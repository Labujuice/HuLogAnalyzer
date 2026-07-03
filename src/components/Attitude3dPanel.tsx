import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useApp } from '../store/appStore';
import { interpolateAt } from '../parser/utils';
import { timePublisher } from '../store/timePublisher';
import styles from './Attitude3dPanel.module.css';

interface Attitude3dPanelProps {
  panelId: string;
  currentTimeUs: number;
}

export function Attitude3dPanel({ panelId, currentTimeUs }: Attitude3dPanelProps) {
  const { state, requestTopicData } = useApp();
  const mountRef = useRef<HTMLDivElement>(null);

  // Three.js instances
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const droneRef = useRef<THREE.Group | null>(null);
  const remainingPathLineRef = useRef<THREE.Line | null>(null);
  const remainingGeomRef = useRef<THREE.BufferGeometry | null>(null);
  const activePathLineRef = useRef<THREE.Line | null>(null);
  const activeGeomRef = useRef<THREE.BufferGeometry | null>(null);

  // 地面投影與垂線
  const groundPathLineRef = useRef<THREE.Line | null>(null);
  const groundGeomRef = useRef<THREE.BufferGeometry | null>(null);
  const verticalLineRef = useRef<THREE.Line | null>(null);
  const verticalGeomRef = useRef<THREE.BufferGeometry | null>(null);

  // 衛星地圖貼圖群組
  const satelliteGroupRef = useRef<THREE.Group | null>(null);
  const [showSatellite, setShowSatellite] = useState<boolean>(true); // 預設啟用

  // Camera angles & zoom
  const cameraTheta = useRef<number>(Math.PI / 4);
  const cameraPhi = useRef<number>(Math.PI / 3);
  const cameraRadius = useRef<number>(6);
  const cameraTargetRef = useRef(new THREE.Vector3(0, 0, 0));

  // Follow mode state
  const [isFollowing, setIsFollowing] = useState<boolean>(true);
  const isFollowingRef = useRef<boolean>(true);
  useEffect(() => {
    isFollowingRef.current = isFollowing;
  }, [isFollowing]);

  // Drag state
  const isDragging = useRef<boolean>(false);
  const dragMode = useRef<'none' | 'rotate' | 'pan'>('none');
  const lastMouseX = useRef<number>(0);
  const lastMouseY = useRef<number>(0);

  // Find topics
  const attTopic = state.summary?.topics.find(
    t => t.name === 'vehicle_attitude' || t.name.includes('vehicle_attitude')
  );
  const posTopic = state.summary?.topics.find(
    t => t.name === 'vehicle_local_position' || t.name.includes('vehicle_local_position')
  );
  const gpsTopic = state.summary?.topics.find(
    t => t.name === 'vehicle_gps_position' || t.name === 'vehicle_global_position' || t.name.includes('gps') || t.name.includes('global_position')
  );

  const [hasAttitude, setHasAttitude] = useState<boolean>(!!attTopic);

  // Request topic data if not loaded
  useEffect(() => {
    if (attTopic) {
      const key = `${attTopic.name}:${attTopic.multiId}`;
      if (!state.topicCache[key]) {
        const qFields = attTopic.fields.filter(f => f.startsWith('q['));
        requestTopicData(attTopic.name, attTopic.multiId, qFields.length > 0 ? qFields : attTopic.fields);
      }
    } else {
      setHasAttitude(false);
    }

    if (posTopic) {
      const key = `${posTopic.name}:${posTopic.multiId}`;
      if (!state.topicCache[key]) {
        // Request x, y, z AND dist_bottom (range to ground) if available
        const posFields = ['x', 'y', 'z'];
        if (posTopic.fields.includes('dist_bottom')) {
          posFields.push('dist_bottom');
        }
        requestTopicData(posTopic.name, posTopic.multiId, posFields);
      }
    }

    if (gpsTopic) {
      const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
      if (!state.topicCache[key]) {
        requestTopicData(gpsTopic.name, gpsTopic.multiId, ['lat', 'lon']);
      }
    }
  }, [attTopic, posTopic, gpsTopic, state.topicCache, requestTopicData]);

  // Interpolate Roll, Pitch, Yaw from quaternion in state cache
  const getAttitudeAnglesAt = useCallback((timeUs: number): { roll: number; pitch: number; yaw: number } | null => {
    if (!attTopic) return null;
    const key = `${attTopic.name}:${attTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    const q0Arr = data.fields['q[0]'];
    const q1Arr = data.fields['q[1]'];
    const q2Arr = data.fields['q[2]'];
    const q3Arr = data.fields['q[3]'];

    if (!q0Arr || !q1Arr || !q2Arr || !q3Arr) {
      const qw = data.fields['q_w'] || data.fields['q.w'] || data.fields['q_0'];
      const qx = data.fields['q_x'] || data.fields['q.x'] || data.fields['q_1'];
      const qy = data.fields['q_y'] || data.fields['q.y'] || data.fields['q_2'];
      const qz = data.fields['q_z'] || data.fields['q.z'] || data.fields['q_3'];
      if (!qw || !qx || !qy || !qz) return null;

      const q0 = interpolateAt(data.timestamps, qw, timeUs);
      const qxVal = interpolateAt(data.timestamps, qx, timeUs);
      const qyVal = interpolateAt(data.timestamps, qy, timeUs);
      const qzVal = interpolateAt(data.timestamps, qz, timeUs);

      return quatToEuler(q0, qxVal, qyVal, qzVal);
    }

    const q0 = interpolateAt(data.timestamps, q0Arr, timeUs);
    const q1 = interpolateAt(data.timestamps, q1Arr, timeUs);
    const q2 = interpolateAt(data.timestamps, q2Arr, timeUs);
    const q3 = interpolateAt(data.timestamps, q3Arr, timeUs);

    return quatToEuler(q0, q1, q2, q3);
  }, [attTopic, state.topicCache]);

  // Interpolate Position from local position in state cache
  const getPositionAt = useCallback((timeUs: number): { x: number; y: number; z: number; points: THREE.Vector3[] } | null => {
    if (!posTopic) return null;
    const key = `${posTopic.name}:${posTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    const xArr = data.fields['x'];
    const yArr = data.fields['y'];
    const zArr = data.fields['z'];
    if (!xArr || !yArr || !zArr) return null;

    // 起飛點為原點 (減去第一點的數值)
    const startX = xArr[0] ?? 0;
    const startY = yArr[0] ?? 0;
    const startZ = zArr[0] ?? 0;

    const xVal = interpolateAt(data.timestamps, xArr, timeUs);
    const yVal = interpolateAt(data.timestamps, yArr, timeUs);
    const zVal = interpolateAt(data.timestamps, zArr, timeUs);

    // NED 轉 WebGL 座標系映射
    const currentPos = {
      x: yVal - startY,    // East -> WebGL X
      y: -(zVal - startZ), // Down -> WebGL Y (高度向上)
      z: -(xVal - startX), // North -> WebGL Z (後退)
    };

    // 建立整條飛行軌跡點
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < data.timestamps.length; i++) {
      const px = yArr[i] - startY;
      const py = -(zArr[i] - startZ);
      const pz = -(xArr[i] - startX);
      points.push(new THREE.Vector3(px, py, pz));
    }

    return { ...currentPos, points };
  }, [posTopic, state.topicCache]);

  // 獲取起飛點 GPS 座標作為原點
  const getGpsHome = useCallback((): { lat: number; lon: number } | null => {
    if (!gpsTopic) return null;
    const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    const latArr = data.fields['lat'];
    const lonArr = data.fields['lon'];
    if (!latArr || !lonArr || latArr.length === 0) return null;

    // 尋找第一個有效 GPS 位置
    for (let i = 0; i < latArr.length; i++) {
      let lat = latArr[i];
      let lon = lonArr[i];
      if (lat !== 0 && lon !== 0) {
        if (lat > 180) lat /= 1e7;
        if (lon > 180) lon /= 1e7;
        return { lat, lon };
      }
    }
    return null;
  }, [gpsTopic, state.topicCache]);

  // Setup Three.js Scene
  useEffect(() => {
    if (!mountRef.current || !hasAttitude) return;

    const container = mountRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene & Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0f1d');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight1.position.set(5, 15, 7);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x3b82f6, 0.4);
    dirLight2.position.set(-5, -5, -5);
    scene.add(dirLight2);

    // 3. Grid Ground & Axes
    const gridHelper = new THREE.GridHelper(50, 50, '#1e293b', '#0f172a');
    gridHelper.position.y = -0.01; // 略低於起飛高度，防閃爍
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(2);
    axesHelper.position.set(0, 0, 0);
    scene.add(axesHelper);

    // 4. Setup Satellite Group
    const satelliteGroup = new THREE.Group();
    scene.add(satelliteGroup);
    satelliteGroupRef.current = satelliteGroup;
    satelliteGroup.visible = showSatellite;

    // 5. Build Custom 3D Drone Model
    const droneGroup = new THREE.Group();
    scene.add(droneGroup);
    droneRef.current = droneGroup;

    // Center Hub
    const hubGeom = new THREE.BoxGeometry(0.5, 0.1, 0.5);
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.4, metalness: 0.8 });
    const hub = new THREE.Mesh(hubGeom, bodyMat);
    droneGroup.add(hub);

    // Nose Cone
    const noseGeom = new THREE.ConeGeometry(0.12, 0.25, 4);
    noseGeom.rotateX(-Math.PI / 2);
    const noseMat = new THREE.MeshStandardMaterial({ color: '#ef4444' });
    const nose = new THREE.Mesh(noseGeom, noseMat);
    nose.position.set(0, 0, -0.3);
    droneGroup.add(nose);

    // Arms
    const armGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.8);
    armGeom.rotateX(Math.PI / 2);
    const arm1 = new THREE.Mesh(armGeom, bodyMat);
    arm1.rotation.y = Math.PI / 4;
    droneGroup.add(arm1);
    const arm2 = new THREE.Mesh(armGeom, bodyMat);
    arm2.rotation.y = -Math.PI / 4;
    droneGroup.add(arm2);

    // Motors & Props
    const motorGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.08);
    const motorMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.9 });
    const propGeom = new THREE.BoxGeometry(0.3, 0.005, 0.02);
    const propMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', transparent: true, opacity: 0.8 });

    const armLength = 0.4;
    const angles = [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
    const props: THREE.Mesh[] = [];

    angles.forEach((angle, idx) => {
      const x = Math.sin(angle) * armLength;
      const z = Math.cos(angle) * armLength;
      const motor = new THREE.Mesh(motorGeom, motorMat);
      motor.position.set(x, 0.06, z);
      droneGroup.add(motor);

      const prop = new THREE.Mesh(propGeom, propMat);
      prop.position.set(x, 0.11, z);
      droneGroup.add(prop);
      props.push(prop);
    });

    // 6. Initialize Path Lines
    // 尚未飛過的未來航線 (黃色)
    const remainingGeom = new THREE.BufferGeometry();
    const remainingMat = new THREE.LineBasicMaterial({
      color: '#eab308',
      transparent: true,
      opacity: 0.6,
    });
    const remainingPathLine = new THREE.Line(remainingGeom, remainingMat);
    scene.add(remainingPathLine);
    remainingPathLineRef.current = remainingPathLine;
    remainingGeomRef.current = remainingGeom;

    // 播放中已飛過的發光航線 (紅色)
    const activeGeom = new THREE.BufferGeometry();
    const activeMat = new THREE.LineBasicMaterial({
      color: '#ef4444',
      linewidth: 2,
    });
    const activePathLine = new THREE.Line(activeGeom, activeMat);
    scene.add(activePathLine);
    activePathLineRef.current = activePathLine;
    activeGeomRef.current = activeGeom;

    // 地面軌跡投影線 (深藍灰色)
    const groundGeom = new THREE.BufferGeometry();
    const groundMat = new THREE.LineBasicMaterial({
      color: '#475569',
      linewidth: 1,
      transparent: true,
      opacity: 0.8,
    });
    const groundPathLine = new THREE.Line(groundGeom, groundMat);
    scene.add(groundPathLine);
    groundPathLineRef.current = groundPathLine;
    groundGeomRef.current = groundGeom;

    // 垂直投影垂線 (白色虛線)
    const verticalGeom = new THREE.BufferGeometry();
    const verticalMat = new THREE.LineBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.5,
    });
    const verticalLine = new THREE.Line(verticalGeom, verticalMat);
    scene.add(verticalLine);
    verticalLineRef.current = verticalLine;
    verticalGeomRef.current = verticalGeom;

    // 7. Animation loop
    let animId: number;
    let propRot = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      // 旋轉螺旋槳
      if (state.playback.isPlaying) {
        propRot += 0.25 * state.playback.speedMultiplier;
        props.forEach((p, idx) => {
          p.rotation.y = (idx % 2 === 0 ? 1 : -1) * propRot;
        });
      }

      // 更新相機位置 (Slerp)
      const theta = cameraTheta.current;
      const phi = cameraPhi.current;
      const radius = cameraRadius.current;

      const targetCamPos = new THREE.Vector3(
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
      ).add(cameraTargetRef.current);

      camera.position.lerp(targetCamPos, 0.1);
      camera.lookAt(cameraTargetRef.current);

      renderer.render(scene, camera);
    };
    animate();

    // 8. 註冊滾輪縮放
    const onWheelEvent = (e: WheelEvent) => {
      e.preventDefault();
      cameraRadius.current = Math.max(1.0, Math.min(2000, cameraRadius.current + e.deltaY * 0.015));
    };
    container.addEventListener('wheel', onWheelEvent, { passive: false });

    // 9. Resize Observer
    const ro = new ResizeObserver(() => {
      if (!rendererRef.current) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(animId);
      container.removeEventListener('wheel', onWheelEvent);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
    };
  }, [hasAttitude]);

  // Toggle Satellite Visibility Reactively
  useEffect(() => {
    if (satelliteGroupRef.current) {
      satelliteGroupRef.current.visible = showSatellite;
    }
  }, [showSatellite]);

  // Load Satellite Ground Texture Async
  useEffect(() => {
    if (!sceneRef.current || !satelliteGroupRef.current) return;

    // 清空舊貼圖
    while (satelliteGroupRef.current.children.length > 0) {
      satelliteGroupRef.current.remove(satelliteGroupRef.current.children[0]);
    }

    const home = getGpsHome();
    if (!home) return;

    const localPoints = getPositionAt(0)?.points ?? [];
    if (localPoints.length === 0) return;

    // 計算水平航線的最大包絡半徑
    let maxRadius = 100;
    localPoints.forEach((pt) => {
      const dist = Math.sqrt(pt.x * pt.x + pt.z * pt.z);
      if (dist > maxRadius) maxRadius = dist;
    });

    const lat0 = home.lat * Math.PI / 180;
    const cosLat = Math.cos(lat0);
    const C = 40075016.686;

    // 計算合適的 Google 瓦片 Zoom Level
    const ratio = (1.5 * C * cosLat) / maxRadius;
    let zoom = Math.floor(Math.log2(ratio));
    zoom = Math.max(12, Math.min(19, zoom)); // 限制在 Zoom 12 到 19 之間

    const tileX = Math.floor(((home.lon + 180) / 360) * Math.pow(2, zoom));
    const tileY = Math.floor(((1 - Math.log(Math.tan((home.lat * Math.PI) / 180) + 1 / Math.cos((home.lat * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, zoom));
    const tileSize = (C * cosLat) / Math.pow(2, zoom);

    const homeMercX = (home.lon + 180) / 360;
    const homeMercY = (1 - Math.log(Math.tan((home.lat * Math.PI) / 180) + 1 / Math.cos((home.lat * Math.PI) / 180)) / Math.PI) / 2;

    const textureLoader = new THREE.TextureLoader();

    // 載入 3x3 瓦片以覆蓋整個飛行航線
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tx = tileX + dx;
        const ty = tileY + dy;
        const url = `https://mt1.google.com/vt/lyrs=s&x=${tx}&y=${ty}&z=${zoom}`;

        const tileMercX = (tx + 0.5) / Math.pow(2, zoom);
        const tileMercY = (ty + 0.5) / Math.pow(2, zoom);

        const relX = (tileMercX - homeMercX) * C * cosLat;
        const relY = -(tileMercY - homeMercY) * C * cosLat;

        const geom = new THREE.PlaneGeometry(tileSize, tileSize);
        const texture = textureLoader.load(url);
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        
        const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotateX(-Math.PI / 2);
        mesh.position.set(relX, -0.05, -relY); // 略微下沉避開 Z 衝突
        satelliteGroupRef.current.add(mesh);
      }
    }
  }, [state.topicCache, gpsTopic, getGpsHome, getPositionAt]);

  // Sync Att & Pos via timePublisher Emitter
  useEffect(() => {
    const updateAttitudeAndPosition = (timeUs: number) => {
      const drone = droneRef.current;
      if (!drone) return;

      // 1. Update Attitude
      const att = getAttitudeAnglesAt(timeUs);
      if (att) {
        // NED: Pitch (x), Roll (y), Yaw (z). WebGL Euler rotation: 'YXZ' using Pitch, -Yaw, -Roll
        drone.rotation.set(att.pitch, -att.yaw, -att.roll, 'YXZ');
      }

      // 2. Update Position
      const pos = getPositionAt(timeUs);
      if (pos) {
        drone.position.set(pos.x, pos.y, pos.z);

        if (isFollowingRef.current) {
          cameraTargetRef.current.copy(drone.position);
        }

        // 3. Update paths
        if (posTopic) {
          const key = `${posTopic.name}:${posTopic.multiId}`;
          const posData = state.topicCache[key];
          
          if (posData) {
            let lo = 0;
            let hi = posData.timestamps.length - 1;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (posData.timestamps[mid] < timeUs) lo = mid + 1;
              else hi = mid;
            }

            // 3D 已飛過的路徑
            if (activeGeomRef.current) {
              const activePoints = pos.points.slice(0, lo + 1);
              activeGeomRef.current.setFromPoints(activePoints);
              activeGeomRef.current.computeBoundingSphere();
              activeGeomRef.current.computeBoundingBox();
            }

            // 3D 尚未飛過的路徑
            if (remainingGeomRef.current) {
              const remainingPoints = pos.points.slice(lo);
              remainingGeomRef.current.setFromPoints(remainingPoints);
              remainingGeomRef.current.computeBoundingSphere();
              remainingGeomRef.current.computeBoundingBox();
            }

            // 4. 地面投影軌跡與實時地貌資料解析
            if (groundGeomRef.current) {
              const distBottomArr = posData.fields['dist_bottom'];
              const groundPoints: THREE.Vector3[] = [];

              for (let i = 0; i <= lo; i++) {
                const pt = pos.points[i];
                let groundY = 0; // 預設平面
                if (distBottomArr && distBottomArr[i] !== undefined && distBottomArr[i] > 0 && distBottomArr[i] < 1000) {
                  // 地貌高度 = 飛行高度 - 與地面距離 (dist_bottom)
                  groundY = pt.y - distBottomArr[i];
                }
                groundPoints.push(new THREE.Vector3(pt.x, groundY, pt.z));
              }

              groundGeomRef.current.setFromPoints(groundPoints);
              groundGeomRef.current.computeBoundingSphere();
              groundGeomRef.current.computeBoundingBox();
            }

            // 5. 實時垂直垂線 (Plumb Line)
            if (verticalGeomRef.current) {
              const distBottomArr = posData.fields['dist_bottom'];
              let groundY = 0;
              if (distBottomArr) {
                const currentDistBottom = interpolateAt(posData.timestamps, distBottomArr, timeUs);
                if (currentDistBottom > 0 && currentDistBottom < 1000) {
                  groundY = pos.y - currentDistBottom;
                }
              }

              const verticalPoints = [
                new THREE.Vector3(pos.x, pos.y, pos.z),
                new THREE.Vector3(pos.x, groundY, pos.z),
              ];
              verticalGeomRef.current.setFromPoints(verticalPoints);
              verticalGeomRef.current.computeBoundingSphere();
              verticalGeomRef.current.computeBoundingBox();
            }
          }
        }
      }
    };

    const unsubscribe = timePublisher.subscribe(updateAttitudeAndPosition);
    updateAttitudeAndPosition(timePublisher.getTime());

    return unsubscribe;
  }, [getAttitudeAnglesAt, getPositionAt, posTopic, state.topicCache]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastMouseX.current = e.clientX;
    lastMouseY.current = e.clientY;

    if (e.button === 1 || e.button === 2) {
      dragMode.current = 'pan';
    } else {
      dragMode.current = 'rotate';
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const deltaX = e.clientX - lastMouseX.current;
    const deltaY = e.clientY - lastMouseY.current;
    lastMouseX.current = e.clientX;
    lastMouseY.current = e.clientY;

    if (dragMode.current === 'rotate') {
      cameraTheta.current -= deltaX * 0.006;
      cameraPhi.current = Math.max(0.01, Math.min(Math.PI - 0.01, cameraPhi.current - deltaY * 0.006));
    } else if (dragMode.current === 'pan' && cameraRef.current) {
      setIsFollowing(false);

      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraRef.current.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraRef.current.quaternion);
      
      const factor = cameraRadius.current * 0.0015;
      cameraTargetRef.current.addScaledVector(right, -deltaX * factor);
      cameraTargetRef.current.addScaledVector(up, deltaY * factor);
    }
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    dragMode.current = 'none';
  };

  if (!hasAttitude) {
    return (
      <div className={styles.root}>
        <div className={styles.noData}>
          <span>{state.language === 'en' ? '⚠️ No attitude data found (vehicle_attitude)' : '⚠️ 找不到 3D 姿態數據 (vehicle_attitude)'}</span>
        </div>
      </div>
    );
  }

  const hasGpsData = !!gpsTopic;

  return (
    <div
      className={styles.root}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isDragging.current ? 'grabbing' : 'grab' }}
    >
      <div className={styles.panelTitle}>
        {state.language === 'en' ? '3D Real-Time Attitude & Flight Path Viewer' : '3D 實時姿態與航線軌跡觀測器'}
      </div>

      {/* 3D 控制按鈕浮動列 */}
      <div className={styles.controlOverlay}>
        {hasGpsData && (
          <button
            className={`${styles.overlayBtn} ${showSatellite ? styles.overlayBtnActive : ''}`}
            onClick={() => setShowSatellite(!showSatellite)}
            title={state.language === 'en' ? 'Toggle Google Satellite texture ground' : '切換 Google 衛星空照地面背景'}
          >
            🛰️ {state.language === 'en' ? 'Satellite Ground' : '衛星背景'}
          </button>
        )}

        {!isFollowing && (
          <button
            className={styles.overlayBtn}
            onClick={() => {
              setIsFollowing(true);
              if (droneRef.current) {
                cameraTargetRef.current.copy(droneRef.current.position);
              }
            }}
            title={state.language === 'en' ? 'Lock camera target back onto the drone' : '恢復相機跟隨鎖定飛機'}
          >
            📍 {state.language === 'en' ? 'Follow Drone' : '恢復跟隨'}
          </button>
        )}
      </div>

      <div ref={mountRef} className={styles.canvasContainer} />
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
