import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import { quatToEuler, interpolateAt } from '../parser/utils';
import { interpolateSeries } from '../parser/mathUtils';
import styles from './MagneticPanel.module.css';

interface MagneticPanelProps {
  panelId: string;
  currentTimeUs: number;
}

interface MagMetricData {
  idx: number;
  name: string;
  avg: number;
  variation: number;
  emi: boolean;
}

export function MagneticPanel({ panelId, currentTimeUs }: MagneticPanelProps) {
  const { state, requestTopicData } = useApp();
  
  const normContainerRef = useRef<HTMLDivElement>(null);
  const rawContainerRef = useRef<HTMLDivElement>(null);
  const headingContainerRef = useRef<HTMLDivElement>(null);
  
  const normChartRef = useRef<uPlot | null>(null);
  const rawChartRef = useRef<uPlot | null>(null);
  const headingChartRef = useRef<uPlot | null>(null);

  const [magInstances, setMagInstances] = useState<{ name: string; multiId: number }[]>([]);
  const [hasHeading, setHasHeading] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  // 磁力計實例的獨立診斷指標
  const [magMetrics, setMagMetrics] = useState<MagMetricData[]>([]);
  const lastMetricsStrRef = useRef<string>('');
  const [gsfOffsetAvg, setGsfOffsetAvg] = useState<number | null>(null);

  // 選擇觀測哪一個磁力計的原始三軸數值 (Compass 0, 1...)
  const [activeRawMagIdx, setActiveRawMagIdx] = useState<number>(0);

  // 1. 本地 uPlot 橫向縮放與游標同步對象
  const magSync = useMemo(() => uPlot.sync('mag-panel-sync'), []);

  // 自動檢測所有磁力計實例與航向 Topic
  useEffect(() => {
    if (!state.summary) return;
    
    // 掃描所有的 vehicle_magnetometer 或 sensor_mag 實例 (multiId 0, 1, 2...)
    const instances = state.summary.topics
      .filter(t => t.name === 'vehicle_magnetometer' || t.name === 'sensor_mag')
      .map(t => ({ name: t.name, multiId: t.multiId }));
    setMagInstances(instances);

    const heading = state.summary.topics.some(t => t.name === 'vehicle_attitude');
    setHasHeading(heading);

    const neededTopics: { name: string; multiId: number; fields: string[] }[] = [];

    // 請求所有磁力計的 fields
    instances.forEach(inst => {
      const magTopic = state.summary!.topics.find(t => t.name === inst.name && t.multiId === inst.multiId)!;
      const desiredFields = magTopic.fields.filter(
        f => f.startsWith('magnetometer_ga') || f === 'x' || f === 'y' || f === 'z'
      );
      neededTopics.push({
        name: inst.name,
        multiId: inst.multiId,
        fields: desiredFields
      });
    });

    if (heading) {
      const attTopic = state.summary.topics.find(t => t.name === 'vehicle_attitude')!;
      neededTopics.push({
        name: 'vehicle_attitude',
        multiId: 0,
        fields: attTopic.fields.filter(f => f.startsWith('q['))
      });

      const gsfTopic = state.summary.topics.find(t => t.name === 'yaw_estimator_status');
      if (gsfTopic) {
        neededTopics.push({
          name: 'yaw_estimator_status',
          multiId: 0,
          fields: gsfTopic.fields.filter(f => f === 'yaw')
        });
      }

      const gpsTopic = state.summary.topics.find(t => t.name === 'sensor_gps');
      if (gpsTopic) {
        neededTopics.push({
          name: 'sensor_gps',
          multiId: 0,
          fields: gpsTopic.fields.filter(f => f === 'cog_rad')
        });
      }
    }

    let allLoaded = true;
    for (const t of neededTopics) {
      const key = `${t.name}:${t.multiId}`;
      if (!state.topicCache[key]) {
        requestTopicData(t.name, t.multiId, t.fields);
        allLoaded = false;
      }
    }

    setIsDataLoaded(allLoaded);
  }, [state.summary, state.topicCache, requestTopicData]);

  // 滾輪縮放註冊輔助器
  const registerWheelZoom = useCallback((plot: uPlot) => {
    plot.over.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const minX = plot.scales.x.min!;
      const maxX = plot.scales.x.max!;
      const range = maxX - minX;
      const rect = plot.over.getBoundingClientRect();
      const mousePct = (e.clientX - rect.left) / rect.width;
      const mouseVal = minX + mousePct * range;
      const zoomFactor = e.deltaY < 0 ? 0.85 : 1.15;
      const newRange = range * zoomFactor;
      const newMin = mouseVal - mousePct * newRange;
      const newMax = newMin + newRange;
      const logEnd = (state.summary?.durationUs ?? 0) / 1e6;

      plot.setScale('x', {
        min: Math.max(0, newMin),
        max: Math.min(logEnd, newMax),
      });
    });
  }, [state.summary]);

  // 2. 數據解算與繪圖
  const renderCharts = useCallback(() => {
    if (!state.summary || !isDataLoaded) return;
    const startLogUs = state.summary.startTimestampUs;

    // ─── A. 多磁力計模長強度計算與重疊繪製 ───
    if (magInstances.length > 0) {
      const refInst = magInstances[0];
      const refCache = state.topicCache[`${refInst.name}:${refInst.multiId}`];
      if (refCache && refCache.count > 0) {
        const n = refCache.count;
        const xsSec = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          xsSec[i] = (refCache.timestamps[i] - startLogUs) / 1e6;
        }

        const dataCols: Float32Array[] = [];
        const seriesOpts: any[] = [{ label: 'Time (s)' }];
        
        const computedMetrics: MagMetricData[] = [];

        magInstances.forEach((inst, idx) => {
          const cache = state.topicCache[`${inst.name}:${inst.multiId}`];
          if (cache && cache.count > 0) {
            const mx = cache.fields['magnetometer_ga[0]'] || cache.fields['x'];
            const my = cache.fields['magnetometer_ga[1]'] || cache.fields['y'];
            const mz = cache.fields['magnetometer_ga[2]'] || cache.fields['z'];
            
            if (mx && my && mz) {
              const norm = new Float32Array(n);
              let sumNorm = 0;
              let minN = Infinity;
              let maxN = -Infinity;

              if (idx === 0) {
                for (let i = 0; i < n; i++) {
                  const val = Math.sqrt(mx[i]*mx[i] + my[i]*my[i] + mz[i]*mz[i]);
                  norm[i] = val;
                  sumNorm += val;
                  if (val < minN) minN = val;
                  if (val > maxN) maxN = val;
                }
              } else {
                const mxAl = interpolateSeries(cache.timestamps, mx as any, refCache.timestamps);
                const myAl = interpolateSeries(cache.timestamps, my as any, refCache.timestamps);
                const mzAl = interpolateSeries(cache.timestamps, mz as any, refCache.timestamps);
                for (let i = 0; i < n; i++) {
                  const val = Math.sqrt(mxAl[i]*mxAl[i] + myAl[i]*myAl[i] + mzAl[i]*mzAl[i]);
                  norm[i] = val;
                  sumNorm += val;
                  if (val < minN) minN = val;
                  if (val > maxN) maxN = val;
                }
              }
              
              computedMetrics.push({
                idx: inst.multiId,
                name: inst.name,
                avg: sumNorm / n,
                variation: maxN - minN,
                emi: (maxN - minN) > 0.15
              });

              dataCols.push(norm);
              seriesOpts.push({
                label: `Compass ${inst.multiId} Norm`,
                stroke: idx === 0 ? '#fbbf24' : idx === 1 ? '#38bdf8' : '#a78bfa',
                width: 1.5,
                points: { show: false } as any
              });
            }
          }
        });

        // 避免 React 更新迴圈
        const metricsStr = JSON.stringify(computedMetrics);
        if (metricsStr !== lastMetricsStrRef.current) {
          lastMetricsStrRef.current = metricsStr;
          setMagMetrics(computedMetrics);
        }

        if (normContainerRef.current && dataCols.length > 0) {
          normChartRef.current?.destroy();
          normChartRef.current = null;

          const uPlotData = [xsSec, ...dataCols] as uPlot.AlignedData;
          const rect = normContainerRef.current.getBoundingClientRect();

          const opts: uPlot.Options = {
            width: Math.max(100, Math.floor(rect.width)),
            height: Math.max(80, Math.floor(rect.height)),
            scales: { x: { time: false }, y: { auto: true } },
            axes: [
              { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
              { label: 'Norm (Gauss)', stroke: '#64748b', font: '10px JetBrains Mono, monospace', side: 3 }
            ],
            series: seriesOpts,
            cursor: { sync: { key: magSync.key } },
            hooks: {
              drawAxes: [
                (u: uPlot) => {
                  const timeSec = (currentTimeUs - startLogUs) / 1e6;
                  const cx = u.valToPos(timeSec, 'x', true);
                  if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
                    u.ctx.save();
                    u.ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                    u.ctx.setLineDash([3, 3]);
                    u.ctx.beginPath();
                    u.ctx.moveTo(cx, u.bbox.top);
                    u.ctx.lineTo(cx, u.bbox.top + u.bbox.height);
                    u.ctx.stroke();
                    u.ctx.restore();
                  }
                }
              ]
            }
          };
          const plot = new uPlot(opts, uPlotData, normContainerRef.current);
          registerWheelZoom(plot);
          normChartRef.current = plot;
        }
      }
    }

    // ─── B. 繪製選定指南針的原始三軸磁力值 (X, Y, Z) ───
    if (magInstances.length > activeRawMagIdx) {
      const targetInst = magInstances[activeRawMagIdx];
      const cache = state.topicCache[`${targetInst.name}:${targetInst.multiId}`];
      if (cache && cache.count > 0 && rawContainerRef.current) {
        const mx = cache.fields['magnetometer_ga[0]'] || cache.fields['x'];
        const my = cache.fields['magnetometer_ga[1]'] || cache.fields['y'];
        const mz = cache.fields['magnetometer_ga[2]'] || cache.fields['z'];

        if (mx && my && mz) {
          rawChartRef.current?.destroy();
          rawChartRef.current = null;

          const n = cache.count;
          const xsSec = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            xsSec[i] = (cache.timestamps[i] - startLogUs) / 1e6;
          }

          const uPlotData: uPlot.AlignedData = [xsSec, mx, my, mz] as any;
          const rect = rawContainerRef.current.getBoundingClientRect();

          const opts: uPlot.Options = {
            width: Math.max(100, Math.floor(rect.width)),
            height: Math.max(80, Math.floor(rect.height)),
            scales: { x: { time: false }, y: { auto: true } },
            axes: [
              { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
              { label: 'Mag Axis (Gauss)', stroke: '#64748b', font: '10px JetBrains Mono, monospace', side: 3 }
            ],
            series: [
              { label: 'Time (s)' },
              { label: 'Mag X', stroke: '#ef4444', width: 1.2, points: { show: false } },
              { label: 'Mag Y', stroke: '#10b981', width: 1.2, points: { show: false } },
              { label: 'Mag Z', stroke: '#3b82f6', width: 1.2, points: { show: false } }
            ] as any,
            cursor: { sync: { key: magSync.key } },
            hooks: {
              drawAxes: [
                (u: uPlot) => {
                  const timeSec = (currentTimeUs - startLogUs) / 1e6;
                  const cx = u.valToPos(timeSec, 'x', true);
                  if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
                    u.ctx.save();
                    u.ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                    u.ctx.setLineDash([3, 3]);
                    u.ctx.beginPath();
                    u.ctx.moveTo(cx, u.bbox.top);
                    u.ctx.lineTo(cx, u.bbox.top + u.bbox.height);
                    u.ctx.stroke();
                    u.ctx.restore();
                  }
                }
              ]
            }
          };

          const plot = new uPlot(opts, uPlotData, rawContainerRef.current);
          registerWheelZoom(plot);
          rawChartRef.current = plot;
        }
      }
    }

    // ─── C. 多源航向角計算與繪製 (EKF Yaw vs GSF Yaw vs GPS COG) ───
    if (hasHeading) {
      const attCache = state.topicCache['vehicle_attitude:0'];
      const gsfCache = state.topicCache['yaw_estimator_status:0'];
      const gpsCache = state.topicCache['sensor_gps:0'];

      if (attCache && attCache.count > 0) {
        const q0 = attCache.fields['q[0]'];
        const q1 = attCache.fields['q[1]'];
        const q2 = attCache.fields['q[2]'];
        const q3 = attCache.fields['q[3]'];

        if (q0 && q1 && q2 && q3) {
          const n = attCache.count;
          
          const ekfYaw = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const euler = quatToEuler(q0[i], q1[i], q2[i], q3[i]);
            let yawDeg = (euler[2] * 180) / Math.PI;
            if (yawDeg < 0) yawDeg += 360;
            ekfYaw[i] = yawDeg;
          }

          const gsfYawAligned = new Float32Array(n);
          let sumGsfOffset = 0;
          let validGsfCount = 0;
          const hasGsf = gsfCache && gsfCache.count > 0 && gsfCache.fields['yaw'];

          if (hasGsf) {
            const gsfYawRaw = gsfCache.fields['yaw'];
            for (let i = 0; i < n; i++) {
              const rad = interpolateAt(gsfCache.timestamps, gsfYawRaw as any, attCache.timestamps[i]);
              let deg = (rad * 180) / Math.PI;
              if (deg < 0) deg += 360;
              gsfYawAligned[i] = deg;

              let diff = Math.abs(ekfYaw[i] - deg);
              if (diff > 180) diff = 360 - diff;
              sumGsfOffset += diff;
              validGsfCount++;
            }
            setGsfOffsetAvg(validGsfCount > 0 ? sumGsfOffset / validGsfCount : null);
          }

          const gpsCogAligned = new Float32Array(n);
          const hasGps = gpsCache && gpsCache.count > 0 && gpsCache.fields['cog_rad'];
          if (hasGps) {
            const cogRaw = gpsCache.fields['cog_rad'];
            for (let i = 0; i < n; i++) {
              const rad = interpolateAt(gpsCache.timestamps, cogRaw as any, attCache.timestamps[i]);
              let deg = (rad * 180) / Math.PI;
              if (deg < 0) deg += 360;
              gpsCogAligned[i] = deg;
            }
          }

          if (headingContainerRef.current) {
            headingChartRef.current?.destroy();
            headingChartRef.current = null;

            const xsSec = new Float64Array(n);
            for (let i = 0; i < n; i++) {
              xsSec[i] = (attCache.timestamps[i] - startLogUs) / 1e6;
            }

            const yCols = [ekfYaw];
            const seriesOpts: any[] = [
              { label: 'Time (s)' },
              { label: 'EKF Yaw', stroke: '#ef4444', width: 1.5, points: { show: false } }
            ];

            if (hasGsf) {
              yCols.push(gsfYawAligned);
              seriesOpts.push({ label: 'EKF GSF Yaw (IMU/GPS)', stroke: '#10b981', width: 1.5, points: { show: false } });
            }
            if (hasGps) {
              yCols.push(gpsCogAligned);
              seriesOpts.push({ label: 'GPS COG (地面航向)', stroke: '#3b82f6', width: 1.2, points: { show: false } });
            }

            const uPlotData: uPlot.AlignedData = [xsSec, ...yCols] as uPlot.AlignedData;
            const rect = headingContainerRef.current.getBoundingClientRect();

            const opts: uPlot.Options = {
              width: Math.max(100, Math.floor(rect.width)),
              height: Math.max(80, Math.floor(rect.height)),
              scales: { x: { time: false }, y: { min: 0, max: 360 } },
              axes: [
                { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
                { label: 'Heading (Degrees)', stroke: '#64748b', font: '10px JetBrains Mono, monospace', side: 3, values: (u, vals) => vals.map(v => `${v}°`) }
              ],
              series: seriesOpts,
              cursor: { sync: { key: magSync.key } },
              hooks: {
                drawAxes: [
                  (u: uPlot) => {
                    const timeSec = (currentTimeUs - startLogUs) / 1e6;
                    const cx = u.valToPos(timeSec, 'x', true);
                    if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
                      u.ctx.save();
                      u.ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                      u.ctx.setLineDash([3, 3]);
                      u.ctx.beginPath();
                      u.ctx.moveTo(cx, u.bbox.top);
                      u.ctx.lineTo(cx, u.bbox.top + u.bbox.height);
                      u.ctx.stroke();
                      u.ctx.restore();
                    }
                  }
                ]
              }
            };
            const plot = new uPlot(opts, uPlotData, headingContainerRef.current);
            registerWheelZoom(plot);
            headingChartRef.current = plot;
          }
        }
      }
    }
  }, [isDataLoaded, magInstances, hasHeading, state.topicCache, state.summary, currentTimeUs, activeRawMagIdx, magSync, registerWheelZoom]);

  // 重建圖表
  useEffect(() => {
    renderCharts();
  }, [renderCharts]);

  // 播放時間更新時重繪
  useEffect(() => {
    if (normChartRef.current) normChartRef.current.redraw(false);
    if (rawChartRef.current) rawChartRef.current.redraw(false);
    if (headingChartRef.current) headingChartRef.current.redraw(false);
  }, [currentTimeUs]);

  // ResizeObserver
  useEffect(() => {
    const handleResize = () => {
      if (normChartRef.current && normContainerRef.current) {
        const rect = normContainerRef.current.getBoundingClientRect();
        normChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
      if (rawChartRef.current && rawContainerRef.current) {
        const rect = rawContainerRef.current.getBoundingClientRect();
        rawChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
      if (headingChartRef.current && headingContainerRef.current) {
        const rect = headingContainerRef.current.getBoundingClientRect();
        headingChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
    };

    const ro = new ResizeObserver(handleResize);
    if (normContainerRef.current) ro.observe(normContainerRef.current);
    if (rawContainerRef.current) ro.observe(rawContainerRef.current);
    if (headingContainerRef.current) ro.observe(headingContainerRef.current);
    return () => ro.disconnect();
  }, []);

  const hasMag = magInstances.length > 0;

  return (
    <div className={styles.root}>
      <div className={styles.container}>
        {/* 左側三圖表 */}
        <div className={styles.chartColumn} style={{ gap: '6px' }}>
          {/* 磁場強度模長 */}
          <div className={styles.card} style={{ flex: 1 }}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>
                🧲 {state.language === 'en' ? 'Magnetic Field Strength (Norm)' : '磁力計三軸模長強度比較 (Vector Norm)'}
              </span>
            </div>
            {!hasMag ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'No magnetometer data' : '無磁力計數據'}</div>
            ) : !isDataLoaded ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'Loading Mag...' : '載入磁場數據中...'}</div>
            ) : (
              <div className={styles.chartWrapper}>
                <div ref={normContainerRef} className={styles.chartArea} />
              </div>
            )}
          </div>

          {/* 原始三軸磁力值 (X, Y, Z) - 新增 */}
          <div className={styles.card} style={{ flex: 1 }}>
            <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={styles.cardTitle}>
                🧲 {state.language === 'en' ? 'Raw 3-Axis Magnetic Values' : '磁力計原始三軸數據 (Gauss)'}
              </span>
              {magInstances.length > 1 && (
                <select
                  value={activeRawMagIdx}
                  onChange={(e) => setActiveRawMagIdx(Number(e.target.value))}
                  style={{ background: '#111827', border: '1px solid #1e293b', color: '#e2e8f0', fontSize: '11px', borderRadius: '3px', padding: '2px 4px' }}
                >
                  {magInstances.map((inst, idx) => (
                    <option key={idx} value={idx}>
                      Compass {inst.multiId} ({inst.name})
                    </option>
                  ))}
                </select>
              )}
            </div>
            {!hasMag ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'No magnetometer data' : '無磁力計數據'}</div>
            ) : !isDataLoaded ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'Loading Raw Mag...' : '載入三軸磁力數據中...'}</div>
            ) : (
              <div className={styles.chartWrapper}>
                <div ref={rawContainerRef} className={styles.chartArea} />
              </div>
            )}
          </div>

          {/* 多源航向對比 */}
          <div className={styles.card} style={{ flex: 1 }}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>
                🧭 {state.language === 'en' ? 'Multi-Source Heading (Yaw/COG) Comparison' : 'EKF/GSF/GPS 航向角與航跡向同步比對'}
              </span>
            </div>
            {!hasHeading ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'No attitude data' : '無姿態數據'}</div>
            ) : !isDataLoaded ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'Loading Heading...' : '載入航向數據中...'}</div>
            ) : (
              <div className={styles.chartWrapper}>
                <div ref={headingContainerRef} className={styles.chartArea} />
              </div>
            )}
          </div>
        </div>

        {/* 右側診斷控制台 */}
        <div className={styles.consoleColumn}>
          <div className={styles.sectionTitle}>
            {state.language === 'en' ? '🛡️ EKF & Mag Diagnostics' : '🛡️ 磁力與航向評估報告'}
          </div>

          {isDataLoaded ? (
            <div className={styles.reportWrap}>
              <div className={styles.reportRow}>
                <span className={styles.reportKey}>{state.language === 'en' ? 'Mag Count' : '偵測指南針數'}</span>
                <span className={styles.reportVal} style={{ fontWeight: 'bold', color: '#38bdf8' }}>
                  {magInstances.length} 個
                </span>
              </div>

              {/* 橫向分割線與指南針評估列表 */}
              <div className={styles.divider} />
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#94a3b8' }}>
                  {state.language === 'en' ? 'Magnetometer Inst. Status' : '各羅盤實例強度評估：'}
                </span>
                {magMetrics.map(m => (
                  <div key={m.idx} style={{ backgroundColor: '#111827', border: '1px solid #1e293b', borderRadius: '3px', padding: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', fontWeight: '500', marginBottom: '4px' }}>
                      <span style={{ color: '#e2e8f0' }}>Compass {m.idx}</span>
                      <span style={{ color: m.emi ? '#f87171' : '#34d399' }}>
                        {m.emi ? (state.language === 'en' ? '🚨 EMI WARNING' : '🚨 EMI 干擾') : (state.language === 'en' ? '✅ STABLE' : '✅ 穩定')}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
                      <span>Avg Norm: <b style={{ fontFamily: 'JetBrains Mono', color: '#94a3b8' }}>{m.avg.toFixed(3)} G</b></span>
                      <span>Fluct: <b style={{ fontFamily: 'JetBrains Mono', color: m.emi ? '#f87171' : '#94a3b8' }}>{m.variation.toFixed(3)} G</b></span>
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.divider} />

              {/* 地球磁場對照基準 */}
              <div className={styles.referenceBox}>
                <div className={styles.refTitle}>🌍 {state.language === 'en' ? 'Earth Magnetic Field Reference' : '地球磁場強度對照基準'}</div>
                <div className={styles.refContent}>
                  {state.language === 'en'
                    ? 'The standard strength of Earth magnetic field is typically between 0.25 to 0.65 Gauss. Typical geographic values: Taiwan is ~0.45 Gauss, Equator is ~0.30 Gauss, Polar regions are ~0.60 Gauss.'
                    : '地球磁場標準強度一般分布在 0.25 ~ 0.65 高斯 (Gauss) 之間。各地區參考值：台灣約為 0.45 高斯，赤道附近最低約為 0.30 高斯，南北兩極最高約為 0.60 高斯。'}
                </div>
              </div>

              {/* 診斷報告卡 */}
              {magMetrics.length > 0 && (
                <div className={styles.diagBox} style={{ borderLeftColor: magMetrics.some(m => m.emi) ? '#ef4444' : '#10b981' }}>
                  <div className={styles.diagTitle} style={{ color: magMetrics.some(m => m.emi) ? '#f87171' : '#34d399' }}>
                    {magMetrics.some(m => m.emi)
                      ? (state.language === 'en' ? '🚨 High Magnetic Interference (EMI)' : '🚨 偵測到強磁場電磁干擾 (EMI)')
                      : (state.language === 'en' ? '✅ Stable Magnetic Environment' : '✅ 磁場環境良好穩定')}
                  </div>
                  <div className={styles.diagContent}>
                    {magMetrics.some(m => m.emi) ? (
                      state.language === 'en'
                        ? 'The magnetometer norm fluctuates heavily. This usually indicates high current loops passing near the compass. Recommend recalibrating or relocating the magnetometer module.'
                        : '部分指南針三軸模長振盪幅度大於地磁正常起伏範圍。這通常是動力配線產生的電磁干擾。可能導致 EKF 出現 compass check fail。建議對指南針進行大電流補償校正 (Mag EMI compensation) 或將羅盤模組墊高。'
                    ) : (
                      state.language === 'en'
                        ? 'Compass magnetic environment is clean and stable. No high-current electro-magnetic coupling detected.'
                        : '指南針磁場模長極為平穩，未檢測到動力大電流電磁干擾。指南針運行環境安全。'
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.emptyHint}>
              {state.language === 'en' ? 'Gathering log parameters...' : '載入並對齊磁強與航向數據中...'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
