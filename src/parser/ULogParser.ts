/**
 * ULog 二進位格式解析器 (Pure TypeScript)
 * 
 * 架構設計兼容未來替換為 Rust/WASM 版本。
 * 採用欄位式儲存（Columnar Storage）與按需解碼策略。
 * 
 * ULog 格式參考: https://docs.px4.io/main/en/dev_log/ulog_file_format.html
 */

import type {
  ULogFormat, ULogField, ULogFieldType,
  ULogSubscription, ULogMessage, ULogLevel,
  ULogMetadata, ULogSummary, ULogTopicData,
} from '../types/ulog';

// ─── Magic Bytes ──────────────────────────────────────────────────────────────
const ULOG_MAGIC = new Uint8Array([0x55, 0x4C, 0x6F, 0x67, 0x01, 0x12, 0x35]);

// ─── Message Types ────────────────────────────────────────────────────────────
const MSG_TYPE = {
  FORMAT:        0x46, // 'F'
  DATA:          0x44, // 'D'
  INFO:          0x49, // 'I'
  INFO_MULTIPLE: 0x4D, // 'M'
  PARAMETER:     0x50, // 'P'
  PARAMETER_DEFAULT: 0x51, // 'Q'
  ADD_LOGGED_MSG: 0x41, // 'A'
  REMOVE_LOGGED_MSG: 0x52, // 'R'
  SYNC:          0x53, // 'S'
  DROPOUT:       0x4F, // 'O'
  LOGGING:       0x4C, // 'L'
  LOGGING_TAGGED: 0x43, // 'C'
  FLAG_BITS:     0x42, // 'B'
} as const;

// ─── 欄位型別大小映射 ──────────────────────────────────────────────────────────
const FIELD_SIZE: Record<ULogFieldType, number> = {
  int8_t:   1, uint8_t:  1,
  int16_t:  2, uint16_t: 2,
  int32_t:  4, uint32_t: 4,
  int64_t:  8, uint64_t: 8,
  float:    4, double:   8,
  bool:     1, char:     1,
};

/** 解析進度回呼型別 */
export type ParseProgressCallback = (progress: number, stage: string) => void;

// ─── 主解析器類別 ─────────────────────────────────────────────────────────────

export class ULogParser {
  private view: DataView;
  private buf: Uint8Array;
  private pos: number = 0;

  // 解析後的結構
  private formats: Map<string, ULogFormat> = new Map();
  private subscriptions: Map<number, ULogSubscription> = new Map();
  private metadata: Partial<ULogMetadata> = {};
  private messages: ULogMessage[] = [];
  private parameters: Record<string, number | string> = {};

  // Topic 數據儲存（欄位式）
  // key: "topicName:multiId"  value: 各欄位的 number[] (解析完再轉 TypedArray)
  private rawTopicData: Map<string, {
    sub: ULogSubscription;
    timestamps: number[];
    fields: Record<string, number[]>;
  }> = new Map();

  private headerVersion: number = 0;
  private logStartTimestamp: number = 0;

  constructor(buffer: ArrayBuffer) {
    this.buf = new Uint8Array(buffer);
    this.view = new DataView(buffer);
  }

  // ─── 公開 API ────────────────────────────────────────────────────────────────

  /**
   * 驗證 Magic Bytes（立即呼叫，不需完整解析）
   */
  static validateMagic(buffer: ArrayBuffer): boolean {
    const arr = new Uint8Array(buffer, 0, 8);
    for (let i = 0; i < 4; i++) {
      if (arr[i] !== ULOG_MAGIC[i]) return false;
    }
    return true;
  }

  /**
   * 解析整個 ULog 檔案，回傳完整 Summary
   */
  async parse(onProgress?: ParseProgressCallback): Promise<ULogSummary> {
    this.pos = 0;

    onProgress?.(0.02, '驗證檔案格式...');
    this._parseFileHeader();

    onProgress?.(0.10, '解析訊息格式定義...');
    this._parseDefinitions();

    onProgress?.(0.30, '掃描數據區塊...');
    this._parseData(onProgress);

    onProgress?.(0.95, '整理資料結構...');
    return this._buildSummary();
  }

  /**
   * 按需取得指定 Topic 的欄位式數據（Zero-Copy friendly）
   */
  getTopicData(topicName: string, multiId: number, requestedFields?: string[]): ULogTopicData | null {
    const key = `${topicName}:${multiId}`;
    const raw = this.rawTopicData.get(key);
    if (!raw || raw.timestamps.length === 0) return null;

    const count = raw.timestamps.length;
    const timestamps = new Float64Array(raw.timestamps);

    const fields: Record<string, Float32Array | Float64Array | Int32Array | Int8Array> = {};
    const fieldsToConvert = requestedFields ?? Object.keys(raw.fields);

    for (const fname of fieldsToConvert) {
      if (!(fname in raw.fields)) continue;
      const nums = raw.fields[fname];
      // 判斷欄位型別決定用哪種 TypedArray
      const fieldDef = raw.sub.format.fields.find(f => f.name === fname);
      if (fieldDef) {
        if (fieldDef.type === 'double' || fieldDef.type === 'int64_t' || fieldDef.type === 'uint64_t') {
          fields[fname] = new Float64Array(nums);
        } else if (fieldDef.type === 'int8_t' || fieldDef.type === 'bool') {
          fields[fname] = new Int8Array(nums);
        } else if (fieldDef.type === 'int32_t' || fieldDef.type === 'uint32_t') {
          fields[fname] = new Int32Array(nums);
        } else {
          fields[fname] = new Float32Array(nums);
        }
      } else {
        fields[fname] = new Float32Array(nums);
      }
    }

    return { topicName, multiId, timestamps, fields, count };
  }

  // ─── 私有解析方法 ────────────────────────────────────────────────────────────

  private _parseFileHeader() {
    // Magic: 7 bytes
    for (let i = 0; i < 7; i++) {
      if (this.buf[i] !== ULOG_MAGIC[i]) {
        throw new Error(`無效的 ULog 幻數，這不是有效的 .ulog 檔案。`);
      }
    }
    this.headerVersion = this.buf[7];
    this.logStartTimestamp = Number(this.view.getBigUint64(8, true));
    this.metadata.logStartTimestamp = this.logStartTimestamp;
    this.pos = 16;
  }

  private _parseDefinitions() {
    // 定義區段：讀到第一個非定義型別訊息為止
    while (this.pos < this.buf.length) {
      const headerPos = this.pos;
      if (this.pos + 3 > this.buf.length) break;

      const msgLen = this.view.getUint16(this.pos, true);
      const msgType = this.buf[this.pos + 2];
      this.pos += 3;

      if (this.pos + msgLen > this.buf.length) break;
      const msgEnd = this.pos + msgLen;

      switch (msgType) {
        case MSG_TYPE.FLAG_BITS:
          this.pos = msgEnd;
          break;
        case MSG_TYPE.FORMAT:
          this._parseFormat(msgEnd);
          break;
        case MSG_TYPE.INFO:
          this._parseInfo(msgEnd);
          break;
        case MSG_TYPE.INFO_MULTIPLE:
          this._parseInfoMultiple(msgEnd);
          break;
        case MSG_TYPE.PARAMETER:
          this._parseParameter(msgEnd);
          break;
        case MSG_TYPE.PARAMETER_DEFAULT:
          this.pos = msgEnd;
          break;
        default:
          // 非定義型別，退回這條訊息的起始位置，進入數據解析階段
          this.pos = headerPos;
          return;
      }
    }
  }

  private _parseData(onProgress?: ParseProgressCallback) {
    const totalSize = this.buf.length;
    let lastReportPos = this.pos;

    while (this.pos < this.buf.length) {
      if (this.pos + 3 > this.buf.length) break;

      const msgLen = this.view.getUint16(this.pos, true);
      const msgType = this.buf[this.pos + 2];
      this.pos += 3;

      if (this.pos + msgLen > this.buf.length) break;
      const msgEnd = this.pos + msgLen;

      switch (msgType) {
        case MSG_TYPE.ADD_LOGGED_MSG:
          this._parseAddLoggedMsg(msgEnd);
          break;
        case MSG_TYPE.DATA:
          this._parseDataMsg(msgEnd);
          break;
        case MSG_TYPE.LOGGING:
          this._parseLogMsg(msgEnd);
          break;
        case MSG_TYPE.LOGGING_TAGGED:
          this._parseLogMsg(msgEnd, true);
          break;
        case MSG_TYPE.PARAMETER:
          this._parseParameter(msgEnd);
          break;
        case MSG_TYPE.DROPOUT:
        case MSG_TYPE.SYNC:
        case MSG_TYPE.REMOVE_LOGGED_MSG:
        default:
          this.pos = msgEnd;
          break;
      }

      // 每解析 2MB 回報一次進度
      if (this.pos - lastReportPos > 2 * 1024 * 1024) {
        const ratio = 0.30 + (this.pos / totalSize) * 0.60;
        onProgress?.(Math.min(ratio, 0.92), `解析數據... (${(this.pos / 1024 / 1024).toFixed(1)} MB)`);
        lastReportPos = this.pos;
      }
    }
  }

  // ─── 訊息解析子方法 ──────────────────────────────────────────────────────────

  private _parseFormat(msgEnd: number) {
    const raw = this._readString(msgEnd);
    // 格式: "TypeName:field1_type field1_name;field2_type field2_name;..."
    const colonIdx = raw.indexOf(':');
    if (colonIdx < 0) return;
    const typeName = raw.substring(0, colonIdx);
    const fieldStr = raw.substring(colonIdx + 1);

    const fields: ULogField[] = [];
    let byteOffset = 0;

    for (const part of fieldStr.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // 格式: "type[N] name" 或 "type name"
      const spaceIdx = trimmed.lastIndexOf(' ');
      if (spaceIdx < 0) continue;
      const typeStr = trimmed.substring(0, spaceIdx).trim();
      let name = trimmed.substring(spaceIdx + 1).trim();

      // 跳過 padding 欄位
      if (name.startsWith('_padding')) continue;

      // 解析陣列大小
      let arraySize = 1;
      let baseType = typeStr;
      const arrMatch = typeStr.match(/^(.+)\[(\d+)\]$/);
      if (arrMatch) {
        baseType = arrMatch[1];
        arraySize = parseInt(arrMatch[2], 10);
      }

      const fieldType = baseType as ULogFieldType;
      const unitSize = FIELD_SIZE[fieldType] ?? 1;
      const byteSize = unitSize * arraySize;

      fields.push({ name, type: fieldType, arraySize, byteOffset, byteSize });
      byteOffset += byteSize;
    }

    const format: ULogFormat = { name: typeName, fields, totalSize: byteOffset };
    this.formats.set(typeName, format);
    this.pos = msgEnd;
  }

  private _parseInfo(msgEnd: number) {
    const keyLen = this.buf[this.pos++];
    const key = this._readFixedString(keyLen);
    const val = this._readString(msgEnd);
    // 解析型別前綴，例如 "char[5] name"
    const spaceIdx = key.indexOf(' ');
    const realKey = spaceIdx >= 0 ? key.substring(spaceIdx + 1) : key;
    const typeStr = spaceIdx >= 0 ? key.substring(0, spaceIdx) : '';

    if (typeStr.startsWith('char')) {
      switch (realKey) {
        case 'sys_name':      this.metadata.systemName = val; break;
        case 'ver_hw':        this.metadata.hardwareVersion = val; break;
        case 'ver_sw_release':
        case 'ver_sw':        this.metadata.softwareVersion = val; break;
      }
    }
    this.pos = msgEnd;
  }

  private _parseInfoMultiple(msgEnd: number) {
    this.pos = msgEnd; // 暫時跳過多值 Info
  }

  private _parseParameter(msgEnd: number) {
    const keyLen = this.buf[this.pos++];
    const key = this._readFixedString(keyLen);
    // 型別前綴 "float name" or "int32_t name"
    const spaceIdx = key.indexOf(' ');
    const typeStr = spaceIdx >= 0 ? key.substring(0, spaceIdx) : 'float';
    const realKey = spaceIdx >= 0 ? key.substring(spaceIdx + 1) : key;

    if (typeStr === 'int32_t') {
      this.parameters[realKey] = this.view.getInt32(this.pos, true);
      this.pos += 4;
    } else {
      // float
      this.parameters[realKey] = this.view.getFloat32(this.pos, true);
      this.pos += 4;
    }
    this.pos = msgEnd;
  }

  private _parseAddLoggedMsg(msgEnd: number) {
    const multiId = this.buf[this.pos++];
    const msgId = this.view.getUint16(this.pos, true); this.pos += 2;
    const topicName = this._readString(msgEnd);

    const format = this.formats.get(topicName);
    if (!format) return;

    const sub: ULogSubscription = { msgId, topicName, multiId, format };
    this.subscriptions.set(msgId, sub);

    const key = `${topicName}:${multiId}`;
    if (!this.rawTopicData.has(key)) {
      const fields: Record<string, number[]> = {};
      for (const f of format.fields) {
        if (f.name === 'timestamp') continue;
        if (f.arraySize > 1) {
          for (let i = 0; i < f.arraySize; i++) {
            fields[`${f.name}[${i}]`] = [];
          }
        } else {
          fields[f.name] = [];
        }
      }
      this.rawTopicData.set(key, { sub, timestamps: [], fields });
    }
  }

  private _parseDataMsg(msgEnd: number) {
    const msgId = this.view.getUint16(this.pos, true); this.pos += 2;
    const sub = this.subscriptions.get(msgId);
    if (!sub) { this.pos = msgEnd; return; }

    const key = `${sub.topicName}:${sub.multiId}`;
    const raw = this.rawTopicData.get(key);
    if (!raw) { this.pos = msgEnd; return; }

    const startPos = this.pos;
    const fmt = sub.format;

    // 讀取 timestamp（uint64_t, 微秒）
    const ts = Number(this.view.getBigUint64(startPos, true));
    raw.timestamps.push(ts);

    // 讀取各欄位
    for (const field of fmt.fields) {
      if (field.name === 'timestamp') continue;
      const fPos = startPos + field.byteOffset;

      if (field.arraySize > 1) {
        for (let i = 0; i < field.arraySize; i++) {
          const arrFieldName = `${field.name}[${i}]`;
          const arrFieldPos = fPos + i * FIELD_SIZE[field.type];
          raw.fields[arrFieldName]?.push(this._readFieldValue(arrFieldPos, field.type));
        }
      } else {
        raw.fields[field.name]?.push(this._readFieldValue(fPos, field.type));
      }
    }

    this.pos = msgEnd;
  }

  private _parseLogMsg(msgEnd: number, tagged: boolean = false) {
    const logLevel = this.buf[this.pos++];
    if (tagged) this.pos += 2; // tag (uint16)

    const timestamp = Number(this.view.getBigUint64(this.pos, true)); this.pos += 8;
    const text = this._readString(msgEnd);

    const levelMap: Record<number, ULogLevel> = {
      0: 'EMERG', 1: 'ALERT', 2: 'CRIT', 3: 'ERR',
      4: 'WARNING', 5: 'NOTICE', 6: 'INFO', 7: 'DEBUG',
    };

    this.messages.push({
      timestamp,
      level: levelMap[logLevel] ?? 'INFO',
      message: text,
    });
    this.pos = msgEnd;
  }

  // ─── 讀取原始值 ──────────────────────────────────────────────────────────────

  private _readFieldValue(pos: number, type: ULogFieldType): number {
    switch (type) {
      case 'int8_t':   return this.view.getInt8(pos);
      case 'uint8_t':  return this.view.getUint8(pos);
      case 'bool':     return this.view.getUint8(pos);
      case 'char':     return this.view.getUint8(pos);
      case 'int16_t':  return this.view.getInt16(pos, true);
      case 'uint16_t': return this.view.getUint16(pos, true);
      case 'int32_t':  return this.view.getInt32(pos, true);
      case 'uint32_t': return this.view.getUint32(pos, true);
      case 'float':    return this.view.getFloat32(pos, true);
      case 'double':   return this.view.getFloat64(pos, true);
      case 'int64_t':  return Number(this.view.getBigInt64(pos, true));
      case 'uint64_t': return Number(this.view.getBigUint64(pos, true));
      default:         return 0;
    }
  }

  private _readString(end: number): string {
    const start = this.pos;
    const slice = this.buf.subarray(start, end);
    this.pos = end;
    return new TextDecoder().decode(slice).replace(/\0/g, '');
  }

  private _readFixedString(len: number): string {
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return new TextDecoder().decode(slice).replace(/\0/g, '');
  }

  // ─── 建立 Summary ────────────────────────────────────────────────────────────

  private _buildSummary(): ULogSummary {
    let startTs = Infinity;
    let endTs = 0;

    const topics = [];
    for (const [key, raw] of this.rawTopicData) {
      if (raw.timestamps.length === 0) continue;
      const ts = raw.timestamps;
      const first = ts[0];
      const last = ts[ts.length - 1];
      if (first < startTs) startTs = first;
      if (last > endTs) endTs = last;

      const durationUs = last - first;
      const freqHz = durationUs > 0 ? Math.round((ts.length / durationUs) * 1e6) : 0;

      const fieldTypes: Record<string, ULogFieldType> = {};
      const fields: string[] = [];
      for (const f of raw.sub.format.fields) {
        if (f.name === 'timestamp') continue;
        if (f.arraySize > 1) {
          for (let i = 0; i < f.arraySize; i++) {
            const name = `${f.name}[${i}]`;
            fields.push(name);
            fieldTypes[name] = f.type;
          }
        } else {
          fields.push(f.name);
          fieldTypes[f.name] = f.type;
        }
      }

      topics.push({
        name: raw.sub.topicName,
        multiId: raw.sub.multiId,
        count: ts.length,
        freqHz,
        fields,
        fieldTypes,
      });
    }

    if (startTs === Infinity) startTs = this.logStartTimestamp;
    if (endTs === 0) endTs = startTs;

    // 嘗試從 GPS 取得 UTC offset
    const gpsKey = 'vehicle_gps_position:0';
    const gpsData = this.rawTopicData.get(gpsKey);
    let utcOffsetUs = 0;
    if (gpsData && gpsData.fields['time_utc_usec'] && gpsData.fields['time_utc_usec'].length > 0) {
      const utcTime = gpsData.fields['time_utc_usec'][0];
      const logTime = gpsData.timestamps[0];
      if (utcTime > 0) {
        utcOffsetUs = utcTime - logTime;
      }
    }

    return {
      metadata: {
        systemName: this.metadata.systemName ?? 'PX4',
        hardwareVersion: this.metadata.hardwareVersion ?? 'Unknown',
        softwareVersion: this.metadata.softwareVersion ?? 'Unknown',
        utcOffset: utcOffsetUs,
        logStartTimestamp: this.logStartTimestamp,
        parameters: this.parameters,
      },
      topics: topics.sort((a, b) => a.name.localeCompare(b.name)),
      messages: this.messages,
      durationUs: endTs - startTs,
      startTimestampUs: startTs,
      endTimestampUs: endTs,
    };
  }
}
