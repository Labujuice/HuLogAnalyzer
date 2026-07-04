import { computeNorm, interpolateSeries } from './mathUtils';
import { computeFFTAmplitude } from './fft';

/**
 * 簡易的數位一階低通濾波器
 */
export function applyLowPass(
  data: Float32Array,
  timestamps: Float64Array,
  cutoffHz: number
): Float32Array {
  const n = data.length;
  const result = new Float32Array(n);
  if (n === 0) return result;

  result[0] = data[0];
  const rc = 1.0 / (2 * Math.PI * cutoffHz);

  for (let i = 1; i < n; i++) {
    const dt = (timestamps[i] - timestamps[i - 1]) / 1e6; // 微秒轉秒
    // 預防時域逆流或異常
    const safeDt = dt > 0 ? dt : 0.001;
    const alpha = safeDt / (safeDt + rc);
    result[i] = result[i - 1] + alpha * (data[i] - result[i - 1]);
  }

  return result;
}

// ─── 簡易代數公式解析器 (Shunting-Yard & RPN Evaluator) ────────────────────────

type TokenType = 'NUM' | 'VAR' | 'OP' | 'FN' | 'LPAREN' | 'RPAREN' | 'COMMA';

interface Token {
  type: TokenType;
  value: string;
}

const PRECEDENCE: Record<string, number> = {
  '+': 1, '-': 1,
  '*': 2, '/': 2,
  '^': 3,
  'u-': 4, // 單位元負號
};

const OPERATORS = new Set(['+', '-', '*', '/', '^']);
const FUNCTIONS = new Set(['sqrt', 'abs', 'sin', 'cos', 'atan2', 'log']);

/**
 * 將數學公式字串 Tokenize
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const char = expr[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (OPERATORS.has(char)) {
      // 判定是否為單原子負號 (即前方是左括弧、逗號、運算子，或開頭的第一個字)
      if (char === '-') {
        const prev = tokens[tokens.length - 1];
        if (!prev || prev.type === 'OP' || prev.type === 'LPAREN' || prev.type === 'COMMA') {
          tokens.push({ type: 'OP', value: 'u-' });
          i++;
          continue;
        }
      }
      tokens.push({ type: 'OP', value: char });
      i++;
      continue;
    }

    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'COMMA', value: ',' });
      i++;
      continue;
    }

    // 數字
    if (/[0-9.]/.test(char)) {
      let numStr = '';
      while (i < len && /[0-9.]/.test(expr[i])) {
        numStr += expr[i];
        i++;
      }
      tokens.push({ type: 'NUM', value: numStr });
      continue;
    }

    // 字母 (函數或變數)
    if (/[a-zA-Z_]/.test(char)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_]/.test(expr[i])) {
        ident += expr[i];
        i++;
      }
      if (FUNCTIONS.has(ident.toLowerCase())) {
        tokens.push({ type: 'FN', value: ident.toLowerCase() });
      } else {
        tokens.push({ type: 'VAR', value: ident });
      }
      continue;
    }

    // 忽略未知字元
    i++;
  }
  return tokens;
}

/**
 * Shunting-Yard 演算法：將中序 Token 轉為逆波蘭表示法 (RPN)
 */
function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];

  for (const token of tokens) {
    if (token.type === 'NUM' || token.type === 'VAR') {
      output.push(token);
    } else if (token.type === 'FN') {
      stack.push(token);
    } else if (token.type === 'LPAREN') {
      stack.push(token);
    } else if (token.type === 'RPAREN') {
      while (stack.length > 0 && stack[stack.length - 1].value !== '(') {
        output.push(stack.pop()!);
      }
      if (stack.length === 0) {
        throw new Error('公式括弧不匹配');
      }
      stack.pop(); // 彈出 '('
      if (stack.length > 0 && stack[stack.length - 1].type === 'FN') {
        output.push(stack.pop()!);
      }
    } else if (token.type === 'COMMA') {
      while (stack.length > 0 && stack[stack.length - 1].value !== '(') {
        output.push(stack.pop()!);
      }
    } else if (token.type === 'OP') {
      const o1 = token;
      let o2 = stack.length > 0 ? stack[stack.length - 1] : null;
      while (
        o2 &&
        o2.type === 'OP' &&
        (PRECEDENCE[o1.value] < PRECEDENCE[o2.value] ||
          (PRECEDENCE[o1.value] === PRECEDENCE[o2.value] && o1.value !== '^'))
      ) {
        output.push(stack.pop()!);
        o2 = stack.length > 0 ? stack[stack.length - 1] : null;
      }
      stack.push(o1);
    }
  }

  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.type === 'LPAREN' || top.type === 'RPAREN') {
      throw new Error('公式括弧不匹配');
    }
    output.push(top);
  }

  return output;
}

/**
 * 執行 RPN 計算的表達式求值器
 */
function evaluateRPN(rpn: Token[], vars: Record<string, number>): number {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === 'NUM') {
      stack.push(parseFloat(token.value));
    } else if (token.type === 'VAR') {
      const val = vars[token.value];
      if (val === undefined) {
        throw new Error(`未定義的變數: ${token.value}`);
      }
      stack.push(val);
    } else if (token.type === 'OP') {
      if (token.value === 'u-') {
        const a = stack.pop();
        if (a === undefined) throw new Error('公式語法錯誤');
        stack.push(-a);
        continue;
      }
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) {
        throw new Error('公式語法錯誤');
      }
      switch (token.value) {
        case '+': stack.push(a + b); break;
        case '-': stack.push(a - b); break;
        case '*': stack.push(a * b); break;
        case '/': stack.push(a / b); break;
        case '^': stack.push(Math.pow(a, b)); break;
      }
    } else if (token.type === 'FN') {
      switch (token.value) {
        case 'sqrt': {
          const a = stack.pop();
          if (a === undefined) throw new Error('公式語法錯誤');
          stack.push(Math.sqrt(a));
          break;
        }
        case 'abs': {
          const a = stack.pop();
          if (a === undefined) throw new Error('公式語法錯誤');
          stack.push(Math.abs(a));
          break;
        }
        case 'sin': {
          const a = stack.pop();
          if (a === undefined) throw new Error('公式語法錯誤');
          stack.push(Math.sin(a));
          break;
        }
        case 'cos': {
          const a = stack.pop();
          if (a === undefined) throw new Error('公式語法錯誤');
          stack.push(Math.cos(a));
          break;
        }
        case 'log': {
          const a = stack.pop();
          if (a === undefined) throw new Error('公式語法錯誤');
          stack.push(Math.log(a));
          break;
        }
        case 'atan2': {
          const y = stack.pop();
          const x = stack.pop();
          if (x === undefined || y === undefined) throw new Error('公式語法錯誤');
          stack.push(Math.atan2(x, y));
          break;
        }
      }
    }
  }

  if (stack.length !== 1) {
    throw new Error('公式求值失敗，堆疊殘留多個結果');
  }
  return stack[0];
}

// ─── 主執行引擎 ──────────────────────────────────────────────────────────────

interface Operation {
  type: string;
  inputs: Array<string | number>;
  output: string;
  reference?: string;
  formula?: string;
  variables?: Record<string, string | number>;
  params?: Record<string, any>;
}

interface CustomCalcConfig {
  id: string;
  name: string;
  operations: Operation[];
}

/**
 * 執行客製運算鏈
 * @param config 客製運算 JSON 設定
 * @param getRawData 獲取原始 ULog Topic 資料的 Callback
 */
export function executeCustomCalculation(
  config: CustomCalcConfig,
  getRawData: (topicName: string) => { timestamps: Float64Array; fields: Record<string, Float32Array> } | null
): { timestamps: Float64Array; values: Float32Array } {
  
  // 用於儲存各步驟生成的陣列 (或時間軸)
  // key: "outputVar" -> { timestamps: Float64Array, data: Float32Array }
  const varStore: Record<string, { timestamps: Float64Array; data: Float32Array }> = {};

  // 取得變數的輔助方法 (可從 ULog Topic 或 varStore 中獲取)
  const getVariable = (
    key: string
  ): { timestamps: Float64Array; data: Float32Array } => {
    if (varStore[key]) {
      return varStore[key];
    }

    // 解析 "topic_name.field_name"
    const dotIdx = key.indexOf('.');
    if (dotIdx < 0) {
      throw new Error(`找不到變數或無效的 Topic 欄位路徑: ${key}`);
    }
    const topicName = key.substring(0, dotIdx);
    const fieldName = key.substring(dotIdx + 1);

    const raw = getRawData(topicName);
    if (!raw) {
      throw new Error(`無法載入 ULog 中的 Topic: ${topicName}`);
    }

    const fieldData = raw.fields[fieldName];
    if (!fieldData) {
      throw new Error(`在 Topic: ${topicName} 中找不到欄位: ${fieldName}`);
    }

    return {
      timestamps: raw.timestamps,
      data: fieldData,
    };
  };

  let lastOutputTimestamps = new Float64Array(0);
  let lastOutputData = new Float32Array(0);

  for (const op of config.operations) {
    switch (op.type) {
      case 'add':
      case 'subtract':
      case 'multiply':
      case 'divide':
      case 'power': {
        if (op.inputs.length < 2) {
          throw new Error(`${op.type} 運算子至少需要兩個輸入`);
        }
        
        const in0 = op.inputs[0];
        const in1 = op.inputs[1];

        // 讀取第一個輸入
        const isNum0 = typeof in0 === 'number';
        const var0 = isNum0 ? null : getVariable(in0 as string);
        
        // 讀取第二個輸入
        const isNum1 = typeof in1 === 'number';
        const var1 = isNum1 ? null : getVariable(in1 as string);

        if (isNum0 && isNum1) {
          // 純常數運算
          const val0 = in0 as number;
          const val1 = in1 as number;
          let res = 0;
          if (op.type === 'add') res = val0 + val1;
          else if (op.type === 'subtract') res = val0 - val1;
          else if (op.type === 'multiply') res = val0 * val1;
          else if (op.type === 'divide') res = val0 / val1;
          else if (op.type === 'power') res = Math.pow(val0, val1);
          
          lastOutputTimestamps = new Float64Array([0]);
          lastOutputData = new Float32Array([res]);
        } else {
          // 向量與常數，或向量與向量
          const activeVar = var0 || var1!;
          const n = activeVar.data.length;
          const outData = new Float32Array(n);
          lastOutputTimestamps = activeVar.timestamps;

          for (let i = 0; i < n; i++) {
            const val0 = isNum0 ? (in0 as number) : var0!.data[i];
            const val1 = isNum1 ? (in1 as number) : var1!.data[i];
            
            if (op.type === 'add') outData[i] = val0 + val1;
            else if (op.type === 'subtract') outData[i] = val0 - val1;
            else if (op.type === 'multiply') outData[i] = val0 * val1;
            else if (op.type === 'divide') outData[i] = val0 / val1;
            else if (op.type === 'power') outData[i] = Math.pow(val0, val1);
          }
          lastOutputData = outData;
        }

        varStore[op.output] = {
          timestamps: lastOutputTimestamps,
          data: lastOutputData,
        };
        break;
      }

      case 'norm': {
        if (op.inputs.length !== 3) {
          throw new Error('norm 運算需要剛好 3 個輸入軸 (X, Y, Z)');
        }
        const vX = getVariable(op.inputs[0] as string);
        const vY = getVariable(op.inputs[1] as string);
        const vZ = getVariable(op.inputs[2] as string);

        // 以 X 時間軸為基準
        const yAligned = interpolateSeries(vY.timestamps, vY.data, vX.timestamps);
        const zAligned = interpolateSeries(vZ.timestamps, vZ.data, vX.timestamps);

        lastOutputTimestamps = vX.timestamps;
        lastOutputData = computeNorm(vX.data, yAligned, zAligned);

        varStore[op.output] = {
          timestamps: lastOutputTimestamps,
          data: lastOutputData,
        };
        break;
      }

      case 'interpolate': {
        if (op.inputs.length !== 1 || !op.reference) {
          throw new Error('interpolate 需要 1 個輸入並指定 reference 變數');
        }
        const src = getVariable(op.inputs[0] as string);
        const ref = getVariable(op.reference);

        lastOutputTimestamps = ref.timestamps;
        lastOutputData = interpolateSeries(src.timestamps, src.data, ref.timestamps);

        varStore[op.output] = {
          timestamps: lastOutputTimestamps,
          data: lastOutputData,
        };
        break;
      }

      case 'lowpass': {
        if (op.inputs.length !== 1) {
          throw new Error('lowpass 濾波器需要 1 個輸入');
        }
        const cutoff = op.params?.cutoff_hz || 20.0;
        const src = getVariable(op.inputs[0] as string);

        lastOutputTimestamps = src.timestamps;
        lastOutputData = applyLowPass(src.data, src.timestamps, cutoff);

        varStore[op.output] = {
          timestamps: lastOutputTimestamps,
          data: lastOutputData,
        };
        break;
      }

      case 'fft': {
        if (op.inputs.length !== 1) {
          throw new Error('fft 需要 1 個輸入');
        }
        const src = getVariable(op.inputs[0] as string);
        
        // 估算採樣頻率
        const n = src.timestamps.length;
        if (n < 4) {
          throw new Error('FFT 計算點數不足');
        }
        const dtSec = (src.timestamps[n - 1] - src.timestamps[0]) / (n - 1) / 1e6;
        const fs = 1.0 / dtSec;

        const fftResult = computeFFTAmplitude(src.data, fs);

        // FFT 特殊之處：輸出是「頻率軸」而非「時間軸」
        // 我們將 frequencies 存入 timestamps 槽以配合 uPlot 繪圖
        lastOutputTimestamps = fftResult.frequencies;
        lastOutputData = fftResult.amplitudes;

        varStore[op.output] = {
          timestamps: lastOutputTimestamps,
          data: lastOutputData,
        };
        break;
      }

      case 'expression': {
        if (!op.formula || !op.variables) {
          throw new Error('expression 運算需要提供 formula 與 variables 映射');
        }

        // 解析與編譯 RPN 公式
        const tokens = tokenize(op.formula);
        const rpn = toRPN(tokens);

        // 綁定所有變數序列
        const boundVars: Record<string, { isNum: boolean; val: number; timestamps: Float64Array; data: Float32Array }> = {};
        let refTimestamps: Float64Array | null = null;
        let dataLength = 0;

        for (const [varName, varSrc] of Object.entries(op.variables)) {
          if (typeof varSrc === 'number') {
            boundVars[varName] = {
              isNum: true,
              val: varSrc,
              timestamps: new Float64Array(0),
              data: new Float32Array(0),
            };
          } else {
            const v = getVariable(varSrc);
            boundVars[varName] = {
              isNum: false,
              val: 0,
              timestamps: v.timestamps,
              data: v.data,
            };
            if (!refTimestamps) {
              refTimestamps = v.timestamps;
              dataLength = v.data.length;
            }
          }
        }

        if (!refTimestamps) {
          // 純常數運算
          const evalVars: Record<string, number> = {};
          for (const [k, v] of Object.entries(boundVars)) {
            evalVars[k] = v.val;
          }
          const res = evaluateRPN(rpn, evalVars);
          lastOutputTimestamps = new Float64Array([0]);
          lastOutputData = new Float32Array([res]);
        } else {
          // 向量多項式運算，將非基準時間軸的序列全數插值對齊
          const alignedVars: Record<string, Float32Array> = {};
          for (const [varName, info] of Object.entries(boundVars)) {
            if (info.isNum) continue;
            if (info.timestamps === refTimestamps) {
              alignedVars[varName] = info.data;
            } else {
              alignedVars[varName] = interpolateSeries(info.timestamps, info.data, refTimestamps);
            }
          }

          const outData = new Float32Array(dataLength);
          lastOutputTimestamps = refTimestamps;

          const evalVars: Record<string, number> = {};
          
          // 執行逐點公式計算
          for (let i = 0; i < dataLength; i++) {
            // 綁定第 i 個元素
            for (const [varName, info] of Object.entries(boundVars)) {
              if (info.isNum) {
                evalVars[varName] = info.val;
              } else {
                evalVars[varName] = alignedVars[varName][i];
              }
            }
            outData[i] = evaluateRPN(rpn, evalVars);
          }
          
          lastOutputData = outData;
        }

        varStore[op.output] = {
          timestamps: lastOutputTimestamps,
          data: lastOutputData,
        };
        break;
      }

      default:
        throw new Error(`未知的運算型別: ${op.type}`);
    }
  }

  return {
    timestamps: lastOutputTimestamps,
    values: lastOutputData,
  };
}
