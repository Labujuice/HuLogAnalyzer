import React, { useEffect, useRef, useState, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import { getWorkerBridge } from '../workers/workerBridge';
import styles from './PidResponsePanel.module.css';

interface PidResponsePanelProps {
  panelId: string;
  currentTimeUs: number;
}

type LoopType = 'rate' | 'attitude' | 'velocity' | 'position';
type AxisType = 'roll' | 'pitch' | 'yaw' | 'x' | 'y' | 'z';

interface LoopConfig {
  name: string;
  setpointTopic: string;
  actualTopic: string;
  axes: {
    id: AxisType;
    label: string;
    setpointField: string;
    actualField: string;
    unit: string;
  }[];
}

const LOOP_CONFIGS: Record<LoopType, LoopConfig> = {
  rate: {
    name: 'Rate Loop (角速度環)',
    setpointTopic: 'vehicle_rates_setpoint',
    actualTopic: 'vehicle_angular_velocity',
    axes: [
      { id: 'roll', label: 'Roll Rate', setpointField: 'roll', actualField: 'xyz[0]', unit: 'rad/s' },
      { id: 'pitch', label: 'Pitch Rate', setpointField: 'pitch', actualField: 'xyz[1]', unit: 'rad/s' },
      { id: 'yaw', label: 'Yaw Rate', setpointField: 'yaw', actualField: 'xyz[2]', unit: 'rad/s' }
    ]
  },
  attitude: {
    name: 'Attitude Loop (姿態環)',
    setpointTopic: 'vehicle_attitude_setpoint',
    actualTopic: 'vehicle_attitude',
    axes: [
      { id: 'roll', label: 'Roll Euler', setpointField: 'roll_euler', actualField: 'roll_euler', unit: 'deg' },
      { id: 'pitch', label: 'Pitch Euler', setpointField: 'pitch_euler', actualField: 'pitch_euler', unit: 'deg' },
      { id: 'yaw', label: 'Yaw Euler', setpointField: 'yaw_euler', actualField: 'yaw_euler', unit: 'deg' }
    ]
  },
  velocity: {
    name: 'Velocity Loop (速度環)',
    setpointTopic: 'vehicle_local_position_setpoint',
    actualTopic: 'vehicle_local_position',
    axes: [
      { id: 'x', label: 'Vx (North)', setpointField: 'vx', actualField: 'vx', unit: 'm/s' },
      { id: 'y', label: 'Vy (East)', setpointField: 'vy', actualField: 'vy', unit: 'm/s' },
      { id: 'z', label: 'Vz (Down)', setpointField: 'vz', actualField: 'vz', unit: 'm/s' }
    ]
  },
  position: {
    name: 'Position Loop (位置環)',
    setpointTopic: 'vehicle_local_position_setpoint',
    actualTopic: 'vehicle_local_position',
    axes: [
      { id: 'x', label: 'X (North)', setpointField: 'x', actualField: 'x', unit: 'm' },
      { id: 'y', label: 'Y (East)', setpointField: 'y', actualField: 'y', unit: 'm' },
      { id: 'z', label: 'Z (Down)', setpointField: 'z', actualField: 'z', unit: 'm' }
    ]
  }
};

export function PidResponsePanel({ panelId, currentTimeUs }: PidResponsePanelProps) {
  const { state } = useApp();
  const chartRef = useRef<uPlot | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [activeLoop, setActiveLoop] = useState<LoopType>('rate');
  const [activeAxis, setActiveAxis] = useState<AxisType>('roll');
  const [isCalculating, setIsCalculating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 運算結果指標狀態
  const [metrics, setMetrics] = useState<{
    rmse: number;
    corr: number;
    lagMs: number;
    rating: string;
    ratingColor: string;
    computedRange?: { startS: number; endS: number };
  } | null>(null);

  // 切換 Loop 時，重設對應的 Axis
  useEffect(() => {
    const config = LOOP_CONFIGS[activeLoop];
    setActiveAxis(config.axes[0].id);
    setMetrics(null);
  }, [activeLoop]);

  // 確認 Topic 是否存在於 Summary
  const checkTopicsExist = useCallback((loop: LoopType) => {
    if (!state.summary) return false;
    const config = LOOP_CONFIGS[loop];
    const hasSetpoint = state.summary.topics.some(t => t.name === config.setpointTopic);
    const hasActual = state.summary.topics.some(t => t.name === config.actualTopic);
    return hasSetpoint && hasActual;
  }, [state.summary]);

  // 核心對齊與運算繪圖
  const handleCalculatePID = useCallback(async () => {
    if (!state.summary) return;
    setErrorMsg(null);
    setIsCalculating(true);

    const config = LOOP_CONFIGS[activeLoop];
    const axisConfig = config.axes.find(a => a.id === activeAxis);
    if (!axisConfig) return;

    // 取得當前圖表所框選的範圍
    const startUs = state.playback.startTimeUs;
    const endUs = state.playback.endTimeUs;
    const startS = (startUs - state.summary.startTimestampUs) / 1e6;
    const endS = (endUs - state.summary.startTimestampUs) / 1e6;

    try {
      const bridge = getWorkerBridge();
      const result = await bridge.alignPIDData(
        config.setpointTopic,
        axisConfig.setpointField,
        config.actualTopic,
        axisConfig.actualField,
        startUs,
        endUs
      );

      const timestamps = result.timestamps;
      const setpoint = result.setpointAligned;
      const actual = result.actualAligned;

      // 計算評分等級
      let rating = 'Poor (欠佳)';
      let ratingColor = '#ef4444';
      if (result.corr >= 0.95 && Math.abs(result.lagUs) < 40000) {
        rating = 'Excellent (優異)';
        ratingColor = '#10b981';
      } else if (result.corr >= 0.85 && Math.abs(result.lagUs) < 100000) {
        rating = 'Good (良好)';
        ratingColor = '#3b82f6';
      } else if (result.corr >= 0.70) {
        rating = 'Moderate (一般)';
        ratingColor = '#fb923c';
      }

      setMetrics({
        rmse: result.rmse,
        corr: result.corr,
        lagMs: result.lagUs / 1000,
        rating,
        ratingColor,
        computedRange: { startS, endS }
      });

      // 繪製 uPlot
      if (containerRef.current) {
        chartRef.current?.destroy();
        chartRef.current = null;

        // X 軸轉換為相對秒數
        const startLogUs = state.summary.startTimestampUs;
        const xsSec = new Float64Array(timestamps.length);
        for (let i = 0; i < timestamps.length; i++) {
          xsSec[i] = (timestamps[i] - startLogUs) / 1e6;
        }

        const uPlotData: uPlot.AlignedData = [xsSec, setpoint, actual];
        const rect = containerRef.current.getBoundingClientRect();

        const opts: uPlot.Options = {
          width: Math.max(100, Math.floor(rect.width)),
          height: Math.max(100, Math.floor(rect.height)),
          scales: {
            x: { time: false },
            y: { auto: true }
          },
          axes: [
            {
              stroke: '#64748b',
              grid: { stroke: '#1e293b', width: 1 },
              font: '11px JetBrains Mono, monospace',
            },
            {
              label: `${axisConfig.label} (${axisConfig.unit})`,
              stroke: '#64748b',
              grid: { stroke: '#1e293b', width: 1 },
              font: '11px JetBrains Mono, monospace',
              side: 3,
            }
          ],
          series: [
            { label: 'Time (s)' },
            {
              label: `Setpoint (期望)`,
              stroke: '#10b981',
              width: 1.5,
              dash: [4, 4],
              points: { show: false }
            },
            {
              label: `Feedback (實際)`,
              stroke: '#ef4444',
              width: 1.5,
              points: { show: false }
            }
          ],
          hooks: {
            drawAxes: [
              (u: uPlot) => {
                // 同步繪製當前播放時間線
                const timeSec = (currentTimeUs - startLogUs) / 1e6;
                const cx = u.valToPos(timeSec, 'x', true);
                const inRange = cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width;
                if (!inRange) return;

                const ctx = u.ctx;
                ctx.save();
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(cx, u.bbox.top);
                ctx.lineTo(cx, u.bbox.top + u.bbox.height);
                ctx.stroke();
                ctx.restore();
              }
            ]
          }
        };

        chartRef.current = new uPlot(opts, uPlotData, containerRef.current);
      }

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCalculating(false);
    }
  }, [state.summary, activeLoop, activeAxis, state.playback, currentTimeUs]);

  // 當選擇改變時，清理圖表
  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [activeLoop, activeAxis]);

  // 當播放時間線更新時，只重繪垂直播放線，不重新計算數據
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.redraw(false);
    }
  }, [currentTimeUs]);

  // ResizeObserver
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (chartRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        chartRef.current.setSize({
          width: Math.max(100, Math.floor(rect.width)),
          height: Math.max(100, Math.floor(rect.height))
        });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const hasData = checkTopicsExist(activeLoop);
  const currentConfig = LOOP_CONFIGS[activeLoop];

  return (
    <div className={styles.root}>
      {/* 頂部四環控制選單 */}
      <div className={styles.loopTabs}>
        {(['rate', 'attitude', 'velocity', 'position'] as LoopType[]).map(loop => {
          const exists = checkTopicsExist(loop);
          return (
            <button
              key={loop}
              className={`${styles.loopBtn} ${activeLoop === loop ? styles.active : ''} ${!exists ? styles.disabled : ''}`}
              onClick={() => exists && setActiveLoop(loop)}
              disabled={!exists}
              title={!exists ? '此日誌中缺少對應的 Topic 數據' : ''}
            >
              {LOOP_CONFIGS[loop].name}
              {!exists && <span className={styles.missingBadge}>N/A</span>}
            </button>
          );
        })}
      </div>

      <div className={styles.mainArea}>
        {/* 左側時序圖表 */}
        <div className={styles.chartSection}>
          <div className={styles.axisToolbar}>
            <div className={styles.axisSelect}>
              {currentConfig.axes.map(axis => (
                <button
                  key={axis.id}
                  className={`${styles.axisBtn} ${activeAxis === axis.id ? styles.axisActive : ''}`}
                  onClick={() => setActiveAxis(axis.id)}
                >
                  {axis.label}
                </button>
              ))}
            </div>

            <button
              className="btn btn--primary btn--small"
              onClick={handleCalculatePID}
              disabled={isCalculating || !hasData}
            >
              {isCalculating 
                ? (state.language === 'en' ? 'Calculating...' : '對齊計算中...') 
                : (state.language === 'en' ? '🔄 Align & Analyze' : '🔄 對齊與分析')}
            </button>
          </div>

          {!hasData ? (
            <div className={styles.emptyContainer}>
              {state.language === 'en'
                ? `Lack of Topic data: setpoint (${currentConfig.setpointTopic}) or actual (${currentConfig.actualTopic})`
                : `此 ULog 缺少分析所需的主題：期望值 (${currentConfig.setpointTopic}) 或實測值 (${currentConfig.actualTopic})`}
            </div>
          ) : (
            <div className={styles.chartWrapper}>
              {!metrics && !isCalculating && (
                <div className={styles.chartOverlay}>
                  <button className="btn btn--primary btn--large" onClick={handleCalculatePID}>
                    {state.language === 'en' ? 'Compute tracking response' : '點擊開始計算對齊與追隨響應'}
                  </button>
                </div>
              )}
              <div ref={containerRef} className={styles.chartArea} />
            </div>
          )}
        </div>

        {/* 右側評估指標面板 */}
        <div className={styles.metricsSection}>
          <div className={styles.sectionTitle}>
            {state.language === 'en' ? '📊 Tracking Report' : '📊 追隨分析報告'}
          </div>

          {metrics ? (
            <div className={styles.reportCard}>
              <div className={styles.metricRow}>
                <span className={styles.metricKey}>{state.language === 'en' ? 'Tracking Rating' : '追隨判定'}</span>
                <span className={styles.metricVal} style={{ color: metrics.ratingColor, fontWeight: 'bold' }}>
                  {metrics.rating}
                </span>
              </div>
              
              <div className={styles.divider} />
              
              <div className={styles.metricRow}>
                <span className={styles.metricKey}>{state.language === 'en' ? 'Root Mean Square Error (RMSE)' : '均方根誤差 (RMSE)'}</span>
                <span className={styles.metricVal} style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {metrics.rmse.toFixed(4)}
                </span>
              </div>

              <div className={styles.metricRow}>
                <span className={styles.metricKey}>{state.language === 'en' ? 'Correlation Coeff (R)' : '皮爾森相關係數 (R)'}</span>
                <span className={styles.metricVal} style={{ fontFamily: 'JetBrains Mono, monospace', color: metrics.corr >= 0.85 ? '#10b981' : '#f59e0b' }}>
                  {metrics.corr.toFixed(4)}
                </span>
              </div>

              <div className={styles.metricRow}>
                <span className={styles.metricKey}>{state.language === 'en' ? 'Phase Lag' : '相位延遲 (Lag)'}</span>
                <span className={styles.metricVal} style={{ fontFamily: 'JetBrains Mono, monospace', color: Math.abs(metrics.lagMs) > 60 ? '#ef4444' : '#e2e8f0' }}>
                  {metrics.lagMs.toFixed(1)} ms
                </span>
              </div>

              {metrics.computedRange && (
                <div className={styles.reportTimeRange}>
                  {state.language === 'en' ? 'Analysis Window:' : '分析範圍:'} {metrics.computedRange.startS.toFixed(1)}s - {metrics.computedRange.endS.toFixed(1)}s
                </div>
              )}

              {/* 簡單診斷建議 */}
              <div className={styles.diagnosisBox}>
                <div className={styles.diagnosisTitle}>
                  💡 {state.language === 'en' ? 'Diagnostics & Suggestion' : '診斷與建議'}
                </div>
                <div className={styles.diagnosisContent}>
                  {metrics.lagMs > 50 ? (
                    state.language === 'en'
                      ? 'Significant phase lag detected. Consider increasing derivative gain (D) or increasing EKF/controller rates.'
                      : '偵測到顯著的相位延遲。可能原因為 PID 中的 D 項過低，或濾波器截止頻率設置過低。建議增強 D 增益或微調濾波器。'
                  ) : metrics.corr < 0.80 ? (
                    state.language === 'en'
                      ? 'Low correlation. The controller is not following setpoints. Check for physical axis binding, low proportional gain (P), or actuator saturation.'
                      : '追隨動態相關度偏低。控制器未能緊密跟隨期望指令。請檢查是否存在結構卡阻、P 增益過低、或是馬達輸出已達上限飽和。'
                  ) : (
                    state.language === 'en'
                      ? 'The PID tracking looks well-tuned. Steady dynamic follow and negligible delay.'
                      : 'PID 追隨性能極佳，動態追隨緊密且幾乎沒有可視延遲。控制參數設置非常理想。'
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.noReportHint}>
              {state.language === 'en'
                ? 'Click "Align & Analyze" to compute metrics'
                : '請點擊左側「對齊與分析」按鈕以生成本區間的追隨數據報告'}
            </div>
          )}
        </div>
      </div>

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}
    </div>
  );
}
