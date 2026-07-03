import React, { useEffect, useRef, useCallback, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import type { ChartSeries, Panel } from '../types/ulog';
import { lttbDownsample } from '../parser/utils';
import styles from './ChartPanel.module.css';

interface ChartPanelProps {
  panel: Panel;
  onAddSeries?: (series: ChartSeries) => void;
  onRemoveSeries?: (idx: number) => void;
  onSplitHoriz?: () => void;
  onSplitVert?: () => void;
  currentTimeUs: number;
}

// 全域共享的 uPlot 同步物件（讓所有圖表 X 軸聯動）
const sharedSync = uPlot.sync('global-sync');

export function ChartPanel({
  panel, onAddSeries, onRemoveSeries,
  onSplitHoriz, onSplitVert, currentTimeUs,
}: ChartPanelProps) {
  const { state, requestTopicData } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const [isDragTarget, setIsDragTarget] = useState(false);

  // 組裝圖表數據
  const buildChartData = useCallback((): uPlot.AlignedData => {
    if (panel.series.length === 0) return [new Float64Array(), new Float64Array()];

    // 用第一個 series 的 timestamps 作為 X 軸
    const firstSeries = panel.series[0];
    const firstKey = `${firstSeries.topicName}:${firstSeries.multiId}`;
    const firstData = state.topicCache[firstKey];
    if (!firstData) return [new Float64Array(), new Float64Array()];

    let xs = firstData.timestamps;
    const result: (Float64Array | Float32Array | null)[] = [xs];

    for (const s of panel.series) {
      const key = `${s.topicName}:${s.multiId}`;
      const topicData = state.topicCache[key];
      if (!topicData) {
        result.push(null);
        continue;
      }
      const ys = topicData.fields[s.fieldName];
      if (!ys) { result.push(null); continue; }
      result.push(ys instanceof Float32Array ? ys : new Float32Array(ys));
    }

    // 轉換 timestamps 為秒（uPlot 預設以秒為單位）
    const startUs = state.summary?.startTimestampUs ?? 0;
    const xsSec = new Float64Array(xs.length);
    for (let i = 0; i < xs.length; i++) xsSec[i] = (xs[i] - startUs) / 1e6;

    return [xsSec, ...result.slice(1)] as uPlot.AlignedData;
  }, [panel.series, state.topicCache, state.summary]);

  // 建立 uPlot 選項
  const buildOptions = useCallback((width: number, height: number): uPlot.Options => {
    const seriesOpts: uPlot.Series[] = [
      { label: 'Time (s)' }, // X 軸
      ...panel.series.map((s, i) => ({
        label: `${s.topicName}.${s.fieldName}`,
        stroke: s.color,
        width: 1.5,
        points: { show: false },
      })),
    ];

    return {
      width,
      height,
      cursor: {
        sync: { key: sharedSync.key },
        drag: { x: true, y: false },
      },
      scales: {
        x: { time: false },
      },
      axes: [
        {
          stroke: '#475569',
          ticks: { stroke: '#1e293b' },
          grid: { stroke: '#1e293b', width: 1 },
          font: '11px JetBrains Mono',
          labelFont: '11px Inter',
        },
        {
          stroke: '#475569',
          ticks: { stroke: '#1e293b' },
          grid: { stroke: '#1e293b', width: 1 },
          font: '11px JetBrains Mono',
          side: 3,
        },
      ],
      series: seriesOpts,
      hooks: {
        drawAxes: [
          (u: uPlot) => {
            // 繪製播放時間線
            const startUs = state.summary?.startTimestampUs ?? 0;
            const timeSec = (currentTimeUs - startUs) / 1e6;
            const cx = u.valToPos(timeSec, 'x', true);
            if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
              const ctx = u.ctx;
              ctx.save();
              ctx.strokeStyle = 'rgba(248, 113, 113, 0.85)';
              ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(cx, u.bbox.top);
              ctx.lineTo(cx, u.bbox.top + u.bbox.height);
              ctx.stroke();
              ctx.restore();
            }
          },
        ],
      },
    };
  }, [panel.series, currentTimeUs, state.summary]);

  // 初始化 & 更新圖表
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const { width, height } = el.getBoundingClientRect();
    if (width < 50 || height < 50) return;

    const data = buildChartData();
    const opts = buildOptions(width, height);

    if (chartRef.current) {
      chartRef.current.destroy();
    }
    chartRef.current = new uPlot(opts, data, el);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [buildChartData, buildOptions]);

  // 播放線更新（只重繪不重建圖表）
  useEffect(() => {
    chartRef.current?.redraw(false);
  }, [currentTimeUs]);

  // Resize 監聽
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (width > 50 && height > 50) {
        chartRef.current.setSize({ width, height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // 請求缺少的 Topic 數據
  useEffect(() => {
    for (const s of panel.series) {
      const key = `${s.topicName}:${s.multiId}`;
      if (!state.topicCache[key]) {
        const topic = state.summary?.topics.find(
          t => t.name === s.topicName && t.multiId === s.multiId
        );
        if (topic) {
          requestTopicData(s.topicName, s.multiId, topic.fields);
        }
      }
    }
  }, [panel.series, state.topicCache, state.summary, requestTopicData]);

  // 拖曳接收
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/ulog-series')) {
      e.preventDefault();
      setIsDragTarget(true);
    }
  };
  const onDragLeave = () => setIsDragTarget(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragTarget(false);
    try {
      const raw = e.dataTransfer.getData('application/ulog-series');
      const series: ChartSeries = JSON.parse(raw);
      onAddSeries?.(series);
    } catch {}
  };

  return (
    <div
      className={`${styles.root} ${isDragTarget ? styles.dragTarget : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Panel 頂部工具列 */}
      <div className={styles.toolbar}>
        <div className={styles.seriesList}>
          {panel.series.length === 0 ? (
            <span className={styles.emptyHint}>從左側拖曳欄位至此繪圖</span>
          ) : (
            panel.series.map((s, i) => (
              <div key={i} className={styles.seriesTag} style={{ '--c': s.color } as React.CSSProperties}>
                <span className={styles.seriesDot} />
                <span className={styles.seriesLabel}>{s.topicName}.{s.fieldName}</span>
                <button
                  className={styles.seriesRemove}
                  onClick={() => onRemoveSeries?.(i)}
                  title="移除"
                >×</button>
              </div>
            ))
          )}
        </div>
        <div className={styles.actions}>
          <button className="btn btn--icon btn--ghost" onClick={onSplitHoriz} title="橫向分割" data-tooltip="橫向分割">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="0" y="0" width="5" height="12" rx="1" opacity="0.6"/>
              <rect x="7" y="0" width="5" height="12" rx="1" opacity="0.6"/>
            </svg>
          </button>
          <button className="btn btn--icon btn--ghost" onClick={onSplitVert} title="縱向分割" data-tooltip="縱向分割">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <rect x="0" y="0" width="12" height="5" rx="1" opacity="0.6"/>
              <rect x="0" y="7" width="12" height="5" rx="1" opacity="0.6"/>
            </svg>
          </button>
        </div>
      </div>

      {/* uPlot 容器 */}
      <div className={styles.chartArea} ref={containerRef} />
    </div>
  );
}
