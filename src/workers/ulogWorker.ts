/**
 * ULog 解析 Web Worker
 * 
 * 在後台執行緒中執行解析，避免阻塞 UI 主執行緒。
 * 使用 Transferable Objects 進行 Zero-Copy 數據傳輸。
 */

import { ULogParser } from '../parser/ULogParser';
import { lttbDownsample, getLttbIndices, sliceByTimeRange } from '../parser/utils';
import { computeFFTAmplitude } from '../parser/fft';
import { computeRMSE, computeCorrelation, detectLagUs, interpolateSeries } from '../parser/mathUtils';
import { executeCustomCalculation } from '../parser/customCalcParser';
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

    case 'COMPUTE_FFT': {
      if (!parser) {
        self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: '尚未解析 any ULog 檔案。' });
        return;
      }
      try {
        const topicData = parser.getTopicData(req.topicName, req.multiId, [req.fieldName]);
        if (!topicData) {
          self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: `找不到 Topic: ${req.topicName}` });
          return;
        }

        const timestamps = topicData.timestamps;
        const values = topicData.fields[req.fieldName];
        if (!values) {
          self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: `在 Topic ${req.topicName} 中找不到欄位: ${req.fieldName}` });
          return;
        }

        // 根據時間範圍 Slice
        const [startIdx, endIdx] = sliceByTimeRange(timestamps, req.timeStartUs, req.timeEndUs);
        const subTimestamps = timestamps.subarray(startIdx, endIdx);
        const subValues = values.subarray(startIdx, endIdx);

        if (subValues.length < 8) {
          self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: '所選時間區間內的數據點數不足，無法計算 FFT。' });
          return;
        }

        // 計算採樣頻率
        const n = subTimestamps.length;
        const dtSec = (subTimestamps[n - 1] - subTimestamps[0]) / (n - 1) / 1e6;
        const fs = 1.0 / dtSec;

        const { frequencies, amplitudes } = computeFFTAmplitude(
          subValues instanceof Float32Array ? subValues : new Float32Array(subValues),
          fs
        );

        const resp: WorkerResponse = {
          type: 'FFT_COMPLETE',
          requestId: req.requestId,
          topicName: req.topicName,
          fieldName: req.fieldName,
          frequencies,
          amplitudes
        };

        // Zero-copy transfer
        (self as unknown as Worker).postMessage(resp, [frequencies.buffer as ArrayBuffer, amplitudes.buffer as ArrayBuffer]);
      } catch (err) {
        self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }

    case 'ALIGN_PID_DATA': {
      if (!parser) {
        self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: '尚未解析 any ULog 檔案。' });
        return;
      }
      try {
        const setpointData = parser.getTopicData(req.setpointTopic, 0, [req.setpointField]);
        const actualData = parser.getTopicData(req.actualTopic, 0, [req.actualField]);

        if (!setpointData || !actualData) {
          self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: `找不到 PID Topic: ${!setpointData ? req.setpointTopic : req.actualTopic}` });
          return;
        }

        const ySetRaw = setpointData.fields[req.setpointField];
        const yActRaw = actualData.fields[req.actualField];

        if (!ySetRaw || !yActRaw) {
          self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: `在 PID Topic 中找不到對應欄位` });
          return;
        }

        // 1. 先對 actual 數據做時間範圍 Slice（以實測實際值為基準時間軸）
        const [startIdxAct, endIdxAct] = sliceByTimeRange(actualData.timestamps, req.timeStartUs, req.timeEndUs);
        const tRef = actualData.timestamps.subarray(startIdxAct, endIdxAct);
        const yAct = yActRaw.subarray(startIdxAct, endIdxAct) instanceof Float32Array 
          ? (yActRaw.subarray(startIdxAct, endIdxAct) as Float32Array)
          : new Float32Array(yActRaw.subarray(startIdxAct, endIdxAct));

        if (tRef.length < 5) {
          self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: '所選時間區間內數據點過少，無法對齊 PID' });
          return;
        }

        // 2. 對 setpoint 進行對齊與延遲偵測
        // 第一遍：將 setpoint 線性插值到基準時間軸 tRef
        const ySetAligned = interpolateSeries(setpointData.timestamps, ySetRaw, tRef);

        // 偵測相位滯後
        const lagUs = detectLagUs(yAct, ySetAligned, tRef);

        // 第二遍：根據滯後平移時間戳，重新插值對齊 setpoint 達到相位補償
        let ySetFinal = ySetAligned;
        if (Math.abs(lagUs) > 0) {
          const tShifted = new Float64Array(setpointData.timestamps.length);
          for (let i = 0; i < setpointData.timestamps.length; i++) {
            tShifted[i] = setpointData.timestamps[i] - lagUs;
          }
          ySetFinal = interpolateSeries(tShifted, ySetRaw, tRef);
        }

        // 3. 計算 PID 指標
        const rmse = computeRMSE(yAct, ySetFinal);
        const corr = computeCorrelation(yAct, ySetFinal);

        const resp: WorkerResponse = {
          type: 'PID_DATA_ALIGNED',
          requestId: req.requestId,
          timestamps: tRef,
          setpointAligned: ySetFinal,
          actualAligned: yAct,
          rmse,
          corr,
          lagUs
        };

        // Zero-copy transfer
        (self as unknown as Worker).postMessage(resp, [
          tRef.buffer as ArrayBuffer,
          ySetFinal.buffer as ArrayBuffer,
          yAct.buffer as ArrayBuffer
        ]);
      } catch (err) {
        self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }

    case 'RUN_CUSTOM_CALC': {
      if (!parser) {
        self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: '尚未解析 any ULog 檔案。' });
        return;
      }
      try {
        const getRawData = (tName: string) => {
          // 預設尋找 multiId 0
          const topicInfo = parser!.getTopicData(tName, 0);
          if (!topicInfo) return null;
          return {
            timestamps: topicInfo.timestamps,
            fields: topicInfo.fields as Record<string, Float32Array>
          };
        };

        const result = executeCustomCalculation(req.config, getRawData);

        const resp: WorkerResponse = {
          type: 'CUSTOM_CALC_COMPLETE',
          requestId: req.requestId,
          outputId: req.config.id,
          timestamps: result.timestamps,
          values: result.values
        };

        // Zero-copy transfer
        (self as unknown as Worker).postMessage(resp, [
          result.timestamps.buffer as ArrayBuffer,
          result.values.buffer as ArrayBuffer
        ]);
      } catch (err) {
        self.postMessage({ type: 'CALC_ERROR', requestId: req.requestId, message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
  }
};
