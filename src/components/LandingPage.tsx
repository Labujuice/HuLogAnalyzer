import React, { useCallback, useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import { getTranslation } from '../store/translations';
import styles from './LandingPage.module.css';

const ACCEPT_EXTS = ['.ulog', '.ulg'];

export function LandingPage() {
  const { state, dispatch, loadFile } = useApp();
  const { language } = state;
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const t = useCallback((key: any) => getTranslation(language, key), [language]);

  const handleFile = useCallback((file: File) => {
    const name = file.name.toLowerCase();
    if (!ACCEPT_EXTS.some((ext) => name.endsWith(ext))) {
      alert(
        language === 'en'
          ? 'Unsupported file format. Please select a PX4 flight log in .ulog or .ulg format.'
          : '不支援的檔案格式。請選取 .ulog 或 .ulg 格式的 PX4 飛行日誌。'
      );
      return;
    }
    loadFile(file);
  }, [loadFile, language]);

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

  // 載入預設範例日誌
  const loadSample = (filename: string) => {
    // 範例日誌路徑使用相對路徑對齊
    dispatch({ type: 'SET_STATUS', status: 'loading' });
    dispatch({ type: 'SET_PROGRESS', progress: 0.1, stage: language === 'en' ? 'Fetching sample log...' : '獲取範例日誌...' });
    
    fetch(`./${filename}`)
      .then((res) => {
        if (!res.ok) throw new Error(language === 'en' ? 'Failed to fetch sample file' : '無法獲取範例檔案');
        return res.arrayBuffer();
      })
      .then((buf) => {
        dispatch({ type: 'SET_PROGRESS', progress: 0.3, stage: language === 'en' ? 'Parsing sample log...' : '解析範例日誌...' });
        const file = new File([buf], filename);
        loadFile(file);
      })
      .catch((err) => {
        dispatch({ type: 'SET_ERROR', error: err.message });
      });
  };

  return (
    <div className={styles.root}>
      {/* 背景裝飾 */}
      <div className={styles.bgGrid} aria-hidden />
      <div className={styles.bgGlow1} aria-hidden />
      <div className={styles.bgGlow2} aria-hidden />

      {/* 語言切換浮動選單 */}
      <div className={styles.langSelector}>
        <span className={styles.langLabel}>Language / 語言:</span>
        <select
          value={language}
          onChange={(e) => dispatch({ type: 'SET_LANGUAGE', language: e.target.value as any })}
          className={styles.select}
        >
          <option value="en">English</option>
          <option value="zh">繁體中文</option>
        </select>
      </div>

      <div className={styles.content}>
        {/* Logo & Title */}
        <div className={styles.hero}>
          <div className={styles.logoWrap}>
            <svg className={styles.logoIcon} viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="30" stroke="url(#grad1)" strokeWidth="2"/>
              <path d="M32 8 L56 20 L56 44 L32 56 L8 44 L8 20 Z" stroke="url(#grad1)" strokeWidth="1.5" fill="none"/>
              <circle cx="32" cy="32" r="6" fill="url(#grad1)"/>
              <ellipse cx="14" cy="14" rx="8" ry="3" fill="rgba(96,165,250,0.4)" transform="rotate(-45 14 14)"/>
              <ellipse cx="50" cy="14" rx="8" ry="3" fill="rgba(96,165,250,0.4)" transform="rotate(45 50 14)"/>
              <ellipse cx="14" cy="50" rx="8" ry="3" fill="rgba(96,165,250,0.4)" transform="rotate(45 14 50)"/>
              <ellipse cx="50" cy="50" rx="8" ry="3" fill="rgba(96,165,250,0.4)" transform="rotate(-45 50 50)"/>
              <line x1="32" y1="8" x2="32" y2="14" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="32" y1="50" x2="32" y2="56" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="8" y1="20" x2="14" y2="23" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="50" y1="41" x2="56" y2="44" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="56" y1="20" x2="50" y2="23" stroke="#60a5fa" strokeWidth="1.5"/>
              <line x1="8" y1="44" x2="14" y2="41" stroke="#60a5fa" strokeWidth="1.5"/>
              <defs>
                <linearGradient id="grad1" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#60a5fa"/>
                  <stop offset="100%" stopColor="#c084fc"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h1 className={styles.title}>{t('landingTitle')}</h1>
          <p className={styles.subtitle}>{t('landingSub')}</p>
        </div>

        {/* 拖曳上傳區塊 */}
        <div
          className={`${styles.dropZone} ${isDragOver ? styles.dragOver : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
        >
          <input
            type="file"
            ref={inputRef}
            onChange={onInputChange}
            accept=".ulog,.ulg"
            style={{ display: 'none' }}
          />
          <div className={styles.dropIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
          </div>
          <span className={styles.dropText}>{t('dropPrompt')}</span>
          <span className={styles.dropSubText}>.ulog / .ulg (max 200MB)</span>
        </div>

        {/* 快速測試範例 */}
        <div className={styles.sampleSection}>
          <span className={styles.sampleTitle}>{t('sampleLogs')}</span>
          <div className={styles.sampleButtons}>
            <button className="btn btn--secondary btn--sm" onClick={() => loadSample('sample.ulg')}>
              🛸 Quadcopter Log (sample.ulg)
            </button>
          </div>
        </div>

        {/* 特色列表 */}
        <div className={styles.features}>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🌐</div>
            <div>
              <h3 className={styles.featureTitle}>{t('featureStaticTitle')}</h3>
              <p className={styles.featureDesc}>{t('featureStaticDesc')}</p>
            </div>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>🛡️</div>
            <div>
              <h3 className={styles.featureTitle}>{t('featurePrivateTitle')}</h3>
              <p className={styles.featureDesc}>{t('featurePrivateDesc')}</p>
            </div>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>⚡</div>
            <div>
              <h3 className={styles.featureTitle}>{t('featurePerfTitle')}</h3>
              <p className={styles.featureDesc}>{t('featurePerfDesc')}</p>
            </div>
          </div>
          <div className={styles.featureCard}>
            <div className={styles.featureIcon}>✨</div>
            <div>
              <h3 className={styles.featureTitle}>{t('featureWebGLTitle')}</h3>
              <p className={styles.featureDesc}>{t('featureWebGLDesc')}</p>
            </div>
          </div>
        </div>

        {/* Footer with GitHub link and Version/Update Logs */}
        <footer className={styles.footer}>
          <a
            href="https://github.com/Labujuice/HuLogAnalyzer"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.footerLink}
            title="GitHub"
          >
            <svg viewBox="0 0 24 24" className={styles.githubIcon}>
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12c0-5.523-4.477-10-10-10z" />
            </svg>
            GitHub
          </a>
          <span className={styles.footerDivider}>|</span>
          <a
            href={language === 'zh' ? './UPDATE_LOG.md' : './UPDATE_LOG_EN.md'}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.footerLink}
            title={language === 'zh' ? '查看更新日誌' : 'View Update Log'}
          >
            v1.1.2_20260704
          </a>
        </footer>
      </div>
    </div>
  );
}
