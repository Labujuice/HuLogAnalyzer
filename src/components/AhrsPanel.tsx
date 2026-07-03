import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { interpolateAt } from '../parser/utils';
import styles from './AhrsPanel.module.css';

interface AhrsPanelProps {
  panelId: string;
  currentTimeUs: number;
}

export function AhrsPanel({ panelId, currentTimeUs }: AhrsPanelProps) {
  const { state, requestTopicData } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Find attitude topic
  const attTopic = state.summary?.topics.find(
    t => t.name === 'vehicle_attitude' || t.name.includes('vehicle_attitude')
  );

  const [hasAttitude, setHasAttitude] = useState<boolean>(!!attTopic);

  // Request attitude topic data if not loaded
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
  }, [attTopic, state.topicCache, requestTopicData]);

  // Interpolate Roll and Pitch from state cache
  const getAttitudeAngles = useCallback((): { roll: number; pitch: number; yaw: number } | null => {
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

  // Draw AHRS on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasAttitude) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const angles = getAttitudeAngles() || { roll: 0, pitch: 0, yaw: 0 };
      const roll = angles.roll;     // radians
      const pitch = angles.pitch;   // radians

      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.min(w, h) / 2;

      // Draw AHRS inside a circular mask
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.9, 0, Math.PI * 2);
      ctx.clip();

      // Pitch sensitivity: pixels per radian. (e.g. 90 deg pitch = radius pixels offset)
      const pitchOffset = (pitch / (Math.PI / 2)) * (radius * 0.8);

      // Rotate and translate scene based on attitude
      ctx.translate(cx, cy);
      ctx.rotate(-roll);
      ctx.translate(0, pitchOffset);

      // 1. Sky and Ground
      ctx.fillStyle = '#0284c7'; // Sky Blue
      ctx.fillRect(-w, -h * 2, w * 2, h * 2);

      ctx.fillStyle = '#78350f'; // Ground Brown
      ctx.fillRect(-w, 0, w * 2, h * 2);

      // Horizon Line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.lineTo(w, 0);
      ctx.stroke();

      // 2. Pitch Ladder (Horizontal bars every 10 degrees)
      const deg10Px = (10 * Math.PI / 180 / (Math.PI / 2)) * (radius * 0.8);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let d = -80; d <= 80; d += 10) {
        if (d === 0) continue;
        const py = -d / 10 * deg10Px;

        // Skip drawing if outside viewport
        if (Math.abs(py + pitchOffset) > radius) continue;

        ctx.beginPath();
        const barWidth = d % 20 === 0 ? 60 : 35;
        ctx.moveTo(-barWidth / 2, py);
        ctx.lineTo(barWidth / 2, py);
        // Small vertical tick on the ends
        const tickDir = d > 0 ? 5 : -5;
        ctx.moveTo(-barWidth / 2, py);
        ctx.lineTo(-barWidth / 2, py + tickDir);
        ctx.moveTo(barWidth / 2, py);
        ctx.lineTo(barWidth / 2, py + tickDir);
        ctx.stroke();

        // Text label
        ctx.fillText(String(Math.abs(d)), -barWidth / 2 - 12, py);
        ctx.fillText(String(Math.abs(d)), barWidth / 2 + 12, py);
      }

      ctx.restore(); // Restore translation and rotation

      // 3. Static Fixed Aircraft Reference (Yellow crosshairs in center)
      ctx.strokeStyle = '#f59e0b'; // Amber yellow
      ctx.lineWidth = 4;
      ctx.beginPath();
      // Center dot
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();

      // Left wing
      ctx.moveTo(cx - 50, cy);
      ctx.lineTo(cx - 20, cy);
      ctx.lineTo(cx - 20, cy + 12);
      // Right wing
      ctx.moveTo(cx + 50, cy);
      ctx.lineTo(cx + 20, cy);
      ctx.lineTo(cx + 20, cy + 12);
      ctx.stroke();

      // 4. Roll Scale & Pointer (Top ring)
      ctx.save();
      ctx.translate(cx, cy);
      
      // Draw outer dial ticks
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      const ringRadius = radius * 0.85;

      const rollAngles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
      rollAngles.forEach((deg) => {
        const rad = deg * Math.PI / 180;
        // Draw tick
        const tickLen = deg % 30 === 0 ? 10 : 6;
        const x1 = Math.sin(rad) * ringRadius;
        const y1 = -Math.cos(rad) * ringRadius;
        const x2 = Math.sin(rad) * (ringRadius - tickLen);
        const y2 = -Math.cos(rad) * (ringRadius - tickLen);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      // Pointer indicating current roll angle (rotates with roll)
      ctx.rotate(-roll);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -ringRadius + 2);
      ctx.lineTo(-8, -ringRadius + 14);
      ctx.lineTo(8, -ringRadius + 14);
      ctx.closePath();
      ctx.fill();

      ctx.restore();

      // 5. Digital displays for Pitch & Roll
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(8, 8, 90, 42);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.strokeRect(8, 8, 90, 42);

      ctx.fillStyle = '#38bdf8'; // Sky blue text
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`PITCH: ${(pitch * 180 / Math.PI).toFixed(1)}°`, 14, 22);
      ctx.fillText(`ROLL:  ${(roll * 180 / Math.PI).toFixed(1)}°`, 14, 38);

      animId = requestAnimationFrame(draw);
    };

    draw();

    // Resize canvas to fit container
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    resizeCanvas();

    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(canvas.parentElement!);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [hasAttitude, getAttitudeAngles]);

  if (!hasAttitude) {
    return (
      <div className={styles.root}>
        <div className={styles.noData}>
          <span>⚠️ 找不到姿態數據 (`vehicle_attitude`)</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.panelTitle}>AHRS 航空儀表</div>
      <canvas ref={canvasRef} className={styles.canvas} />
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
