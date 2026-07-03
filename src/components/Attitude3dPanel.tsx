import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { useApp } from '../store/appStore';
import { interpolateAt } from '../parser/utils';
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
  const droneRef = useRef<THREE.Group | null>(null);
  const propsRef = useRef<THREE.Mesh[]>([]); // Propellers to spin

  // Find attitude topic: standard vehicle_attitude
  const attTopic = state.summary?.topics.find(
    t => t.name === 'vehicle_attitude' || t.name.includes('vehicle_attitude')
  );

  const [hasAttitude, setHasAttitude] = useState<boolean>(!!attTopic);

  // Request attitude topic data if not loaded
  useEffect(() => {
    if (attTopic) {
      const key = `${attTopic.name}:${attTopic.multiId}`;
      if (!state.topicCache[key]) {
        // Request all q fields
        const qFields = attTopic.fields.filter(f => f.startsWith('q['));
        requestTopicData(attTopic.name, attTopic.multiId, qFields.length > 0 ? qFields : attTopic.fields);
      }
    } else {
      setHasAttitude(false);
    }
  }, [attTopic, state.topicCache, requestTopicData]);

  // Interpolate Roll, Pitch, Yaw from quaternion in state cache
  const getAttitudeAngles = useCallback((): { roll: number; pitch: number; yaw: number } | null => {
    if (!attTopic) return null;
    const key = `${attTopic.name}:${attTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    // Standard PX4 uses q[0] (w), q[1] (x), q[2] (y), q[3] (z)
    const q0Arr = data.fields['q[0]'];
    const q1Arr = data.fields['q[1]'];
    const q2Arr = data.fields['q[2]'];
    const q3Arr = data.fields['q[3]'];

    if (!q0Arr || !q1Arr || !q2Arr || !q3Arr) {
      // Fallback: check if they are named q_w, q_x, q_y, q_z
      const qw = data.fields['q_w'] || data.fields['q.w'] || data.fields['q_0'];
      const qx = data.fields['q_x'] || data.fields['q.x'] || data.fields['q_1'];
      const qy = data.fields['q_y'] || data.fields['q.y'] || data.fields['q_2'];
      const qz = data.fields['q_z'] || data.fields['q.z'] || data.fields['q_3'];
      if (!qw || !qx || !qy || !qz) return null;

      const q0 = interpolateAt(data.timestamps, qw, currentTimeUs);
      const q1 = interpolateAt(data.timestamps, qx, currentTimeUs);
      const q2 = interpolateAt(data.timestamps, qy, currentTimeUs);
      const q3 = interpolateAt(data.timestamps, qz, currentTimeUs);

      return quatToEuler(q0, q1, q2, q3);
    }

    const q0 = interpolateAt(data.timestamps, q0Arr, currentTimeUs);
    const q1 = interpolateAt(data.timestamps, q1Arr, currentTimeUs);
    const q2 = interpolateAt(data.timestamps, q2Arr, currentTimeUs);
    const q3 = interpolateAt(data.timestamps, q3Arr, currentTimeUs);

    return quatToEuler(q0, q1, q2, q3);
  }, [attTopic, state.topicCache, currentTimeUs]);

  // Setup Three.js Scene
  useEffect(() => {
    if (!mountRef.current || !hasAttitude) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    // 1. Scene & Renderer
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0a0f1d'); // Sleek dark bg
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(4, 3, 5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 2. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(5, 10, 7);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x3b82f6, 0.4); // Accent blue light
    dirLight2.position.set(-5, -5, -5);
    scene.add(dirLight2);

    // 3. Grid Ground & Axes
    const gridHelper = new THREE.GridHelper(20, 20, '#1e293b', '#0f172a');
    gridHelper.position.y = -1.5;
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(1.5);
    axesHelper.position.y = -1.49;
    scene.add(axesHelper);

    // 4. Build Custom 3D Drone Model
    const droneGroup = new THREE.Group();
    scene.add(droneGroup);
    droneRef.current = droneGroup;

    // Center Hub (Futuristic Octagon/Box)
    const hubGeom = new THREE.BoxGeometry(0.8, 0.15, 0.8);
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.4, metalness: 0.8 });
    const hub = new THREE.Mesh(hubGeom, bodyMat);
    droneGroup.add(hub);

    // Nose Cone (Direction indicator - Front is +Z in NED, so we place it on +Z or -Z)
    // In our WebGL mapping: Forward is -Z (aligned with camera looking at center)
    const noseGeom = new THREE.ConeGeometry(0.2, 0.4, 4);
    noseGeom.rotateX(-Math.PI / 2); // point forward (-Z)
    const noseMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.5 }); // Red nose
    const nose = new THREE.Mesh(noseGeom, noseMat);
    nose.position.set(0, 0, -0.5);
    droneGroup.add(nose);

    // LED Eyes
    const eyeGeom = new THREE.SphereGeometry(0.08, 8, 8);
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
    const eyeL = new THREE.Mesh(eyeGeom, eyeMat);
    eyeL.position.set(-0.25, 0.05, -0.42);
    const eyeR = new THREE.Mesh(eyeGeom, eyeMat);
    eyeR.position.set(0.25, 0.05, -0.42);
    droneGroup.add(eyeL);
    droneGroup.add(eyeR);

    // Quadcopter Arms (X Layout)
    const armGeom = new THREE.CylinderGeometry(0.04, 0.04, 1.2);
    armGeom.rotateX(Math.PI / 2); // lay flat

    // Front-Left to Back-Right Arm
    const arm1 = new THREE.Mesh(armGeom, bodyMat);
    arm1.rotation.y = Math.PI / 4;
    droneGroup.add(arm1);

    // Front-Right to Back-Left Arm
    const arm2 = new THREE.Mesh(armGeom, bodyMat);
    arm2.rotation.y = -Math.PI / 4;
    droneGroup.add(arm2);

    // Motors & Props
    const motorGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.15);
    const motorMat = new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.9 });
    const propGeom = new THREE.BoxGeometry(0.5, 0.01, 0.04);
    const propMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', transparent: true, opacity: 0.7 });

    const armLength = 0.6;
    const angles = [
      Math.PI / 4,       // Back-Right (FR)
      -Math.PI / 4,      // Back-Left (FL)
      (3 * Math.PI) / 4,  // Front-Right (BR)
      (-3 * Math.PI) / 4, // Front-Left (BL)
    ];

    const props: THREE.Mesh[] = [];

    angles.forEach((angle, idx) => {
      const x = Math.sin(angle) * armLength;
      const z = Math.cos(angle) * armLength;

      // Motor
      const motor = new THREE.Mesh(motorGeom, motorMat);
      motor.position.set(x, 0.1, z);
      droneGroup.add(motor);

      // Propeller
      const prop = new THREE.Mesh(propGeom, propMat);
      prop.position.set(x, 0.18, z);
      droneGroup.add(prop);
      props.push(prop);
    });

    propsRef.current = props;

    // 5. Animation loop
    let animId: number;
    let propRot = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Spin propellers when playing
      if (state.playback.isPlaying) {
        propRot += 0.25 * state.playback.speedMultiplier;
        props.forEach((p, idx) => {
          // Alternate spin directions
          p.rotation.y = idx % 2 === 0 ? propRot : -propRot;
        });
      }

      // Render
      if (rendererRef.current && sceneRef.current) {
        rendererRef.current.render(sceneRef.current, camera);
      }
    };
    animate();

    // 6. Resize Observer
    const ro = new ResizeObserver(() => {
      if (!mountRef.current || !rendererRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    });
    ro.observe(mountRef.current);

    // Cleanup
    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      if (rendererRef.current && mountRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }
      scene.clear();
    };
  }, [hasAttitude, state.playback.isPlaying]);

  // Sync Drone Rotation with Playback Time
  useEffect(() => {
    if (!droneRef.current) return;
    const angles = getAttitudeAngles();
    if (angles) {
      // NED to WebGL rotation mapping
      droneRef.current.rotation.set(angles.pitch, -angles.yaw, -angles.roll, 'YXZ');
    }
  }, [currentTimeUs, getAttitudeAngles]);

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
    <div className={styles.root}>
      <div className={styles.panelTitle}>3D 實時姿態觀測器</div>
      <div ref={mountRef} className={styles.canvasContainer} />
    </div>
  );
}

// ─── 尤拉角四元數轉換工具 ──────────────────────────────────────────────────────

function quatToEuler(q0: number, q1: number, q2: number, q3: number) {
  // PX4 quaternion order is (w=q0, x=q1, y=q2, z=q3)
  const roll = Math.atan2(2 * (q0 * q1 + q2 * q3), 1 - 2 * (q1 * q1 + q2 * q2));
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (q0 * q2 - q3 * q1))));
  const yaw = Math.atan2(2 * (q0 * q3 + q1 * q2), 1 - 2 * (q2 * q2 + q3 * q3));
  return { roll, pitch, yaw };
}
