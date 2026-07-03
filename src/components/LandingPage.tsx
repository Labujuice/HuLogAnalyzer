import React, { useCallback, useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import styles from './LandingPage.module.css';

const ACCEPT_EXTS = ['.ulog', '.ulg'];

export function LandingPage() {
  const { loadFile } = useApp();
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const name = file.name.toLowerCase();
    if (!ACCEPT_EXTS.some((ext) => name.endsWith(ext))) {
      alert(`不支援的檔案格式。請選取 .ulog 或 .ulg 格式的 PX4 飛行日誌。`);
      return;
    }
    loadFile(file);
  }, [loadFile]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const onDragLeave = () => setIsDragOver(false);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className={styles.root}>
      {/* 背景裝飾 */}
      <div className={styles.bgGrid} aria-hidden />
      <div className={styles.bgGlow1} aria-hidden />
      <div className={styles.bgGlow2} aria-hidden />

      <div className={styles.content}>
        {/* Logo & Title */}
        <div className={styles.hero}>
          <div className={styles.logoWrap}>
            <svg className={styles.logoIcon} viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="30" stroke="url(#grad1)" strokeWidth="2"/>
              <path d="M32 8 L56 20 L56 44 L32 56 L8 44 L8 20 Z" stroke="url(#grad1)" strokeWidth="1.5" fill="none"/>
              <circle cx="32" cy="32" r="6" fill="url(#grad1)"/>
              {/* 螺旋槳 */}
              <ellipse cx="14" cy="14" rx="8" ry="3" fill="rgba(96,165,250,0.4)" transform="rotate(-45 14 14)"/>
              <ellipse cx="50" cy="14" rx="8" ry="3" fill="rgba(96,165,250,0.4)" transform="rotate(45 50 14)"/>
              <ellipse cx="14" cy="50" rx="8" ry="3" fill="rgba(96,165,250,0.4)" transform="rotate(45 14 50)"/>
              <ellipse cx="50" cy="50" rx="8" ry="3" fill="rgba(96,165,250,0.4)" transform="rotate(-45 50 50)"/>
              <line x1="32" y1="8" x2="32" y2="14" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="32" y1="50" x2="32" y2="56" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="8" y1="20" x2="14" y2="23" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="50" y1="41" x2="56" y2="44" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="56" y1="20" x2="50" y2="23" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="14" y1="41" x2="8" y2="44" stroke="#60a5fa" strokeWidth="1.5"/>
              <defs>
                <linearGradient id="grad1" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#60a5fa"/>
                  <stop offset="100%" stopColor="#a78bfa"/>
                </linearGradient>
              </defs>
            </svg>
            <div className={styles.logoText}>
              <span className={styles.logoMain}>ULog</span>
              <span className={styles.logoSub}>Analyzer</span>
            </div>
          </div>
          <p className={styles.tagline}>
            純前端 · 零後端 · 完全隱私<br/>
            <span>PX4 飛行日誌 ‧ 線上即時分析儀表板</span>
          </p>
        </div>

        {/* 拖放區域 */}
        <div
          className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ''}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          aria-label="拖放或點擊選取 ULog 檔案"
        >
          <div className={styles.dropIcon}>
            <svg viewBox="0 0 48 48" fill="none">
              <path d="M12 36L8 32M8 32L12 28M8 32H24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M36 12L40 16M40 16L36 20M40 16H24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M24 8V40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="4 4"/>
              <rect x="16" y="20" width="16" height="8" rx="2" fill="currentColor" opacity="0.2"/>
              <path d="M20 24H28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M24 20V28" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <p className={styles.dropText}>拖放 ULog 檔案到這裡</p>
          <p className={styles.dropSubText}>或點擊選取 .ulog / .ulg 檔案</p>
          <div className={styles.dropHint}>
            <span className="badge badge--blue">無需上傳</span>
            <span className="badge badge--green">完全本地解析</span>
            <span className="badge badge--gray">支援 &gt;300MB</span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".ulog,.ulg"
            onChange={onInputChange}
            style={{ display: 'none' }}
            id="ulog-file-input"
          />
        </div>

        {/* 功能特色 */}
        <div className={styles.features}>
          {FEATURES.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>{f.icon}</div>
              <div>
                <div className={styles.featureTitle}>{f.title}</div>
                <div className={styles.featureDesc}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: '⚡',
    title: '高效解析',
    desc: 'Web Worker 後台解析，UI 始終 60 FPS 流暢',
  },
  {
    icon: '📊',
    title: '動態儀表板',
    desc: '多面板自由分割，拖曳欄位即時繪圖',
  },
  {
    icon: '🛸',
    title: '3D 姿態回放',
    desc: 'Three.js 渲染無人機四元數即時旋轉',
  },
  {
    icon: '🔒',
    title: '完全隱私',
    desc: '資料不外傳，所有運算在本地瀏覽器完成',
  },
];
