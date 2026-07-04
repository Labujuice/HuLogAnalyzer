import React, { useEffect, useRef, useState, useCallback } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import { NAV_STATE_MAP, ARMING_STATE_MAP } from '../types/ulog';
import { formatRelativeTime } from '../parser/utils';
import styles from './StatusModePanel.module.css';

interface StatusModePanelProps {
  panelId: string;
  currentTimeUs: number;
}

interface ModeTransition {
  mode: number;
  modeName: string;
  startUs: number;
  endUs: number;
  startS: number;
  endS: number;
  color: string;
}

// 預設模式顏色映射，調和暗色系
const MODE_COLORS: Record<number, string> = {
  0: 'rgba(148, 163, 184, 0.15)', // MANUAL (Grey)
  1: 'rgba(56, 189, 248, 0.15)',  // ALTCTL (Light Blue)
  2: 'rgba(16, 185, 129, 0.15)',  // POSCTL (Green)
  3: 'rgba(167, 139, 250, 0.15)', // AUTO_MISSION (Purple)
  4: 'rgba(251, 146, 60, 0.15)',  // AUTO_LOITER (Orange)
  5: 'rgba(239, 68, 68, 0.15)',   // AUTO_RTL (Red)
  8: 'rgba(245, 158, 11, 0.15)',  // STAB (Yellow)
  9: 'rgba(20, 184, 166, 0.15)',  // AUTO_TAKEOFF (Teal)
  10: 'rgba(217, 70, 239, 0.15)', // AUTO_LAND (Magenta)
};

export function StatusModePanel({ panelId, currentTimeUs }: StatusModePanelProps) {
  const { state, requestTopicData } = useApp();
  
  const stickContainerRef = useRef<HTMLDivElement>(null);
  const failsafeContainerRef = useRef<HTMLDivElement>(null);
  
  const stickChartRef = useRef<uPlot | null>(null);
  const failsafeChartRef = useRef<uPlot | null>(null);

  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [hasSticks, setHasSticks] = useState(false);
  
  // 模式轉移事件
  const [transitions, setTransitions] = useState<ModeTransition[]>([]);
  const [currentModeStr, setCurrentModeStr] = useState<string>('UNKNOWN');
  const [currentArmStr, setCurrentArmStr] = useState<string>('DISARMED');
  
  // 遙控訊號與安全警告
  const [hasFailsafe, setHasFailsafe] = useState<boolean>(false);
  const [failsafeLogs, setFailsafeLogs] = useState<{ timeS: number; msg: string }[]>([]);

  // 1. 自動檢查並快取數據
  useEffect(() => {
    if (!state.summary) return;
    const topics = state.summary.topics;
    const hasStickTopic = topics.some(t => t.name === 'manual_control_setpoint');
    setHasSticks(hasStickTopic);

    const needed: { name: string; fields: string[] }[] = [
      { name: 'vehicle_status', fields: ['nav_state', 'arming_state', 'failsafe', 'rc_signal_lost'] }
    ];

    if (hasStickTopic) {
      needed.push({ name: 'manual_control_setpoint', fields: ['x', 'y', 'z', 'r'] });
    }

    let loaded = true;
    for (const n of needed) {
      const key = `${n.name}:0`;
      if (!state.topicCache[key]) {
        requestTopicData(n.name, 0, n.fields);
        loaded = false;
      }
    }
    setIsDataLoaded(loaded);
  }, [state.summary, state.topicCache, requestTopicData, hasSticks]);

  // 2. 模式變更事件解析
  const parseTransitions = useCallback(() => {
    if (!state.summary || !isDataLoaded) return;
    
    const statusCache = state.topicCache['vehicle_status:0'];
    if (!statusCache || statusCache.count === 0) return;

    const navStates = statusCache.fields['nav_state'];
    const timestamps = statusCache.timestamps;
    if (!navStates) return;

    const list: ModeTransition[] = [];
    const n = statusCache.count;
    const startLogUs = state.summary.startTimestampUs;

    let currentMode = Number(navStates[0]);
    let modeStartUs = timestamps[0];

    for (let i = 1; i < n; i++) {
      const m = Number(navStates[i]);
      if (m !== currentMode) {
        const modeEndUs = timestamps[i];
        list.push({
          mode: currentMode,
          modeName: NAV_STATE_MAP[currentMode] || `MODE_${currentMode}`,
          startUs: modeStartUs,
          endUs: modeEndUs,
          startS: (modeStartUs - startLogUs) / 1e6,
          endS: (modeEndUs - startLogUs) / 1e6,
          color: MODE_COLORS[currentMode] || 'rgba(148, 163, 184, 0.08)'
        });
        currentMode = m;
        modeStartUs = modeEndUs;
      }
    }

    // 壓入最後一段
    const lastUs = timestamps[n - 1];
    list.push({
      mode: currentMode,
      modeName: NAV_STATE_MAP[currentMode] || `MODE_${currentMode}`,
      startUs: modeStartUs,
      endUs: lastUs,
      startS: (modeStartUs - startLogUs) / 1e6,
      endS: (lastUs - startLogUs) / 1e6,
      color: MODE_COLORS[currentMode] || 'rgba(148, 163, 184, 0.08)'
    });

    setTransitions(list);

    // 解析 Failsafe 事件日誌
    const failsafes = statusCache.fields['failsafe'];
    const rcLost = statusCache.fields['rc_signal_lost'];
    const fLogs: { timeS: number; msg: string }[] = [];
    let isFsActive = false;
    let isRcLostActive = false;

    for (let i = 0; i < n; i++) {
      const timeS = (timestamps[i] - startLogUs) / 1e6;
      if (failsafes && Number(failsafes[i]) === 1 && !isFsActive) {
        fLogs.push({ timeS, msg: state.language === 'en' ? 'Failsafe Triggered!' : '安全防護 Failsafe 觸發！' });
        isFsActive = true;
      } else if (failsafes && Number(failsafes[i]) === 0 && isFsActive) {
        fLogs.push({ timeS, msg: state.language === 'en' ? 'Failsafe Cleared' : '安全防護 Failsafe 解除' });
        isFsActive = false;
      }

      if (rcLost && Number(rcLost[i]) === 1 && !isRcLostActive) {
        fLogs.push({ timeS, msg: state.language === 'en' ? 'RC Signal Lost!' : '遙控訊號中斷！' });
        isRcLostActive = true;
      } else if (rcLost && Number(rcLost[i]) === 0 && isRcLostActive) {
        fLogs.push({ timeS, msg: state.language === 'en' ? 'RC Signal Recovered' : '遙控訊號恢復' });
        isRcLostActive = false;
      }
    }
    setFailsafeLogs(fLogs);
  }, [isDataLoaded, state.topicCache, state.summary, state.language]);

  useEffect(() => {
    parseTransitions();
  }, [parseTransitions]);

  // 3. 全局播放進度聯動模式/解鎖字串
  useEffect(() => {
    if (!state.summary || !isDataLoaded) return;
    const statusCache = state.topicCache['vehicle_status:0'];
    if (!statusCache) return;

    const nav = statusCache.fields['nav_state'];
    const arm = statusCache.fields['arming_state'];
    const fs = statusCache.fields['failsafe'];

    if (nav && arm) {
      const idx = statusCache.timestamps.findIndex(t => t >= currentTimeUs);
      const safeIdx = idx === -1 ? statusCache.count - 1 : idx;
      const activeNav = nav[safeIdx];
      const activeArm = arm[safeIdx];
      
      setCurrentModeStr(NAV_STATE_MAP[activeNav] || `MODE_${activeNav}`);
      setCurrentArmStr(ARMING_STATE_MAP[activeArm] || `ARMING_${activeArm}`);
      setHasFailsafe(fs ? Number(fs[safeIdx]) === 1 : false);
    }
  }, [currentTimeUs, isDataLoaded, state.topicCache, state.summary]);

  // 4. 時序折線圖繪製
  const renderCharts = useCallback(() => {
    if (!state.summary || !isDataLoaded) return;
    const startLogUs = state.summary.startTimestampUs;

    // ─── A. 遙控器操縱桿輸入折線圖（附帶模式背景色帶） ───
    if (hasSticks) {
      const stickCache = state.topicCache['manual_control_setpoint:0'];
      if (stickCache && stickCache.count > 0 && stickContainerRef.current) {
        const sx = stickCache.fields['x'];
        const sy = stickCache.fields['y'];
        const sz = stickCache.fields['z'];
        const sr = stickCache.fields['r'];

        if (sx && sy && sz && sr) {
          stickChartRef.current?.destroy();
          stickChartRef.current = null;

          const n = stickCache.count;
          const xsSec = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            xsSec[i] = (stickCache.timestamps[i] - startLogUs) / 1e6;
          }

          const uPlotData: uPlot.AlignedData = [xsSec, sx, sy, sz, sr];
          const rect = stickContainerRef.current.getBoundingClientRect();

          const opts: uPlot.Options = {
            width: Math.max(100, Math.floor(rect.width)),
            height: Math.max(80, Math.floor(rect.height)),
            scales: { x: { time: false }, y: { min: -1.1, max: 1.1 } },
            axes: [
              { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
              { label: 'Stick Inputs [-1, 1]', stroke: '#64748b', font: '10px JetBrains Mono, monospace', side: 3 }
            ],
            series: [
              { label: 'Time (s)' },
              { label: 'Pitch (x)', stroke: '#ef4444', width: 1.2, points: { show: false } },
              { label: 'Roll (y)', stroke: '#10b981', width: 1.2, points: { show: false } },
              { label: 'Throttle (z)', stroke: '#fb923c', width: 1.2, points: { show: false } },
              { label: 'Yaw (r)', stroke: '#3b82f6', width: 1.2, points: { show: false } }
            ],
            hooks: {
              drawClear: [
                (u: uPlot) => {
                  // 在底層繪製飛行模式色帶
                  const ctx = u.ctx;
                  transitions.forEach(t => {
                    const x0 = u.valToPos(t.startS, 'x', true);
                    const x1 = u.valToPos(t.endS, 'x', true);
                    
                    ctx.save();
                    ctx.fillStyle = t.color;
                    ctx.fillRect(x0, u.bbox.top, x1 - x0, u.bbox.height);
                    
                    // 在色帶頂部渲染模式名稱
                    if (x1 - x0 > 40) {
                      ctx.fillStyle = '#64748b';
                      ctx.font = '9px system-ui, sans-serif';
                      ctx.textBaseline = 'top';
                      ctx.fillText(t.modeName, x0 + 4, u.bbox.top + 4);
                    }
                    ctx.restore();
                  });
                }
              ],
              drawAxes: [
                (u: uPlot) => {
                  // 繪製播放時間線
                  const timeSec = (currentTimeUs - startLogUs) / 1e6;
                  const cx = u.valToPos(timeSec, 'x', true);
                  if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
                    u.ctx.save();
                    u.ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                    u.ctx.setLineDash([3, 3]);
                    u.ctx.beginPath();
                    u.ctx.moveTo(cx, u.bbox.top);
                    u.ctx.lineTo(cx, u.bbox.top + u.bbox.height);
                    u.ctx.stroke();
                    u.ctx.restore();
                  }
                }
              ]
            }
          };
          stickChartRef.current = new uPlot(opts, uPlotData, stickContainerRef.current);
        }
      }
    }

    // ─── B. 安全防護 (Failsafe & RC Lost) 狀態時序圖 ───
    const statusCache = state.topicCache['vehicle_status:0'];
    if (statusCache && statusCache.count > 0 && failsafeContainerRef.current) {
      const fs = statusCache.fields['failsafe'];
      const rcLost = statusCache.fields['rc_signal_lost'];

      if (fs && rcLost) {
        failsafeChartRef.current?.destroy();
        failsafeChartRef.current = null;

        const n = statusCache.count;
        const xsSec = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          xsSec[i] = (statusCache.timestamps[i] - startLogUs) / 1e6;
        }

        const uPlotData: uPlot.AlignedData = [xsSec, fs, rcLost];
        const rect = failsafeContainerRef.current.getBoundingClientRect();

        const opts: uPlot.Options = {
          width: Math.max(100, Math.floor(rect.width)),
          height: Math.max(80, Math.floor(rect.height)),
          scales: { x: { time: false }, y: { min: -0.1, max: 1.1 } },
          axes: [
            { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
            { stroke: '#64748b', font: '10px JetBrains Mono, monospace', side: 3, values: (u, vals) => vals.map(v => v === 1 ? 'True' : 'False') }
          ],
          series: [
            { label: 'Time (s)' },
            { label: 'Failsafe Triggered', stroke: '#ef4444', width: 1.5, points: { show: false } },
            { label: 'RC Signal Lost', stroke: '#fb923c', width: 1.5, points: { show: false } }
          ],
          hooks: {
            drawAxes: [
              (u: uPlot) => {
                const timeSec = (currentTimeUs - startLogUs) / 1e6;
                const cx = u.valToPos(timeSec, 'x', true);
                if (cx >= u.bbox.left && cx <= u.bbox.left + u.bbox.width) {
                  u.ctx.save();
                  u.ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
                  u.ctx.setLineDash([3, 3]);
                  u.ctx.beginPath();
                  u.ctx.moveTo(cx, u.bbox.top);
                  u.ctx.lineTo(cx, u.bbox.top + u.bbox.height);
                  u.ctx.stroke();
                  u.ctx.restore();
                }
              }
            ]
          }
        };
        failsafeChartRef.current = new uPlot(opts, uPlotData, failsafeContainerRef.current);
      }
    }
  }, [isDataLoaded, hasSticks, state.topicCache, state.summary, transitions, currentTimeUs]);

  // 重建圖表
  useEffect(() => {
    renderCharts();
  }, [renderCharts]);

  // 播放時間更新時重繪
  useEffect(() => {
    if (stickChartRef.current) stickChartRef.current.redraw(false);
    if (failsafeChartRef.current) failsafeChartRef.current.redraw(false);
  }, [currentTimeUs]);

  // ResizeObserver
  useEffect(() => {
    const handleResize = () => {
      if (stickChartRef.current && stickContainerRef.current) {
        const rect = stickContainerRef.current.getBoundingClientRect();
        stickChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
      if (failsafeChartRef.current && failsafeContainerRef.current) {
        const rect = failsafeContainerRef.current.getBoundingClientRect();
        failsafeChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
    };

    const ro = new ResizeObserver(handleResize);
    if (stickContainerRef.current) ro.observe(stickContainerRef.current);
    if (failsafeContainerRef.current) ro.observe(failsafeContainerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className={styles.root}>
      {/* 頂部 HUD 控制板，顯示當前播放點狀態 */}
      <div className={styles.dashboard}>
        <div className={styles.hudCard}>
          <div className={styles.hudKey}>{state.language === 'en' ? 'Flight Mode' : '目前飛行模式'}</div>
          <div className={styles.hudValue}>{currentModeStr}</div>
        </div>
        <div className={styles.hudCard}>
          <div className={styles.hudKey}>{state.language === 'en' ? 'Arming State' : '解鎖狀態'}</div>
          <div className={styles.hudValue} style={{ color: currentArmStr === 'ARMED' ? '#ef4444' : '#94a3b8' }}>
            {currentArmStr}
          </div>
        </div>
        <div className={styles.hudCard}>
          <div className={styles.hudKey}>{state.language === 'en' ? 'Failsafe Status' : '安全防護'}</div>
          <div className={styles.hudValue} style={{ color: hasFailsafe ? '#ef4444' : '#10b981' }}>
            {hasFailsafe ? (state.language === 'en' ? 'TRIGGERED' : '🚨 觸發') : (state.language === 'en' ? 'CLEAR' : '✅ 正常')}
          </div>
        </div>
      </div>

      <div className={styles.container}>
        {/* 左側時序圖 */}
        <div className={styles.chartColumn}>
          {/* 操縱桿與模式背景 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>🎮 {state.language === 'en' ? 'Pilot Intervention (Stick Inputs) & Modes' : '遙控器搖桿輸入 (人為介入) 與飛行模式'}</span>
            </div>
            {!hasSticks ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'No manual stick inputs found' : '日誌中無遙控器搖桿數據'}</div>
            ) : !isDataLoaded ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'Loading Stick Data...' : '載入搖桿數據中...'}</div>
            ) : (
              <div className={styles.chartWrapper}>
                <div ref={stickContainerRef} className={styles.chartArea} />
              </div>
            )}
          </div>

          {/* Failsafe & RC Lost */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>⚠️ {state.language === 'en' ? 'Safety Failsafe & RC Link Status' : '安全防護與遙控訊號斷訊監控'}</span>
            </div>
            {!isDataLoaded ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'Loading Failsafe...' : '載入安全防護數據中...'}</div>
            ) : (
              <div className={styles.chartWrapper}>
                <div ref={failsafeContainerRef} className={styles.chartArea} />
              </div>
            )}
          </div>
        </div>

        {/* 右側日誌與事件主控台 */}
        <div className={styles.consoleColumn}>
          <div className={styles.sectionTitle}>
            {state.language === 'en' ? '📋 Mission Event Log' : '📋 飛行任務事件日誌'}
          </div>

          <div className={styles.eventLogList}>
            {/* 模式轉變日誌 */}
            <div className={styles.logCategory}>
              <div className={styles.logCategoryTitle}>🔄 {state.language === 'en' ? 'Mode Transitions' : '飛行模式切換紀錄'}</div>
              {transitions.map((t, idx) => (
                <div key={idx} className={styles.logRow}>
                  <span className={styles.logTime}>{t.startS.toFixed(1)}s</span>
                  <span className={styles.logMsg}>
                    {state.language === 'en' ? 'Switch to ' : '切換至 '} <b>{t.modeName}</b>
                  </span>
                </div>
              ))}
            </div>

            {/* 安全警報日誌 */}
            <div className={styles.logCategory}>
              <div className={styles.logCategoryTitle}>🚨 {state.language === 'en' ? 'Safety & Failsafe Events' : '防護觸發與斷訊告警'}</div>
              {failsafeLogs.length === 0 ? (
                <div className={styles.noDiagHint}>
                  {state.language === 'en' ? 'No safety events recorded' : '無安全警報事件紀錄。'}
                </div>
              ) : (
                failsafeLogs.map((l, idx) => (
                  <div key={idx} className={styles.logRow} style={{ color: '#f87171' }}>
                    <span className={styles.logTime}>{l.timeS.toFixed(1)}s</span>
                    <span className={styles.logMsg}><b>{l.msg}</b></span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
