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
        requestTopicData(posTopic.name, posTopic.multiId, ['x', 'y', 'z']);
      }
    }
  }, [attTopic, posTopic, state.topicCache, requestTopicData]);

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
      const q1 = interpolateAt(data.timestamps, qx, timeUs);
      const q2 = interpolateAt(data.timestamps, qy, timeUs);
      const q3 = interpolateAt(data.timestamps, qz, timeUs);

      return quatToEuler(q0, q1, q2, q3);
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

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
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

    // 4. Build Custom 3D Drone Model
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

    // 5. Initialize Path Lines
    // 尚未飛過的未來航線 (黃色)
    const remainingGeom = new THREE.BufferGeometry();
    const remainingMat = new THREE.LineBasicMaterial({
      color: '#eab308', // Yellow
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
      color: '#ef4444', // Red
      linewidth: 2,
    });
    const activePathLine = new THREE.Line(activeGeom, activeMat);
    scene.add(activePathLine);
    activePathLineRef.current = activePathLine;
    activeGeomRef.current = activeGeom;

    // 6. Animation loop
    let animId: number;
    let propRot = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      // 旋轉螺旋槳
      if (state.playback.isPlaying) {
        propRot += 0.25 * state.playback.speedMultiplier;
        props.forEach((p, idx) => {
          p.rotation.y = idx % 2 === 0 ? propRot : -propRot;
        });
      }

      // 相機焦點平滑跟隨
      const target = cameraTargetRef.current;
      if (isFollowingRef.current && droneGroup) {
        target.copy(droneGroup.position);
      }

      const targetX = target.x + cameraRadius.current * Math.sin(cameraPhi.current) * Math.sin(cameraTheta.current);
      const targetY = target.y + cameraRadius.current * Math.cos(cameraPhi.current);
      const targetZ = target.z + cameraRadius.current * Math.sin(cameraPhi.current) * Math.cos(cameraTheta.current);

      camera.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.15);
      camera.lookAt(target);

      if (rendererRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, camera);
      }
    };
    animate();

    // 7. 註冊滾輪縮放 (綁定在容器上以防止警告)
    const onWheelEvent = (e: WheelEvent) => {
      e.preventDefault();
      cameraRadius.current = Math.max(1.5, Math.min(80, cameraRadius.current + e.deltaY * 0.01));
    };
    container.addEventListener('wheel', onWheelEvent, { passive: false });

    // 8. Resize Observer
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
      cancelAnimationFrame(animId);
      ro.disconnect();
      container.removeEventListener('wheel', onWheelEvent);
      if (rendererRef.current && container.contains(rendererRef.current.domElement)) {
        container.removeChild(rendererRef.current.domElement);
      }
      scene.clear();
      cameraRef.current = null;
    };
  }, [hasAttitude, state.playback.isPlaying]);

  // 訂閱 timePublisher 實實更新無人機位置、姿態與軌跡，完全不需 React re-render
  useEffect(() => {
    const updateAttitudeAndPosition = (timeUs: number) => {
      if (!droneRef.current) return;

      // 1. 更新姿態旋轉
      const angles = getAttitudeAnglesAt(timeUs);
      if (angles) {
        droneRef.current.rotation.set(angles.pitch, -angles.yaw, -angles.roll, 'YXZ');
      }

      // 2. 更新位置與軌跡線
      const pos = getPositionAt(timeUs);
      if (pos) {
        droneRef.current.position.set(pos.x, pos.y, pos.z);

        // 更新目前已飛過的時間點軌跡點 (0 -> lo) 與尚未飛過的軌跡點 (lo -> end)
        if (posTopic) {
          const key = `${posTopic.name}:${posTopic.multiId}`;
          const data = state.topicCache[key];
          if (data) {
            let lo = 0;
            let hi = data.timestamps.length - 1;
            while (lo < hi) {
              const mid = (lo + hi) >>> 1;
              if (data.timestamps[mid] < timeUs) lo = mid + 1;
              else hi = mid;
            }

            // 已飛過的路徑
            if (activeGeomRef.current) {
              const activePoints = pos.points.slice(0, lo + 1);
              activeGeomRef.current.setFromPoints(activePoints);
            }

            // 尚未飛過的路徑
            if (remainingGeomRef.current) {
              const remainingPoints = pos.points.slice(lo);
              remainingGeomRef.current.setFromPoints(remainingPoints);
            }
          }
        }
      }
    };

    const unsubscribe = timePublisher.subscribe(updateAttitudeAndPosition);

    // 初始對齊
    updateAttitudeAndPosition(timePublisher.getTime());

    return unsubscribe;
  }, [getAttitudeAnglesAt, getPositionAt, posTopic, state.topicCache]);

  // 滑鼠拖曳控制（左鍵旋轉、中鍵平移）
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) { // Left click: Rotate
      dragMode.current = 'rotate';
      isDragging.current = true;
      lastMouseX.current = e.clientX;
      lastMouseY.current = e.clientY;
    } else if (e.button === 1) { // Middle click: Pan
      e.preventDefault(); // 阻擋中鍵瀏覽器自動滾動
      dragMode.current = 'pan';
      isDragging.current = true;
      lastMouseX.current = e.clientX;
      lastMouseY.current = e.clientY;
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
      cameraPhi.current = Math.max(0.05, Math.min(Math.PI / 2 - 0.02, cameraPhi.current - deltaY * 0.006));
    } else if (dragMode.current === 'pan' && cameraRef.current) {
      // 一旦進行手動平移，立即脫離跟隨鎖定狀態
      setIsFollowing(false);

      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cameraRef.current.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraRef.current.quaternion);
      
      // 根據相機縮放半徑決定平移灵敏度
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
          <span>⚠️ 找不到 3D 姿態數據 (`vehicle_attitude`)</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.root}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: isDragging.current ? 'grabbing' : 'grab' }}
    >
      <div className={styles.panelTitle}>3D 實時姿態與航線軌跡觀測器</div>

      {/* 恢復跟隨按鈕 */}
      {!isFollowing && (
        <button
          className={styles.resetFollowBtn}
          onClick={() => {
            setIsFollowing(true);
            if (droneRef.current) {
              cameraTargetRef.current.copy(droneRef.current.position);
            }
          }}
          title="恢復視角跟隨無人機"
        >
          📍 恢復跟隨
        </button>
      )}

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
