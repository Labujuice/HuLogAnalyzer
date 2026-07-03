/**
 * 全域 App 狀態管理（React Context + useReducer）
 */

import React, { createContext, useContext, useReducer, useCallback, useRef } from 'react';
import type { AppState, PlaybackState, PanelLayout, ULogTopicData, ULogSummary, ChartSeries } from '../types/ulog';
import { CHART_COLORS } from '../types/ulog';
import { getWorkerBridge } from '../workers/workerBridge';

// ─── 初始狀態 ─────────────────────────────────────────────────────────────────

const DEFAULT_LAYOUT: PanelLayout = {
  direction: 'column',
  panels: [
    {
      id: 'panel-1',
      type: 'chart',
      series: [],
      title: '圖表 1',
    },
  ],
  sizes: [100],
};

const INITIAL_PLAYBACK: PlaybackState = {
  isPlaying: false,
  currentTimeUs: 0,
  startTimeUs: 0,
  endTimeUs: 0,
  speedMultiplier: 1,
  useUtcTime: false,
  utcOffsetUs: 0,
};

const INITIAL_STATE: AppState = {
  status: 'idle',
  progress: 0,
  progressStage: '',
  error: null,
  summary: null,
  topicCache: {},
  layout: DEFAULT_LAYOUT,
  playback: INITIAL_PLAYBACK,
  selectedTopics: new Set(),
};

// ─── Actions ─────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_STATUS'; status: AppState['status'] }
  | { type: 'SET_PROGRESS'; progress: number; stage: string }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'PARSE_COMPLETE'; summary: ULogSummary }
  | { type: 'TOPIC_DATA_LOADED'; key: string; data: ULogTopicData }
  | { type: 'SET_LAYOUT'; layout: PanelLayout }
  | { type: 'ADD_SERIES_TO_PANEL'; panelId: string; series: ChartSeries }
  | { type: 'REMOVE_SERIES_FROM_PANEL'; panelId: string; seriesIdx: number }
  | { type: 'SPLIT_PANEL'; panelId: string; direction: 'row' | 'column' }
  | { type: 'SET_PLAYBACK'; playback: Partial<PlaybackState> }
  | { type: 'RESET' };

type LeafPanel = Extract<PanelLayout['panels'][0], { id: string }>;

// ─── Reducer ─────────────────────────────────────────────────────────────────

function findAndUpdatePanel(
  layout: PanelLayout,
  panelId: string,
  updater: (panel: LeafPanel) => PanelLayout['panels'][0]
): PanelLayout {
  const newPanels = layout.panels.map((p) => {
    if ('id' in p && (p as LeafPanel).id === panelId) {
      return updater(p as LeafPanel);
    } else if ('direction' in p) {
      return findAndUpdatePanel(p as PanelLayout, panelId, updater);
    }
    return p;
  });
  return { ...layout, panels: newPanels };
}

let panelCounter = 2;

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.status };

    case 'SET_PROGRESS':
      return { ...state, progress: action.progress, progressStage: action.stage };

    case 'SET_ERROR':
      return { ...state, status: 'error', error: action.error };

    case 'PARSE_COMPLETE':
      return {
        ...state,
        status: 'ready',
        progress: 1,
        progressStage: '解析完成',
        error: null,
        summary: action.summary,
        playback: {
          ...state.playback,
          startTimeUs: action.summary.startTimestampUs,
          endTimeUs: action.summary.endTimestampUs,
          currentTimeUs: action.summary.startTimestampUs,
          utcOffsetUs: action.summary.metadata.utcOffset,
        },
        layout: DEFAULT_LAYOUT,
        topicCache: {},
      };

    case 'TOPIC_DATA_LOADED':
      return {
        ...state,
        topicCache: { ...state.topicCache, [action.key]: action.data },
      };

    case 'SET_LAYOUT':
      return { ...state, layout: action.layout };

    case 'ADD_SERIES_TO_PANEL': {
      const { panelId: apId, series: aSeries } = action as { type: 'ADD_SERIES_TO_PANEL'; panelId: string; series: ChartSeries };
      const newLayout = findAndUpdatePanel(state.layout, apId, (panel) => ({
        ...panel,
        series: [...panel.series, aSeries],
      }));
      return { ...state, layout: newLayout };
    }

    case 'REMOVE_SERIES_FROM_PANEL': {
      const { panelId: rpId, seriesIdx } = action as { type: 'REMOVE_SERIES_FROM_PANEL'; panelId: string; seriesIdx: number };
      const newLayout = findAndUpdatePanel(state.layout, rpId, (panel) => ({
        ...panel,
        series: panel.series.filter((_, i) => i !== seriesIdx),
      }));
      return { ...state, layout: newLayout };
    }

    case 'SPLIT_PANEL': {
      const { panelId: spId, direction: spDir } = action as { type: 'SPLIT_PANEL'; panelId: string; direction: 'row' | 'column' };
      const newPanelId = `panel-${panelCounter++}`;
      const splitInLayout = (layout: PanelLayout): PanelLayout => {
        const newPanels = layout.panels.map((p) => {
          if ('id' in p && (p as LeafPanel).id === spId) {
            const subLayout: PanelLayout = {
              direction: spDir,
              panels: [
                p,
                { id: newPanelId, type: 'empty', series: [], title: `圖表 ${panelCounter - 1}` },
              ],
              sizes: [50, 50],
            };
            return subLayout;
          } else if ('direction' in p) {
            return splitInLayout(p as PanelLayout);
          }
          return p;
        });
        return { ...layout, panels: newPanels };
      };
      return { ...state, layout: splitInLayout(state.layout) };
    }

    case 'SET_PLAYBACK':
      return { ...state, playback: { ...state.playback, ...action.playback } };

    case 'RESET':
      getWorkerBridge().reset();
      return { ...INITIAL_STATE };

    default:
      return state;
  }
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  loadFile: (file: File) => Promise<void>;
  requestTopicData: (topicName: string, multiId: number, fields: string[]) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);

  const loadFile = useCallback(async (file: File) => {
    dispatch({ type: 'SET_STATUS', status: 'loading' });
    dispatch({ type: 'SET_PROGRESS', progress: 0.01, stage: '讀取檔案...' });

    try {
      const buffer = await file.arrayBuffer();
      dispatch({ type: 'SET_STATUS', status: 'parsing' });

      const bridge = getWorkerBridge();
      const summary = await bridge.parseFile(buffer, (progress, stage) => {
        dispatch({ type: 'SET_PROGRESS', progress, stage });
      });

      dispatch({ type: 'PARSE_COMPLETE', summary });
    } catch (err) {
      dispatch({
        type: 'SET_ERROR',
        error: err instanceof Error ? err.message : '未知錯誤，解析失敗。',
      });
    }
  }, []);

  const requestTopicData = useCallback(async (
    topicName: string,
    multiId: number,
    fields: string[]
  ) => {
    const key = `${topicName}:${multiId}`;
    if (state.topicCache[key]) return; // 已快取

    try {
      const bridge = getWorkerBridge();
      const data = await bridge.getTopicData(topicName, multiId, fields);
      dispatch({ type: 'TOPIC_DATA_LOADED', key, data });
    } catch (err) {
      console.error(`載入 Topic 數據失敗 (${topicName}):`, err);
    }
  }, [state.topicCache]);

  return (
    <AppContext.Provider value={{ state, dispatch, loadFile, requestTopicData }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function usePlayback() {
  const { state, dispatch } = useApp();
  return {
    playback: state.playback,
    setPlayback: (p: Partial<PlaybackState>) => dispatch({ type: 'SET_PLAYBACK', playback: p }),
  };
}
