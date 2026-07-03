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
          className={`${styles.dropzone} ${isDragOver ? styles.dropzoneActive : ''}`}
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
      </div>
    </div>
  );
}
