// ============================================================
// ULog 核心型別定義
// ============================================================

/** ULog 欄位基本型別 */
export type ULogFieldType =
  | 'int8_t' | 'uint8_t'
  | 'int16_t' | 'uint16_t'
  | 'int32_t' | 'uint32_t'
  | 'int64_t' | 'uint64_t'
  | 'float' | 'double'
  | 'bool' | 'char';

/** 單一欄位定義 */
export interface ULogField {
  name: string;
  type: ULogFieldType;
  arraySize: number; // 1 = 非陣列
  byteOffset: number;
  byteSize: number;
}

/** 訊息格式定義（Format Message） */
export interface ULogFormat {
  name: string;
  fields: ULogField[];
  totalSize: number; // 每條訊息的位元組大小
}

/** 訂閱的 Topic */
export interface ULogSubscription {
  msgId: number;
  topicName: string;
  multiId: number;
  format: ULogFormat;
}

/** 解析出的 Topic 資料（欄位式儲存） */
export interface ULogTopicData {
  topicName: string;
  multiId: number;
  timestamps: Float64Array;   // 微秒 timestamp
  fields: Record<string, Float32Array | Float64Array | Int32Array | Int8Array>;
  count: number;
}

/** ULog 日誌等級 */
export type ULogLevel = 'EMERG' | 'ALERT' | 'CRIT' | 'ERR' | 'WARNING' | 'NOTICE' | 'INFO' | 'DEBUG';

/** 單條日誌訊息 */
export interface ULogMessage {
  timestamp: number; // 微秒
  level: ULogLevel;
  message: string;
}

/** 飛行基礎資訊 */
export interface ULogMetadata {
  systemName: string;
  hardwareVersion: string;
  softwareVersion: string;
  utcOffset: number;
  logStartTimestamp: number; // 微秒
  parameters: Record<string, number | string>;
}

/** ULog 解析完成後的完整資訊 */
export interface ULogSummary {
  metadata: ULogMetadata;
  topics: {
    name: string;
    multiId: number;
    count: number;
    freqHz: number;
    fields: string[];
    fieldTypes: Record<string, ULogFieldType>;
  }[];
  messages: ULogMessage[];
  durationUs: number;
  startTimestampUs: number;
  endTimestampUs: number;
}

// ============================================================
// Worker 訊息型別
// ============================================================

export type WorkerRequest =
  | { type: 'PARSE_FILE'; buffer: ArrayBuffer }
  | { type: 'GET_TOPIC_DATA'; topicName: string; multiId: number; fields: string[] }
  | { type: 'COMPUTE_FFT'; requestId: string; topicName: string; multiId: number; fieldName: string; timeStartUs: number; timeEndUs: number }
  | { type: 'ALIGN_PID_DATA'; requestId: string; setpointTopic: string; setpointField: string; actualTopic: string; actualField: string; timeStartUs: number; timeEndUs: number }
  | { type: 'RUN_CUSTOM_CALC'; requestId: string; config: any };

export type WorkerResponse =
  | { type: 'PARSE_PROGRESS'; progress: number; stage: string }
  | { type: 'PARSE_COMPLETE'; summary: ULogSummary }
  | { type: 'PARSE_ERROR'; message: string }
  | { type: 'TOPIC_DATA'; topicName: string; multiId: number; data: TopicTransferData }
  | { type: 'TOPIC_ERROR'; topicName: string; message: string }
  | { type: 'FFT_COMPLETE'; requestId: string; topicName: string; fieldName: string; frequencies: Float64Array; amplitudes: Float32Array }
  | { type: 'PID_DATA_ALIGNED'; requestId: string; timestamps: Float64Array; setpointAligned: Float32Array; actualAligned: Float32Array; rmse: number; corr: number; lagUs: number }
  | { type: 'CUSTOM_CALC_COMPLETE'; requestId: string; outputId: string; timestamps: Float64Array; values: Float32Array }
  | { type: 'CALC_ERROR'; requestId: string; message: string };

/** Zero-copy 傳輸的 Topic 數據包 */
export interface TopicTransferData {
  timestamps: Float64Array;
  fields: Record<string, Float32Array | Float64Array | Int32Array>;
  count: number;
}

// ============================================================
// 儀表板佈局型別
// ============================================================

export type PanelType = 
  | 'chart' 
  | 'attitude3d' 
  | 'ahrs' 
  | 'metadata' 
  | 'messages' 
  | 'empty' 
  | 'map'
  | 'vibration'
  | 'pid_tracking'
  | 'motor_balance'
  | 'magnetic_analysis'
  | 'status_mode';

export interface ChartSeries {
  topicName: string;
  multiId: number;
  fieldName: string;
  label: string;
  color: string;
  unit?: string;
}

export interface Panel {
  id: string;
  type: PanelType;
  series: ChartSeries[];    // 只對 chart 型別有效
  title?: string;
}

export interface PanelLayout {
  direction: 'row' | 'column';
  panels: (Panel | PanelLayout)[];
  sizes: number[]; // 百分比
}

// ============================================================
// 播放控制型別
// ============================================================

export interface PlaybackState {
  isPlaying: boolean;
  currentTimeUs: number;
  startTimeUs: number;
  endTimeUs: number;
  speedMultiplier: number;
  useUtcTime: boolean;
  utcOffsetUs: number;
}

// ============================================================
// 全域 App 狀態
// ============================================================

export type AppStatus =
  | 'idle'
  | 'loading'
  | 'parsing'
  | 'ready'
  | 'error';

export interface AppState {
  status: AppStatus;
  progress: number;
  progressStage: string;
  error: string | null;
  summary: ULogSummary | null;
  topicCache: Record<string, ULogTopicData>;
  layout: PanelLayout;
  playback: PlaybackState;
  selectedTopics: Set<string>;
  language: 'en' | 'zh';
}

// ============================================================
// PX4 狀態解碼表
// ============================================================

export const NAV_STATE_MAP: Record<number, string> = {
  0: 'MANUAL',
  1: 'ALTCTL',
  2: 'POSCTL',
  3: 'AUTO_MISSION',
  4: 'AUTO_LOITER',
  5: 'AUTO_RTL',
  6: 'ACRO',
  7: 'OFFBOARD',
  8: 'STAB',
  9: 'AUTO_TAKEOFF',
  10: 'AUTO_LAND',
  11: 'AUTO_FOLLOW_TARGET',
  12: 'AUTO_PRECLAND',
  13: 'ORBIT',
  14: 'AUTO_VTOL_TAKEOFF',
  17: 'TERMINATION',
  18: 'AUTO_LAND_ENGINE_FAILURE',
  23: 'EXTERNAL1',
  24: 'EXTERNAL2',
  25: 'EXTERNAL3',
  26: 'EXTERNAL4',
  27: 'EXTERNAL5',
  28: 'EXTERNAL6',
  29: 'AUTO_RTL_SWARM',
  30: 'AUTO_FOLLOW_SWARM',
};

export const ARMING_STATE_MAP: Record<number, string> = {
  0: 'INIT',
  1: 'STANDBY',
  2: 'ARMED',
  3: 'STANDBY_ERROR',
  4: 'SHUTDOWN',
  5: 'IN_AIR_RESTORE',
};

/** 預設圖表顏色池 */
export const CHART_COLORS = [
  '#60a5fa', '#34d399', '#f59e0b', '#f87171',
  '#a78bfa', '#38bdf8', '#fb923c', '#4ade80',
  '#c084fc', '#2dd4bf', '#fbbf24', '#ff6b6b',
];
