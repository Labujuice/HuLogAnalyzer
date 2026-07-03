import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { interpolateAt } from '../parser/utils';
import { timePublisher } from '../store/timePublisher';
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

  // Find local position topic for altitude and speed
  const posTopic = state.summary?.topics.find(
    t => t.name === 'vehicle_local_position' || t.name.includes('vehicle_local_position')
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

  // Request local position data if not loaded
  useEffect(() => {
    if (posTopic) {
      const key = `${posTopic.name}:${posTopic.multiId}`;
      if (!state.topicCache[key]) {
        requestTopicData(posTopic.name, posTopic.multiId, ['z', 'vx', 'vy', 'vz']);
      }
    }
  }, [posTopic, state.topicCache, requestTopicData]);

  // Interpolate Roll and Pitch from state cache at specific timeUs
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

  // Interpolate Position & Velocity fields from local position
  const getFlightDataAt = useCallback((timeUs: number): { altitude: number; verticalSpeed: number; horizontalSpeed: number } | null => {
    if (!posTopic) return null;
    const key = `${posTopic.name}:${posTopic.multiId}`;
    const data = state.topicCache[key];
    if (!data) return null;

    const zArr = data.fields['z'];
    const vxArr = data.fields['vx'] || data.fields['x_vel'];
    const vyArr = data.fields['vy'] || data.fields['y_vel'];
    const vzArr = data.fields['vz'] || data.fields['z_vel'];

    const alt = zArr ? -interpolateAt(data.timestamps, zArr, timeUs) : 0;
    const vx = vxArr ? interpolateAt(data.timestamps, vxArr, timeUs) : 0;
    const vy = vyArr ? interpolateAt(data.timestamps, vyArr, timeUs) : 0;
    const vz = vzArr ? -interpolateAt(data.timestamps, vzArr, timeUs) : 0;

    return {
      altitude: alt,
      verticalSpeed: vz,
      horizontalSpeed: Math.sqrt(vx * vx + vy * vy),
    };
  }, [posTopic, state.topicCache]);

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

      const currentTimeUs = timePublisher.getTime();
      const angles = getAttitudeAnglesAt(currentTimeUs) || { roll: 0, pitch: 0, yaw: 0 };
      const roll = angles.roll;     // radians
      const pitch = angles.pitch;   // radians
      const yawDeg = (angles.yaw * 180 / Math.PI + 360) % 360;

      const flightData = getFlightDataAt(currentTimeUs) || { altitude: 0, verticalSpeed: 0, horizontalSpeed: 0 };
      const { altitude, verticalSpeed, horizontalSpeed } = flightData;

      const cx = w / 2;
      const cy = h / 2;
      // Horizon Indicator Radius
      const r = Math.min(w, h) * 0.33;

      // ── 1. Draw AHRS Horizon Indicator (inside circular clip) ──
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();

      // Pitch sensitivity: pixels per radian (90 deg = r pixels)
      const pitchOffset = (pitch / (Math.PI / 2)) * (r * 0.85);

      // Rotate and translate scene based on attitude
      ctx.translate(cx, cy);
      ctx.rotate(-roll);
      ctx.translate(0, pitchOffset);

      // Sky (Light Blue)
      ctx.fillStyle = '#0284c7';
      ctx.fillRect(-w, -h * 2, w * 2, h * 2);

      // Ground (Brown)
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-w, 0, w * 2, h * 2);

      // Horizon Center Divider Line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.lineTo(w, 0);
      ctx.stroke();

      // Pitch Ladder (Ticks every 10 degrees)
      const deg10Px = (10 * Math.PI / 180 / (Math.PI / 2)) * (r * 0.85);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let d = -80; d <= 80; d += 10) {
        if (d === 0) continue;
        const py = -d / 10 * deg10Px;

        // Skip drawing if outside horizon circle view bounds
        if (Math.abs(py + pitchOffset) > r) continue;

        ctx.beginPath();
        const barWidth = d % 20 === 0 ? 50 : 30;
        ctx.moveTo(-barWidth / 2, py);
        ctx.lineTo(barWidth / 2, py);
        const tickDir = d > 0 ? 5 : -5;
        ctx.moveTo(-barWidth / 2, py);
        ctx.lineTo(-barWidth / 2, py + tickDir);
        ctx.moveTo(barWidth / 2, py);
        ctx.lineTo(barWidth / 2, py + tickDir);
        ctx.stroke();

        ctx.fillText(String(Math.abs(d)), -barWidth / 2 - 12, py);
        ctx.fillText(String(Math.abs(d)), barWidth / 2 + 12, py);
      }

      ctx.restore(); // Restore translation and rotation

      // Circular Border around horizon
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 3;
      ctx.stroke();

      // ── 2. Fixed Aircraft Symbol (Yellow Crosshair) ──
      ctx.strokeStyle = '#f59e0b'; // Amber yellow
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();

      // Left wing
      ctx.moveTo(cx - 40, cy);
      ctx.lineTo(cx - 15, cy);
      ctx.lineTo(cx - 15, cy + 10);
      // Right wing
      ctx.moveTo(cx + 40, cy);
      ctx.lineTo(cx + 15, cy);
      ctx.lineTo(cx + 15, cy + 10);
      ctx.stroke();

      // ── 3. Roll Scale Ring (Top) ──
      ctx.save();
      ctx.translate(cx, cy);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1.5;
      const ringRadius = r * 1.05;

      const rollAngles = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
      rollAngles.forEach((deg) => {
        const rad = deg * Math.PI / 180;
        const tickLen = deg % 30 === 0 ? 8 : 4;
        const x1 = Math.sin(rad) * ringRadius;
        const y1 = -Math.cos(rad) * ringRadius;
        const x2 = Math.sin(rad) * (ringRadius - tickLen);
        const y2 = -Math.cos(rad) * (ringRadius - tickLen);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      // Pointer rotates with Roll
      ctx.rotate(-roll);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -ringRadius + 2);
      ctx.lineTo(-6, -ringRadius + 12);
      ctx.lineTo(6, -ringRadius + 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // ── 4. Heading Compass Tape (Top Center) ──
      const htx = cx - 100;
      const hty = 15;
      const htw = 200;
      const hth = 20;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(htx, hty, htw, hth);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(htx, hty, htw, hth);

      ctx.save();
      ctx.beginPath();
      ctx.rect(htx, hty, htw, hth);
      ctx.clip();

      ctx.fillStyle = '#ffffff';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const degPx = htw / 60; // 60 deg visible range
      const startDeg = Math.floor((yawDeg - 30) / 5) * 5;
      const endDeg = Math.ceil((yawDeg + 30) / 5) * 5;

      for (let d = startDeg; d <= endDeg; d++) {
        const norm = (d + 360) % 360;
        const dx = cx + (d - yawDeg) * degPx;

        const isLabel = norm % 30 === 0;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.moveTo(dx, hty + hth);
        ctx.lineTo(dx, hty + hth - (isLabel ? 7 : 4));
        ctx.stroke();

        if (isLabel) {
          let label = String(norm / 10).padStart(2, '0');
          if (norm === 0) label = 'N';
          else if (norm === 90) label = 'E';
          else if (norm === 180) label = 'S';
          else if (norm === 270) label = 'W';

          ctx.fillStyle = (norm % 90 === 0) ? '#ef4444' : '#ffffff';
          ctx.fillText(label, dx, hty + 7);
        }
      }
      ctx.restore();

      // Heading Center pointer
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.moveTo(cx, hty + hth + 3);
      ctx.lineTo(cx - 5, hty + hth - 1);
      ctx.lineTo(cx + 5, hty + hth - 1);
      ctx.closePath();
      ctx.fill();

      // Digital Heading degrees display box
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(cx - 22, hty - 11, 44, 11);
      ctx.strokeStyle = '#eab308';
      ctx.strokeRect(cx - 22, hty - 11, 44, 11);
      ctx.fillStyle = '#eab308';
      ctx.font = '9px monospace';
      ctx.fillText(`${Math.round(yawDeg).toString().padStart(3, '0')}°`, cx, hty - 6);

      // ── 5. Speed Tape (Left Side) ──
      const stx = cx - r - 45;
      const sty = cy - 70;
      const stw = 35;
      const sth = 140;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(stx, sty, stw, sth);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.strokeRect(stx, sty, stw, sth);

      ctx.save();
      ctx.beginPath();
      ctx.rect(stx, sty, stw, sth);
      ctx.clip();

      const speedPx = sth / 30; // 30 m/s range visible
      const startSp = Math.floor((horizontalSpeed - 15) / 2) * 2;
      const endSp = Math.ceil((horizontalSpeed + 15) / 2) * 2;

      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = '8px monospace';

      for (let s = Math.max(0, startSp); s <= endSp; s += 2) {
        const sy = cy - (s - horizontalSpeed) * speedPx;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.moveTo(stx + stw, sy);
        ctx.lineTo(stx + stw - 5, sy);
        ctx.stroke();

        if (s % 4 === 0) {
          ctx.fillText(s.toFixed(0), stx + stw - 9, sy);
        }
      }
      ctx.restore();

      // Speed Pointer Box
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(stx - 8, cy - 8, stw + 8, 16);
      ctx.strokeStyle = '#38bdf8';
      ctx.strokeRect(stx - 8, cy - 8, stw + 8, 16);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${horizontalSpeed.toFixed(1)}`, stx + stw / 2 - 2, cy);

      // Label at bottom
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '8px monospace';
      ctx.fillText('SPD m/s', stx + stw / 2, sty - 6);

      // ── 6. Altitude Tape (Right Side) ──
      const atx = cx + r + 10;
      const aty = cy - 70;
      const atw = 35;
      const ath = 140;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(atx, aty, atw, ath);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.strokeRect(atx, aty, atw, ath);

      ctx.save();
      ctx.beginPath();
      ctx.rect(atx, aty, atw, ath);
      ctx.clip();

      const altPx = ath / 80; // 80m visible range
      const startAlt = Math.floor((altitude - 40) / 10) * 10;
      const endAlt = Math.ceil((altitude + 40) / 10) * 10;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.font = '8px monospace';

      for (let a = startAlt; a <= endAlt; a += 10) {
        const ay = cy - (a - altitude) * altPx;
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.moveTo(atx, ay);
        ctx.lineTo(atx + 5, ay);
        ctx.stroke();

        ctx.fillText(a.toFixed(0), atx + 9, ay);
      }
      ctx.restore();

      // Altitude Pointer Box
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(atx, cy - 8, atw + 8, 16);
      ctx.strokeStyle = '#22c55e';
      ctx.strokeRect(atx, cy - 8, atw + 8, 16);
      ctx.fillStyle = '#22c55e';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${altitude.toFixed(1)}`, atx + atw / 2 + 3, cy);

      // Label at bottom
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '8px monospace';
      ctx.fillText('ALT m', atx + atw / 2, aty - 6);

      // ── 7. Vertical Speed Indicator (VSI / Vario) ──
      const vx = atx + atw + 14;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(vx, cy - 50);
      ctx.lineTo(vx, cy + 50);
      ctx.stroke();

      const vsiPx = 50 / 5; // 5 m/s scale = 50px
      const vsiTicks = [5, 2, 0, -2, -5];
      ctx.font = '7px monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.textAlign = 'left';

      vsiTicks.forEach(t => {
        const ty = cy - t * vsiPx;
        ctx.beginPath();
        ctx.moveTo(vx, ty);
        ctx.lineTo(vx + 3, ty);
        ctx.stroke();
        if (t !== 0) {
          ctx.fillText(`${t > 0 ? '+' : ''}${t}`, vx + 6, ty);
        }
      });

      // Draw VSI Arrow
      const vsiVal = Math.max(-6, Math.min(6, verticalSpeed));
      const vsiY = cy - vsiVal * vsiPx;
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.moveTo(vx - 1, vsiY);
      ctx.lineTo(vx - 6, vsiY - 3.5);
      ctx.lineTo(vx - 6, vsiY + 3.5);
      ctx.closePath();
      ctx.fill();

      // Label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '8px monospace';
      ctx.fillText('VSI', vx - 4, cy - 58);

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
  }, [hasAttitude, getAttitudeAnglesAt, getFlightDataAt]);

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
