/**
 * LTTB (Largest-Triangle-Three-Buckets) 降採樣演算法
 * 在保留視覺特徵的前提下大幅減少繪圖點數。
 */
export function lttbDownsample(
  xs: Float64Array,
  ys: Float32Array | Float64Array,
  threshold: number
): { xs: Float64Array; ys: Float64Array } {
  const len = xs.length;
  if (threshold >= len || threshold < 3) {
    return {
      xs: new Float64Array(xs),
      ys: new Float64Array(ys),
    };
  }

  const outX = new Float64Array(threshold);
  const outY = new Float64Array(threshold);

  // 桶大小
  const bucketSize = (len - 2) / (threshold - 2);

  let a = 0;
  outX[0] = xs[0];
  outY[0] = ys[0];

  for (let i = 0; i < threshold - 2; i++) {
    // 下一個桶的平均值（作為第三個點）
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len);
    const avgRangeLen = avgRangeEnd - avgRangeStart;

    let avgX = 0;
    let avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += xs[j];
      avgY += Number(ys[j]);
    }
    avgX /= avgRangeLen;
    avgY /= avgRangeLen;

    // 目前桶的範圍
    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, len);

    const aX = xs[a];
    const aY = Number(ys[a]);

    let maxArea = -1;
    let maxIdx = rangeStart;

    for (let j = rangeStart; j < rangeEnd; j++) {
      // 三角形面積（有號面積絕對值）
      const area = Math.abs(
        (aX - avgX) * (Number(ys[j]) - aY) -
        (aX - xs[j]) * (avgY - aY)
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }

    outX[i + 1] = xs[maxIdx];
    outY[i + 1] = Number(ys[maxIdx]);
    a = maxIdx;
  }

  outX[threshold - 1] = xs[len - 1];
  outY[threshold - 1] = Number(ys[len - 1]);

  return { xs: outX, ys: outY };
}

/**
 * LTTB (Largest-Triangle-Three-Buckets) 索引提取
 * 針對多欄位對齊的情境，回傳應保留的資料索引。
 */
export function getLttbIndices(
  xs: Float64Array,
  ys: Float32Array | Float64Array,
  threshold: number
): Int32Array {
  const len = xs.length;
  if (threshold >= len || threshold < 3) {
    const indices = new Int32Array(len);
    for (let i = 0; i < len; i++) indices[i] = i;
    return indices;
  }

  const indices = new Int32Array(threshold);
  const bucketSize = (len - 2) / (threshold - 2);

  let a = 0;
  indices[0] = 0;

  for (let i = 0; i < threshold - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, len);
    const avgRangeLen = avgRangeEnd - avgRangeStart;

    let avgX = 0;
    let avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += xs[j];
      avgY += Number(ys[j]);
    }
    avgX /= avgRangeLen;
    avgY /= avgRangeLen;

    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, len);

    const aX = xs[a];
    const aY = Number(ys[a]);

    let maxArea = -1;
    let maxIdx = rangeStart;

    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (aX - avgX) * (Number(ys[j]) - aY) -
        (aX - xs[j]) * (avgY - aY)
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }

    indices[i + 1] = maxIdx;
    a = maxIdx;
  }

  indices[threshold - 1] = len - 1;
  return indices;
}


/**
 * 在指定時間範圍內做 Slice（二分搜索，O(log n)）
 */
export function sliceByTimeRange(
  timestamps: Float64Array,
  startUs: number,
  endUs: number
): [number, number] {
  let lo = 0;
  let hi = timestamps.length;

  // 找 startIdx
  let left = 0, right = timestamps.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (timestamps[mid] < startUs) left = mid + 1;
    else right = mid;
  }
  const startIdx = left;

  // 找 endIdx
  left = 0; right = timestamps.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (timestamps[mid] <= endUs) left = mid + 1;
    else right = mid;
  }
  const endIdx = left;

  return [startIdx, endIdx];
}

/**
 * 線性插值，在 timestamps 中找 targetUs 對應的 Y 值
 */
export function interpolateAt(
  timestamps: Float64Array,
  values: Float32Array | Float64Array,
  targetUs: number
): number {
  if (timestamps.length === 0) return 0;
  if (targetUs <= timestamps[0]) return Number(values[0]);
  if (targetUs >= timestamps[timestamps.length - 1]) return Number(values[values.length - 1]);

  // 二分搜索找插值點
  let lo = 0;
  let hi = timestamps.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (timestamps[mid] <= targetUs) lo = mid;
    else hi = mid;
  }

  const t0 = timestamps[lo];
  const t1 = timestamps[hi];
  const ratio = (targetUs - t0) / (t1 - t0);
  return Number(values[lo]) + ratio * (Number(values[hi]) - Number(values[lo]));
}

/**
 * 格式化微秒時間為相對秒數字串
 */
export function formatRelativeTime(us: number, startUs: number = 0): string {
  const secs = (us - startUs) / 1e6;
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(3);
  return m > 0 ? `${m}:${s.padStart(6, '0')}` : `${s}s`;
}

/**
 * 格式化微秒時間為 UTC 時間字串
 */
export function formatUtcTime(us: number): string {
  const date = new Date(us / 1000);
  const pad = (n: number, len = 2) => n.toString().padStart(len, '0');
  const ms = (us % 1000000) / 1000;
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${ms.toFixed(0).padStart(3, '0')}`
  );
}

/**
 * 格式化飛行時長（微秒→ mm:ss）
 */
export function formatDuration(us: number): string {
  const secs = Math.floor(us / 1e6);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 四元數轉尤拉角 (弧度)
 */
export function quatToEuler(q0: number, q1: number, q2: number, q3: number): [number, number, number] {
  // 返回 [roll, pitch, yaw]
  const roll = Math.atan2(2 * (q0 * q1 + q2 * q3), 1 - 2 * (q1 * q1 + q2 * q2));
  const sinp = 2 * (q0 * q2 - q3 * q1);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  const yaw = Math.atan2(2 * (q0 * q3 + q1 * q2), 1 - 2 * (q2 * q2 + q3 * q3));
  return [roll, pitch, yaw];
}
