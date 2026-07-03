import React, { useCallback } from 'react';
import { useApp, usePlayback } from '../store/appStore';
import { ChartPanel } from './ChartPanel';
import type { PanelLayout, Panel, ChartSeries } from '../types/ulog';
import styles from './DashboardLayout.module.css';

export function DashboardLayout() {
  const { state, dispatch } = useApp();
  const { playback } = usePlayback();

  const addSeries = useCallback((panelId: string, series: ChartSeries) => {
    dispatch({ type: 'ADD_SERIES_TO_PANEL', panelId, series });
  }, [dispatch]);

  const removeSeries = useCallback((panelId: string, idx: number) => {
    dispatch({ type: 'REMOVE_SERIES_FROM_PANEL', panelId, seriesIdx: idx });
  }, [dispatch]);

  const splitPanel = useCallback((panelId: string, direction: 'row' | 'column') => {
    dispatch({ type: 'SPLIT_PANEL', panelId, direction });
  }, [dispatch]);

  const removePanel = useCallback((panelId: string) => {
    dispatch({ type: 'REMOVE_PANEL', panelId });
  }, [dispatch]);

  return (
    <div className={styles.root}>
      <LayoutNode
        node={state.layout}
        currentTimeUs={playback.currentTimeUs}
        onAddSeries={addSeries}
        onRemoveSeries={removeSeries}
        onSplit={splitPanel}
        onRemovePanel={removePanel}
      />
    </div>
  );
}

// ─── 遞迴渲染佈局節點 ─────────────────────────────────────────────────────────

interface LayoutNodeProps {
  node: PanelLayout | Panel;
  currentTimeUs: number;
  onAddSeries: (panelId: string, series: ChartSeries) => void;
  onRemoveSeries: (panelId: string, idx: number) => void;
  onSplit: (panelId: string, direction: 'row' | 'column') => void;
  onRemovePanel: (panelId: string) => void;
}

function LayoutNode({
  node, currentTimeUs,
  onAddSeries, onRemoveSeries, onSplit, onRemovePanel,
}: LayoutNodeProps) {
  // 葉節點（Panel）
  if ('id' in node) {
    return (
      <ChartPanel
        panel={node as Panel}
        currentTimeUs={currentTimeUs}
        onAddSeries={s => onAddSeries(node.id, s)}
        onRemoveSeries={i => onRemoveSeries(node.id, i)}
        onSplitHoriz={() => onSplit(node.id, 'row')}
        onSplitVert={() => onSplit(node.id, 'column')}
        onRemovePanel={() => onRemovePanel(node.id)}
      />
    );
  }

  // 佈局節點（PanelLayout）
  const layout = node as PanelLayout;
  return (
    <div
      className={styles.layoutNode}
      style={{ flexDirection: layout.direction }}
    >
      {layout.panels.map((child, idx) => (
        <React.Fragment key={'id' in child ? child.id : idx}>
          <div
            className={styles.panelSlot}
            style={{ flex: layout.sizes[idx] ?? 1 }}
          >
            <LayoutNode
              node={child}
              currentTimeUs={currentTimeUs}
              onAddSeries={onAddSeries}
              onRemoveSeries={onRemoveSeries}
              onSplit={onSplit}
              onRemovePanel={onRemovePanel}
            />
          </div>
          {idx < layout.panels.length - 1 && (
            <ResizeHandle
              direction={layout.direction}
              idx={idx}
              layout={layout}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Resize Handle ────────────────────────────────────────────────────────────

interface ResizeHandleProps {
  direction: 'row' | 'column';
  idx: number;
  layout: PanelLayout;
}

function ResizeHandle({ direction, idx, layout }: ResizeHandleProps) {
  const isCol = direction === 'row';

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startSizes = [...layout.sizes];
    const total = startSizes[idx] + startSizes[idx + 1];

    const onMove = (me: MouseEvent) => {
      const parent = (e.target as HTMLElement).parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const delta = isCol
        ? (me.clientX - startX) / rect.width * 100
        : (me.clientY - startY) / rect.height * 100;

      const newA = Math.max(10, Math.min(total - 10, startSizes[idx] + delta));
      const newB = total - newA;
      layout.sizes[idx] = newA;
      layout.sizes[idx + 1] = newB;

      // 直接更新 DOM flex 值，不等 React re-render
      const slots = parent.querySelectorAll<HTMLElement>(`:scope > .${styles.panelSlot}`);
      if (slots[idx]) slots[idx].style.flex = `${newA}`;
      if (slots[idx + 1]) slots[idx + 1].style.flex = `${newB}`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className={`resize-handle ${isCol ? 'resize-handle--col' : 'resize-handle--row'}`}
      onMouseDown={onMouseDown}
    />
  );
}
