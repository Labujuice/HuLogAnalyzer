import React, { useRef, useState } from 'react';
import { useApp } from '../store/appStore';
import { customCalcRegistry, CustomCalcConfig } from '../parser/customCalcRegistry';
import styles from './QuickPlotPresets.module.css';

interface PresetNode {
  id: string;
  labelEn: string;
  labelZh: string;
  type: string; // panelType or 'custom_calc'
}

interface PresetCategory {
  id: string;
  labelEn: string;
  labelZh: string;
  icon: string;
  children: PresetNode[];
}

const PRESET_CATEGORIES: PresetCategory[] = [
  {
    id: 'vibration',
    labelEn: '📈 Vibration Analysis (FFT)',
    labelZh: '📈 振動量分析 (FFT)',
    icon: '📈',
    children: [
      { id: 'vib_acc', labelEn: 'Accelerometer FFT', labelZh: '加速度計頻譜分析', type: 'vibration' },
      { id: 'vib_gyro', labelEn: 'Gyroscope FFT', labelZh: '陀螺儀頻譜分析', type: 'vibration' }
    ]
  },
  {
    id: 'pid',
    labelEn: '🎯 Controller Tracking (PID)',
    labelZh: '🎯 控制器追隨分析 (PID)',
    icon: '🎯',
    children: [
      { id: 'pid_rate', labelEn: 'Rate Loop response', labelZh: '角速度環追隨分析', type: 'pid_tracking' },
      { id: 'pid_att', labelEn: 'Attitude Loop response', labelZh: '姿態環追隨分析', type: 'pid_tracking' },
      { id: 'pid_vel', labelEn: 'Velocity Loop response', labelZh: '速度環追隨分析', type: 'pid_tracking' },
      { id: 'pid_pos', labelEn: 'Position Loop response', labelZh: '位置環追隨分析', type: 'pid_tracking' }
    ]
  },
  {
    id: 'motors',
    labelEn: '⚡ Motor Status & Balance',
    labelZh: '⚡ 馬達動力與電調平衡',
    icon: '⚡',
    children: [
      { id: 'motor_rpm', labelEn: 'ESC Telemetry RPMs', labelZh: '電調轉速 (RPM) 圖表', type: 'motor_balance' },
      { id: 'motor_out', labelEn: 'Actuator PWM Outputs', labelZh: '馬達控制命令 (PWM) 輸出', type: 'motor_balance' },
      { id: 'motor_hover', labelEn: 'Hover Balance Diagnostics', labelZh: '懸停出力平衡診斷', type: 'motor_balance' }
    ]
  },
  {
    id: 'magnetic',
    labelEn: '🧲 Magnetic & Compass Sync',
    labelZh: '🧲 磁強與指南針航向比對',
    icon: '🧲',
    children: [
      { id: 'mag_norm', labelEn: 'Magnetic Norm (EMI)', labelZh: '電磁干擾模長強度 (EMI)', type: 'magnetic_analysis' },
      { id: 'mag_yaw', labelEn: 'Multi-Source Yaw Sync', labelZh: '多源航向角 (Yaw) 對比', type: 'magnetic_analysis' }
    ]
  },
  {
    id: 'status',
    labelEn: '🎛️ Flight Status & Failsafes',
    labelZh: '🎛️ 飛行狀態與模式防護',
    icon: '🎛️',
    children: [
      { id: 'fs_modes', labelEn: 'Flight Modes & RC Sticks', labelZh: '飛行模式與操縱桿輸入', type: 'status_mode' },
      { id: 'fs_events', labelEn: 'Failsafes & Safety Events', labelZh: '安全防護與斷訊告警紀錄', type: 'status_mode' }
    ]
  }
];

export function QuickPlotPresets() {
  const { state } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    vibration: false,
    pid: false,
    motors: false,
    magnetic: false,
    status: false,
    custom: false
  });
  
  const [customConfigs, setCustomConfigs] = useState<CustomCalcConfig[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/ulog-preset', JSON.stringify({ type }));
  };

  const handleDragStartCustom = (e: React.DragEvent, configId: string) => {
    e.dataTransfer.setData('application/ulog-preset', JSON.stringify({ type: 'custom_calc', configId }));
  };

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const config = JSON.parse(text);

        // 基本 Schema 驗證
        if (!config.id || !config.name || !config.targetChart) {
          throw new Error(
            state.language === 'en'
              ? 'Invalid JSON: missing id, name or targetChart config.'
              : 'JSON 格式無效：缺少 id, name 或是 targetChart 屬性。'
          );
        }

        // 註冊進 customCalcRegistry
        customCalcRegistry.add(config);
        
        // 更新 UI 清單
        setCustomConfigs(customCalcRegistry.list());
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
    // 重設 input
    e.target.value = '';
  };

  const isEn = state.language === 'en';

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>
          {isEn ? '⚡ Quick Plot Presets' : '⚡ 快速繪圖快捷區'}
        </span>
        <span className={styles.subtitle}>
          {isEn ? '(Drag item onto any frame)' : '(可直接拖拽至任何畫框)'}
        </span>
      </div>

      <div className={styles.listArea}>
        {/* 內建快捷項目樹 */}
        {PRESET_CATEGORIES.map(cat => {
          const isCollapsed = collapsed[cat.id];
          return (
            <div key={cat.id} className={styles.categoryGroup}>
              <div className={styles.categoryRow} onClick={() => toggleCollapse(cat.id)}>
                <span className={`${styles.arrow} ${!isCollapsed ? styles.arrowOpen : ''}`}>▶</span>
                <span className={styles.categoryName}>
                  {isEn ? cat.labelEn : cat.labelZh}
                </span>
              </div>

              {!isCollapsed && (
                <div className={styles.childrenList}>
                  {cat.children.map(child => (
                    <div
                      key={child.id}
                      className={styles.presetItem}
                      draggable
                      onDragStart={(e) => handleDragStart(e, child.type)}
                    >
                      <span className={styles.dragDot}>⋮⋮</span>
                      <span className={styles.itemLabel}>
                        {isEn ? child.labelEn : child.labelZh}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* 自訂計算項目 */}
        <div className={styles.categoryGroup}>
          <div className={styles.categoryRow} onClick={() => toggleCollapse('custom')}>
            <span className={`${styles.arrow} ${!collapsed.custom ? styles.arrowOpen : ''}`}>▶</span>
            <span className={styles.categoryName}>
              {isEn ? '⚙️ Custom Math Calculations' : '⚙️ 自訂數學運算項目'}
            </span>
          </div>

          {!collapsed.custom && (
            <div className={styles.childrenList}>
              <div className={styles.uploadBtnRow}>
                <button className="btn btn--primary btn--small" onClick={triggerUpload}>
                  {isEn ? '📥 Import Config JSON' : '📥 匯入自訂 JSON'}
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept=".json"
                  onChange={handleFileUpload}
                />
              </div>

              {uploadError && <div className={styles.uploadError}>{uploadError}</div>}

              {customConfigs.length === 0 ? (
                <div className={styles.emptyHint}>
                  {isEn ? 'No custom formulas imported yet.' : '尚未匯入自訂計算項目。'}
                </div>
              ) : (
                customConfigs.map(cfg => (
                  <div
                    key={cfg.id}
                    className={styles.presetItem}
                    draggable
                    onDragStart={(e) => handleDragStartCustom(e, cfg.id)}
                  >
                    <span className={styles.dragDot}>⋮⋮</span>
                    <span className={styles.itemLabel}>
                      {cfg.name} <span className={styles.customBadge}>Custom</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
