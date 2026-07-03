import React from 'react';
import { useApp } from '../store/appStore';
import styles from './ParseProgress.module.css';

export function ParseProgress() {
  const { state } = useApp();
  const pct = Math.round(state.progress * 100);

  return (
    <div className={styles.root}>
      <div className={styles.bgGrid} aria-hidden />
      <div className={styles.card}>
        {/* 動態 Spinner */}
        <div className={styles.spinnerWrap}>
          <div className={styles.spinnerOuter} />
          <div className={styles.spinnerInner} />
          <svg className={styles.spinnerIcon} viewBox="0 0 24 24" fill="none">
            <path d="M12 2L12 6M12 18L12 22M2 12L6 12M18 12L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.8"/>
          </svg>
        </div>

        <div className={styles.title}>正在解析 ULog 飛行日誌</div>
        <div className={styles.stage}>{state.progressStage || '初始化中...'}</div>

        {/* 進度條 */}
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${pct}%` }} />
            <div className={styles.progressGlow} style={{ left: `${pct}%` }} />
          </div>
          <div className={styles.progressPct}>{pct}%</div>
        </div>

        <div className={styles.hint}>
          所有運算在您的瀏覽器本地執行，資料不會上傳至任何伺服器
        </div>
      </div>
    </div>
  );
}
