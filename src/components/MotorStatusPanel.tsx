import React, { useEffect, useRef, useState, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import { CHART_COLORS } from '../types/ulog';
import { getWorkerBridge } from '../workers/workerBridge';
import styles from './MotorStatusPanel.module.css';

interface MotorStatusPanelProps {
  panelId: string;
  currentTimeUs: number;
}

interface MotorDataInfo {
  motorIndex: number;
  average: number;
  deviation: number; // 偏離百分比
  status: 'normal' | 'warning' | 'critical';
  color: string;
}

export function MotorStatusPanel({ panelId, currentTimeUs }: MotorStatusPanelProps) {
  const { state, requestTopicData } = useApp();
  const chartRef = useRef<uPlot | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [dataType, setDataType] = useState<'rpm' | 'output'>('output');
  const [motorCount, setMotorCount] = useState<number>(0);
  const [isReady, setIsReady] = useState(false);
  
  // 診斷指標
  const [balanceList, setBalanceList] = useState<MotorDataInfo[]>([]);
  const [diagnostics, setDiagnostics] = useState<string>('');
  const [hasEscData, setHasEscData] = useState(false);

  // 1. 檢測電調資料是否存在
  useEffect(() => {
    if (!state.summary) return;
    const hasEsc = state.summary.topics.some(t => t.name === 'esc_status');
    setHasEscData(hasEsc);
    if (hasEsc) {
      setDataType('rpm');
    } else {
      setDataType('output');
    }
  }, [state.summary]);

  // 2. 獲取 Topic 的欄位並取得資料
  const getTargetTopicInfo = useCallback(() => {
    if (!state.summary) return null;
    if (dataType === 'rpm') {
      const escTopic = state.summary.topics.find(t => t.name === 'esc_status');
      if (!escTopic) return null;
      // 尋找包含 esc_rpm 的欄位，如 esc[0].esc_rpm, esc[1].esc_rpm 等
      const fields = escTopic.fields.filter(f => f.includes('esc_rpm'));
      return { topicName: 'esc_status', multiId: escTopic.multiId, fields };
    } else {
      const actTopic = state.summary.topics.find(t => t.name === 'actuator_outputs');
      if (!actTopic) return null;
      // 尋找 output[0] 等欄位，通常過濾非 padding 且為數值的 output 欄位
      const fields = actTopic.fields.filter(f => f.startsWith('output[') && !f.includes('_padding'));
      return { topicName: 'actuator_outputs', multiId: actTopic.multiId, fields };
    }
  }, [state.summary, dataType]);

  // 3. 確保資料已載入 cache
  useEffect(() => {
    const info = getTargetTopicInfo();
    if (!info) return;

    const key = `${info.topicName}:${info.multiId}`;
    if (!state.topicCache[key]) {
      requestTopicData(info.topicName, info.multiId, info.fields);
      setIsReady(false);
    } else {
      setMotorCount(info.fields.length);
      setIsReady(true);
    }
  }, [getTargetTopicInfo, state.topicCache, requestTopicData]);

  // 4. 計算 Hover 平衡指標與繪製折線圖
  const renderChartAndComputeBalance = useCallback(() => {
    const info = getTargetTopicInfo();
    if (!info || !isReady) return;

    const key = `${info.topicName}:${info.multiId}`;
    const cached = state.topicCache[key];
    if (!cached || cached.count === 0) return;

    // ─── A. 計算懸停區間內馬達平均輸出與平衡性 ───
    const startUs = state.playback.startTimeUs;
    const endUs = state.playback.endTimeUs;
    const startLogUs = state.summary?.startTimestampUs ?? 0;

    // 找到時間對應的 index 範圍
    let startIdx = 0;
    let endIdx = cached.timestamps.length - 1;
    for (let i = 0; i < cached.timestamps.length; i++) {
      if (cached.timestamps[i] >= startUs) {
        startIdx = i;
        break;
      }
    }
    for (let i = cached.timestamps.length - 1; i >= 0; i--) {
      if (cached.timestamps[i] <= endUs) {
        endIdx = i;
        break;
      }
    }

    const nSamples = Math.max(1, endIdx - startIdx + 1);
    
    // 計算每顆馬達的平均值
    const fieldSums = info.fields.map(f => {
      const arr = cached.fields[f];
      let sum = 0;
      if (arr) {
        for (let i = startIdx; i <= endIdx; i++) {
          sum += arr[i] || 0;
        }
      }
      return sum / nSamples;
    });

    // 全體平均值
    const overallAvg = fieldSums.reduce((a, b) => a + b, 0) / fieldSums.length;

    // 計算偏離百分比
    const balances: MotorDataInfo[] = info.fields.map((f, idx) => {
      const avg = fieldSums[idx];
      // 預防除以零
      const deviation = overallAvg > 0 ? ((avg - overallAvg) / overallAvg) * 100 : 0;
      
      let status: MotorDataInfo['status'] = 'normal';
      if (Math.abs(deviation) > 15) {
        status = 'critical';
      } else if (Math.abs(deviation) > 8) {
        status = 'warning';
      }

      return {
        motorIndex: idx + 1,
        average: avg,
        deviation,
        status,
        color: CHART_COLORS[idx % CHART_COLORS.length]
      };
    });
    setBalanceList(balances);

    // 產生診斷語句
    const highDevMotors = balances.filter(b => b.status === 'critical');
    const midDevMotors = balances.filter(b => b.status === 'warning');

    if (highDevMotors.length > 0) {
      const idxs = highDevMotors.map(m => `#${m.motorIndex}`).join(', ');
      setDiagnostics(state.language === 'en'
        ? `⚠️ CRITICAL: Motors (${idxs}) deviate significantly (>15%). Please check for physical motor twist, bent arm, or damaged propellers.`
        : `⚠️ 嚴重警告：馬達 (${idxs}) 的輸出偏離率大於 15%。強烈建議檢查馬達軸向歪斜、機臂歪曲或槳葉嚴重受損！`);
    } else if (midDevMotors.length > 0) {
      const idxs = midDevMotors.map(m => `#${m.motorIndex}`).join(', ');
      setDiagnostics(state.language === 'en'
        ? `⚠️ WARNING: Motors (${idxs}) have noticeable deviation (>8%). Check weight balance or loose motor mounts.`
        : `⚠️ 警告：馬達 (${idxs}) 存在中度不對稱輸出 (>8%)。建議檢查機體重心分配或馬達固定座是否鬆動。`);
    } else {
      setDiagnostics(state.language === 'en'
        ? `✅ HEALTHY: All motors are well balanced (deviations <8%). Aerodynamic alignment is excellent.`
        : `✅ 健康：所有馬達輸出均勻對稱 (偏離度均在 8% 以內)。機體氣動結構與重心分配優良。`);
    }

    // ─── B. 繪製時序折線圖 ───
    if (containerRef.current) {
      chartRef.current?.destroy();
      chartRef.current = null;

      const xsSec = new Float64Array(cached.timestamps.length);
      for (let i = 0; i < cached.timestamps.length; i++) {
        xsSec[i] = (cached.timestamps[i] - startLogUs) / 1e6;
      }

      const yCols = info.fields.map(f => {
        const arr = cached.fields[f];
        return arr instanceof Float32Array ? arr : new Float32Array(arr);
      });

      const uPlotData: uPlot.AlignedData = [xsSec, ...yCols] as uPlot.AlignedData;
      const rect = containerRef.current.getBoundingClientRect();
      const unit = dataType === 'rpm' ? 'RPM' : 'PWM';

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
            label: `Motor Outputs (${unit})`,
            stroke: '#64748b',
            grid: { stroke: '#1e293b', width: 1 },
            font: '11px JetBrains Mono, monospace',
            side: 3,
          }
        ],
        series: [
          { label: 'Time (s)' },
          ...info.fields.map((f, idx) => ({
            label: `Motor ${idx + 1}`,
            stroke: CHART_COLORS[idx % CHART_COLORS.length],
            width: 1.5,
            points: { show: false }
          }))
        ],
        hooks: {
          drawAxes: [
            (u: uPlot) => {
              // 繪製當前播放時間線
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
      chartRef.current = plot;
    }
  }, [getTargetTopicInfo, isReady, state.topicCache, state.playback, state.summary, currentTimeUs, dataType, state.language]);

  // 重建折線圖與重算指標
  useEffect(() => {
    renderChartAndComputeBalance();
  }, [renderChartAndComputeBalance]);

  // 播放時間更新時重繪
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

  const info = getTargetTopicInfo();
  const hasTopic = !!info;

  return (
    <div className={styles.root}>
      {/* 頂部操作列 */}
      <div className={styles.toolbar}>
        <div className={styles.typeSelect}>
          <button
            className={`${styles.tabBtn} ${dataType === 'rpm' ? styles.active : ''} ${!hasEscData ? styles.disabled : ''}`}
            onClick={() => hasEscData && setDataType('rpm')}
            disabled={!hasEscData}
            title={!hasEscData ? '日誌無電調 RPM 回饋' : ''}
          >
            {state.language === 'en' ? '🌀 ESC Motor RPM' : '🌀 電調轉速 (RPM)'}
            {!hasEscData && <span className={styles.naBadge}>N/A</span>}
          </button>
          <button
            className={`${styles.tabBtn} ${dataType === 'output' ? styles.active : ''}`}
            onClick={() => setDataType('output')}
          >
            {state.language === 'en' ? '🔌 Actuator Outputs' : '🔌 馬達命令輸出'}
          </button>
        </div>

        <div className={styles.summaryBadge}>
          {state.language === 'en' 
            ? `Detected Layout: ${motorCount}-rotor` 
            : `偵測佈局: ${motorCount} 軸馬達`}
        </div>
      </div>

      {/* 主呈現區 */}
      <div className={styles.mainLayout}>
        {/* 左側折線圖 */}
        <div className={styles.chartSection}>
          {!hasTopic ? (
            <div className={styles.emptyChoice}>
              {state.language === 'en' ? 'Topic data missing' : '找不到對應的馬達輸出 Topic 資料'}
            </div>
          ) : !isReady ? (
            <div className={styles.emptyChoice}>
              {state.language === 'en' ? 'Loading Cached Data...' : '載入快取數據中...'}
            </div>
          ) : (
            <div className={styles.chartWrapper}>
              <div ref={containerRef} className={styles.chartArea} />
            </div>
          )}
        </div>

        {/* 右側平衡柱狀圖與診斷 */}
        <div className={styles.balanceSection}>
          <div className={styles.sectionTitle}>
            {state.language === 'en' ? '⚖️ Hover Power Balance' : '⚖️ 懸停出力平衡比對'}
          </div>

          {balanceList.length > 0 ? (
            <div className={styles.balanceReport}>
              {/* 柱狀圖列表 */}
              <div className={styles.barList}>
                {balanceList.map(b => {
                  const percent = Math.min(30, Math.abs(b.deviation));
                  const isPositive = b.deviation >= 0;
                  const barColor = b.status === 'critical' ? '#ef4444' : b.status === 'warning' ? '#fb923c' : '#10b981';
                  
                  return (
                    <div key={b.motorIndex} className={styles.barRow}>
                      <span className={styles.motorLabel} style={{ color: b.color }}>
                        M{b.motorIndex}
                      </span>
                      
                      {/* 雙向對稱柱狀圖 */}
                      <div className={styles.barContainer}>
                        <div className={styles.leftBarSide}>
                          {!isPositive && (
                            <div 
                              className={styles.fillBar} 
                              style={{ width: `${(percent / 30) * 100}%`, backgroundColor: barColor, marginLeft: 'auto' }}
                            />
                          )}
                        </div>
                        <div className={styles.centerLine} />
                        <div className={styles.rightBarSide}>
                          {isPositive && (
                            <div 
                              className={styles.fillBar} 
                              style={{ width: `${(percent / 30) * 100}%`, backgroundColor: barColor }}
                            />
                          )}
                        </div>
                      </div>

                      <span className={`${styles.percentLabel} ${styles[b.status]}`}>
                        {isPositive ? '+' : ''}{b.deviation.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 診斷結論 */}
              <div className={styles.diagnosticCard}>
                <div className={styles.diagTitle}>
                  {state.language === 'en' ? 'Diagnostics Result' : '氣動平衡診斷'}
                </div>
                <div className={styles.diagContent}>{diagnostics}</div>
              </div>
            </div>
          ) : (
            <div className={styles.noReportHint}>
              {state.language === 'en' ? 'No balance report computed' : '資料載入中，暫無報告'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
