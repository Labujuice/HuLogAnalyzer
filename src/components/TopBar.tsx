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

        {/* GitHub & Version links */}
        <div className={styles.links}>
          <a
            href="https://github.com/Labujuice/HuLogAnalyzer"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
            title="GitHub"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12c0-5.523-4.477-10-10-10z" />
            </svg>
          </a>
          <span className={styles.divider}>·</span>
          <a
            href={language === 'zh' ? './UPDATE_LOG.md' : './UPDATE_LOG_EN.md'}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.link}
            title={language === 'zh' ? '更新日誌' : 'Changelog'}
          >
            v1.2.1_20260707
          </a>
          <span className={styles.divider}>|</span>
        </div>

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
