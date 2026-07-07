/**
 * 進階數學與訊號處理工具模組
 */
import { largestPowerOfTwo, complexFFT, complexIFFT, applyHanningWindow, detrend } from './fft';


/**
 * 計算三維向量模長 (Vector Norm)：sqrt(x^2 + y^2 + z^2)
 */
export function computeNorm(
  x: Float32Array | Float64Array,
  y: Float32Array | Float64Array,
  z: Float32Array | Float64Array
): Float32Array {
  const n = x.length;
  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const valX = x[i] || 0;
    const valY = y[i] || 0;
    const valZ = z[i] || 0;
    result[i] = Math.sqrt(valX * valX + valY * valY + valZ * valZ);
  }
  return result;
}

/**
 * 線性插值對齊 (Time Series Interpolation)：
 * 將源序列的值 (sourceVal) 基於其時間戳 (sourceTime)，插值對齊到參考時間軸 (targetTime)
 */
export function interpolateSeries(
  sourceTime: Float64Array,
  sourceVal: Float32Array | Float64Array,
  targetTime: Float64Array
): Float32Array {
  const targetN = targetTime.length;
  const result = new Float32Array(targetN);
  if (sourceTime.length === 0 || sourceVal.length === 0) {
    return result;
  }

  const sourceN = sourceTime.length;
  let sourceIdx = 0;

  for (let i = 0; i < targetN; i++) {
    const t = targetTime[i];

    // 邊界條件
    if (t <= sourceTime[0]) {
      result[i] = sourceVal[0];
      continue;
    }
    if (t >= sourceTime[sourceN - 1]) {
      result[i] = sourceVal[sourceN - 1];
      continue;
    }

    // 沿著時間推進尋找插值點 (利用遞增特性優化，O(N) 雙指標對齊)
    while (sourceIdx < sourceN - 1 && sourceTime[sourceIdx + 1] < t) {
      sourceIdx++;
    }

    const t0 = sourceTime[sourceIdx];
    const t1 = sourceTime[sourceIdx + 1];
    const v0 = sourceVal[sourceIdx];
    const v1 = sourceVal[sourceIdx + 1];

    if (t1 === t0) {
      result[i] = v0;
    } else {
      const ratio = (t - t0) / (t1 - t0);
      result[i] = v0 + ratio * (v1 - v0);
    }
  }

  return result;
}

/**
 * 計算均方根誤差 (RMSE)：評估兩組對齊數據的絕對偏離值
 */
export function computeRMSE(
  actual: Float32Array,
  target: Float32Array
): number {
  const n = Math.min(actual.length, target.length);
  if (n === 0) return 0;

  let sumSqErr = 0;
  for (let i = 0; i < n; i++) {
    const err = actual[i] - target[i];
    sumSqErr += err * err;
  }
  return Math.sqrt(sumSqErr / n);
}

/**
 * 計算皮爾森相關係數 (Pearson Correlation Coefficient)：評估運動波形響應的相似度
 */
export function computeCorrelation(
  x: Float32Array,
  y: Float32Array
): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

/**
 * 互相關延遲估算 (Lag Detection)：
 * 通過互相關 (Cross-correlation) 計算使 actual 與 target 最匹配的微秒延遲量
 * @returns 延遲微秒數 (正數代表 actual 滯後於 target)
 */
export function detectLagUs(
  actual: Float32Array,
  target: Float32Array,
  timestamps: Float64Array
): number {
  const n = Math.min(actual.length, target.length, timestamps.length);
  if (n < 10) return 0;

  // 計算平均採樣間隔 (微秒)
  const dtUs = (timestamps[n - 1] - timestamps[0]) / (n - 1);
  if (dtUs <= 0) return 0;

  // 設定最大搜索偏置為正負 100 個資料點 (e.g., 200Hz 下約正負 500ms)
  const maxShift = Math.min(100, Math.floor(n / 3));
  let bestShift = 0;
  let maxCov = -Infinity;

  // 計算平均值
  let meanAct = 0, meanTgt = 0;
  for (let i = 0; i < n; i++) {
    meanAct += actual[i];
    meanTgt += target[i];
  }
  meanAct /= n;
  meanTgt /= n;

  // 預先去中心化以提昇內層循環運算效能
  const actZeroMean = new Float32Array(n);
  const tgtZeroMean = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    actZeroMean[i] = actual[i] - meanAct;
    tgtZeroMean[i] = target[i] - meanTgt;
  }

  // 搜尋互相關最大值 (優化循環邊界以利 JIT 優化與向量化)
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let cov = 0;
    const start = Math.max(0, -shift);
    const end = Math.min(n, n - shift);
    
    for (let i = start; i < end; i++) {
      cov += actZeroMean[i] * tgtZeroMean[i + shift];
    }
    
    const count = end - start;
    if (count > 0) {
      cov /= count;
      if (cov > maxCov) {
        maxCov = cov;
        bestShift = shift;
      }
    }
  }

  // bestShift > 0 代表 actual[i] 對應 target[i + shift] (未來的值)，表示 actual 訊號發生滯後
  return bestShift * dtUs;
}

/**
 * 使用維納反褶積 (Wiener Deconvolution) 進行系統識別，估計脈衝響應
 * @param input 期望值 (Setpoint) 陣列
 * @param output 實際值 (Actual Feedback) 陣列
 * @param timestamps 時間戳 (微秒)
 * @param snr 信噪比正則化參數 (例如 100)
 */
export function estimateImpulseResponse(
  input: Float32Array,
  output: Float32Array,
  timestamps: Float64Array,
  snr: number
): Float32Array {
  const rawN = input.length;
  const n = largestPowerOfTwo(rawN);
  if (n < 4) return new Float32Array(0);

  // 1. 計算差分微分（變化率）以去除直流偏置並保留高頻暫態
  let u_d = new Float32Array(n);
  let y_d = new Float32Array(n);

  for (let i = 1; i < n; i++) {
    const dt = (timestamps[i] - timestamps[i - 1]) / 1e6;
    if (dt > 0 && dt < 1.0) {
      u_d[i] = (input[i] - input[i - 1]) / dt;
      y_d[i] = (output[i] - output[i - 1]) / dt;
    }
  }

  // 2. 套用漢寧窗 (Hanning Window) 降低頻域邊界洩漏
  const u_windowed = applyHanningWindow(u_d);
  const y_windowed = applyHanningWindow(y_d);

  // 3. 準備實部與虛部進行 FFT
  const uReal = new Float32Array(u_windowed);
  const uImag = new Float32Array(n);
  const yReal = new Float32Array(y_windowed);
  const yImag = new Float32Array(n);

  complexFFT(uReal, uImag);
  complexFFT(yReal, yImag);

  // 4. 維納濾波反褶積 H(f) = (Y * U*) / (|U|^2 + 1/SNR)
  const hReal = new Float32Array(n);
  const hImag = new Float32Array(n);
  const nsr = 1.0 / snr;

  for (let k = 0; k < n; k++) {
    const ur = uReal[k];
    const ui = uImag[k];
    const yr = yReal[k];
    const yi = yImag[k];

    const uPower = ur * ur + ui * ui;
    const den = uPower + nsr;

    hReal[k] = (yr * ur + yi * ui) / den;
    hImag[k] = (yi * ur - yr * ui) / den;
  }

  // 5. 逆快速傅立葉變換 (IFFT) 轉回時域，得到脈衝響應
  complexIFFT(hReal, hImag);

  return hReal; // 脈衝響應 h(t)
}

/**
 * 對脈衝響應進行數值積分，以獲得階躍響應
 * @param impulseResponse 脈衝響應陣列
 */
export function integrateImpulseResponse(
  impulseResponse: Float32Array
): Float32Array {
  const n = impulseResponse.length;
  const stepResponse = new Float32Array(n);
  
  let sum = 0;
  for (let i = 0; i < n; i++) {
    // 數值積分: 累加離散脈衝響應得到離散階躍響應。
    // 由於輸入已作歸一化差分，這裡直接累加即為無量綱的歸一化階躍響應。
    sum += impulseResponse[i];
    stepResponse[i] = sum;
  }

  return stepResponse;
}

