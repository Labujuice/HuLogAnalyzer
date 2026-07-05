import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useApp } from '../store/appStore';
import { NAV_STATE_MAP, ARMING_STATE_MAP } from '../types/ulog';
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

const MODE_COLORS: Record<number, string> = {
  0: 'rgba(148, 163, 184, 0.15)', // MANUAL
  1: 'rgba(56, 189, 248, 0.15)',  // ALTCTL
  2: 'rgba(16, 185, 129, 0.15)',  // POSCTL
  3: 'rgba(167, 139, 250, 0.15)', // AUTO_MISSION
  4: 'rgba(251, 146, 60, 0.15)',  // AUTO_LOITER
  5: 'rgba(239, 68, 68, 0.15)',   // AUTO_RTL
  8: 'rgba(245, 158, 11, 0.15)',  // STAB
  9: 'rgba(20, 184, 166, 0.15)',  // AUTO_TAKEOFF
  10: 'rgba(217, 70, 239, 0.15)', // AUTO_LAND
};

const MULTI_CHANNEL_COLORS = [
  '#ef4444', '#10b981', '#fb923c', '#3b82f6',
  '#a78bfa', '#f43f5e', '#06b6d4', '#eab308',
  '#ec4899', '#14b8a6', '#6366f1', '#f97316'
];

type StickTab = 'setpoint' | 'rc_channels' | 'input_rc';

export function StatusModePanel({ panelId, currentTimeUs }: StatusModePanelProps) {
  const { state, requestTopicData } = useApp();
  
  const stickContainerRef = useRef<HTMLDivElement>(null);
  const modeContainerRef = useRef<HTMLDivElement>(null);
  const failsafeContainerRef = useRef<HTMLDivElement>(null);
  
  const stickChartRef = useRef<uPlot | null>(null);
  const modeChartRef = useRef<uPlot | null>(null);
  const failsafeChartRef = useRef<uPlot | null>(null);

  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<StickTab>('setpoint');
  
  const [hasSetpoint, setHasSetpoint] = useState(false);
  const [hasRcChannels, setHasRcChannels] = useState(false);
  const [hasInputRc, setHasInputRc] = useState(false);

  const [transitions, setTransitions] = useState<ModeTransition[]>([]);
  const [currentModeStr, setCurrentModeStr] = useState<string>('UNKNOWN');
  const [currentArmStr, setCurrentArmStr] = useState<string>('DISARMED');
  
  const [hasFailsafe, setHasFailsafe] = useState<boolean>(false);
  const [failsafeLogs, setFailsafeLogs] = useState<{ timeS: number; msg: string }[]>([]);

  // 1. 本地 uPlot 橫向縮放與游標同步對象
  const statusSync = useMemo(() => uPlot.sync('status-panel-sync'), []);

  // 自動檢查實際存在的 Topic 與 Fields
  useEffect(() => {
    if (!state.summary) return;
    const topics = state.summary.topics;

    const spExist = topics.some(t => t.name === 'manual_control_setpoint');
    const rcChExist = topics.some(t => t.name === 'rc_channels');
    const inputRcExist = topics.some(t => t.name === 'input_rc');

    setHasSetpoint(spExist);
    setHasRcChannels(rcChExist);
    setHasInputRc(inputRcExist);

    if (spExist) {
      setActiveTab('setpoint');
    } else if (rcChExist) {
      setActiveTab('rc_channels');
    } else if (inputRcExist) {
      setActiveTab('input_rc');
    }

    const statusTopic = topics.find(t => t.name === 'vehicle_status');
    if (!statusTopic) return;

    const statusFields = ['nav_state', 'arming_state', 'failsafe', 'rc_signal_lost']
      .filter(f => statusTopic.fields.includes(f));

    const needed: { name: string; fields: string[] }[] = [
      { name: 'vehicle_status', fields: statusFields }
    ];

    if (spExist) {
      const t = topics.find(tp => tp.name === 'manual_control_setpoint')!;
      needed.push({ name: t.name, fields: t.fields.filter(f => ['x', 'y', 'z', 'r'].includes(f)) });
    }
    if (rcChExist) {
      const t = topics.find(tp => tp.name === 'rc_channels')!;
      needed.push({ name: t.name, fields: t.fields.filter(f => f.startsWith('channels[')) });
    }
    if (inputRcExist) {
      const t = topics.find(tp => tp.name === 'input_rc')!;
      needed.push({ name: t.name, fields: t.fields.filter(f => f.startsWith('values[')) });
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
  }, [state.summary, state.topicCache, requestTopicData]);

  // 滾輪縮放註冊輔助器
  const registerWheelZoom = useCallback((plot: uPlot) => {
    plot.over.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const minX = plot.scales.x.min!;
      const maxX = plot.scales.x.max!;
      const range = maxX - minX;
      const rect = plot.over.getBoundingClientRect();
      const mousePct = (e.clientX - rect.left) / rect.width;
      const mouseVal = minX + mousePct * range;
      const zoomFactor = e.deltaY < 0 ? 0.85 : 1.15;
      const newRange = range * zoomFactor;
      const newMin = mouseVal - mousePct * newRange;
      const newMax = newMin + newRange;
      const logEnd = (state.summary?.durationUs ?? 0) / 1e6;

      plot.setScale('x', {
        min: Math.max(0, newMin),
        max: Math.min(logEnd, newMax),
      });
    });
  }, [state.summary]);

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

  // 3. 全局播放時間點同步
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

  // 4. 折線圖與階躍圖繪製
  const renderCharts = useCallback(() => {
    if (!state.summary || !isDataLoaded) return;
    const startLogUs = state.summary.startTimestampUs;

    // ─── A. 搖桿操縱桿 / RC 訊號折線圖 (根據 Tab 切換) ───
    let currentCacheKey = '';
    if (activeTab === 'setpoint' && hasSetpoint) currentCacheKey = 'manual_control_setpoint:0';
    else if (activeTab === 'rc_channels' && hasRcChannels) currentCacheKey = 'rc_channels:0';
    else if (activeTab === 'input_rc' && hasInputRc) currentCacheKey = 'input_rc:0';

    if (currentCacheKey) {
      const stickCache = state.topicCache[currentCacheKey];
      if (stickCache && stickCache.count > 0 && stickContainerRef.current) {
        stickChartRef.current?.destroy();
        stickChartRef.current = null;

        const n = stickCache.count;
        const xsSec = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          xsSec[i] = (stickCache.timestamps[i] - startLogUs) / 1e6;
        }

        const dataCols: any[] = [];
        const seriesOpts: any[] = [{ label: 'Time (s)' }];
        let yMin = -1.1;
        let yMax = 1.1;

        if (activeTab === 'setpoint') {
          const sx = stickCache.fields['x']; // Pitch
          const sy = stickCache.fields['y']; // Roll
          const sz = stickCache.fields['z']; // Throttle
          const sr = stickCache.fields['r']; // Yaw
          if (sx && sy && sz && sr) {
            dataCols.push(sx, sy, sz, sr);
            seriesOpts.push(
              { label: 'Pitch (x)', stroke: '#ef4444', width: 1.2, points: { show: false } },
              { label: 'Roll (y)', stroke: '#10b981', width: 1.2, points: { show: false } },
              { label: 'Throttle (z)', stroke: '#fb923c', width: 1.2, points: { show: false } },
              { label: 'Yaw (r)', stroke: '#3b82f6', width: 1.2, points: { show: false } }
            );
          }
        } else if (activeTab === 'rc_channels') {
          const channelFields = Object.keys(stickCache.fields)
            .filter(k => k.startsWith('channels['))
            .sort((a,b) => {
              const idxA = parseInt(a.match(/\d+/)![0]);
              const idxB = parseInt(b.match(/\d+/)![0]);
              return idxA - idxB;
            });
          
          if (channelFields.length > 0) {
            const isRaw = stickCache.fields[channelFields[0]][0] > 500;
            channelFields.forEach((f, idx) => {
              const arr = stickCache.fields[f];
              const norm = new Float32Array(n);
              for (let i = 0; i < n; i++) {
                norm[i] = isRaw ? (arr[i] - 1500) / 500 : arr[i];
              }
              dataCols.push(norm);
              seriesOpts.push({
                label: `CH ${idx + 1}`,
                stroke: MULTI_CHANNEL_COLORS[idx % MULTI_CHANNEL_COLORS.length],
                width: 1.2,
                points: { show: false }
              });
            });
          }
        } else if (activeTab === 'input_rc') {
          const valueFields = Object.keys(stickCache.fields)
            .filter(k => k.startsWith('values['))
            .sort((a,b) => {
              const idxA = parseInt(a.match(/\d+/)![0]);
              const idxB = parseInt(b.match(/\d+/)![0]);
              return idxA - idxB;
            });
          
          if (valueFields.length > 0) {
            yMin = 850;
            yMax = 2150;
            valueFields.forEach((f, idx) => {
              const arr = stickCache.fields[f];
              const vals = arr instanceof Float32Array ? arr : new Float32Array(arr);
              dataCols.push(vals);
              seriesOpts.push({
                label: `RC CH ${idx + 1}`,
                stroke: MULTI_CHANNEL_COLORS[idx % MULTI_CHANNEL_COLORS.length],
                width: 1.2,
                points: { show: false }
              });
            });
          }
        }

        if (dataCols.length > 0) {
          const uPlotData: uPlot.AlignedData = [xsSec, ...dataCols] as uPlot.AlignedData;
          const rect = stickContainerRef.current.getBoundingClientRect();

          const opts: uPlot.Options = {
            width: Math.max(100, Math.floor(rect.width)),
            height: Math.max(80, Math.floor(rect.height)),
            scales: { x: { time: false }, y: { min: yMin, max: yMax } },
            axes: [
              { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
              {
                label: activeTab === 'input_rc' ? 'PWM (us)' : 'Normalized [-1, 1]',
                stroke: '#64748b',
                font: '10px JetBrains Mono, monospace',
                side: 3
              }
            ],
            series: seriesOpts,
            cursor: { sync: { key: statusSync.key } },
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
          const plot = new uPlot(opts, uPlotData, stickContainerRef.current);
          registerWheelZoom(plot);
          stickChartRef.current = plot;
        }
      }
    }

    // ─── B. 獨立飛行模式與解鎖狀態 step 折線圖 ───
    const statusCache = state.topicCache['vehicle_status:0'];
    if (statusCache && statusCache.count > 0) {
      const nav = statusCache.fields['nav_state'];
      const arm = statusCache.fields['arming_state'];

      if (nav && arm && modeContainerRef.current) {
        modeChartRef.current?.destroy();
        modeChartRef.current = null;

        const n = statusCache.count;
        const xsSec = new Float64Array(n);
        const armBinary = new Float32Array(n);
        const navValues = new Float32Array(n);

        for (let i = 0; i < n; i++) {
          xsSec[i] = (statusCache.timestamps[i] - startLogUs) / 1e6;
          navValues[i] = Number(nav[i]);
          armBinary[i] = Number(arm[i]) === 2 ? 1 : 0;
        }

        const uPlotData: uPlot.AlignedData = [xsSec, navValues, armBinary];
        const rect = modeContainerRef.current.getBoundingClientRect();

        const opts: uPlot.Options = {
          width: Math.max(100, Math.floor(rect.width)),
          height: Math.max(80, Math.floor(rect.height)),
          scales: {
            x: { time: false },
            mode: { auto: true },
            arm: { min: -0.1, max: 1.1 }
          },
          axes: [
            { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
            {
              scale: 'mode',
              label: 'Flight Mode',
              stroke: '#10b981',
              font: '10px JetBrains Mono, monospace',
              side: 3,
              values: (u, vals) => vals.map(v => Number.isInteger(v) ? (NAV_STATE_MAP[v] || `State ${v}`) : '')
            },
            {
              scale: 'arm',
              label: 'Arm Status',
              stroke: '#ef4444',
              font: '10px JetBrains Mono, monospace',
              side: 1,
              values: (u, vals) => vals.map(v => v === 1 ? 'ARMED' : v === 0 ? 'DISARMED' : '')
            }
          ],
          series: [
            { label: 'Time (s)' },
            {
              label: 'Flight Mode',
              stroke: '#10b981',
              width: 2,
              scale: 'mode',
              paths: (uPlot.paths as any)?.stepped ? (uPlot.paths as any).stepped({ align: 1 }) : undefined,
              points: { show: false }
            } as any,
            {
              label: 'Arm State',
              stroke: '#ef4444',
              width: 1.5,
              scale: 'arm',
              paths: (uPlot.paths as any)?.stepped ? (uPlot.paths as any).stepped({ align: 1 }) : undefined,
              points: { show: false }
            } as any
          ],
          cursor: { sync: { key: statusSync.key } },
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
                  u.ctx.moveTo(cx, u.ctx.canvas.height);
                  u.ctx.lineTo(cx, 0);
                  u.ctx.stroke();
                  u.ctx.restore();
                }
              }
            ]
          }
        };
        const plot = new uPlot(opts, uPlotData, modeContainerRef.current);
        registerWheelZoom(plot);
        modeChartRef.current = plot;
      }
    }

    // ─── C. 安全防護 (Failsafe & RC Lost) 狀態時序圖 ───
    if (statusCache && statusCache.count > 0 && failsafeContainerRef.current) {
      const fs = statusCache.fields['failsafe'];
      const rcLost = statusCache.fields['rc_signal_lost'];

      const hasFsField = !!fs;
      const hasRcField = !!rcLost;

      if (hasFsField || hasRcField) {
        failsafeChartRef.current?.destroy();
        failsafeChartRef.current = null;

        const n = statusCache.count;
        const xsSec = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          xsSec[i] = (statusCache.timestamps[i] - startLogUs) / 1e6;
        }

        const yCols: Float32Array[] = [];
        const seriesOpts: any[] = [{ label: 'Time (s)' }];

        if (hasFsField) {
          yCols.push(fs instanceof Float32Array ? fs : new Float32Array(fs));
          seriesOpts.push({ label: 'Failsafe Triggered', stroke: '#ef4444', width: 1.5, points: { show: false } as any });
        }
        if (hasRcField) {
          yCols.push(rcLost instanceof Float32Array ? rcLost : new Float32Array(rcLost));
          seriesOpts.push({ label: 'RC Signal Lost', stroke: '#fb923c', width: 1.5, points: { show: false } as any });
        }

        const uPlotData: uPlot.AlignedData = [xsSec, ...yCols] as uPlot.AlignedData;
        const rect = failsafeContainerRef.current.getBoundingClientRect();

        const opts: uPlot.Options = {
          width: Math.max(100, Math.floor(rect.width)),
          height: Math.max(80, Math.floor(rect.height)),
          scales: { x: { time: false }, y: { min: -0.1, max: 1.1 } },
          axes: [
            { stroke: '#64748b', font: '10px JetBrains Mono, monospace' },
            { stroke: '#64748b', font: '10px JetBrains Mono, monospace', side: 3, values: (u, vals) => vals.map(v => v === 1 ? 'True' : 'False') }
          ],
          series: seriesOpts,
          cursor: { sync: { key: statusSync.key } },
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
        const plot = new uPlot(opts, uPlotData, failsafeContainerRef.current);
        registerWheelZoom(plot);
        failsafeChartRef.current = plot;
      }
    }
  }, [isDataLoaded, activeTab, hasSetpoint, hasRcChannels, hasInputRc, state.topicCache, state.summary, transitions, currentTimeUs, statusSync, registerWheelZoom]);

  useEffect(() => {
    renderCharts();
  }, [renderCharts]);

  // 播放時間更新時重繪
  useEffect(() => {
    if (stickChartRef.current) stickChartRef.current.redraw(false);
    if (modeChartRef.current) modeChartRef.current.redraw(false);
    if (failsafeChartRef.current) failsafeChartRef.current.redraw(false);
  }, [currentTimeUs]);

  // ResizeObserver
  useEffect(() => {
    const handleResize = () => {
      if (stickChartRef.current && stickContainerRef.current) {
        const rect = stickContainerRef.current.getBoundingClientRect();
        stickChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
      if (modeChartRef.current && modeContainerRef.current) {
        const rect = modeContainerRef.current.getBoundingClientRect();
        modeChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
      if (failsafeChartRef.current && failsafeContainerRef.current) {
        const rect = failsafeContainerRef.current.getBoundingClientRect();
        failsafeChartRef.current.setSize({ width: Math.max(50, rect.width), height: Math.max(50, rect.height) });
      }
    };

    const ro = new ResizeObserver(handleResize);
    if (stickContainerRef.current) ro.observe(stickContainerRef.current);
    if (modeContainerRef.current) ro.observe(modeContainerRef.current);
    if (failsafeContainerRef.current) ro.observe(failsafeContainerRef.current);
    return () => ro.disconnect();
  }, []);

  const hasData = hasSetpoint || hasRcChannels || hasInputRc;

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
          {/* 操縱桿輸入 (包含 Tab 切換) */}
          <div className={styles.card}>
            <div className={styles.cardHeader} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className={styles.cardTitle}>
                🎮 {state.language === 'en' ? 'Pilot Stick / RC inputs' : '遙控搖桿與 RC 輸入信號'}
              </span>
              
              <div className={styles.stickTabs}>
                <button
                  className={`${styles.stickTabBtn} ${activeTab === 'setpoint' ? styles.stickTabBtnActive : ''} ${!hasSetpoint ? styles.stickTabBtnDisabled : ''}`}
                  disabled={!hasSetpoint}
                  onClick={() => setActiveTab('setpoint')}
                >
                  Setpoint
                </button>
                <button
                  className={`${styles.stickTabBtn} ${activeTab === 'rc_channels' ? styles.stickTabBtnActive : ''} ${!hasRcChannels ? styles.stickTabBtnDisabled : ''}`}
                  disabled={!hasRcChannels}
                  onClick={() => setActiveTab('rc_channels')}
                >
                  RC Channels
                </button>
                <button
                  className={`${styles.stickTabBtn} ${activeTab === 'input_rc' ? styles.stickTabBtnActive : ''} ${!hasInputRc ? styles.stickTabBtnDisabled : ''}`}
                  disabled={!hasInputRc}
                  onClick={() => setActiveTab('input_rc')}
                >
                  Raw RC (PWM)
                </button>
              </div>
            </div>
            
            {!hasData ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'No stick or RC data found' : '日誌中無遙控器搖桿或 RC 數據'}</div>
            ) : !isDataLoaded ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'Loading Stick Data...' : '載入搖桿數據中...'}</div>
            ) : (
              <div className={styles.chartWrapper}>
                <div ref={stickContainerRef} className={styles.chartArea} />
              </div>
            )}
          </div>

          {/* 飛行模式與解鎖狀態 */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>
                🔄 {state.language === 'en' ? 'Flight Mode & Arming History' : '飛行模式與解鎖狀態時序圖'}
              </span>
            </div>
            {!isDataLoaded ? (
              <div className={styles.emptyHint}>{state.language === 'en' ? 'Loading Mode Status...' : '載入解鎖與模式數據中...'}</div>
            ) : (
              <div className={styles.chartWrapper}>
                <div ref={modeContainerRef} className={styles.chartArea} />
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
