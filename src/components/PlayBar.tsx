import React, { useEffect, useRef, useCallback } from 'react';
import { usePlayback } from '../store/appStore';
import { timePublisher } from '../store/timePublisher';
import { formatRelativeTime, formatUtcTime } from '../parser/utils';
import styles from './PlayBar.module.css';

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10];

export function PlayBar() {
  const { playback, setPlayback } = usePlayback();
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);
  const lastStateUpdateMsRef = useRef<number>(0);

  const {
    isPlaying, currentTimeUs, startTimeUs, endTimeUs,
    speedMultiplier, useUtcTime, utcOffsetUs,
  } = playback;

  const duration = endTimeUs - startTimeUs;

  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const currentTimeRef = useRef<number>(0);
  const lastDispatchedTimeRef = useRef<number>(0);

  // DOM Refs for high-performance direct manipulation
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressThumbRef = useRef<HTMLDivElement>(null);
  const currentTimeTextRef = useRef<HTMLSpanElement>(null);

  const formatTime = useCallback((us: number) => {
    if (useUtcTime && utcOffsetUs !== 0) {
      return formatUtcTime(us + utcOffsetUs);
    }
    return formatRelativeTime(us, startTimeUs);
  }, [useUtcTime, utcOffsetUs, startTimeUs]);

  // RAF 驅動播放
  const tick = useCallback((now: number) => {
    const p = playbackRef.current;
    if (!p.isPlaying) return;

    if (lastTsRef.current === 0) lastTsRef.current = now;
    const dtMs = now - lastTsRef.current;
    lastTsRef.current = now;

    // 檢測外部尋跡（如點擊進度條）：如果目前的 state 時間與我們上次 dispatch 的時間不同，說明是外部修改，進行同步
    if (Math.abs(p.currentTimeUs - lastDispatchedTimeRef.current) > 1000) {
      currentTimeRef.current = p.currentTimeUs;
    }

    const nextTimeUs = currentTimeRef.current + dtMs * 1000 * p.speedMultiplier;

    if (nextTimeUs >= p.endTimeUs) {
      setPlayback({ isPlaying: false, currentTimeUs: p.endTimeUs });
      timePublisher.setTime(p.endTimeUs);
      return;
    }

    currentTimeRef.current = nextTimeUs;
    lastDispatchedTimeRef.current = nextTimeUs;

    // 1. 直發高頻時間信號給 3D、AHRS、uPlot 與本地 DOM，完全跳過 React render 流程
    timePublisher.setTime(nextTimeUs);

    // 2. 節流 (Throttle 500ms) 寫回 React 狀態以同步其他非即時性元件
    if (now - lastStateUpdateMsRef.current > 500) {
      lastStateUpdateMsRef.current = now;
      setPlayback({ currentTimeUs: nextTimeUs });
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [setPlayback]);

  // 訂閱 timePublisher 以接收時間跳轉 (Seek / 播放更新)，同步更新進度條與文字
  useEffect(() => {
    const unsubscribe = timePublisher.subscribe((timeUs) => {
      const dur = playbackRef.current.endTimeUs - playbackRef.current.startTimeUs;
      const progress = dur > 0 ? (timeUs - playbackRef.current.startTimeUs) / dur : 0;
      const pct = `${progress * 100}%`;

      if (progressFillRef.current) {
        progressFillRef.current.style.width = pct;
      }
      if (progressThumbRef.current) {
        progressThumbRef.current.style.left = pct;
      }
      if (currentTimeTextRef.current) {
        currentTimeTextRef.current.innerText = formatTime(timeUs);
      }
    });

    // 初始位置同步
    timePublisher.setTime(currentTimeUs);

    return unsubscribe;
  }, [startTimeUs, formatTime, currentTimeUs]);

  useEffect(() => {
    if (isPlaying) {
      currentTimeRef.current = currentTimeUs;
      lastDispatchedTimeRef.current = currentTimeUs;
      lastTsRef.current = 0;
      lastStateUpdateMsRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafRef.current);
      // 暫停時立刻寫回最新最精準的目前時間
      setPlayback({ currentTimeUs: currentTimeRef.current });
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, tick, setPlayback, currentTimeUs]);

  const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetUs = startTimeUs + ratio * duration;
    
    timePublisher.setTime(targetUs);
    setPlayback({ currentTimeUs: targetUs });
  };

  return (
    <div className={styles.root}>
      {/* 進度條 */}
      <div className={styles.progressWrap} onClick={onProgressClick} role="slider" aria-label="播放進度">
        <div className={styles.progressTrack}>
          <div ref={progressFillRef} className={styles.progressFill} />
          <div ref={progressThumbRef} className={styles.progressThumb} />
        </div>
      </div>

      {/* 控制列主體 */}
      <div className={styles.controls}>
        {/* 播放按鈕群 */}
        <div className={styles.playButtons}>
          {/* 回到起點 */}
          <button
            className="btn btn--icon btn--ghost"
            onClick={() => {
              timePublisher.setTime(startTimeUs);
              setPlayback({ currentTimeUs: startTimeUs, isPlaying: false });
            }}
            title="回到起點"
            id="btn-playbar-stop"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="2" height="16" rx="1"/>
              <path d="M8 12L20 4V20L8 12Z"/>
            </svg>
          </button>

          {/* 播放/暫停 */}
          <button
            className={`btn btn--icon ${isPlaying ? 'btn--primary' : ''}`}
            style={!isPlaying ? { background: 'var(--clr-bg-elevated)', borderColor: 'var(--clr-border-strong)' } : {}}
            onClick={() => setPlayback({ isPlaying: !isPlaying })}
            title={isPlaying ? '暫停' : '播放'}
            id="btn-playbar-play"
          >
            {isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 4L20 12L6 20V4Z"/>
              </svg>
            )}
          </button>
        </div>

        {/* 時間顯示 */}
        <div className={styles.timeDisplay}>
          <span ref={currentTimeTextRef} className={styles.currentTime}>0.000s</span>
          <span className={styles.timeSep}>/</span>
          <span className={styles.totalTime}>{formatRelativeTime(endTimeUs, startTimeUs)}</span>
        </div>

        {/* 速度選擇 */}
        <div className={styles.speedGroup}>
          {SPEEDS.map(s => (
            <button
              key={s}
              className={`btn btn--ghost ${styles.speedBtn} ${speedMultiplier === s ? styles.speedActive : ''}`}
              onClick={() => setPlayback({ speedMultiplier: s })}
              id={`btn-speed-${s}`}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* UTC 切換 */}
        <label className={styles.utcToggle} title="切換 UTC / 相對時間">
          <span className={styles.utcLabel}>UTC</span>
          <div
            className={`${styles.toggle} ${useUtcTime ? styles.toggleOn : ''}`}
            onClick={() => setPlayback({ useUtcTime: !useUtcTime })}
            role="switch"
            aria-checked={useUtcTime}
            tabIndex={0}
            id="toggle-utc-time"
          >
            <div className={styles.toggleThumb} />
          </div>
        </label>
      </div>
    </div>
  );
}
