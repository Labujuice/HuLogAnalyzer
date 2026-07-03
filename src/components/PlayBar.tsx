import React, { useEffect, useRef, useCallback } from 'react';
import { usePlayback } from '../store/appStore';
import { formatRelativeTime, formatUtcTime } from '../parser/utils';
import { NAV_STATE_MAP, ARMING_STATE_MAP } from '../types/ulog';
import styles from './PlayBar.module.css';

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10];

export function PlayBar() {
  const { playback, setPlayback } = usePlayback();
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef<number>(0);

  const {
    isPlaying, currentTimeUs, startTimeUs, endTimeUs,
    speedMultiplier, useUtcTime, utcOffsetUs,
  } = playback;

  const duration = endTimeUs - startTimeUs;
  const progress = duration > 0 ? (currentTimeUs - startTimeUs) / duration : 0;

  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  const currentTimeRef = useRef<number>(0);
  const lastDispatchedTimeRef = useRef<number>(0);

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
      return;
    }

    currentTimeRef.current = nextTimeUs;
    lastDispatchedTimeRef.current = nextTimeUs;
    setPlayback({ currentTimeUs: nextTimeUs });
    rafRef.current = requestAnimationFrame(tick);
  }, [setPlayback]);

  useEffect(() => {
    if (isPlaying) {
      currentTimeRef.current = currentTimeUs;
      lastDispatchedTimeRef.current = currentTimeUs;
      lastTsRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, tick]);

  const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlayback({ currentTimeUs: startTimeUs + ratio * duration });
  };

  const formatTime = (us: number) => {
    if (useUtcTime && utcOffsetUs !== 0) {
      return formatUtcTime(us + utcOffsetUs);
    }
    return formatRelativeTime(us, startTimeUs);
  };

  return (
    <div className={styles.root}>
      {/* 進度條 */}
      <div className={styles.progressWrap} onClick={onProgressClick} role="slider" aria-label="播放進度">
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
          <div className={styles.progressThumb} style={{ left: `${progress * 100}%` }} />
        </div>
      </div>

      {/* 控制列主體 */}
      <div className={styles.controls}>
        {/* 播放按鈕群 */}
        <div className={styles.playButtons}>
          {/* 回到起點 */}
          <button
            className="btn btn--icon btn--ghost"
            onClick={() => setPlayback({ currentTimeUs: startTimeUs, isPlaying: false })}
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
          <span className={styles.currentTime}>{formatTime(currentTimeUs)}</span>
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
