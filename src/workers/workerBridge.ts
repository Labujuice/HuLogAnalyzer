/**
 * Worker 橋接層
 * 
 * 封裝與 Web Worker 的通訊，提供 Promise-based API，
 * 並管理 Worker 生命週期。
 */

import type { WorkerRequest, WorkerResponse, ULogSummary, ULogTopicData } from '../types/ulog';

type ProgressCallback = (progress: number, stage: string) => void;

export class ULogWorkerBridge {
  private worker: Worker | null = null;
  private pendingTopicResolvers = new Map<string, {
    resolve: (data: ULogTopicData) => void;
    reject: (err: Error) => void;
  }>();
  private pendingCalcResolvers = new Map<string, {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
  }>();

  private onProgressCb: ProgressCallback | null = null;
  private parseResolve: ((summary: ULogSummary) => void) | null = null;
  private parseReject: ((err: Error) => void) | null = null;
  private _requestIdCounter = 0;

  private _getRequestId(): string {
    return `req_${this._requestIdCounter++}`;
  }

  constructor() {
    this._initWorker();
  }

  private _initWorker() {
    // Vite 的 Worker 匯入語法
    this.worker = new Worker(
      new URL('../workers/ulogWorker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resp = e.data;

      switch (resp.type) {
        case 'PARSE_PROGRESS':
          this.onProgressCb?.(resp.progress, resp.stage);
          break;

        case 'PARSE_COMPLETE':
          this.parseResolve?.(resp.summary);
          this.parseResolve = null;
          this.parseReject = null;
          break;

        case 'PARSE_ERROR':
          this.parseReject?.(new Error(resp.message));
          this.parseResolve = null;
          this.parseReject = null;
          break;

        case 'TOPIC_DATA': {
          const key = `${resp.topicName}:${resp.multiId}`;
          const resolver = this.pendingTopicResolvers.get(key);
          if (resolver) {
            resolver.resolve({
              topicName: resp.topicName,
              multiId: resp.multiId,
              timestamps: resp.data.timestamps,
              fields: resp.data.fields,
              count: resp.data.count,
            });
            this.pendingTopicResolvers.delete(key);
          }
          break;
        }

        case 'TOPIC_ERROR': {
          const key = `${resp.topicName}:0`;
          const resolver = this.pendingTopicResolvers.get(key);
          if (resolver) {
            resolver.reject(new Error(resp.message));
            this.pendingTopicResolvers.delete(key);
          }
          break;
        }

        case 'FFT_COMPLETE': {
          const resolver = this.pendingCalcResolvers.get(resp.requestId);
          if (resolver) {
            resolver.resolve({
              frequencies: resp.frequencies,
              amplitudes: resp.amplitudes
            });
            this.pendingCalcResolvers.delete(resp.requestId);
          }
          break;
        }

        case 'PID_DATA_ALIGNED': {
          const resolver = this.pendingCalcResolvers.get(resp.requestId);
          if (resolver) {
            resolver.resolve({
              timestamps: resp.timestamps,
              setpointAligned: resp.setpointAligned,
              actualAligned: resp.actualAligned,
              rmse: resp.rmse,
              corr: resp.corr,
              lagUs: resp.lagUs
            });
            this.pendingCalcResolvers.delete(resp.requestId);
          }
          break;
        }

        case 'CUSTOM_CALC_COMPLETE': {
          const resolver = this.pendingCalcResolvers.get(resp.requestId);
          if (resolver) {
            resolver.resolve({
              timestamps: resp.timestamps,
              values: resp.values
            });
            this.pendingCalcResolvers.delete(resp.requestId);
          }
          break;
        }

        case 'CALC_ERROR': {
          const resolver = this.pendingCalcResolvers.get(resp.requestId);
          if (resolver) {
            resolver.reject(new Error(resp.message));
            this.pendingCalcResolvers.delete(resp.requestId);
          }
          break;
        }
      }
    };

    this.worker.onerror = (e) => {
      console.error('ULog Worker Error:', e);
      this.parseReject?.(new Error(`Worker 錯誤: ${e.message}`));
    };
  }

  /**
   * 解析 ULog 檔案（Zero-Copy：ArrayBuffer 所有權轉移給 Worker）
   */
  parseFile(buffer: ArrayBuffer, onProgress?: ProgressCallback): Promise<ULogSummary> {
    this.onProgressCb = onProgress ?? null;

    return new Promise((resolve, reject) => {
      this.parseResolve = resolve;
      this.parseReject = reject;

      const req: WorkerRequest = { type: 'PARSE_FILE', buffer };
      // 轉移 ArrayBuffer 所有權給 Worker（Zero-Copy）
      this.worker!.postMessage(req, [buffer]);
    });
  }

  /**
   * 按需請求指定 Topic 的數據
   */
  getTopicData(topicName: string, multiId: number, fields: string[]): Promise<ULogTopicData> {
    const key = `${topicName}:${multiId}`;

    return new Promise((resolve, reject) => {
      this.pendingTopicResolvers.set(key, { resolve, reject });

      const req: WorkerRequest = { type: 'GET_TOPIC_DATA', topicName, multiId, fields };
      this.worker!.postMessage(req);
    });
  }

  /**
   * 請求計算特定 Topic 的特定欄位在指定時間範圍內的 FFT
   */
  computeFFT(
    topicName: string,
    multiId: number,
    fieldName: string,
    timeStartUs: number,
    timeEndUs: number
  ): Promise<{ frequencies: Float64Array; amplitudes: Float32Array }> {
    const requestId = this._getRequestId();
    return new Promise((resolve, reject) => {
      this.pendingCalcResolvers.set(requestId, { resolve, reject });
      const req: WorkerRequest = {
        type: 'COMPUTE_FFT',
        requestId,
        topicName,
        multiId,
        fieldName,
        timeStartUs,
        timeEndUs,
      };
      this.worker!.postMessage(req);
    });
  }

  /**
   * 請求對齊 PID 數據並計算追隨指標與相位延遲
   */
  alignPIDData(
    setpointTopic: string,
    setpointField: string,
    actualTopic: string,
    actualField: string,
    timeStartUs: number,
    timeEndUs: number
  ): Promise<{
    timestamps: Float64Array;
    setpointAligned: Float32Array;
    actualAligned: Float32Array;
    rmse: number;
    corr: number;
    lagUs: number;
  }> {
    const requestId = this._getRequestId();
    return new Promise((resolve, reject) => {
      this.pendingCalcResolvers.set(requestId, { resolve, reject });
      const req: WorkerRequest = {
        type: 'ALIGN_PID_DATA',
        requestId,
        setpointTopic,
        setpointField,
        actualTopic,
        actualField,
        timeStartUs,
        timeEndUs,
      };
      this.worker!.postMessage(req);
    });
  }

  /**
   * 執行客製化的代數/信號運算鏈
   */
  runCustomCalc(config: any): Promise<{ timestamps: Float64Array; values: Float32Array }> {
    const requestId = this._getRequestId();
    return new Promise((resolve, reject) => {
      this.pendingCalcResolvers.set(requestId, { resolve, reject });
      const req: WorkerRequest = {
        type: 'RUN_CUSTOM_CALC',
        requestId,
        config,
      };
      this.worker!.postMessage(req);
    });
  }

  /**
   * 終止並重建 Worker
   */
  reset() {
    this.worker?.terminate();
    this.pendingTopicResolvers.clear();
    this.pendingCalcResolvers.clear();
    this.parseResolve = null;
    this.parseReject = null;
    this._initWorker();
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }
}

// 全域單例
let _bridge: ULogWorkerBridge | null = null;
export function getWorkerBridge(): ULogWorkerBridge {
  if (!_bridge) _bridge = new ULogWorkerBridge();
  return _bridge;
}
