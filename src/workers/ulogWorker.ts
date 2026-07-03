/**
 * ULog 解析 Web Worker
 * 
 * 在後台執行緒中執行解析，避免阻塞 UI 主執行緒。
 * 使用 Transferable Objects 進行 Zero-Copy 數據傳輸。
 */

import { ULogParser } from '../parser/ULogParser';
import { lttbDownsample, getLttbIndices } from '../parser/utils';
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
          message: '尚未解析 any ULog 檔案。',
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

        let finalTimestamps = topicData.timestamps;
        let finalCount = topicData.count;
        const fieldBuffers: Record<string, Float32Array | Float64Array | Int32Array> = {};
        const transferables: ArrayBuffer[] = [];

        if (topicData.count > 8000) {
          // 超過 8000 點，統一用 LTTB 對第一個浮點數欄位做降採樣，取得統一的保留索引
          let refField: Float32Array | Float64Array | null = null;
          for (const val of Object.values(topicData.fields)) {
            if (val instanceof Float32Array || val instanceof Float64Array) {
              refField = val;
              break;
            }
          }
          if (!refField) {
            refField = Object.values(topicData.fields)[0] as Float32Array | Float64Array | null;
          }

          if (refField) {
            const indices = getLttbIndices(topicData.timestamps, refField, 4000);
            finalCount = indices.length;

            // 重新抽取 timestamps
            const newTimestamps = new Float64Array(finalCount);
            for (let i = 0; i < finalCount; i++) {
              newTimestamps[i] = topicData.timestamps[indices[i]];
            }
            finalTimestamps = newTimestamps;
            transferables.push(finalTimestamps.buffer as ArrayBuffer);

            // 重新抽取各個欄位
            for (const [fieldName, arr] of Object.entries(topicData.fields)) {
              let finalArr: Float32Array | Float64Array | Int32Array;
              if (arr instanceof Float32Array) {
                const temp = new Float32Array(finalCount);
                for (let i = 0; i < finalCount; i++) temp[i] = arr[indices[i]];
                finalArr = temp;
              } else if (arr instanceof Float64Array) {
                const temp = new Float64Array(finalCount);
                for (let i = 0; i < finalCount; i++) temp[i] = arr[indices[i]];
                finalArr = temp;
              } else {
                const temp = new Int32Array(finalCount);
                for (let i = 0; i < finalCount; i++) temp[i] = arr[indices[i]];
                finalArr = temp;
              }
              fieldBuffers[fieldName] = finalArr;
              transferables.push(finalArr.buffer as ArrayBuffer);
            }
          } else {
            // 兜底：無任何欄位
            transferables.push(finalTimestamps.buffer as ArrayBuffer);
          }
        } else {
          // 不需要降採樣，正常升級與傳輸
          transferables.push(finalTimestamps.buffer as ArrayBuffer);
          for (const [fieldName, arr] of Object.entries(topicData.fields)) {
            let finalArr: Float32Array | Float64Array | Int32Array;
            if (arr instanceof Int8Array) {
              finalArr = new Int32Array(arr);
            } else {
              finalArr = arr as Float32Array | Float64Array | Int32Array;
            }
            fieldBuffers[fieldName] = finalArr;
            transferables.push(finalArr.buffer as ArrayBuffer);
          }
        }

        const dataResp: WorkerResponse = {
          type: 'TOPIC_DATA',
          topicName: req.topicName,
          multiId: req.multiId,
          data: {
            timestamps: finalTimestamps,
            fields: fieldBuffers,
            count: finalCount,
          },
        };

        // Zero-Copy 傳輸
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
