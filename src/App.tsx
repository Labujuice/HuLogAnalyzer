import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from './store/appStore';
import { LandingPage } from './components/LandingPage';
import { ParseProgress } from './components/ParseProgress';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { DashboardLayout } from './components/DashboardLayout';
import { PlayBar } from './components/PlayBar';
import styles from './App.module.css';

export function App() {
  const { state } = useApp();
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const isResizing = useRef(false);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      // 限制寬度在 200px - 600px 之間
      const newWidth = Math.max(200, Math.min(600, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // 錯誤畫面
  if (state.status === 'error') {
    return (
      <div className={styles.errorRoot}>
        <div className={styles.errorCard}>
          <div className={styles.errorIcon}>⚠️</div>
          <h2 className={styles.errorTitle}>
            {state.language === 'en' ? 'Parsing Failed' : '解析失敗'}
          </h2>
          <p className={styles.errorMsg}>{state.error}</p>
          <button
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            {state.language === 'en' ? 'Reload' : '重新載入'}
          </button>
        </div>
      </div>
    );
  }

  // 首頁
  if (state.status === 'idle') {
    return <LandingPage />;
  }

  // 解析中
  if (state.status === 'loading' || state.status === 'parsing') {
    return <ParseProgress />;
  }

  // 儀表板
  return (
    <div className={styles.root}>
      <TopBar />
      <div className={styles.body}>
        <Sidebar width={sidebarWidth} />
        <div
          className={styles.resizeHandle}
          onMouseDown={startResize}
          title={state.language === 'en' ? 'Drag to resize sidebar' : '拖曳以調整寬度'}
        />
        <main className={styles.main}>
          <DashboardLayout />
        </main>
      </div>
      <PlayBar />
    </div>
  );
}
