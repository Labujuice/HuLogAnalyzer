import React, { useEffect, useRef, useState, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import { getWorkerBridge } from '../workers/workerBridge';
import styles from './VibrationPanel.module.css';

interface VibrationPanelProps {
  panelId: string;
  currentTimeUs: number;
}

export function VibrationPanel({ panelId, currentTimeUs }: VibrationPanelProps) {
  const { state } = useApp();
  const chartRef = useRef<uPlot | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [sensorType, setSensorType] = useState<'accel' | 'gyro'>('accel');
  const [isCalculating, setIsCalculating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // 記錄上一次計算的資訊
  const [computedRange, setComputedRange] = useState<{ startS: number; endS: number } | null>(null);
  const [peaks, setPeaks] = useState<{ axis: string; freq: number; amp: number }[]>([]);

  // 找尋合適的 Topic 名稱
  const findSensorTopic = useCallback((type: 'accel' | 'gyro') => {
    if (!state.summary) return null;
    const topics = state.summary.topics;
    
    if (type === 'accel') {
      const match = topics.find(t => t.name === 'sensor_accel' || t.name === 'sensor_combined');
      if (!match) return null;
      const fields = match.fields.filter(f => f.startsWith('x') || f.startsWith('accelerometer_m_s2'));
      return { topicName: match.name, multiId: match.multiId, fields };
    } else {
      const match = topics.find(t => t.name === 'sensor_gyro' || t.name === 'sensor_combined');
      if (!match) return null;
      const fields = match.fields.filter(f => f.startsWith('x') || f.startsWith('gyro_rad'));
      return { topicName: match.name, multiId: match.multiId, fields };
    }
  }, [state.summary]);

  // 執行 FFT 計算
  const handleCalculateFFT = useCallback(async () => {
    if (!state.summary) return;
    const sensorInfo = findSensorTopic(sensorType);
    if (!sensorInfo || sensorInfo.fields.length < 3) {
      setErrorMsg(state.language === 'en' ? 'No matched sensor topic fields found.' : '找不到相符的感測器欄位數據。');
      return;
    }

    setIsCalculating(true);
    setErrorMsg(null);

    // 取得當前圖表所框選的範圍（若無框選則使用播放進度條所處視角，或預設整段）
    const startUs = state.playback.startTimeUs;
    const endUs = state.playback.endTimeUs;
    const startS = (startUs - state.summary.startTimestampUs) / 1e6;
    const endS = (endUs - state.summary.startTimestampUs) / 1e6;

    try {
      const bridge = getWorkerBridge();
      // 平行計算三軸向 FFT
      const results = await Promise.all([
        bridge.computeFFT(sensorInfo.topicName, sensorInfo.multiId, sensorInfo.fields[0], startUs, endUs),
        bridge.computeFFT(sensorInfo.topicName, sensorInfo.multiId, sensorInfo.fields[1], startUs, endUs),
        bridge.computeFFT(sensorInfo.topicName, sensorInfo.multiId, sensorInfo.fields[2], startUs, endUs),
      ]);

      const frequencies = results[0].frequencies;
      const ampX = results[0].amplitudes;
      const ampY = results[1].amplitudes;
      const ampZ = results[2].amplitudes;

      if (frequencies.length === 0) {
        throw new Error(state.language === 'en' ? 'Insufficient samples in selected range' : '所選區間內點數不足以計算 FFT。');
      }

      setComputedRange({ startS, endS });

      // 計算各軸峰值頻率 (Peak Frequencies)
      const axes = ['X', 'Y', 'Z'];
      const currentPeaks = results.map((r, idx) => {
        let maxVal = -1;
        let maxFreq = 0;
        // 忽略 2Hz 以下的極低頻段，避免受殘留直流或超低頻慢漂干擾
        const startSearchIdx = Math.floor(2 / (r.frequencies[1] - r.frequencies[0])) || 0;
        for (let i = startSearchIdx; i < r.amplitudes.length; i++) {
          if (r.amplitudes[i] > maxVal) {
            maxVal = r.amplitudes[i];
            maxFreq = r.frequencies[i];
          }
        }
        return { axis: axes[idx], freq: maxFreq, amp: maxVal };
      });
      setPeaks(currentPeaks);

      // 繪製頻域圖表
      if (containerRef.current) {
        chartRef.current?.destroy();
        chartRef.current = null;

        const uPlotData: uPlot.AlignedData = [frequencies, ampX, ampY, ampZ];
        const rect = containerRef.current.getBoundingClientRect();
        
        const unit = sensorType === 'accel' ? 'm/s²' : 'rad/s';
        
        const opts: uPlot.Options = {
          width: Math.max(100, Math.floor(rect.width)),
          height: Math.max(100, Math.floor(rect.height)),
          scales: {
            x: { time: false },
            y: { auto: true }
          },
          axes: [
            {
              label: 'Frequency (Hz)',
              stroke: '#64748b',
              grid: { stroke: '#1e293b', width: 1 },
              font: '11px JetBrains Mono, monospace',
            },
            {
              label: `Amplitude (${unit})`,
              stroke: '#64748b',
              grid: { stroke: '#1e293b', width: 1 },
              font: '11px JetBrains Mono, monospace',
              side: 3,
            }
          ],
          series: [
            { label: 'Frequency' },
            {
              label: `${sensorType.toUpperCase()} X`,
              stroke: '#ef4444',
              width: 1.5,
              points: { show: false }
            },
            {
              label: `${sensorType.toUpperCase()} Y`,
              stroke: '#10b981',
              width: 1.5,
              points: { show: false }
            },
            {
              label: `${sensorType.toUpperCase()} Z`,
              stroke: '#3b82f6',
              width: 1.5,
              points: { show: false }
            }
          ]
        };

        chartRef.current = new uPlot(opts, uPlotData, containerRef.current);
      }

    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCalculating(false);
    }
  }, [state.summary, sensorType, state.playback, state.language, findSensorTopic]);

  // 當元件掛載或 sensor 改變時自動清理
  useEffect(() => {
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [sensorType]);

  // Resize 監聽
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

  const sensorInfo = findSensorTopic(sensorType);
  const hasData = !!sensorInfo;

  return (
    <div className={styles.root}>
      {/* 控制操作列 */}
      <div className={styles.toolbar}>
        <div className={styles.sensorSelect}>
          <button
            className={`${styles.tabBtn} ${sensorType === 'accel' ? styles.active : ''}`}
            onClick={() => setSensorType('accel')}
          >
            {state.language === 'en' ? '🚀 Accelerometer FFT' : '🚀 加速度計頻譜'}
          </button>
          <button
            className={`${styles.tabBtn} ${sensorType === 'gyro' ? styles.active : ''}`}
            onClick={() => setSensorType('gyro')}
          >
            {state.language === 'en' ? '🔄 Gyroscope FFT' : '🔄 陀螺儀頻譜'}
          </button>
        </div>

        <button
          className={`btn btn--primary ${styles.calcBtn}`}
          onClick={handleCalculateFFT}
          disabled={isCalculating || !hasData}
        >
          {isCalculating 
            ? (state.language === 'en' ? 'Calculating...' : '計算中...') 
            : (state.language === 'en' ? '⚡ Compute FFT' : '⚡ 計算頻譜')}
        </button>
      </div>

      {/* 狀態與資訊列 */}
      <div className={styles.infoBar}>
        {computedRange ? (
          <span className={styles.rangeInfo}>
            {state.language === 'en'
              ? `Computed Range: ${computedRange.startS.toFixed(1)}s - ${computedRange.endS.toFixed(1)}s`
              : `計算區間: ${computedRange.startS.toFixed(1)}秒 - ${computedRange.endS.toFixed(1)}秒`}
          </span>
        ) : (
          <span className={styles.hintInfo}>
            {state.language === 'en'
              ? 'Zoom on the chart first, then click Compute FFT'
              : '可先在時序圖上框選縮放範圍，再點擊「計算頻譜」'}
          </span>
        )}

        {peaks.length > 0 && (
          <div className={styles.peaksWrap}>
            <span className={styles.peaksLabel}>
              {state.language === 'en' ? 'Peak Frequencies:' : '主頻峰值:'}
            </span>
            {peaks.map(p => (
              <span key={p.axis} className={styles.peakTag}>
                {p.axis}: <b>{p.freq.toFixed(1)} Hz</b> ({p.amp.toFixed(3)})
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 錯誤提示 */}
      {errorMsg && <div className={styles.error}>{errorMsg}</div>}

      {/* 圖表呈現區 */}
      {!hasData ? (
        <div className={styles.emptyChoice}>
          {state.language === 'en'
            ? `No ${sensorType.toUpperCase()} topic data found in this log.`
            : `此日誌檔中找不到對應的 ${sensorType === 'accel' ? '加速度計' : '陀螺儀'} 數據。`}
        </div>
      ) : (
        <div className={styles.chartWrapper}>
          {!computedRange && !isCalculating && (
            <div className={styles.chartOverlay}>
              <button className="btn btn--primary btn--large" onClick={handleCalculateFFT}>
                {state.language === 'en' ? 'Click to compute FFT' : '點擊開始計算 FFT 頻譜'}
              </button>
            </div>
          )}
          <div ref={containerRef} className={styles.chartArea} />
        </div>
      )}
    </div>
  );
}
