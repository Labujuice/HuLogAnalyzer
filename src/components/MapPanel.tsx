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

type MapLayerType = 'satellite' | 'roadmap';

export function MapPanel({ panelId, currentTimeUs }: MapPanelProps) {
  const { state, requestTopicData } = useApp();
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
        // Request lat, lon
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

  // Interpolate Roll, Pitch, Yaw
  const getYawAt = useCallback((timeUs: number): number => {
    if (!attTopic) return 0;
    const key = `${attTopic.name}:${attTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return 0;

    const q0Arr = data.fields['q[0]'];
    const q1Arr = data.fields['q[1]'];
    const q2Arr = data.fields['q[2]'];
    const q3Arr = data.fields['q[3]'];

    let roll = 0, pitch = 0, yaw = 0;

    if (!q0Arr || !q1Arr || !q2Arr || !q3Arr) {
      const qw = data.fields['q_w'] || data.fields['q.w'] || data.fields['q_0'];
      const qx = data.fields['q_x'] || data.fields['q.x'] || data.fields['q_1'];
      const qy = data.fields['q_y'] || data.fields['q.y'] || data.fields['q_2'];
      const qz = data.fields['q_z'] || data.fields['q.z'] || data.fields['q_3'];
      if (qw && qx && qy && qz) {
        const q0 = interpolateAt(data.timestamps, qw, timeUs);
        const q1 = interpolateAt(data.timestamps, qx, timeUs);
        const q2 = interpolateAt(data.timestamps, qy, timeUs);
        const q3 = interpolateAt(data.timestamps, qz, timeUs);
        yaw = Math.atan2(2 * (q0 * q3 + q1 * q2), 1 - 2 * (q2 * q2 + q3 * q3));
      }
    } else {
      const q0 = interpolateAt(data.timestamps, q0Arr, timeUs);
      const q1 = interpolateAt(data.timestamps, q1Arr, timeUs);
      const q2 = interpolateAt(data.timestamps, q2Arr, timeUs);
      const q3 = interpolateAt(data.timestamps, q3Arr, timeUs);
      yaw = Math.atan2(2 * (q0 * q3 + q1 * q2), 1 - 2 * (q2 * q2 + q3 * q3));
    }

    return yaw * 180 / Math.PI; // Convert to degrees
  }, [attTopic, state.topicCache]);

  // Interpolate Position & entire GPS path array
  const getGpsData = useCallback((): { points: L.LatLngExpression[] } | null => {
    if (!gpsTopic) return null;
    const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    const latArr = data.fields['lat'];
    const lonArr = data.fields['lon'];
    if (!latArr || !lonArr) return null;

    // Detect if scaled by 1e7
    const scale = Math.abs(latArr[0] ?? 0) > 1000 ? 1e7 : 1.0;

    const points: L.LatLngExpression[] = [];
    for (let i = 0; i < data.timestamps.length; i++) {
      points.push([latArr[i] / scale, lonArr[i] / scale]);
    }

    return { points };
  }, [gpsTopic, state.topicCache]);

  // Interpolate single lat/lon point
  const getGpsPositionAt = useCallback((timeUs: number): [number, number] | null => {
    if (!gpsTopic) return null;
    const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    const latArr = data.fields['lat'];
    const lonArr = data.fields['lon'];
    if (!latArr || !lonArr) return null;

    const scale = Math.abs(latArr[0] ?? 0) > 1000 ? 1e7 : 1.0;
    const lat = interpolateAt(data.timestamps, latArr, timeUs) / scale;
    const lon = interpolateAt(data.timestamps, lonArr, timeUs) / scale;

    return [lat, lon];
  }, [gpsTopic, state.topicCache]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || !hasGps) return;

    // 1. Create map instance
    const map = L.map(mapContainerRef.current, {
      zoomControl: false, // Custom position zoom control
      attributionControl: false,
    });
    mapRef.current = map;

    // Default center at 0,0 until coordinates load
    map.setView([0, 0], 2);

    // 2. Setup Tile Layer
    const getTileUrl = (type: MapLayerType) => {
      // Standard Google Tiles url (m = roadmap, s = satellite, y = hybrid)
      return type === 'satellite'
        ? 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
        : 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
    };

    const tileLayer = L.tileLayer(getTileUrl(layerType), {
      maxZoom: 20,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // Custom Zoom buttons position
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // 3. Create Flight Path Polylines
    // 尚未飛過的未來航線 (黃色虛線)
    const remainingPathPoly = L.polyline([], {
      color: '#eab308', // Yellow
      weight: 3,
      opacity: 0.8,
      dashArray: '6, 6',
    }).addTo(map);
    remainingPathPolyRef.current = remainingPathPoly;

    const activePathPoly = L.polyline([], {
      color: '#ef4444', // Red (已飛過)
      weight: 4,
      opacity: 0.9,
    }).addTo(map);
    activePathPolyRef.current = activePathPoly;

    // 4. Create Custom Drone Marker with heading rotation
    // A CSS-styled pointer arrow inside Leaflet DivIcon
    const droneIcon = L.divIcon({
      html: `
        <div class="${styles.droneMarkerWrap}">
          <div id="leaflet-drone-pointer" class="${styles.droneMarkerArrow}"></div>
          <div class="${styles.droneMarkerPulse}"></div>
        </div>
      `,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });

    const marker = L.marker([0, 0], { icon: droneIcon }).addTo(map);
    markerRef.current = marker;

    // Find the arrow DOM element once
    const element = marker.getElement();
    if (element) {
      const arrow = element.querySelector('#leaflet-drone-pointer') as HTMLDivElement;
      if (arrow) markerIconRef.current = arrow;
    }

    // 5. Fit Bounds once the entire path becomes available (removed static from init, handled reactively below)

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
    const url = layerType === 'satellite'
      ? 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'
      : 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
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
        // Find pointer inside DOM
        if (!markerIconRef.current) {
          const el = marker.getElement();
          if (el) {
            const arrow = el.querySelector('#leaflet-drone-pointer') as HTMLDivElement;
            if (arrow) markerIconRef.current = arrow;
          }
        }
        if (markerIconRef.current) {
          // Leaflet coordinates usually reset transitions, we override using transform rotate
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

    // Initial sync
    updateGpsMap(timePublisher.getTime());

    return unsubscribe;
  }, [getGpsPositionAt, getYawAt, getGpsData, followDrone, gpsTopic, state.topicCache]);

  if (!hasGps) {
    return (
      <div className={styles.root}>
        <div className={styles.noData}>
          <span>⚠️ 找不到 GPS 定位數據 (`vehicle_gps_position`)</span>
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
          onClick={() => setLayerType(layerType === 'satellite' ? 'roadmap' : 'satellite')}
          title="切換衛星圖 / 道路圖"
        >
          {layerType === 'satellite' ? '🗺️ 道路圖' : '🛰️ 衛星圖'}
        </button>

        <button
          className={`${styles.overlayBtn} ${followDrone ? styles.active : ''}`}
          onClick={() => setFollowDrone(!followDrone)}
          title="跟隨飛機位置"
        >
          {followDrone ? '📍 已鎖定' : '📍 跟隨飛機'}
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
          title="縮放至完整軌跡"
        >
          🔍 完整視野
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
