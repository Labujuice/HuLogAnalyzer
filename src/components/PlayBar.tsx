import React, { useEffect, useRef, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { timePublisher } from '../store/timePublisher';
import { formatRelativeTime, formatUtcTime } from '../parser/utils';
import styles from './PlayBar.module.css';

const SPEEDS = [0.25, 0.5, 1, 2, 5, 10];

export function PlayBar() {
  const { state, dispatch } = useApp();
  const { playback, language } = state;
  
  const setPlayback = useCallback((p: Partial<typeof playback>) => {
    dispatch({ type: 'SET_PLAYBACK', playback: p });
  }, [dispatch]);

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

    // 同步外部尋軌 (例如手動拖動進度條)
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

    // 1. 每幀 (60fps) 直接用原生 DOM 操作更新時間文字與進度條，跳過 React render 負載
    if (currentTimeTextRef.current) {
      currentTimeTextRef.current.textContent = formatTime(nextTimeUs);
    }
    if (progressFillRef.current && progressThumbRef.current && duration > 0) {
      const pct = Math.min(100, Math.max(0, ((nextTimeUs - startTimeUs) / duration) * 100));
      progressFillRef.current.style.width = `${pct}%`;
      progressThumbRef.current.style.left = `${pct}%`;
    }

    // 2. 每幀 (60fps) 透過純 JS PubSub 發佈事件，驅動 ThreeJS、Canvas 與 Leaflet
    timePublisher.setTime(nextTimeUs);

    // 3. 每 500ms (2Hz) Throttled 寫入 React AppStore 全域狀態，僅同步其他低頻 React 元件
    if (now - lastStateUpdateMsRef.current > 500) {
      lastDispatchedTimeRef.current = nextTimeUs;
      setPlayback({ currentTimeUs: nextTimeUs });
      lastStateUpdateMsRef.current = now;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [setPlayback, formatTime, startTimeUs, duration]);

  // 監聽播放狀態
  useEffect(() => {
    if (isPlaying) {
      lastTsRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, tick]);

  // 監聽外部手動時間點跳轉 (進度條/圖表 Cursor)
  useEffect(() => {
    const handleTimeTick = (timeUs: number) => {
      const p = playbackRef.current;
      // 如果不是播放中，直接渲染定位點
      if (!p.isPlaying) {
        if (currentTimeTextRef.current) {
          currentTimeTextRef.current.textContent = formatTime(timeUs);
        }
        if (progressFillRef.current && progressThumbRef.current && duration > 0) {
          const pct = Math.min(100, Math.max(0, ((timeUs - startTimeUs) / duration) * 100));
          progressFillRef.current.style.width = `${pct}%`;
          progressThumbRef.current.style.left = `${pct}%`;
        }
      }
    };
    const unsubscribe = timePublisher.subscribe(handleTimeTick);
    // 初始位置
    handleTimeTick(timePublisher.getTime());
    return unsubscribe;
  }, [formatTime, startTimeUs, duration]);

  // 點擊進度條尋軌
  const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const targetUs = startTimeUs + duration * pct;

    timePublisher.setTime(targetUs);
    setPlayback({ currentTimeUs: targetUs });
  };

  return (
    <div className={styles.root}>
      {/* 進度條 */}
      <div
        className={styles.progressWrap}
        onClick={onProgressClick}
        role="slider"
        aria-label={language === 'en' ? 'Playback Progress' : '播放進度'}
      >
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
            title={language === 'en' ? 'Back to Start' : '回到起點'}
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
            title={isPlaying ? (language === 'en' ? 'Pause' : '暫停') : (language === 'en' ? 'Play' : '播放')}
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
              title={language === 'en' ? `Play speed ${s}x` : `播放倍速 ${s}x`}
            >
              {s}×
            </button>
          ))}
        </div>

        {/* UTC 切換 */}
        <label className={styles.utcToggle} title={language === 'en' ? 'Toggle UTC / Relative Time' : '切換 UTC / 相對時間'}>
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
