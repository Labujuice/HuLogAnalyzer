import React, { useEffect, useRef, useCallback, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import type { ChartSeries, Panel } from '../types/ulog';
import { interpolateAt } from '../parser/utils';
import styles from './ChartPanel.module.css';

interface ChartPanelProps {
  panel: Panel;
  onAddSeries?: (series: ChartSeries) => void;
  onRemoveSeries?: (idx: number) => void;
  onSplitHoriz?: () => void;
  onSplitVert?: () => void;
  onRemovePanel?: () => void;
  currentTimeUs: number;
}

// 全域共享的 uPlot 同步物件（讓所有圖表 X 軸聯動）
const sharedSync = uPlot.sync('global-sync');

// toolbar 高度（px），從圖表容器總高度中扣除
const TOOLBAR_H = 32;

export function ChartPanel({
  panel, onAddSeries, onRemoveSeries,
  onSplitHoriz, onSplitVert, onRemovePanel, currentTimeUs,
}: ChartPanelProps) {
  const { state, requestTopicData } = useApp();
  const rootRef = useRef<HTMLDivElement>(null);       // 整個 panel 容器
  const chartAreaRef = useRef<HTMLDivElement>(null);  // 僅圖表區域
  const chartRef = useRef<uPlot | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isDragTarget, setIsDragTarget] = useState(false);

  // ─── 組裝 uPlot 數據 ────────────────────────────────────────────────────────
  const buildChartData = useCallback((): uPlot.AlignedData => {
    if (panel.series.length === 0) return [new Float64Array(0)];

    const firstSeries = panel.series[0];
    const firstKey = `${firstSeries.topicName}:${firstSeries.multiId}`;
    const firstData = state.topicCache[firstKey];
    if (!firstData) return [new Float64Array(0)];

    const startUs = state.summary?.startTimestampUs ?? 0;
    const xs = firstData.timestamps;

    // X 軸：微秒轉秒
    const xsSec = new Float64Array(xs.length);
    for (let i = 0; i < xs.length; i++) xsSec[i] = (xs[i] - startUs) / 1e6;

    // Y 軸：各 series (如果有時間戳不一致，進行線性插值對齊)
    const yCols: Float32Array[] = [];
    for (const s of panel.series) {
      const key = `${s.topicName}:${s.multiId}`;
      const topicData = state.topicCache[key];

      if (!topicData) {
        // 資料載入中，兜底填充 0 陣列，維持長度對齊
        yCols.push(new Float32Array(xs.length));
        continue;
      }

      const ys = topicData.fields[s.fieldName];
      if (!ys) {
        yCols.push(new Float32Array(xs.length));
        continue;
      }

      if (topicData.timestamps === xs) {
        // 同一主題，時間戳參考相同，直接使用
        yCols.push(ys instanceof Float32Array ? ys : new Float32Array(ys));
      } else {
        // 不同主題，利用線性插值對齊到主系列的時間軸 (xs)
        const alignedYs = new Float32Array(xs.length);
        for (let i = 0; i < xs.length; i++) {
          alignedYs[i] = interpolateAt(topicData.timestamps, ys, xs[i]);
        }
        yCols.push(alignedYs);
      }
    }

    return [xsSec, ...yCols] as uPlot.AlignedData;
  }, [panel.series, state.topicCache, state.summary]);

  // ─── uPlot 選項 ─────────────────────────────────────────────────────────────
  const buildOptions = useCallback((width: number, height: number): uPlot.Options => {
    return {
      width,
      height,
      cursor: {
        sync: { key: sharedSync.key },
        drag: { x: true, y: false, setScale: false },
      },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: '#64748b',
          ticks: { stroke: '#1e293b', width: 1 },
          grid: { stroke: '#1e293b', width: 1 },
          font: '11px JetBrains Mono, monospace',
          gap: 4,
        },
        {
          stroke: '#64748b',
          ticks: { stroke: '#1e293b', width: 1 },
          grid: { stroke: '#1e293b', width: 1 },
          font: '11px JetBrains Mono, monospace',
          side: 3,
          gap: 4,
        },
      ],
      series: [
        { label: 'Time (s)' },
        ...panel.series.map((s) => ({
          label: `${s.topicName}.${s.fieldName}`,
          stroke: s.color,
          width: 1.5,
          points: { show: false },
        })),
      ],
      hooks: {
        drawAxes: [
          (u: uPlot) => {
            // 播放時間線
            const startUs = state.summary?.startTimestampUs ?? 0;
            const timeSec = (currentTimeUs - startUs) / 1e6;
            const cx = u.valToPos(timeSec, 'x', true);
            const inRange = cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width;
            if (!inRange) return;

            const ctx = u.ctx;
            ctx.save();
            ctx.strokeStyle = 'rgba(248, 113, 113, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(cx, u.bbox.top);
            ctx.lineTo(cx, u.bbox.top + u.bbox.height);
            ctx.stroke();
            // 小三角標記
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(248, 113, 113, 0.9)';
            ctx.beginPath();
            ctx.moveTo(cx - 5, u.bbox.top);
            ctx.lineTo(cx + 5, u.bbox.top);
            ctx.lineTo(cx, u.bbox.top + 8);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            const tooltip = tooltipRef.current;
            if (!tooltip) return;

            if (
              u.cursor.left === null ||
              u.cursor.left === undefined ||
              u.cursor.left < 0 ||
              u.cursor.idx === null ||
              u.cursor.idx === undefined
            ) {
              tooltip.style.display = 'none';
              return;
            }

            const idx = u.cursor.idx;
            const timeVal = u.data[0][idx];
            if (timeVal === undefined) {
              tooltip.style.display = 'none';
              return;
            }

            let tooltipContent = `<div class="${styles.tooltipTime}">時間: ${timeVal.toFixed(3)}s</div>`;
            tooltipContent += `<div class="${styles.tooltipDivider}"></div>`;

            let hasValidData = false;
            for (let i = 1; i < u.series.length; i++) {
              const s = u.series[i];
              if (!s.show) continue;
              const val = u.data[i][idx];
              if (val === undefined || val === null) continue;
              hasValidData = true;

              const seriesInfo = panel.series[i - 1];
              const color = s.stroke;
              tooltipContent += `
                <div class="${styles.tooltipRow}">
                  <span class="${styles.tooltipDot}" style="background-color: ${color}"></span>
                  <span class="${styles.tooltipLabel}">${seriesInfo.topicName}.${seriesInfo.fieldName}:</span>
                  <span class="${styles.tooltipValue}">${val.toFixed(4)}</span>
                </div>
              `;
            }

            if (!hasValidData) {
              tooltip.style.display = 'none';
              return;
            }

            tooltip.innerHTML = tooltipContent;
            tooltip.style.display = 'block';

            const plotRect = chartAreaRef.current!.getBoundingClientRect();
            const panelRect = rootRef.current!.getBoundingClientRect();
            
            const cursorLeft = plotRect.left - panelRect.left + (u.cursor.left ?? 0);
            const cursorTop = plotRect.top - panelRect.top + (u.cursor.top ?? 0);

            const tooltipWidth = 220;
            const leftPos = cursorLeft + 15 + tooltipWidth > panelRect.width 
              ? cursorLeft - tooltipWidth - 15 
              : cursorLeft + 15;
            
            tooltip.style.left = `${leftPos}px`;
            tooltip.style.top = `${cursorTop + 15}px`;
          }
        ]
      },
    };
  }, [panel.series, currentTimeUs, state.summary]);

  // ─── 取得正確的圖表尺寸（扣除 toolbar）────────────────────────────────────
  const getChartSize = useCallback(() => {
    if (!rootRef.current) return { width: 0, height: 0 };
    const { width, height } = rootRef.current.getBoundingClientRect();
    return {
      width: Math.max(100, Math.floor(width)),
      height: Math.max(60, Math.floor(height - TOOLBAR_H)),
    };
  }, []);

  // ─── 建立 / 重建圖表 ────────────────────────────────────────────────────────
  const rebuildChart = useCallback(() => {
    if (!chartAreaRef.current) return;
    const { width, height } = getChartSize();
    if (width < 50 || height < 50) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    const data = buildChartData();
    const opts = buildOptions(width, height);
    const plot = new uPlot(opts, data, chartAreaRef.current);
    chartRef.current = plot;

    // 1. 註冊滾輪縮放監聽器
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

      plot.batch(() => {
        plot.setScale('x', {
          min: Math.max(0, newMin),
          max: Math.min(logEnd, newMax),
        });
      });
    });

    // 2. 註冊中鍵拖曳平移 (Pan) 與左鍵拖曳方向性縮放 (Zoom In/Out)
    let leftStartX = 0;

    plot.over.addEventListener('mousedown', (e: MouseEvent) => {
      // 中鍵點擊 (button === 1) 平移
      if (e.button === 1) {
        e.preventDefault(); // 阻擋瀏覽器預設的滾輪滾動圖示
        const startX = e.clientX;
        const minX = plot.scales.x.min!;
        const maxX = plot.scales.x.max!;
        const range = maxX - minX;
        const rect = plot.over.getBoundingClientRect();
        const secPerPx = range / rect.width;

        const onMouseMove = (moveEvent: MouseEvent) => {
          const deltaX = moveEvent.clientX - startX;
          const offsetSec = deltaX * secPerPx;
          const newMin = minX - offsetSec;
          const newMax = maxX - offsetSec;
          const logEnd = (state.summary?.durationUs ?? 0) / 1e6;

          plot.batch(() => {
            plot.setScale('x', {
              min: Math.max(0, newMin),
              max: Math.min(logEnd, newMax),
            });
          });
        };

        const onMouseUp = (upEvent: MouseEvent) => {
          if (upEvent.button === 1) {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
          }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      }

      // 左鍵點擊 (button === 0) 紀錄起點，用於判斷拖曳方向 (放大/縮小)
      if (e.button === 0) {
        leftStartX = e.clientX;

        const onLeftMouseUp = (upEvent: MouseEvent) => {
          if (upEvent.button === 0) {
            document.removeEventListener('mouseup', onLeftMouseUp);

            const leftEndX = upEvent.clientX;
            const diff = leftEndX - leftStartX;

            // 忽略微小抖動 (單純點擊)
            if (Math.abs(diff) < 5) return;

            const minX = plot.scales.x.min!;
            const maxX = plot.scales.x.max!;
            const range = maxX - minX;
            const rect = plot.over.getBoundingClientRect();

            if (diff > 0) {
              // 從左往右拖曳：放大至框選範圍
              const selectStartVal = plot.posToVal(plot.select.left, 'x');
              const selectEndVal = plot.posToVal(plot.select.left + plot.select.width, 'x');

              plot.batch(() => {
                plot.setScale('x', { min: selectStartVal, max: selectEndVal });
                plot.setSelect({ left: 0, width: 0, top: 0, height: 0 });
              });
            } else {
              // 從右往左拖曳：縮小
              const dragPct = Math.abs(diff) / rect.width;
              const zoomFactor = 1 + dragPct * 3;
              const centerVal = minX + range / 2;
              const newRange = range * zoomFactor;
              const newMin = centerVal - newRange / 2;
              const newMax = centerVal + newRange / 2;

              const logEnd = (state.summary?.durationUs ?? 0) / 1e6;

              plot.batch(() => {
                plot.setScale('x', {
                  min: Math.max(0, newMin),
                  max: Math.min(logEnd, newMax),
                });
                plot.setSelect({ left: 0, width: 0, top: 0, height: 0 });
              });
            }
          }
        };

        document.addEventListener('mouseup', onLeftMouseUp);
      }
    });
  }, [buildChartData, buildOptions, getChartSize, state.summary]);

  // 資料或 series 改變時重建
  useEffect(() => {
    rebuildChart();
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [rebuildChart]);

  // 播放線更新（只 redraw，不重建）
  useEffect(() => {
    chartRef.current?.redraw(false);
  }, [currentTimeUs]);

  // ─── 快捷鍵復原縮放 (Esc / R) ──────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 避免在輸入框中按 R 時觸發
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA'
      ) {
        return;
      }

      if (e.key === 'Escape' || e.key === 'r' || e.key === 'R') {
        const u = chartRef.current;
        if (u) {
          const logEnd = (state.summary?.durationUs ?? 0) / 1e6;
          u.batch(() => {
            u.setScale('x', { min: 0, max: logEnd });
          });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.summary]);

  // ResizeObserver：尺寸改變時更新 uPlot 大小
  useEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!chartRef.current) return;
      const { width, height } = getChartSize();
      if (width > 50 && height > 50) {
        chartRef.current.setSize({ width, height });
      }
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [getChartSize]);

  // ─── 請求缺少的 Topic 資料 ──────────────────────────────────────────────────
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

  // ─── 拖曳接收 ───────────────────────────────────────────────────────────────
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
      const items: ChartSeries[] = JSON.parse(raw);
      items.forEach(s => onAddSeries?.(s));
    } catch {}
  };

  const hasSeries = panel.series.length > 0;

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${isDragTarget ? styles.dragTarget : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.seriesList}>
          {!hasSeries ? (
            <span className={styles.emptyHint}>從左側拖曳欄位至此繪圖</span>
          ) : (
            panel.series.map((s, i) => (
              <div
                key={i}
                className={styles.seriesTag}
                style={{ '--c': s.color } as React.CSSProperties}
              >
                <span className={styles.seriesDot} />
                <span className={styles.seriesLabel} title={`${s.topicName}.${s.fieldName}`}>
                  {s.topicName}.<b>{s.fieldName}</b>
                </span>
                <button
                  className={styles.seriesRemove}
                  onClick={() => onRemoveSeries?.(i)}
                  title="移除此數據"
                >×</button>
              </div>
            ))
          )}
        </div>

        {/* 右側操作按鈕 */}
        <div className={styles.actions}>
          <button
            className="btn btn--icon btn--ghost"
            onClick={onSplitHoriz}
            title="左右分割"
            data-tooltip="左右分割"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
              <rect x="0" y="0" width="5.5" height="13" rx="1.5" opacity="0.6"/>
              <rect x="7.5" y="0" width="5.5" height="13" rx="1.5" opacity="0.6"/>
            </svg>
          </button>
          <button
            className="btn btn--icon btn--ghost"
            onClick={onSplitVert}
            title="上下分割"
            data-tooltip="上下分割"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
              <rect x="0" y="0" width="13" height="5.5" rx="1.5" opacity="0.6"/>
              <rect x="0" y="7.5" width="13" height="5.5" rx="1.5" opacity="0.6"/>
            </svg>
          </button>
          <div className={styles.actionDivider} />
          <button
            className={`btn btn--icon btn--ghost ${styles.removeBtn}`}
            onClick={onRemovePanel}
            title="移除此畫框"
            data-tooltip="移除畫框"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── uPlot 圖表區域 ── */}
      <div ref={chartAreaRef} className={styles.chartArea} />

      {/* ── 懸浮數據提示框 ── */}
      <div ref={tooltipRef} className={styles.tooltip} style={{ display: 'none' }} />
    </div>
  );
}
