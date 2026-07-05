/**
 * FFT (快速傅立葉變換) 數值計算模組
 * 
 * 包含：去直流分量 (De-trending)、漢寧窗 (Hanning Window) 加窗處理、
 * 迭代式 Cooley-Tukey Radix-2 FFT、與振幅頻譜計算。
 */

/**
 * 尋找小於或等於給定長度的最大 2 的冪次方 (Radix-2 FFT 點數)
 */
export function largestPowerOfTwo(n: number): number {
  if (n < 2) return 0;
  let p = 1;
  while (p * 2 <= n) {
    p *= 2;
  }
  return p;
}

/**
 * 判斷是否為 2 的冪次方
 */
export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * 去直流分量 (De-trending)：減去訊號平均值以移除 0Hz 附近的直流偏置
 */
export function detrend(data: Float32Array): Float32Array {
  const n = data.length;
  if (n === 0) return data;
  
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += data[i];
  }
  const mean = sum / n;

  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = data[i] - mean;
  }
  return result;
}

/**
 * 加漢寧窗 (Hanning Window)：降低頻譜洩漏，平滑化邊界訊號
 */
export function applyHanningWindow(data: Float32Array): Float32Array {
  const n = data.length;
  const result = new Float32Array(n);
  if (n <= 1) return result;

  for (let i = 0; i < n; i++) {
    // w_i = 0.5 * (1 - cos(2 * pi * i / (n - 1)))
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    result[i] = data[i] * w;
  }
  return result;
}

/**
 * 位元反轉排列 (Bit Reversal Permutation)
 * 將陣列重排以供 Cooley-Tukey 原地 (In-place) 運算
 */
function bitReversePermutation(real: Float32Array, imag: Float32Array) {
  const n = real.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      // 交換 real
      const tempReal = real[i];
      real[i] = real[j];
      real[j] = tempReal;
      // 交換 imag
      const tempImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tempImag;
    }
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
  }
}

/**
 * 原地 (In-place) 複數快速傅立葉變換 (Cooley-Tukey Radix-2 FFT)
 * @param real 實部陣列 (長度必須為 2 的冪次方)
 * @param imag 虛部陣列 (長度與實部相同)
 */
export function complexFFT(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if (!isPowerOfTwo(n)) {
    throw new Error('FFT 長度必須是 2 的冪次方');
  }

  // 1. 重排輸入訊號
  bitReversePermutation(real, imag);

  // 2. 迭代蝶形運算 (Butterfly stages)
  // 預先計算旋轉因子 (Twiddle Factors) 提昇性能
  for (let size = 2; size <= n; size *= 2) {
    const half = size >> 1;
    const tabReal = Math.cos((2 * Math.PI) / size);
    const tabImag = -Math.sin((2 * Math.PI) / size); // -sin 代表向前變換 FFT

    for (let i = 0; i < n; i += size) {
      let wr = 1.0;
      let wi = 0.0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = i + j + half;

        // t = w * data[b]
        const tr = wr * real[b] - wi * imag[b];
        const ti = wr * imag[b] + wi * real[b];

        // data[b] = data[a] - t
        real[b] = real[a] - tr;
        imag[b] = imag[a] - ti;

        // data[a] = data[a] + t
        real[a] = real[a] + tr;
        imag[a] = imag[a] + ti;

        // w = w * twiddle
        const nextWr = wr * tabReal - wi * tabImag;
        const nextWi = wr * tabImag + wi * tabReal;
        wr = nextWr;
        wi = nextWi;
      }
    }
  }
}

/**
 * 計算實數訊號的單邊幅值頻譜 (Single-Sided Amplitude Spectrum)
 * @param timeData 時域實數數據
 * @param sampleRate 採樣頻率 (Hz)
 * @returns frequencies: 頻率軸 (Hz) 陣列, amplitudes: 頻譜幅值陣列
 */
export function computeFFTAmplitude(
  timeData: Float32Array,
  sampleRate: number
): { frequencies: Float64Array; amplitudes: Float32Array } {
  const rawN = timeData.length;
  const n = largestPowerOfTwo(rawN);

  if (n < 4) {
    return {
      frequencies: new Float64Array(0),
      amplitudes: new Float32Array(0),
    };
  }

  // 截斷資料至 2 的冪次方，避免 zero-padding 的頻譜人造失真
  let subData = timeData.subarray(0, n);
  
  // 1. 直流分量消除 (De-trend)
  subData = detrend(subData);

  // 2. 加漢寧窗 (Hanning Window)
  subData = applyHanningWindow(subData);

  // 3. 準備實部與虛部
  const real = new Float32Array(subData);
  const imag = new Float32Array(n); // 初始為零

  // 4. 進行 FFT
  complexFFT(real, imag);

  // 5. 計算單邊頻譜幅值 (0 ~ fs/2)
  const halfN = n / 2;
  const frequencies = new Float64Array(halfN);
  const amplitudes = new Float32Array(halfN);

  // 頻率軸解析度 (df = fs / n)
  const df = sampleRate / n;

  for (let k = 0; k < halfN; k++) {
    frequencies[k] = k * df;
    
    // 計算模長 |X(f)|
    const magnitude = Math.sqrt(real[k] * real[k] + imag[k] * imag[k]);
    
    // 單邊幅值：
    // 對於 k > 0，幅值為 2 * |X(f)| / n
    // 對於 k = 0，幅值為 |X(0)| / n
    if (k === 0) {
      amplitudes[k] = magnitude / n;
    } else {
      amplitudes[k] = (2 * magnitude) / n;
    }
  }

  return { frequencies, amplitudes };
}
