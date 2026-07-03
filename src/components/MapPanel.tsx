import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApp } from '../store/appStore';
import { interpolateAt } from '../parser/utils';
import { timePublisher } from '../store/timePublisher';
import styles from './MapPanel.module.css';

interface MapPanelProps {
  panelId: string;
  currentTimeUs: number;
}

type MapLayerType = 'satellite' | 'roadmap' | 'terrain';

export function MapPanel({ panelId, currentTimeUs }: MapPanelProps) {
  const { state, requestTopicData } = useApp();
  const { language } = state;
  const mapContainerRef = useRef<HTMLDivElement>(null);

  // Leaflet map instances
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const remainingPathPolyRef = useRef<L.Polyline | null>(null);
  const activePathPolyRef = useRef<L.Polyline | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const markerIconRef = useRef<HTMLDivElement | null>(null); // To apply CSS rotation

  // Map state settings
  const [layerType, setLayerType] = useState<MapLayerType>('satellite');
  const [followDrone, setFollowDrone] = useState<boolean>(true);

  // Find topics
  const gpsTopic = state.summary?.topics.find(
    t => t.name === 'vehicle_gps_position' || t.name === 'vehicle_global_position' || t.name.includes('gps') || t.name.includes('global_position')
  );
  const attTopic = state.summary?.topics.find(
    t => t.name === 'vehicle_attitude' || t.name.includes('vehicle_attitude')
  );

  const [hasGps, setHasGps] = useState<boolean>(!!gpsTopic);

  // Request GPS and Attitude data
  useEffect(() => {
    if (gpsTopic) {
      const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
      if (!state.topicCache[key]) {
        requestTopicData(gpsTopic.name, gpsTopic.multiId, ['lat', 'lon']);
      }
    } else {
      setHasGps(false);
    }

    if (attTopic) {
      const key = `${attTopic.name}:${attTopic.multiId}`;
      if (!state.topicCache[key]) {
        const qFields = attTopic.fields.filter(f => f.startsWith('q['));
        requestTopicData(attTopic.name, attTopic.multiId, qFields.length > 0 ? qFields : attTopic.fields);
      }
    }
  }, [gpsTopic, attTopic, state.topicCache, requestTopicData]);

  // Read GPS Points cache
  const getGpsData = useCallback((): { points: L.LatLngTuple[] } | null => {
    if (!gpsTopic) return null;
    const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    const latArr = data.fields['lat'];
    const lonArr = data.fields['lon'];
    if (!latArr || !lonArr) return null;

    const points: L.LatLngTuple[] = [];
    for (let i = 0; i < data.timestamps.length; i++) {
      // PX4 GPS values are stored as degrees * 1e7
      const lat = latArr[i] > 180 ? latArr[i] / 1e7 : latArr[i];
      const lon = lonArr[i] > 180 ? lonArr[i] / 1e7 : lonArr[i];
      points.push([lat, lon]);
    }
    return { points };
  }, [gpsTopic, state.topicCache]);

  // Interpolate Position at specific time
  const getGpsPositionAt = useCallback((timeUs: number): L.LatLngTuple | null => {
    if (!gpsTopic) return null;
    const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    const latArr = data.fields['lat'];
    const lonArr = data.fields['lon'];
    if (!latArr || !lonArr) return null;

    const rawLat = interpolateAt(data.timestamps, latArr, timeUs);
    const rawLon = interpolateAt(data.timestamps, lonArr, timeUs);

    const lat = rawLat > 180 ? rawLat / 1e7 : rawLat;
    const lon = rawLon > 180 ? rawLon / 1e7 : rawLon;

    return [lat, lon];
  }, [gpsTopic, state.topicCache]);

  // Interpolate Yaw heading at specific time
  const getYawAt = useCallback((timeUs: number): number => {
    if (!attTopic) return 0;
    const key = `${attTopic.name}:${attTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return 0;

    const q0Arr = data.fields['q[0]'];
    const q1Arr = data.fields['q[1]'];
    const q2Arr = data.fields['q[2]'];
    const q3Arr = data.fields['q[3]'];

    let q0 = 1, q1 = 0, q2 = 0, q3 = 0;

    if (!q0Arr || !q1Arr || !q2Arr || !q3Arr) {
      const qw = data.fields['q_w'] || data.fields['q.w'] || data.fields['q_0'];
      const qx = data.fields['q_x'] || data.fields['q.x'] || data.fields['q_1'];
      const qy = data.fields['q_y'] || data.fields['q.y'] || data.fields['q_2'];
      const qz = data.fields['q_z'] || data.fields['q.z'] || data.fields['q_3'];
      if (qw && qx && qy && qz) {
        q0 = interpolateAt(data.timestamps, qw, timeUs);
        q1 = interpolateAt(data.timestamps, qx, timeUs);
        q2 = interpolateAt(data.timestamps, qy, timeUs);
        q3 = interpolateAt(data.timestamps, qz, timeUs);
      }
    } else {
      q0 = interpolateAt(data.timestamps, q0Arr, timeUs);
      q1 = interpolateAt(data.timestamps, q1Arr, timeUs);
      q2 = interpolateAt(data.timestamps, q2Arr, timeUs);
      q3 = interpolateAt(data.timestamps, q3Arr, timeUs);
    }

    // Solve Euler Yaw from quaternions
    const yaw = Math.atan2(2 * (q0 * q3 + q1 * q2), 1 - 2 * (q2 * q2 + q3 * q3));
    return (yaw * 180 / Math.PI + 360) % 360;
  }, [attTopic, state.topicCache]);

  // Setup Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || !hasGps) return;

    // 1. Initialize Map centered at [0,0]
    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([0, 0], 2);
    mapRef.current = map;

    // 2. Load Google Satellite Hybrid Layer by default
    const tileLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      maxZoom: 22,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // 3. Setup Path Polylines
    // 未走過的軌跡 (黃色虛線)
    const remainingPathPoly = L.polyline([], {
      color: '#eab308',
      weight: 3,
      dashArray: '5, 8',
      opacity: 0.75,
    }).addTo(map);
    remainingPathPolyRef.current = remainingPathPoly;

    // 已走過的軌跡 (紅色實線)
    const activePathPoly = L.polyline([], {
      color: '#ef4444',
      weight: 4,
      opacity: 0.9,
    }).addTo(map);
    activePathPolyRef.current = activePathPoly;

    // 4. Custom Icon (Aircraft pointer with radar ripple)
    const droneIcon = L.divIcon({
      html: `
        <div class="${styles.droneMarkerWrap}">
          <div class="${styles.droneMarkerPulse}"></div>
          <div id="leaflet-drone-pointer" class="${styles.droneMarkerArrow}">
            <svg viewBox="0 0 24 24" width="24" height="24">
              <path d="M12 3L21 20H3L12 3Z" fill="#ef4444" stroke="#000000" stroke-width="2.5" stroke-linejoin="round" />
            </svg>
          </div>
        </div>
      `,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    const marker = L.marker([0, 0], { icon: droneIcon }).addTo(map);
    markerRef.current = marker;

    const element = marker.getElement();
    if (element) {
      const arrow = element.querySelector('#leaflet-drone-pointer') as HTMLDivElement;
      if (arrow) markerIconRef.current = arrow;
    }

    // 5. Fit Bounds once (handled reactively below)

    // 6. Resize Observer
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(mapContainerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [hasGps]);

  const hasFittedBoundsRef = useRef<boolean>(false);

  // 實時自動縮放至完整視野（資料載入完成時執行且僅執行一次）
  useEffect(() => {
    if (hasFittedBoundsRef.current) return;
    const map = mapRef.current;
    if (!map) return;

    const gpsData = getGpsData();
    if (gpsData && gpsData.points.length > 0) {
      const bounds = L.latLngBounds(gpsData.points);
      map.fitBounds(bounds, { padding: [30, 30] });
      hasFittedBoundsRef.current = true;
    }
  }, [state.topicCache, getGpsData]);

  // Handle Tile Layer Switch
  useEffect(() => {
    if (!tileLayerRef.current) return;
    let url = 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'; // satellite hybrid
    if (layerType === 'roadmap') {
      url = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}'; // roadmap
    } else if (layerType === 'terrain') {
      url = 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'; // terrain map
    }
    tileLayerRef.current.setUrl(url);
  }, [layerType]);

  // Sync Drone Position, Heading & Trail via timePublisher
  useEffect(() => {
    const updateGpsMap = (timeUs: number) => {
      const map = mapRef.current;
      const marker = markerRef.current;
      if (!map || !marker) return;

      const pos = getGpsPositionAt(timeUs);
      if (pos) {
        // Move marker
        marker.setLatLng(pos);

        // Apply Heading Rotation
        const yawDeg = getYawAt(timeUs);
        if (!markerIconRef.current) {
          const el = marker.getElement();
          if (el) {
            const arrow = el.querySelector('#leaflet-drone-pointer') as HTMLDivElement;
            if (arrow) markerIconRef.current = arrow;
          }
        }
        if (markerIconRef.current) {
          markerIconRef.current.style.transform = `rotate(${yawDeg}deg)`;
        }

        // Draw active path (0 -> lo) and remaining path (lo -> end)
        if (gpsTopic) {
          const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
          const data = state.topicCache[key];
          if (data) {
            let lo = 0;
            let hi = data.timestamps.length - 1;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (data.timestamps[mid] < timeUs) lo = mid + 1;
              else hi = mid;
            }
            const gpsData = getGpsData();
            if (gpsData) {
              // 已飛過的路徑
              if (activePathPolyRef.current) {
                const activePoints = gpsData.points.slice(0, lo + 1);
                activePathPolyRef.current.setLatLngs(activePoints);
              }
              // 尚未飛過的路徑
              if (remainingPathPolyRef.current) {
                const remainingPoints = gpsData.points.slice(lo);
                remainingPathPolyRef.current.setLatLngs(remainingPoints);
              }
            }
          }
        }

        // Auto Center Map
        if (followDrone) {
          map.panTo(pos, { animate: true, duration: 0.1 });
        }
      }
    };

    const unsubscribe = timePublisher.subscribe(updateGpsMap);
    updateGpsMap(timePublisher.getTime());

    return unsubscribe;
  }, [getGpsPositionAt, getYawAt, getGpsData, followDrone, gpsTopic, state.topicCache]);

  if (!hasGps) {
    return (
      <div className={styles.root}>
        <div className={styles.noData}>
          <span>{language === 'en' ? '⚠️ No GPS / position data found' : '⚠️ 找不到 GPS 定位數據 (`vehicle_gps_position`)'}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {/* Floating Control Overlay */}
      <div className={styles.mapOverlay}>
        <button
          className={`${styles.overlayBtn} ${layerType === 'satellite' ? styles.active : ''}`}
          onClick={() => setLayerType('satellite')}
          title={language === 'en' ? 'Satellite Hybrid Map' : '切換衛星混合地圖'}
        >
          🛰️ {language === 'en' ? 'Satellite' : '衛星圖'}
        </button>

        <button
          className={`${styles.overlayBtn} ${layerType === 'roadmap' ? styles.active : ''}`}
          onClick={() => setLayerType('roadmap')}
          title={language === 'en' ? 'Street Roadmap' : '切換街道向量地圖'}
        >
          🗺️ {language === 'en' ? 'Street' : '道路圖'}
        </button>

        <button
          className={`${styles.overlayBtn} ${layerType === 'terrain' ? styles.active : ''}`}
          onClick={() => setLayerType('terrain')}
          title={language === 'en' ? 'Terrain Map with Hillshading' : '切換等高線地形地貌圖'}
        >
          ⛰️ {language === 'en' ? 'Terrain' : '地形圖'}
        </button>

        <span className={styles.divider}>|</span>

        <button
          className={`${styles.overlayBtn} ${followDrone ? styles.active : ''}`}
          onClick={() => setFollowDrone(!followDrone)}
          title={language === 'en' ? 'Follow vehicle position' : '鎖定跟隨無人機位置'}
        >
          📍 {followDrone ? (language === 'en' ? 'Locked' : '已鎖定') : (language === 'en' ? 'Follow' : '跟隨飛機')}
        </button>

        <button
          className={styles.overlayBtn}
          onClick={() => {
            if (mapRef.current) {
              const gpsData = getGpsData();
              if (gpsData && gpsData.points.length > 0) {
                const bounds = L.latLngBounds(gpsData.points);
                mapRef.current.fitBounds(bounds, { padding: [20, 20] });
              }
            }
          }}
          title={language === 'en' ? 'Fit view bounds to entire flight trail' : '縮放至完整飛行軌跡'}
        >
          🔍 {language === 'en' ? 'Fit Path' : '完整視野'}
        </button>
      </div>

      <div ref={mapContainerRef} className={styles.mapContainer} />
    </div>
  );
}

// ─── 尤拉角四元數轉換工具 ──────────────────────────────────────────────────────

function quatToEuler(q0: number, q1: number, q2: number, q3: number) {
  const roll = Math.atan2(2 * (q0 * q1 + q2 * q3), 1 - 2 * (q1 * q1 + q2 * q2));
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q0 * q2 - q3 * q1))));
  const yaw = Math.atan2(2 * (q0 * q3 + q1 * q2), 1 - 2 * (q2 * q2 + q3 * q3));
  return { roll, pitch, yaw };
}
