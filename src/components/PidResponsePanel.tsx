import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import { getWorkerBridge } from '../workers/workerBridge';
import { interpolateSeries } from '../parser/mathUtils';
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

// 提取階躍響應的輔助函數
function extractStepResponses(
  timestamps: Float64Array,
  setpoint: Float32Array,
  actual: Float32Array,
  loopType: LoopType
) {
  const steps: { t: number[]; y: number[] }[] = [];
  const n = timestamps.length;
  if (n < 10) return steps;

  let threshold = 0.08;
  if (loopType === 'rate') threshold = 0.15; // rad/s
  if (loopType === 'attitude') threshold = 3.0; // deg
  if (loopType === 'velocity') threshold = 0.3; // m/s
  if (loopType === 'position') threshold = 0.3; // m

  const windowSec = loopType === 'position' || loopType === 'velocity' ? 1.5 : 0.8;

  let lastStepIdx = -100;
  for (let i = 2; i < n - 10; i++) {
    const diff = setpoint[i] - setpoint[i - 1];
    const dt = (timestamps[i] - timestamps[i - 1]) / 1e6;
    if (dt <= 0 || dt > 1.0) continue;

    if (Math.abs(diff) > threshold && (i - lastStepIdx) > (windowSec * 30)) {
      const startUs = timestamps[i - 1];
      const yStart = setpoint[i - 1];
      const yEnd = setpoint[Math.min(n - 1, i + 8)];
      const stepSize = yEnd - yStart;

      if (Math.abs(stepSize) < threshold) continue;

      const tStep: number[] = [];
      const yStep: number[] = [];
      
      let j = i - 2;
      while (j < n && (timestamps[j] - startUs) / 1e6 < windowSec) {
        const relSec = (timestamps[j] - startUs) / 1e6;
        const valNorm = (actual[j] - yStart) / stepSize;
        tStep.push(relSec);
        yStep.push(valNorm);
        j++;
      }

      if (tStep.length > 5) {
        steps.push({ t: tStep, y: yStep });
        lastStepIdx = i;
      }
    }
  }
  return steps;
}

export function PidResponsePanel({ panelId, currentTimeUs }: PidResponsePanelProps) {
  const { state } = useApp();
  const chartRef = useRef<uPlot | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const stepChartRef = useRef<uPlot | null>(null);
  const stepContainerRef = useRef<HTMLDivElement>(null);

  const [activeLoop, setActiveLoop] = useState<LoopType>('rate');
  const [activeAxis, setActiveAxis] = useState<AxisType>('roll');
  const [isCalculating, setIsCalculating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 1. 本地 uPlot 橫向縮放與游標同步對象
  const pidSync = useMemo(() => uPlot.sync('pid-panel-sync'), []);

  // 緩存結構
  const pidCacheRef = useRef<Map<string, {
    timestamps: Float64Array;
    setpointAligned: Float32Array;
    actualAligned: Float32Array;
    rmse: number;
    corr: number;
    lagUs: number;
    rating: string;
    ratingColor: string;
    startS: number;
    endS: number;
    stepResponses: { t: number[]; y: number[] }[];
  }>>(new Map());

  const autoCalcTimeoutRef = useRef<any>(null);

  const [metrics, setMetrics] = useState<{
    rmse: number;
    corr: number;
    lagMs: number;
    rating: string;
    ratingColor: string;
    computedRange?: { startS: number; endS: number };
    hasSteps: boolean;
  } | null>(null);

  useEffect(() => {
    const config = LOOP_CONFIGS[activeLoop];
    setActiveAxis(config.axes[0].id);
    setMetrics(null);
  }, [activeLoop]);

  const checkTopicsExist = useCallback((loop: LoopType) => {
    if (!state.summary) return false;
    const config = LOOP_CONFIGS[loop];
    const hasSetpoint = state.summary.topics.some(t => t.name === config.setpointTopic);
    const hasActual = state.summary.topics.some(t => t.name === config.actualTopic);
    return hasSetpoint && hasActual;
  }, [state.summary]);

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

  // 繪製 Step Response
  const drawStepChart = useCallback((steps: { t: number[]; y: number[] }[], axisLabel: string) => {
    if (!stepContainerRef.current) return;
    stepChartRef.current?.destroy();
    stepChartRef.current = null;

    const windowSec = activeLoop === 'position' || activeLoop === 'velocity' ? 1.5 : 0.8;
    const numPoints = 50;
    
    const stdTimeline = new Float64Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      stdTimeline[i] = (i / (numPoints - 1)) * windowSec;
    }

    const targetLine = new Float32Array(numPoints).fill(1.0);
    const alignedSteps = steps.map(s => {
      return interpolateSeries(new Float64Array(s.t), new Float32Array(s.y), stdTimeline);
    });

    const avgLine = new Float32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      let sum = 0;
      alignedSteps.forEach(step => {
        sum += step[i] || 0;
      });
      avgLine[i] = steps.length > 0 ? sum / steps.length : 0;
    }

    const uPlotData: uPlot.AlignedData = [stdTimeline, targetLine, avgLine, ...alignedSteps] as uPlot.AlignedData;
    const rect = stepContainerRef.current.getBoundingClientRect();

    const seriesOpts = [
      { label: 'Time (s)' },
      {
        label: 'Target Setpoint (1.0)',
        stroke: '#ef4444',
        width: 1.5,
        dash: [4, 4],
        points: { show: false }
      },
      {
        label: 'Average Step Response',
        stroke: '#38bdf8',
        width: 2.5,
        points: { show: false }
      },
      ...steps.map((_, idx) => ({
        label: `Step ${idx + 1}`,
        stroke: 'rgba(100, 116, 139, 0.25)',
        width: 1,
        points: { show: false }
      }))
    ];

    const opts: uPlot.Options = {
      width: Math.max(100, Math.floor(rect.width)),
      height: Math.max(100, Math.floor(rect.height)),
      scales: {
        x: { time: false },
        y: { min: -0.2, max: 1.8 }
      },
      axes: [
        {
          label: 'Relative Time (s)',
          stroke: '#64748b',
          grid: { stroke: '#1e293b', width: 1 },
          font: '10px JetBrains Mono, monospace',
        },
        {
          label: 'Normalized Output',
          stroke: '#64748b',
          grid: { stroke: '#1e293b', width: 1 },
          font: '10px JetBrains Mono, monospace',
          side: 3,
        }
      ],
      series: seriesOpts,
      legend: { show: false }
    };

    const plot = new uPlot(opts, uPlotData, stepContainerRef.current);
    // 註冊滾輪縮放（在階躍時間軸縮放）
    plot.over.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const minX = plot.scales.x.min!;
      const maxX = plot.scales.x.max!;
      const range = maxX - minX;
      const zoomFactor = ev.deltaY < 0 ? 0.85 : 1.15;
      const newRange = range * zoomFactor;
      plot.setScale('x', { min: 0, max: Math.min(windowSec, newRange) });
    });

    stepChartRef.current = plot;
  }, [activeLoop]);

  // 核心解算
  const handleCalculatePID = useCallback(async () => {
    if (!state.summary) return;
    
    const config = LOOP_CONFIGS[activeLoop];
    const axisConfig = config.axes.find(a => a.id === activeAxis);
    if (!axisConfig) return;

    const startUs = state.playback.startTimeUs;
    const endUs = state.playback.endTimeUs;
    const startLogUs = state.summary.startTimestampUs;
    const cacheKey = `${activeLoop}:${activeAxis}:${startUs}:${endUs}`;

    // 檢查快取
    if (pidCacheRef.current.has(cacheKey)) {
      const cached = pidCacheRef.current.get(cacheKey)!;
      setMetrics({
        rmse: cached.rmse,
        corr: cached.corr,
        lagMs: cached.lagUs / 1000,
        rating: cached.rating,
        ratingColor: cached.ratingColor,
        computedRange: { startS: cached.startS, endS: cached.endS },
        hasSteps: cached.stepResponses.length > 0
      });
      setErrorMsg(null);

      // A. 繪製對齊圖表
      if (containerRef.current) {
        chartRef.current?.destroy();
        chartRef.current = null;

        const xsSec = new Float64Array(cached.timestamps.length);
        for (let i = 0; i < cached.timestamps.length; i++) {
          xsSec[i] = (cached.timestamps[i] - startLogUs) / 1e6;
        }

        const uPlotData: uPlot.AlignedData = [xsSec, cached.setpointAligned, cached.actualAligned];
        const rect = containerRef.current.getBoundingClientRect();

        const opts: uPlot.Options = {
          width: Math.max(100, Math.floor(rect.width)),
          height: Math.max(100, Math.floor(rect.height)),
          scales: { x: { time: false }, y: { auto: true } },
          axes: [
            { stroke: '#64748b', grid: { stroke: '#1e293b', width: 1 }, font: '10px JetBrains Mono, monospace' },
            { label: `${axisConfig.label} (${axisConfig.unit})`, stroke: '#64748b', grid: { stroke: '#1e293b', width: 1 }, font: '10px JetBrains Mono, monospace', side: 3 }
          ],
          series: [
            { label: 'Time (s)' },
            { label: `Setpoint`, stroke: '#10b981', width: 1.5, dash: [4, 4], points: { show: false } },
            { label: `Feedback`, stroke: '#ef4444', width: 1.5, points: { show: false } }
          ],
          cursor: {
            sync: {
              key: pidSync.key
            }
          },
          hooks: {
            drawAxes: [
              (u: uPlot) => {
                const timeSec = (currentTimeUs - startLogUs) / 1e6;
                const cx = u.valToPos(timeSec, 'x', true);
                if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
                  u.ctx.save();
                  u.ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                  u.ctx.lineWidth = 1;
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
        const plot = new uPlot(opts, uPlotData, containerRef.current);
        registerWheelZoom(plot);
        chartRef.current = plot;
      }

      drawStepChart(cached.stepResponses, axisConfig.label);
      return;
    }

    setIsCalculating(true);
    setErrorMsg(null);

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

      const stepResponses = extractStepResponses(timestamps, setpoint, actual, activeLoop);

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
        computedRange: { startS, endS },
        hasSteps: stepResponses.length > 0
      });

      pidCacheRef.current.set(cacheKey, {
        timestamps,
        setpointAligned: setpoint,
        actualAligned: actual,
        rmse: result.rmse,
        corr: result.corr,
        lagUs: result.lagUs,
        rating,
        ratingColor,
        startS,
        endS,
        stepResponses
      });

      if (containerRef.current) {
        chartRef.current?.destroy();
        chartRef.current = null;

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
            { stroke: '#64748b', grid: { stroke: '#1e293b', width: 1 }, font: '10px JetBrains Mono, monospace' },
            { label: `${axisConfig.label} (${axisConfig.unit})`, stroke: '#64748b', grid: { stroke: '#1e293b', width: 1 }, font: '10px JetBrains Mono, monospace', side: 3 }
          ],
          series: [
            { label: 'Time (s)' },
            {
              label: `Setpoint`,
              stroke: '#10b981',
              width: 1.5,
              dash: [4, 4],
              points: { show: false }
            },
            {
              label: `Feedback`,
              stroke: '#ef4444',
              width: 1.5,
              points: { show: false }
            }
          ],
          cursor: {
            sync: {
              key: pidSync.key
            }
          },
          hooks: {
            drawAxes: [
              (u: uPlot) => {
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

        const plot = new uPlot(opts, uPlotData, containerRef.current);
        registerWheelZoom(plot);
        chartRef.current = plot;
      }

      drawStepChart(stepResponses, axisConfig.label);

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCalculating(false);
    }
  }, [state.summary, activeLoop, activeAxis, state.playback.startTimeUs, state.playback.endTimeUs, currentTimeUs, drawStepChart, pidSync, registerWheelZoom]);

  // 當選擇改變時，清理圖表
  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
      stepChartRef.current?.destroy();
      stepChartRef.current = null;
    };
  }, [activeLoop, activeAxis]);

  // 監聽並防抖自動觸發計算
  useEffect(() => {
    if (autoCalcTimeoutRef.current) {
      clearTimeout(autoCalcTimeoutRef.current);
    }

    autoCalcTimeoutRef.current = setTimeout(() => {
      handleCalculatePID();
    }, 300);

    return () => {
      if (autoCalcTimeoutRef.current) {
        clearTimeout(autoCalcTimeoutRef.current);
      }
    };
  }, [activeLoop, activeAxis, state.playback.startTimeUs, state.playback.endTimeUs, handleCalculatePID]);

  // 當播放時間線更新時重繪
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.redraw(false);
    }
  }, [currentTimeUs]);

  // ResizeObserver
  useEffect(() => {
    const handleResize = () => {
      if (chartRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        chartRef.current.setSize({ width: Math.max(100, Math.floor(rect.width)), height: Math.max(100, Math.floor(rect.height)) });
      }
      if (stepChartRef.current && stepContainerRef.current) {
        const rect = stepContainerRef.current.getBoundingClientRect();
        stepChartRef.current.setSize({ width: Math.max(100, Math.floor(rect.width)), height: Math.max(100, Math.floor(rect.height)) });
      }
    };

    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);
    if (stepContainerRef.current) ro.observe(stepContainerRef.current);
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
        {/* 左側雙圖表堆疊 */}
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
          </div>

          {!hasData ? (
            <div className={styles.emptyContainer}>
              {state.language === 'en'
                ? `Lack of Topic data: setpoint (${currentConfig.setpointTopic}) or actual (${currentConfig.actualTopic})`
                : `此 ULog 缺少分析所需的主題：期望值 (${currentConfig.setpointTopic}) 或實測值 (${currentConfig.actualTopic})`}
            </div>
          ) : (
            <div className={styles.chartsStack}>
              {/* 上圖：原始數據對齊 */}
              <div className={styles.chartBlock}>
                <div className={styles.chartBlockHeader}>
                  📈 {state.language === 'en' ? 'Time-Domain Alignment (Setpoint vs Actual)' : '時域對齊比較圖 (期望值 vs 實測值)'}
                </div>
                <div className={styles.chartWrapper}>
                  {isCalculating && (
                    <div className={styles.chartOverlay}>
                      <div style={{ color: '#38bdf8', fontSize: '12px', fontWeight: 'bold' }}>{state.language === 'en' ? '⚡ Aligning signals...' : '⚡ 正在對齊時序數據...'}</div>
                    </div>
                  )}
                  <div ref={containerRef} className={styles.chartArea} />
                </div>
              </div>

              {/* 下圖：階躍響應 */}
              <div className={styles.chartBlock}>
                <div className={styles.chartBlockHeader}>
                  🎯 {state.language === 'en' ? 'Normalized Step Response Envelope' : '正規化階躍響應包絡圖'}
                </div>
                <div className={styles.chartWrapper}>
                  {isCalculating && (
                    <div className={styles.chartOverlay}>
                      <div style={{ color: '#38bdf8', fontSize: '12px', fontWeight: 'bold' }}>{state.language === 'en' ? '⚡ Extracting steps...' : '⚡ 正在提取階躍響應...'}</div>
                    </div>
                  )}
                  {metrics && !metrics.hasSteps && (
                    <div className={styles.chartOverlay} style={{ backgroundColor: 'rgba(9, 13, 22, 0.75)' }}>
                      <div style={{ color: '#64748b', fontSize: '12px', fontStyle: 'italic' }}>
                        {state.language === 'en' ? 'No clear step inputs detected in this range' : '在此時間區間內未偵測到顯著的階躍指令'}
                      </div>
                    </div>
                  )}
                  <div ref={stepContainerRef} className={styles.chartArea} />
                </div>
              </div>
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
                ? 'Select a zoom range on the chart to generate report'
                : '對齊計算完畢後將在此區間生成追隨數據報告'}
            </div>
          )}
        </div>
      </div>

      {errorMsg && <div className={styles.error}>{errorMsg}</div>}
    </div>
  );
}
