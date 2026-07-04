import React from 'react';
import { useApp } from '../store/appStore';
import { formatDuration } from '../parser/utils';
import styles from './TopBar.module.css';

export function TopBar() {
  const { state, dispatch } = useApp();
  const { summary, language } = state;

  return (
    <header className={styles.root}>
      {/* 左側：Logo + 檔案資訊 */}
      <div className={styles.left}>
        <div className={styles.logo}>
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="14" stroke="url(#topGrad)" strokeWidth="2"/>
            <path d="M16 4 L28 10 L28 22 L16 28 L4 22 L4 10 Z" stroke="url(#topGrad)" strokeWidth="1.2" fill="none"/>
            <circle cx="16" cy="16" r="4" fill="url(#topGrad)"/>
            <defs>
              <linearGradient id="topGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#60a5fa"/>
                <stop offset="100%" stopColor="#a78bfa"/>
              </linearGradient>
            </defs>
          </svg>
          <span className={styles.logoText}>ULog Analyzer</span>
        </div>

        {summary && (
          <div className={styles.fileInfo}>
            <span className={styles.separator}>|</span>
            <span className={styles.hw} title={language === 'en' ? 'Hardware Version' : '硬體版本'}>
              {summary.metadata.hardwareVersion}
            </span>
            <span className={styles.separator}>·</span>
            <span className={styles.fw} title={language === 'en' ? 'Firmware Version' : '韌體版本'}>
              {summary.metadata.softwareVersion}
            </span>
            <span className={styles.separator}>·</span>
            <span className={styles.dur} title={language === 'en' ? 'Flight Duration' : '飛行時長'}>
              ⏱ {formatDuration(summary.durationUs)}
            </span>
          </div>
        )}
      </div>

      {/* 右側：語言切換 + 操作按鈕 */}
      <div className={styles.right}>
        {summary && (
          <div className={styles.topicCount}>
            <span className="badge badge--blue">
              {summary.topics.length} {language === 'en' ? 'Topics' : '主題'}
            </span>
            <span className="badge badge--gray">
              {summary.messages.length} {language === 'en' ? 'Msgs' : '日誌'}
            </span>
          </div>
        )}

        <select
          value={language}
          onChange={(e) => dispatch({ type: 'SET_LANGUAGE', language: e.target.value as any })}
          className={styles.langSelect}
          title={language === 'en' ? 'Select Language' : '選擇語言'}
        >
          <option value="en">English</option>
          <option value="zh">繁體中文</option>
        </select>

        {summary && (
          <button
            className="btn btn--ghost"
            onClick={() => dispatch({ type: 'RESET' })}
            title={language === 'en' ? 'Load new file' : '載入新檔案'}
            id="btn-load-new"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            {language === 'en' ? 'Load File' : '載入新檔案'}
          </button>
        )}
      </div>
    </header>
  );
}
