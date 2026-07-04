import React, { useEffect, useRef, useState, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import { interpolateAt, quatToEuler } from '../parser/utils';
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

  const [hasMag, setHasMag] = useState(false);
  const [hasHeading, setHasHeading] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  // 診斷指標
  const [maxNormVariation, setMaxNormVariation] = useState<number>(0);
  const [avgNorm, setAvgNorm] = useState<number>(0);
  const [gsfOffsetAvg, setGsfOffsetAvg] = useState<number | null>(null);
  const [emiAlert, setEmiAlert] = useState<boolean>(false);

  // 1. 檢測 Topic 是否存在
  const checkTopics = useCallback(() => {
    if (!state.summary) return { mag: false, heading: false };
    const topics = state.summary.topics;
    const mag = topics.some(t => t.name === 'vehicle_magnetometer');
    const heading = topics.some(t => t.name === 'vehicle_attitude');
    return { mag, heading };
  }, [state.summary]);

  // 2. 自動按需加載數據到快取
  useEffect(() => {
    if (!state.summary) return;
    const { mag, heading } = checkTopics();
    setHasMag(mag);
    setHasHeading(heading);

    const neededTopics: { name: string; fields: string[] }[] = [];

    if (mag) {
      const magTopic = state.summary.topics.find(t => t.name === 'vehicle_magnetometer')!;
      neededTopics.push({
        name: 'vehicle_magnetometer',
        fields: magTopic.fields.filter(f => f.startsWith('magnetometer_ga'))
      });
    }

    if (heading) {
      const attTopic = state.summary.topics.find(t => t.name === 'vehicle_attitude')!;
      neededTopics.push({
        name: 'vehicle_attitude',
        fields: attTopic.fields.filter(f => f.startsWith('q['))
      });

      const gsfTopic = state.summary.topics.find(t => t.name === 'yaw_estimator_status');
      if (gsfTopic) {
        neededTopics.push({
          name: 'yaw_estimator_status',
          fields: gsfTopic.fields.filter(f => f === 'yaw')
        });
      }

      const gpsTopic = state.summary.topics.find(t => t.name === 'sensor_gps');
      if (gpsTopic) {
        neededTopics.push({
          name: 'sensor_gps',
          fields: gpsTopic.fields.filter(f => f === 'cog_rad')
        });
      }
    }

    // 檢查是否有未加載的資料
    let allLoaded = true;
    for (const t of neededTopics) {
      const key = `${t.name}:0`;
      if (!state.topicCache[key]) {
        requestTopicData(t.name, 0, t.fields);
        allLoaded = false;
      }
    }

    setIsDataLoaded(allLoaded);
  }, [state.summary, checkTopics, state.topicCache, requestTopicData]);

  // 3. 核心數據處理與繪圖
  const renderCharts = useCallback(() => {
    if (!state.summary || !isDataLoaded) return;
    const startLogUs = state.summary.startTimestampUs;

    // ─── A. 磁場強度模長計算與繪製 ───
    if (hasMag) {
      const magCache = state.topicCache['vehicle_magnetometer:0'];
      if (magCache && magCache.count > 0) {
        const mx = magCache.fields['magnetometer_ga[0]'];
        const my = magCache.fields['magnetometer_ga[1]'];
        const mz = magCache.fields['magnetometer_ga[2]'];

        if (mx && my && mz) {
          const n = magCache.count;
          const magNorm = new Float32Array(n);
          let sumNorm = 0;
          let minN = Infinity;
          let maxN = -Infinity;

          for (let i = 0; i < n; i++) {
            const val = Math.sqrt(mx[i] * mx[i] + my[i] * my[i] + mz[i] * mz[i]);
            magNorm[i] = val;
            sumNorm += val;
            if (val < minN) minN = val;
            if (val > maxN) maxN = val;
          }

          const avg = sumNorm / n;
          setAvgNorm(avg);
          // 模長抖動範圍 (Max - Min)
          const variation = maxN - minN;
          setMaxNormVariation(variation);
          // 基準地磁若在飛行中抖動超過 0.15 Gauss (150 mGauss)，提示大電流 EMI 干擾
          setEmiAlert(variation > 0.15);

          // 繪製 uPlot Norm
          if (normContainerRef.current) {
            normChartRef.current?.destroy();
            normChartRef.current = null;

            const xsSec = new Float64Array(n);
            for (let i = 0; i < n; i++) {
              xsSec[i] = (magCache.timestamps[i] - startLogUs) / 1e6;
            }

            const uPlotData: uPlot.AlignedData = [xsSec, magNorm];
            const rect = normContainerRef.current.getBoundingClientRect();

            const opts: uPlot.Options = {
              width: Math.max(100, Math.floor(rect.width)),
              height: Math.max(80, Math.floor(rect.height)),
              scales: { x: { time: false }, y: { auto: true } },
              axes: [
                { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
                { label: 'Mag Norm (Gauss)', stroke: '#64748b', font: '10px JetBrains Mono, monospace', side: 3 }
              ],
              series: [
                { label: 'Time (s)' },
                { label: 'Norm', stroke: '#fbbf24', width: 1.5, points: { show: false } }
              ],
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
    }

    // ─── B. 多源航向角計算與繪製 ───
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
          
          // EKF 姿態估算 Yaw (deg)
          const ekfYaw = new Float32Array(n);
          for (let i = 0; i < n; i++) {
            const euler = quatToEuler(q0[i], q1[i], q2[i], q3[i]); // [roll, pitch, yaw] in rad
            let yawDeg = (euler[2] * 180) / Math.PI;
            // 轉換為 0 - 360 度
            if (yawDeg < 0) yawDeg += 360;
            ekfYaw[i] = yawDeg;
          }

          // 獲取並對齊 GSF Yaw
          const gsfYawAligned = new Float32Array(n);
          let sumGsfOffset = 0;
          let validGsfCount = 0;
          const hasGsf = gsfCache && gsfCache.count > 0 && gsfCache.fields['yaw'];

          if (hasGsf) {
            const gsfYawRaw = gsfCache.fields['yaw'];
            for (let i = 0; i < n; i++) {
              const rad = interpolateAt(gsfCache.timestamps, gsfYawRaw, attCache.timestamps[i]);
              let deg = (rad * 180) / Math.PI;
              if (deg < 0) deg += 360;
              gsfYawAligned[i] = deg;

              // 計算平均航向偏差 (EKF vs GSF)
              let diff = Math.abs(ekfYaw[i] - deg);
              if (diff > 180) diff = 360 - diff;
              sumGsfOffset += diff;
              validGsfCount++;
            }
            setGsfOffsetAvg(validGsfCount > 0 ? sumGsfOffset / validGsfCount : null);
          }

          // 獲取並對齊 GPS COG
          const gpsCogAligned = new Float32Array(n);
          const hasGps = gpsCache && gpsCache.count > 0 && gpsCache.fields['cog_rad'];
          if (hasGps) {
            const cogRaw = gpsCache.fields['cog_rad'];
            for (let i = 0; i < n; i++) {
              const rad = interpolateAt(gpsCache.timestamps, cogRaw, attCache.timestamps[i]);
              let deg = (rad * 180) / Math.PI;
              if (deg < 0) deg += 360;
              gpsCogAligned[i] = deg;
            }
          }

          // 繪製 uPlot Heading
          if (headingContainerRef.current) {
            headingChartRef.current?.destroy();
            headingChartRef.current = null;

            const xsSec = new Float64Array(n);
            for (let i = 0; i < n; i++) {
              xsSec[i] = (attCache.timestamps[i] - startLogUs) / 1e6;
            }

            const yCols = [ekfYaw];
            const seriesOpts = [
              { label: 'Time (s)' },
              { label: 'EKF Yaw', stroke: '#ef4444', width: 1.5, points: { show: false } }
            ];

            if (hasGsf) {
              yCols.push(gsfYawAligned);
              seriesOpts.push({ label: 'GSF Yaw', stroke: '#10b981', width: 1.5, points: { show: false } });
            }
            if (hasGps) {
              yCols.push(gpsCogAligned);
              seriesOpts.push({ label: 'GPS COG (航向)', stroke: '#3b82f6', width: 1.2, points: { show: false } });
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
  }, [isDataLoaded, hasMag, hasHeading, state.topicCache, state.summary, currentTimeUs]);

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

  return (
    <div className={styles.root}>
      {/* 雙欄佈局：左邊兩張時序圖，右邊磁場/航向健康診斷報告 */}
      <div className={styles.container}>
        <div className={styles.chartColumn}>
          {/* 上半部：磁場模長 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>🧲 {state.language === 'en' ? 'Magnetic Field Strength (Norm)' : '磁場模長強度 (Vector Norm)'}</span>
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

          {/* 下半部：多源航向對比 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>🧭 {state.language === 'en' ? 'Multi-Source Heading (Yaw) Comparison' : '多源航向角 (Yaw) 同步比對'}</span>
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
                <span className={styles.reportKey}>{state.language === 'en' ? 'Average Mag Norm' : '平均磁場模長'}</span>
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

              {/* 診斷診斷卡 */}
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
                      : '磁場強度模長抖動幅度超過地磁正常起伏範圍。這通常是動力電源大電流線路過近導致的電磁感擾 (EMI)。可能導致 EKF 出現 compass check fail。建議對指南針重新進行屏蔽校正，或將 GPS/Mag 模組墊高遠離配電板。'
                  ) : (
                    state.language === 'en'
                      ? 'Compass magnetic environment is clean and stable. No high-current electro-magnetic coupling detected.'
                      : '指南針磁強非常平穩，未檢測到動力大電流電磁干擾。指南針運行環境安全。'
                  )}
                </div>
              </div>

              {gsfOffsetAvg !== null && gsfOffsetAvg > 10 && (
                <div className={styles.diagBox} style={{ borderLeftColor: '#ef4444', marginTop: '10px' }}>
                  <div className={styles.diagTitle} style={{ color: '#f87171' }}>
                    🚨 {state.language === 'en' ? 'EKF Compass Alignment Skew' : 'EKF 指南針航向偏置警告'}
                  </div>
                  <div className={styles.diagContent}>
                    {state.language === 'en'
                      ? 'Significant difference between EKF combined Yaw and EKF GSF (pure GPS/IMU) Yaw. This suggests compass calibration errors or alignment offset. Verify the compass installation orientation.'
                      : '融合航向 (EKF Yaw) 與無磁估計航向 (EKF GSF Yaw) 存在持續偏差。這說明指南針安裝偏角設定錯誤、或本身存在機械安裝偏差。請仔細核對 QGC 中的指南針安裝朝向參數 (CAL_MAG_ROT)。'}
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
