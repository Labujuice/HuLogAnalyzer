/**
 * ULog 解析 Web Worker
 * 
 * 在後台執行緒中執行解析，避免阻塞 UI 主執行緒。
 * 使用 Transferable Objects 進行 Zero-Copy 數據傳輸。
 */

import { ULogParser } from '../parser/ULogParser';
import { lttbDownsample } from '../parser/utils';
import type { WorkerRequest, WorkerResponse } from '../types/ulog';

let parser: ULogParser | null = null;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  switch (req.type) {
    case 'PARSE_FILE': {
      try {
        // 驗證 Magic Bytes
        if (!ULogParser.validateMagic(req.buffer)) {
          const errResp: WorkerResponse = {
            type: 'PARSE_ERROR',
            message: '無效的 ULog 檔案：前 4 個 Byte 幻數驗證失敗。請確認上傳的是 .ulog 或 .ulg 格式的 PX4 飛行日誌。',
          };
          self.postMessage(errResp);
          return;
        }

        parser = new ULogParser(req.buffer);

        const summary = await parser.parse((progress, stage) => {
          const progressResp: WorkerResponse = {
            type: 'PARSE_PROGRESS',
            progress,
            stage,
          };
          self.postMessage(progressResp);
        });

        const completeResp: WorkerResponse = {
          type: 'PARSE_COMPLETE',
          summary,
        };
        self.postMessage(completeResp);
      } catch (err) {
        const errResp: WorkerResponse = {
          type: 'PARSE_ERROR',
          message: err instanceof Error ? err.message : String(err),
        };
        self.postMessage(errResp);
      }
      break;
    }

    case 'GET_TOPIC_DATA': {
      if (!parser) {
        const errResp: WorkerResponse = {
          type: 'TOPIC_ERROR',
          topicName: req.topicName,
          message: '尚未解析任何 ULog 檔案。',
        };
        self.postMessage(errResp);
        return;
      }

      try {
        const topicData = parser.getTopicData(req.topicName, req.multiId, req.fields);
        if (!topicData) {
          const errResp: WorkerResponse = {
            type: 'TOPIC_ERROR',
            topicName: req.topicName,
            message: `找不到 Topic: ${req.topicName}`,
          };
          self.postMessage(errResp);
          return;
        }

        // 收集所有 Transferable 物件
        const transferables: ArrayBuffer[] = [];
        transferables.push(topicData.timestamps.buffer as ArrayBuffer);

        const fieldBuffers: Record<string, Float32Array | Float64Array | Int32Array> = {};
        for (const [fieldName, arr] of Object.entries(topicData.fields)) {
          let finalArr: Float32Array | Float64Array | Int32Array;
          // 如果數據量超過 8000 點，在 Worker 端做降採樣
          if (topicData.count > 8000 && arr instanceof Float32Array) {
            const result = lttbDownsample(topicData.timestamps, arr, 4000);
            finalArr = new Float32Array(result.ys);
          } else if (arr instanceof Int8Array) {
            finalArr = new Int32Array(arr); // 升型以統一介面
          } else {
            finalArr = arr as Float32Array | Float64Array | Int32Array;
          }
          fieldBuffers[fieldName] = finalArr;
          transferables.push(finalArr.buffer as ArrayBuffer);
        }

        const dataResp: WorkerResponse = {
          type: 'TOPIC_DATA',
          topicName: req.topicName,
          multiId: req.multiId,
          data: {
            timestamps: topicData.timestamps,
            fields: fieldBuffers,
            count: topicData.count,
          },
        };

        // Zero-Copy 傳輸：轉移 ArrayBuffer 所有權
        (self as unknown as Worker).postMessage(dataResp, transferables);

      } catch (err) {
        const errResp: WorkerResponse = {
          type: 'TOPIC_ERROR',
          topicName: req.topicName,
          message: err instanceof Error ? err.message : String(err),
        };
        self.postMessage(errResp);
      }
      break;
    }
  }
};
