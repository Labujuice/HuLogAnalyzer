import React, { useEffect, useRef, useState, useCallback } from 'react';
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

export function MagneticPanel({ panelId, currentTimeUs }: MagneticPanelProps) {
  const { state, requestTopicData } = useApp();
  
  const normContainerRef = useRef<HTMLDivElement>(null);
  const headingContainerRef = useRef<HTMLDivElement>(null);
  
  const normChartRef = useRef<uPlot | null>(null);
  const headingChartRef = useRef<uPlot | null>(null);

  const [magInstances, setMagInstances] = useState<{ name: string; multiId: number }[]>([]);
  const [hasHeading, setHasHeading] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  // 診斷指標
  const [maxNormVariation, setMaxNormVariation] = useState<number>(0);
  const [avgNorm, setAvgNorm] = useState<number>(0);
  const [gsfOffsetAvg, setGsfOffsetAvg] = useState<number | null>(null);
  const [emiAlert, setEmiAlert] = useState<boolean>(false);

  // 1. 自動檢測所有磁力計實例與航向 Topic
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

    // 檢查快取加載狀態
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
        
        let overallMaxVariation = 0;
        let overallAvg = 0;

        magInstances.forEach((inst, idx) => {
          const cache = state.topicCache[`${inst.name}:${inst.multiId}`];
          if (cache && cache.count > 0) {
            const mx = cache.fields['magnetometer_ga[0]'] || cache.fields['x'];
            const my = cache.fields['magnetometer_ga[1]'] || cache.fields['y'];
            const mz = cache.fields['magnetometer_ga[2]'] || cache.fields['z'];
            
            if (mx && my && mz) {
              const norm = new Float32Array(n);
              if (idx === 0) {
                let sumNorm = 0;
                let minN = Infinity;
                let maxN = -Infinity;
                for (let i = 0; i < n; i++) {
                  const val = Math.sqrt(mx[i]*mx[i] + my[i]*my[i] + mz[i]*mz[i]);
                  norm[i] = val;
                  sumNorm += val;
                  if (val < minN) minN = val;
                  if (val > maxN) maxN = val;
                }
                overallAvg = sumNorm / n;
                overallMaxVariation = maxN - minN;
              } else {
                // 將其他磁力計數據插值對齊到 Compass 0 的時間軸
                const mxAl = interpolateSeries(cache.timestamps, mx as any, refCache.timestamps);
                const myAl = interpolateSeries(cache.timestamps, my as any, refCache.timestamps);
                const mzAl = interpolateSeries(cache.timestamps, mz as any, refCache.timestamps);
                for (let i = 0; i < n; i++) {
                  norm[i] = Math.sqrt(mxAl[i]*mxAl[i] + myAl[i]*myAl[i] + mzAl[i]*mzAl[i]);
                }
              }
              
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

        setAvgNorm(overallAvg);
        setMaxNormVariation(overallMaxVariation);
        // 若磁力計在飛行中振盪起伏大於 0.15 Gauss，判定為高大電流 EMI 干擾
        setEmiAlert(overallMaxVariation > 0.15);

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
            series: seriesOpts as any,
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
          normChartRef.current = new uPlot(opts, uPlotData, normContainerRef.current);
        }
      }
    }

    // ─── B. 多源航向角計算與繪製 (EKF Yaw vs GSF Yaw vs GPS COG) ───
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
          
          // EKF 融合航向
          const ekfYaw = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const euler = quatToEuler(q0[i], q1[i], q2[i], q3[i]);
            let yawDeg = (euler[2] * 180) / Math.PI;
            if (yawDeg < 0) yawDeg += 360;
            ekfYaw[i] = yawDeg;
          }

          // 對齊並解算 GSF Yaw
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

          // 對齊並解算 GPS COG (地面航向)
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
              series: seriesOpts as any,
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
            headingChartRef.current = new uPlot(opts, uPlotData, headingContainerRef.current);
          }
        }
      }
    }
  }, [isDataLoaded, magInstances, hasHeading, state.topicCache, state.summary, currentTimeUs]);

  // 重建圖表
  useEffect(() => {
    renderCharts();
  }, [renderCharts]);

  // 播放時間更新時重繪
  useEffect(() => {
    if (normChartRef.current) normChartRef.current.redraw(false);
    if (headingChartRef.current) headingChartRef.current.redraw(false);
  }, [currentTimeUs]);

  // ResizeObserver
  useEffect(() => {
    const handleResize = () => {
      if (normChartRef.current && normContainerRef.current) {
        const rect = normContainerRef.current.getBoundingClientRect();
        normChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
      if (headingChartRef.current && headingContainerRef.current) {
        const rect = headingContainerRef.current.getBoundingClientRect();
        headingChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
    };

    const ro = new ResizeObserver(handleResize);
    if (normContainerRef.current) ro.observe(normContainerRef.current);
    if (headingContainerRef.current) ro.observe(headingContainerRef.current);
    return () => ro.disconnect();
  }, []);

  const hasMag = magInstances.length > 0;

  return (
    <div className={styles.root}>
      <div className={styles.container}>
        {/* 左側雙圖表 */}
        <div className={styles.chartColumn}>
          {/* 磁場強度模長 */}
          <div className={styles.card}>
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

          {/* 多源航向對比 */}
          <div className={styles.card}>
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
              <div className={styles.reportRow}>
                <span className={styles.reportKey}>{state.language === 'en' ? 'Average Mag Norm' : '主指南針平均模長'}</span>
                <span className={styles.reportVal} style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {avgNorm.toFixed(3)} Gauss
                </span>
              </div>
              <div className={styles.reportRow}>
                <span className={styles.reportKey}>{state.language === 'en' ? 'Mag Norm Variation' : '磁力振盪幅度'}</span>
                <span className={styles.reportVal} style={{ fontFamily: 'JetBrains Mono, monospace', color: emiAlert ? '#f87171' : '#34d399' }}>
                  {maxNormVariation.toFixed(3)} Gauss
                </span>
              </div>
              {gsfOffsetAvg !== null && (
                <div className={styles.reportRow}>
                  <span className={styles.reportKey}>{state.language === 'en' ? 'EKF-GSF Yaw Offset' : '與 GSF 航向平均偏差'}</span>
                  <span className={styles.reportVal} style={{ fontFamily: 'JetBrains Mono, monospace', color: gsfOffsetAvg > 15 ? '#f87171' : '#34d399' }}>
                    {gsfOffsetAvg.toFixed(1)}°
                  </span>
                </div>
              )}

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
              <div className={styles.diagBox} style={{ borderLeftColor: emiAlert ? '#ef4444' : '#10b981' }}>
                <div className={styles.diagTitle} style={{ color: emiAlert ? '#f87171' : '#34d399' }}>
                  {emiAlert 
                    ? (state.language === 'en' ? '🚨 High Magnetic Interference (EMI)' : '🚨 偵測到強磁場電磁干擾 (EMI)') 
                    : (state.language === 'en' ? '✅ Stable Magnetic Environment' : '✅ 磁場環境良好穩定')}
                </div>
                <div className={styles.diagContent}>
                  {emiAlert ? (
                    state.language === 'en'
                      ? 'The magnetometer norm fluctuates heavily. This usually indicates high current loops passing near the compass. Recommend recalibrating or relocating the magnetometer module.'
                      : `指南針三軸模長振盪幅度 (${maxNormVariation.toFixed(3)} Gauss) 大於地磁正常起伏範圍。這通常是動力配線產生的電磁干擾。可能導致 EKF 出現 compass check fail。建議對指南針進行大電流補償校正 (Mag EMI compensation) 或將羅盤模組墊高。`
                  ) : (
                    state.language === 'en'
                      ? 'Compass magnetic environment is clean and stable. No high-current electro-magnetic coupling detected.'
                      : '指南針磁場模長極為平穩，未檢測到動力大電流電磁干擾。指南針運行環境安全。'
                  )}
                </div>
              </div>

              {gsfOffsetAvg !== null && (
                <div className={styles.diagBox} style={{ borderLeftColor: gsfOffsetAvg > 10 ? '#ef4444' : '#10b981', marginTop: '10px' }}>
                  <div className={styles.diagTitle} style={{ color: gsfOffsetAvg > 10 ? '#f87171' : '#34d399' }}>
                    🧭 {state.language === 'en' ? 'EKF GSF Alignment Diagnostic' : 'EKF GSF 航向評估指標'}
                  </div>
                  <div className={styles.diagContent}>
                    {gsfOffsetAvg > 10 ? (
                      state.language === 'en'
                        ? 'Significant difference between EKF combined Yaw and EKF GSF (pure GPS/IMU) Yaw. This suggests compass calibration errors or alignment offset. Verify the compass installation orientation.'
                        : `融合航向 (EKF Yaw) 與無磁估計航向 (EKF GSF Yaw) 偏差高達 ${gsfOffsetAvg.toFixed(1)}°。這說明指南針安裝偏角設定錯誤或受到外部固定磁場干擾，導致導航估算存在偏差。建議核對羅盤旋轉方向 (CAL_MAG_ROT)。`
                    ) : (
                      state.language === 'en'
                        ? 'EKF Yaw and GSF Yaw are well aligned. The navigation solution is highly reliable.'
                        : '融合航向與 EKF GSF 航向吻合良好，羅盤朝向設定正確，狀態估算具備極高可靠度。'
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
