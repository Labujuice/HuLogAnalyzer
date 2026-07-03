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

type DroneModelType = 'multirotor' | 'fixwing' | 'car' | 'turtle' | 'eagle' | 'kabibala';

export function Attitude3dPanel({ panelId, currentTimeUs }: Attitude3dPanelProps) {
  const { state, requestTopicData } = useApp();
  const mountRef = useRef<HTMLDivElement>(null);

  // Trigger state when Three.js scene is initialized
  const [sceneReady, setSceneReady] = useState<boolean>(false);

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

  // 衛星地圖貼圖群組與載入防重置守衛
  const satelliteGroupRef = useRef<THREE.Group | null>(null);
  const loadedHomeKeyRef = useRef<string>('');
  const [showSatellite, setShowSatellite] = useState<boolean>(true); // 預設啟用

  // 3D 載具外型選擇
  const [modelType, setModelType] = useState<DroneModelType>('multirotor');
  const modelTypeRef = useRef<DroneModelType>(modelType);
  useEffect(() => {
    modelTypeRef.current = modelType;
  }, [modelType]);

  // Use refs to bypass stale closure bugs in the Three.js rendering loop
  const isPlayingRef = useRef<boolean>(state.playback.isPlaying);
  const speedMultiplierRef = useRef<number>(state.playback.speedMultiplier);
  useEffect(() => {
    isPlayingRef.current = state.playback.isPlaying;
    speedMultiplierRef.current = state.playback.speedMultiplier;
  }, [state.playback.isPlaying, state.playback.speedMultiplier]);

  const topicCacheRef = useRef(state.topicCache);
  useEffect(() => {
    topicCacheRef.current = state.topicCache;
  }, [state.topicCache]);

  // 動態旋轉/擺動零件
  const animatedMeshesRef = useRef<THREE.Object3D[]>([]);

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
  const motorTopic = state.summary?.topics.find(
    t => t.name === 'actuator_outputs' || t.name === 'actuator_motors' || t.name.includes('actuator_output') || t.name.includes('actuator_motor')
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

    if (motorTopic) {
      const key = `${motorTopic.name}:${motorTopic.multiId}`;
      if (!state.topicCache[key]) {
        const motorFields = motorTopic.fields.filter(
          f => f.startsWith('output[') || f.startsWith('control[') || f.startsWith('output_') || f.startsWith('control_')
        );
        requestTopicData(motorTopic.name, motorTopic.multiId, motorFields.length > 0 ? motorFields : motorTopic.fields);
      }
    }
  }, [attTopic, posTopic, gpsTopic, motorTopic, state.topicCache, requestTopicData]);

  // Interpolate Roll, Pitch, Yaw from quaternion in state cache
  const getAttitudeAnglesAt = useCallback((timeUs: number): { roll: number; pitch: number; yaw: number } | null => {
    if (!attTopic) return null;
    const key = `${attTopic.name}:${attTopic.multiId}`;
    const data = topicCacheRef.current[key]; // Read from Ref
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
  }, [attTopic]);

  // Interpolate Position from local position in state cache
  const getPositionAt = useCallback((timeUs: number): { x: number; y: number; z: number; points: THREE.Vector3[] } | null => {
    if (!posTopic) return null;
    const key = `${posTopic.name}:${posTopic.multiId}`;
    const data = topicCacheRef.current[key]; // Read from Ref
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
  }, [posTopic]);

  // 獲取起飛點 GPS 座標作為原點
  const getGpsHome = useCallback((): { lat: number; lon: number } | null => {
    if (!gpsTopic) return null;
    const key = `${gpsTopic.name}:${gpsTopic.multiId}`;
    const data = topicCacheRef.current[key]; // Read from Ref
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
  }, [gpsTopic]);

  // 獲取馬達輸出轉速平均值（對應螺旋槳轉動速度比例）
  const getAverageMotorSpeedAt = useCallback((timeUs: number): number => {
    if (!motorTopic) return 1.0;
    const key = `${motorTopic.name}:${motorTopic.multiId}`;
    const data = topicCacheRef.current[key]; // Read from Ref
    if (!data) return 1.0;

    const fields = Object.keys(data.fields);
    const motorFields = fields.filter(
      f => f.startsWith('output[') || f.startsWith('control[') || f.startsWith('output_') || f.startsWith('control_')
    );
    if (motorFields.length === 0) return 1.0;

    let sum = 0;
    let count = 0;
    motorFields.forEach(f => {
      const arr = data.fields[f];
      if (arr) {
        sum += interpolateAt(data.timestamps, arr, timeUs);
        count++;
      }
    });

    if (count === 0) return 1.0;
    const avg = sum / count;

    // 若為 PWM 值 (1000 ~ 2000us)
    if (avg > 500) {
      return Math.max(0.1, (avg - 1000) / 400); // 歸一化比例
    }
    // 若為標準 0.0 ~ 1.0
    return Math.max(0.1, avg * 2.5);
  }, [motorTopic]);

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
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(2);
    axesHelper.position.set(0, 0, 0);
    scene.add(axesHelper);

    // 4. Setup Satellite Group
    const satelliteGroup = new THREE.Group();
    scene.add(satelliteGroup);
    satelliteGroupRef.current = satelliteGroup;
    satelliteGroup.visible = showSatellite;

    // 5. Build Custom 3D Drone Model Group
    const droneGroup = new THREE.Group();
    scene.add(droneGroup);
    droneRef.current = droneGroup;

    // 6. Initialize Path Lines
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

    const activeGeom = new THREE.BufferGeometry();
    const activeMat = new THREE.LineBasicMaterial({
      color: '#ef4444',
      linewidth: 2,
    });
    const activePathLine = new THREE.Line(activeGeom, activeMat);
    scene.add(activePathLine);
    activePathLineRef.current = activePathLine;
    activeGeomRef.current = activeGeom;

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

    const verticalGeom = new THREE.BufferGeometry();
    const verticalLine = new THREE.Line(verticalGeom, new THREE.LineBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.5,
    }));
    scene.add(verticalLine);
    verticalLineRef.current = verticalLine;
    verticalGeomRef.current = verticalGeom;

    // 7. Animation loop
    let animId: number;
    let propRot = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const currentModelType = modelTypeRef.current;

      // 旋轉螺旋槳 / 動態部位 (Read from refs to avoid stale closure)
      if (isPlayingRef.current) {
        const timeUs = timePublisher.getTime();
        const motorSpeed = getAverageMotorSpeedAt(timeUs); // 獲取平均馬達輸出轉速
        
        propRot += 0.25 * speedMultiplierRef.current * motorSpeed;
        const meshes = animatedMeshesRef.current;

        if (currentModelType === 'multirotor') {
          // 旋轉四軸螺旋槳
          meshes.forEach((p, idx) => {
            p.rotation.y = (idx % 2 === 0 ? 1 : -1) * propRot;
          });
        } else if (currentModelType === 'fixwing') {
          // 旋轉機頭單螺旋槳 (繞 Z 軸旋轉)
          if (meshes[0]) meshes[0].rotation.z = propRot;
        } else if (currentModelType === 'car') {
          // 四輪轉動 (繞 X 軸捲動)
          meshes.forEach((w) => {
            w.rotation.x = propRot;
          });
        } else if (currentModelType === 'eagle') {
          // 展翅翱翔 (雙翅 Z 軸上下擺動)
          const flap = Math.sin(propRot * 0.5) * 0.25;
          if (meshes[0]) meshes[0].rotation.z = flap;
          if (meshes[1]) meshes[1].rotation.z = -flap;
        } else if (currentModelType === 'turtle') {
          // 四肢划水 (划動)
          const wiggle = Math.sin(propRot * 0.25) * 0.2;
          meshes.forEach((f, idx) => {
            f.rotation.y = (idx % 2 === 0 ? 1 : -1) * wiggle;
          });
        } else if (currentModelType === 'kabibala') {
          // 水豚小短腿跑步擺動
          const run = Math.sin(propRot * 0.5) * 0.3;
          meshes.forEach((l, idx) => {
            l.rotation.x = (idx % 2 === 0 ? 1 : -1) * run;
          });
        }
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

    // Notify model builder that scene is ready
    setSceneReady(true);

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
      setSceneReady(false);
    };
  }, [hasAttitude, getAverageMotorSpeedAt]);

  // Toggle Satellite Visibility Reactively
  useEffect(() => {
    if (satelliteGroupRef.current) {
      satelliteGroupRef.current.visible = showSatellite;
    }
  }, [showSatellite]);

  // Load Satellite Ground Texture Async (Depends on state.topicCache to load when requested asynchronous data resolves)
  useEffect(() => {
    if (!sceneRef.current || !satelliteGroupRef.current) return;

    const home = getGpsHome();
    if (!home) return;

    const localPoints = getPositionAt(0)?.points ?? [];
    if (localPoints.length === 0) return;

    // 用起飛經緯度做為 Key，防範快取更新時的重複瓦片重構與下載
    const homeKey = `${home.lat.toFixed(5)},${home.lon.toFixed(5)}`;
    if (loadedHomeKeyRef.current === homeKey) return;
    loadedHomeKeyRef.current = homeKey;

    // 清空舊瓦片
    while (satelliteGroupRef.current.children.length > 0) {
      satelliteGroupRef.current.remove(satelliteGroupRef.current.children[0]);
    }

    let maxRadius = 100;
    localPoints.forEach((pt) => {
      const dist = Math.sqrt(pt.x * pt.x + pt.z * pt.z);
      if (dist > maxRadius) maxRadius = dist;
    });

    const lat0 = home.lat * Math.PI / 180;
    const cosLat = Math.cos(lat0);
    const C = 40075016.686;

    const ratio = (1.5 * C * cosLat) / maxRadius;
    let zoom = Math.floor(Math.log2(ratio));
    zoom = Math.max(12, Math.min(19, zoom));

    const tileX = Math.floor(((home.lon + 180) / 360) * Math.pow(2, zoom));
    const tileY = Math.floor(((1 - Math.log(Math.tan((home.lat * Math.PI) / 180) + 1 / Math.cos((home.lat * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, zoom));
    const tileSize = (C * cosLat) / Math.pow(2, zoom);

    const homeMercX = (home.lon + 180) / 360;
    const homeMercY = (1 - Math.log(Math.tan((home.lat * Math.PI) / 180) + 1 / Math.cos((home.lat * Math.PI) / 180)) / Math.PI) / 2;

    const textureLoader = new THREE.TextureLoader();

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
        mesh.position.set(relX, -0.05, -relY);
        satelliteGroupRef.current.add(mesh);
      }
    }
  }, [gpsTopic, posTopic, state.topicCache, getGpsHome, getPositionAt]);

  // Sync Att & Pos via timePublisher Emitter
  useEffect(() => {
    const updateAttitudeAndPosition = (timeUs: number) => {
      const drone = droneRef.current;
      if (!drone) return;

      // 1. Update Attitude
      const att = getAttitudeAnglesAt(timeUs);
      if (att) {
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
          const posData = topicCacheRef.current[key];
          
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
                let groundY = 0;
                if (distBottomArr && distBottomArr[i] !== undefined && distBottomArr[i] > 0 && distBottomArr[i] < 1000) {
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
  }, [getAttitudeAnglesAt, getPositionAt, posTopic]);

  // Trigger a manual time broadcast when topic cache changes to snap drone positions immediately (e.g. on initial data load)
  useEffect(() => {
    if (droneRef.current) {
      timePublisher.setTime(timePublisher.getTime());
    }
  }, [state.topicCache]);

  // Rebuild Drone Meshes, FRD Coordinate Indicators, and Labels
  useEffect(() => {
    const drone = droneRef.current;
    if (!drone || !sceneReady) return; // Wait until scene setup is complete

    while (drone.children.length > 0) {
      drone.remove(drone.children[0]);
    }

    // 1. 標示體座標系 FRD 的向量箭頭 (Forward-Right-Down)
    const arrowF = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(0, 0, 0),
      1.15,
      0xff0000,
      0.18,
      0.08
    );
    drone.add(arrowF);
    const labelF = createTextSprite('F', '#ff0000');
    labelF.position.set(0, 0.15, -1.35);
    drone.add(labelF);

    const arrowR = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 0),
      1.15,
      0x22c55e,
      0.18,
      0.08
    );
    drone.add(arrowR);
    const labelR = createTextSprite('R', '#22c55e');
    labelR.position.set(1.35, 0.15, 0);
    drone.add(labelR);

    const arrowD = new THREE.ArrowHelper(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 0),
      1.15,
      0x3b82f6,
      0.18,
      0.08
    );
    drone.add(arrowD);
    const labelD = createTextSprite('D', '#3b82f6');
    labelD.position.set(0, -1.35, 0);
    drone.add(labelD);

    animatedMeshesRef.current = [];

    // 2. 構建選擇的模型外型
    if (modelType === 'multirotor') {
      // 🛸 X-type Multirotor
      const bodyMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.4, metalness: 0.8 });
      const noseMat = new THREE.MeshStandardMaterial({ color: '#ef4444' });
      const motorMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.9 });
      const propMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', transparent: true, opacity: 0.8 });

      // 機身中心結構 (縮小為精簡比例：16cm x 6cm x 16cm)
      const hubGeom = new THREE.BoxGeometry(0.16, 0.06, 0.16);
      const hub = new THREE.Mesh(hubGeom, bodyMat);
      drone.add(hub);

      // 前端紅色機鼻 (縮小並貼近機身 Z = -0.1)
      const noseGeom = new THREE.ConeGeometry(0.06, 0.15, 4);
      noseGeom.rotateX(-Math.PI / 2);
      const nose = new THREE.Mesh(noseGeom, noseMat);
      nose.position.set(0, 0, -0.1);
      drone.add(nose);

      // 使用兩個長方體 (BoxGeometry) 呈 90 度垂直交叉拼湊出 X 型機臂 (寬3.5cm, 高1.5cm, 長85cm)
      const armGeom = new THREE.BoxGeometry(0.035, 0.015, 0.85);
      
      const arm1 = new THREE.Mesh(armGeom, bodyMat);
      arm1.rotation.y = Math.PI / 4; // 45度
      drone.add(arm1);
      
      const arm2 = new THREE.Mesh(armGeom, bodyMat);
      arm2.rotation.y = -Math.PI / 4; // -45度 (兩者呈 90 度垂直交叉)
      drone.add(arm2);

      // 螺旋槳與馬達組件
      const motorGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.06);
      const propGeom = new THREE.BoxGeometry(0.38, 0.003, 0.02); // 螺旋槳增長變薄 (直徑 38cm)

      const armLength = 0.4;
      const angles = [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
      angles.forEach((angle) => {
        const x = Math.sin(angle) * armLength;
        const z = Math.cos(angle) * armLength;
        
        const motor = new THREE.Mesh(motorGeom, motorMat);
        motor.position.set(x, 0.04, z);
        drone.add(motor);

        const prop = new THREE.Mesh(propGeom, propMat);
        prop.position.set(x, 0.075, z);
        drone.add(prop);
        
        animatedMeshesRef.current.push(prop); // 用於馬達轉速旋擬動畫
      });
    }
    else if (modelType === 'fixwing') {
      // ✈️ Fixed Wing Airplane
      const planeMat = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.5, metalness: 0.3 });
      const trimMat = new THREE.MeshStandardMaterial({ color: '#ef4444' });
      const motorMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.9 });

      const fuseGeom = new THREE.CylinderGeometry(0.12, 0.07, 1.2, 8);
      fuseGeom.rotateX(Math.PI / 2);
      const fuselage = new THREE.Mesh(fuseGeom, planeMat);
      drone.add(fuselage);

      const wingGeom = new THREE.BoxGeometry(1.8, 0.02, 0.24);
      const wing = new THREE.Mesh(wingGeom, planeMat);
      wing.position.set(0, 0.05, -0.15);
      drone.add(wing);

      const tipGeom = new THREE.BoxGeometry(0.1, 0.04, 0.24);
      const leftTip = new THREE.Mesh(tipGeom, trimMat);
      leftTip.position.set(-0.9, 0.06, -0.15);
      drone.add(leftTip);
      
      const rightTip = new THREE.Mesh(tipGeom, trimMat);
      rightTip.position.set(0.9, 0.06, -0.15);
      drone.add(rightTip);

      const tailHGeom = new THREE.BoxGeometry(0.5, 0.015, 0.12);
      const tailH = new THREE.Mesh(tailHGeom, planeMat);
      tailH.position.set(0, 0.04, 0.5);
      drone.add(tailH);

      const tailVGeom = new THREE.BoxGeometry(0.015, 0.2, 0.15);
      const tailV = new THREE.Mesh(tailVGeom, trimMat);
      tailV.position.set(0, 0.14, 0.5);
      drone.add(tailV);

      const spinnerGeom = new THREE.ConeGeometry(0.08, 0.15, 8);
      spinnerGeom.rotateX(-Math.PI / 2);
      const spinner = new THREE.Mesh(spinnerGeom, trimMat);
      spinner.position.set(0, 0, -0.65);
      drone.add(spinner);

      const bladeGeom = new THREE.BoxGeometry(0.4, 0.03, 0.005);
      const prop = new THREE.Mesh(bladeGeom, motorMat);
      prop.position.set(0, 0, -0.73);
      drone.add(prop);
      
      animatedMeshesRef.current.push(prop);
    }
    else if (modelType === 'car') {
      // 🚗 Rover / Car
      const carMat = new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.3 });
      const glassMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.1, metalness: 0.9 });
      const wheelMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.8 });

      const bodyGeom = new THREE.BoxGeometry(0.5, 0.18, 0.85);
      const bodyMesh = new THREE.Mesh(bodyGeom, carMat);
      bodyMesh.position.y = 0.15;
      drone.add(bodyMesh);

      const cabinGeom = new THREE.BoxGeometry(0.4, 0.15, 0.45);
      const cabinMesh = new THREE.Mesh(cabinGeom, glassMat);
      cabinMesh.position.set(0, 0.31, -0.05);
      drone.add(cabinMesh);

      const bumperGeom = new THREE.BoxGeometry(0.5, 0.08, 0.08);
      const bumper = new THREE.Mesh(bumperGeom, wheelMat);
      bumper.position.set(0, 0.1, -0.45);
      drone.add(bumper);

      const whGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12);
      whGeom.rotateZ(Math.PI / 2);

      const wheelLocations = [
        [-0.28, 0.12, -0.25], // FL
        [0.28, 0.12, -0.25],  // FR
        [-0.28, 0.12, 0.25],  // RL
        [0.28, 0.12, 0.25]    // RR
      ];

      wheelLocations.forEach(([x, y, z]) => {
        const wheel = new THREE.Mesh(whGeom, wheelMat);
        wheel.position.set(x, y, z);
        drone.add(wheel);
        animatedMeshesRef.current.push(wheel);
      });
    }
    else if (modelType === 'turtle') {
      // 🐢 Turtle
      const shellMat = new THREE.MeshStandardMaterial({ color: '#166534', roughness: 0.6 });
      const skinMat = new THREE.MeshStandardMaterial({ color: '#4ade80', roughness: 0.5 });

      const shellGeom = new THREE.SphereGeometry(0.35, 16, 16);
      const shell = new THREE.Mesh(shellGeom, shellMat);
      shell.scale.set(1.1, 0.65, 1.25);
      shell.position.y = 0.15;
      drone.add(shell);

      const headGeom = new THREE.SphereGeometry(0.12, 12, 12);
      const head = new THREE.Mesh(headGeom, skinMat);
      head.position.set(0, 0.18, -0.5);
      drone.add(head);

      const tailGeom = new THREE.ConeGeometry(0.04, 0.15, 4);
      tailGeom.rotateX(Math.PI / 2.5);
      const tail = new THREE.Mesh(tailGeom, skinMat);
      tail.position.set(0, 0.08, 0.44);
      drone.add(tail);

      const flGeom = new THREE.BoxGeometry(0.18, 0.03, 0.35);
      const flipperLocs = [
        [-0.32, 0.08, -0.22, -Math.PI / 6],
        [0.32, 0.08, -0.22, Math.PI / 6],
        [-0.30, 0.08, 0.22, -Math.PI / 4],
        [0.30, 0.08, 0.22, Math.PI / 4]
      ];

      flipperLocs.forEach(([x, y, z, rotY]) => {
        const fl = new THREE.Mesh(flGeom, skinMat);
        fl.position.set(x, y, z);
        fl.rotation.y = rotY;
        drone.add(fl);
        animatedMeshesRef.current.push(fl);
      });
    }
    else if (modelType === 'eagle') {
      // 🦅 Eagle
      const featherMat = new THREE.MeshStandardMaterial({ color: '#451a03', roughness: 0.8 });
      const whiteMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.7 });
      const beakMat = new THREE.MeshStandardMaterial({ color: '#eab308', metalness: 0.3 });

      const bodyGeom = new THREE.SphereGeometry(0.18, 12, 12);
      bodyGeom.scale(1.0, 0.8, 1.4);
      const body = new THREE.Mesh(bodyGeom, featherMat);
      body.position.y = 0.15;
      drone.add(body);

      const headGeom = new THREE.SphereGeometry(0.11, 10, 10);
      const head = new THREE.Mesh(headGeom, whiteMat);
      head.position.set(0, 0.25, -0.32);
      drone.add(head);

      const beakGeom = new THREE.ConeGeometry(0.05, 0.12, 4);
      beakGeom.rotateX(-Math.PI / 2);
      const beak = new THREE.Mesh(beakGeom, beakMat);
      beak.position.set(0, 0.22, -0.46);
      drone.add(beak);

      const tailGeom = new THREE.BoxGeometry(0.24, 0.015, 0.35);
      const tail = new THREE.Mesh(tailGeom, featherMat);
      tail.position.set(0, 0.15, 0.55);
      tail.rotation.x = Math.PI / 12;
      drone.add(tail);

      const leftWingGroup = new THREE.Group();
      leftWingGroup.position.set(-0.16, 0.18, 0);
      drone.add(leftWingGroup);

      const leftWingGeom = new THREE.BoxGeometry(0.8, 0.02, 0.28);
      leftWingGeom.translate(-0.4, 0, 0);
      const leftWingMesh = new THREE.Mesh(leftWingGeom, featherMat);
      leftWingGroup.add(leftWingMesh);
      animatedMeshesRef.current.push(leftWingGroup);

      const rightWingGroup = new THREE.Group();
      rightWingGroup.position.set(0.16, 0.18, 0);
      drone.add(rightWingGroup);

      const rightWingGeom = new THREE.BoxGeometry(0.8, 0.02, 0.28);
      rightWingGeom.translate(0.4, 0, 0);
      const rightWingMesh = new THREE.Mesh(rightWingGeom, featherMat);
      rightWingGroup.add(rightWingMesh);
      animatedMeshesRef.current.push(rightWingGroup);
    }
    else if (modelType === 'kabibala') {
      // 🦫 Capybara / Kabibala
      const capyMat = new THREE.MeshStandardMaterial({ color: '#78350f', roughness: 0.95 });
      const snoutMat = new THREE.MeshStandardMaterial({ color: '#451a03', roughness: 0.95 });
      const eyeMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.9 });

      const capyBodyGeom = new THREE.CylinderGeometry(0.22, 0.22, 0.75, 10);
      capyBodyGeom.rotateX(Math.PI / 2);
      const capyBody = new THREE.Mesh(capyBodyGeom, capyMat);
      capyBody.position.y = 0.28;
      drone.add(capyBody);

      const capyHeadGeom = new THREE.BoxGeometry(0.24, 0.26, 0.35);
      const capyHead = new THREE.Mesh(capyHeadGeom, capyMat);
      capyHead.position.set(0, 0.44, -0.38);
      drone.add(capyHead);

      const snoutGeom = new THREE.BoxGeometry(0.24, 0.18, 0.15);
      const snout = new THREE.Mesh(snoutGeom, snoutMat);
      snout.position.set(0, 0.38, -0.52);
      drone.add(snout);

      const eyeGeom = new THREE.SphereGeometry(0.025, 6, 6);
      const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
      leftEye.position.set(-0.125, 0.46, -0.45);
      drone.add(leftEye);
      
      const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
      rightEye.position.set(0.125, 0.46, -0.45);
      drone.add(rightEye);

      const earGeom = new THREE.BoxGeometry(0.06, 0.08, 0.04);
      const leftEar = new THREE.Mesh(earGeom, snoutMat);
      leftEar.position.set(-0.1, 0.58, -0.28);
      leftEar.rotation.z = -Math.PI / 12;
      drone.add(leftEar);
      
      const rightEar = new THREE.Mesh(earGeom, snoutMat);
      rightEar.position.set(0.1, 0.58, -0.28);
      rightEar.rotation.z = Math.PI / 12;
      drone.add(rightEar);

      const legGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.22, 6);
      const legsLocations = [
        [-0.14, 0.11, -0.24],
        [0.14, 0.11, -0.24],
        [-0.14, 0.11, 0.24],
        [0.14, 0.11, 0.24]
      ];

      legsLocations.forEach(([x, y, z]) => {
        const leg = new THREE.Mesh(legGeom, capyMat);
        leg.position.set(x, y, z);
        drone.add(leg);
        animatedMeshesRef.current.push(leg);
      });
    }
  }, [modelType, sceneReady]);

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

      {/* 3D 控制按鈕/選單浮動列 */}
      <div className={styles.controlOverlay}>
        <div className={styles.modelSelectGroup}>
          <span className={styles.selectLabel}>
            {state.language === 'en' ? 'Model' : '載具外型'}:
          </span>
          <select
            value={modelType}
            onChange={(e) => setModelType(e.target.value as any)}
            className={styles.modelSelect}
          >
            <option value="multirotor">🛸 Multirotor (X)</option>
            <option value="fixwing">✈️ Fixed Wing</option>
            <option value="car">🚗 Rover / Car</option>
            <option value="turtle">🐢 Turtle</option>
            <option value="eagle">🦅 Eagle</option>
            <option value="kabibala">🦫 Capybara</option>
          </select>
        </div>

        {hasGpsData && (
          <button
            className={`${styles.overlayBtn} ${showSatellite ? styles.overlayBtnActive : ''}`}
            onClick={() => setShowSatellite(!showSatellite)}
            title={state.language === 'en' ? 'Toggle Google Satellite ground' : '切換 Google 衛星空照圖背景'}
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

// ─── 體座標 FRD 標記繪製文字精靈 ───

function createTextSprite(text: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.35, 0.35, 1);
  return sprite;
}
