import React from 'react';
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

  // 錯誤畫面
  if (state.status === 'error') {
    return (
      <div className={styles.errorRoot}>
        <div className={styles.errorCard}>
          <div className={styles.errorIcon}>⚠️</div>
          <h2 className={styles.errorTitle}>解析失敗</h2>
          <p className={styles.errorMsg}>{state.error}</p>
          <button
            className="btn btn--primary"
            onClick={() => window.location.reload()}
          >
            重新載入
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
        <Sidebar />
        <main className={styles.main}>
          <DashboardLayout />
        </main>
      </div>
      <PlayBar />
    </div>
  );
}
