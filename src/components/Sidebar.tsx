import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { CHART_COLORS } from '../types/ulog';
import type { ChartSeries } from '../types/ulog';
import styles from './Sidebar.module.css';

type SidebarTab = 'topics' | 'info' | 'messages';

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('topics');

  return (
    <aside className={styles.root}>
      <div className={styles.tabs}>
        {([ ['topics','Topics'], ['info','資訊'], ['messages','日誌'] ] as [SidebarTab, string][]).map(([id, label]) => (
          <button
            key={id}
            className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(id)}
            id={`sidebar-tab-${id}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {activeTab === 'topics' && <TopicTree />}
        {activeTab === 'info' && <MetadataPanel />}
        {activeTab === 'messages' && <LogMessages />}
      </div>
    </aside>
  );
}

// ─── Topic Tree ───────────────────────────────────────────────────────────────

let colorIdx = 0;
function nextColor() {
  return CHART_COLORS[colorIdx++ % CHART_COLORS.length];
}

function TopicTree() {
  const { state } = useApp();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 多選：key = "topicName:multiId:fieldName"
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const topics = state.summary?.topics ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return topics;
    const q = search.toLowerCase();
    return topics.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.fields.some(f => f.toLowerCase().includes(q))
    );
  }, [topics, search]);

  const toggle = (key: string) => {
    setExpanded(prev => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  };

  const toggleField = (fieldKey: string) => {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(fieldKey) ? s.delete(fieldKey) : s.add(fieldKey);
      return s;
    });
  };

  const toggleAllFields = (topicKey: string, fields: string[], topicName: string, multiId: number) => {
    const fieldKeys = fields.map(f => `${topicName}:${multiId}:${f}`);
    const allSelected = fieldKeys.every(k => selected.has(k));
    setSelected(prev => {
      const s = new Set(prev);
      if (allSelected) {
        fieldKeys.forEach(k => s.delete(k));
      } else {
        fieldKeys.forEach(k => s.add(k));
      }
      return s;
    });
  };

  // 把 selected 組成 ChartSeries[] JSON 放進 dataTransfer
  const buildSeriesFromSelected = useCallback((): ChartSeries[] => {
    return Array.from(selected).map(fieldKey => {
      const parts = fieldKey.split(':');
      const fieldName = parts[parts.length - 1];
      const multiId = parseInt(parts[parts.length - 2], 10);
      const topicName = parts.slice(0, parts.length - 2).join(':');
      return {
        topicName,
        multiId,
        fieldName,
        label: `${topicName}.${fieldName}`,
        color: nextColor(),
      };
    });
  }, [selected]);

  // 拖曳單一欄位（不管有沒有多選，都只拖這個欄位；若此欄位在選取集合內則拖全部）
  const onDragStart = useCallback((
    e: React.DragEvent,
    topicName: string, multiId: number, fieldName: string
  ) => {
    const thisKey = `${topicName}:${multiId}:${fieldName}`;
    let series: ChartSeries[];
    if (selected.has(thisKey) && selected.size > 1) {
      // 拖曳已選取的欄位 → 整批傳出
      series = buildSeriesFromSelected();
    } else {
      // 拖曳未選取的單一欄位
      series = [{
        topicName, multiId, fieldName,
        label: `${topicName}.${fieldName}`,
        color: nextColor(),
      }];
    }
    e.dataTransfer.setData('application/ulog-series', JSON.stringify(series));
    e.dataTransfer.effectAllowed = 'copy';
  }, [selected, buildSeriesFromSelected]);

  if (!state.summary) return <div className={styles.empty}>尚未載入 ULog 檔案</div>;

  const selectedCount = selected.size;

  return (
    <div className={styles.topicTree}>
      <div className={styles.searchWrap}>
        <svg className={styles.searchIcon} viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          className={styles.searchInput}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋 Topic / 欄位..."
          id="sidebar-search"
        />
        {search && (
          <button className={styles.clearBtn} onClick={() => setSearch('')} title="清除搜尋">×</button>
        )}
      </div>

      {/* 多選提示列 */}
      {selectedCount > 0 && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionCount}>已選 {selectedCount} 個欄位</span>
          <button
            className={styles.selectionClear}
            onClick={() => setSelected(new Set())}
          >清除</button>
          <div
            className={styles.selectionDrag}
            draggable
            onDragStart={e => {
              const series = buildSeriesFromSelected();
              e.dataTransfer.setData('application/ulog-series', JSON.stringify(series));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            title="拖曳所有已選欄位至圖表"
          >
            ⠿ 拖曳至圖表
          </div>
        </div>
      )}

      <div className={styles.treeList}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>無符合結果</div>
        ) : (
          filtered.map(topic => {
            const key = `${topic.name}:${topic.multiId}`;
            const isOpen = expanded.has(key);
            const fieldKeys = topic.fields.map(f => `${topic.name}:${topic.multiId}:${f}`);
            const allSelected = fieldKeys.length > 0 && fieldKeys.every(k => selected.has(k));
            const someSelected = fieldKeys.some(k => selected.has(k));
            return (
              <div key={key} className={styles.topicGroup}>
                <div
                  className={styles.topicRow}
                  onClick={() => toggle(key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && toggle(key)}
                >
                  {/* Topic 全選 checkbox */}
                  <input
                    type="checkbox"
                    className={styles.topicCheckbox}
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={e => {
                      e.stopPropagation();
                      toggleAllFields(key, topic.fields, topic.name, topic.multiId);
                    }}
                    onClick={e => e.stopPropagation()}
                    title="全選此 Topic 的欄位"
                  />
                  <span className={`${styles.arrow} ${isOpen ? styles.arrowOpen : ''}`}>▶</span>
                  <span className={styles.topicName}>{topic.name}</span>
                  {topic.multiId > 0 && (
                    <span className={styles.multiId}>[{topic.multiId}]</span>
                  )}
                  <span className={styles.freqBadge}>{topic.freqHz}Hz</span>
                </div>

                {isOpen && (
                  <div className={styles.fieldList}>
                    {topic.fields.map(field => {
                      const fieldKey = `${topic.name}:${topic.multiId}:${field}`;
                      const isChecked = selected.has(fieldKey);
                      return (
                        <div
                          key={field}
                          className={`${styles.fieldRow} ${isChecked ? styles.fieldRowSelected : ''}`}
                          draggable
                          onDragStart={e => onDragStart(e, topic.name, topic.multiId, field)}
                          title={isChecked && selected.size > 1
                            ? `拖曳所有 ${selected.size} 個已選欄位`
                            : `拖曳至圖表：${topic.name}.${field}`}
                        >
                          <input
                            type="checkbox"
                            className={styles.fieldCheckbox}
                            checked={isChecked}
                            onChange={() => toggleField(fieldKey)}
                            onClick={e => e.stopPropagation()}
                          />
                          <span className={styles.dragHandle}>⠿</span>
                          <span className={styles.fieldName}>{field}</span>
                          <span className={styles.fieldType}>{topic.fieldTypes[field]}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Metadata Panel ───────────────────────────────────────────────────────────

function MetadataPanel() {
  const { state } = useApp();
  const meta = state.summary?.metadata;
  const sum = state.summary;

  if (!meta || !sum) return <div className={styles.empty}>無資料</div>;

  const rows: [string, string][] = [
    ['系統名稱', meta.systemName],
    ['硬體版本', meta.hardwareVersion],
    ['韌體版本', meta.softwareVersion],
    ['Topic 數量', `${sum.topics.length}`],
    ['日誌訊息', `${sum.messages.length}`],
    ['飛行時長', `${(sum.durationUs / 1e6).toFixed(1)}s`],
  ];

  const params = Object.entries(meta.parameters).slice(0, 30);

  return (
    <div className={styles.metaPanel}>
      <div className={styles.metaSection}>
        <div className={styles.metaTitle}>基礎資訊</div>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.metaRow}>
            <span className={styles.metaKey}>{k}</span>
            <span className={styles.metaVal}>{v}</span>
          </div>
        ))}
      </div>

      {params.length > 0 && (
        <div className={styles.metaSection}>
          <div className={styles.metaTitle}>參數 ({Object.keys(meta.parameters).length})</div>
          <div className={styles.paramList}>
            {params.map(([k, v]) => (
              <div key={k} className={styles.paramRow}>
                <span className={styles.paramKey}>{k}</span>
                <span className={styles.paramVal}>{typeof v === 'number' ? v.toPrecision(6) : v}</span>
              </div>
            ))}
            {Object.keys(meta.parameters).length > 30 && (
              <div className={styles.moreHint}>...及 {Object.keys(meta.parameters).length - 30} 個更多參數</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Log Messages ─────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<string, string> = {
  EMERG: '#f87171', ALERT: '#f87171', CRIT: '#fb923c', ERR: '#f87171',
  WARNING: '#f59e0b', NOTICE: '#60a5fa', INFO: '#94a3b8', DEBUG: '#475569',
};

function LogMessages() {
  const { state } = useApp();
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set(['EMERG','ALERT','CRIT','ERR','WARNING','NOTICE','INFO']));
  const msgs = state.summary?.messages ?? [];

  const filtered = useMemo(() => {
    return msgs.filter(m =>
      levelFilter.has(m.level) &&
      (!search || m.message.toLowerCase().includes(search.toLowerCase()))
    );
  }, [msgs, search, levelFilter]);

  const toggleLevel = (lvl: string) => {
    setLevelFilter(prev => {
      const s = new Set(prev);
      s.has(lvl) ? s.delete(lvl) : s.add(lvl);
      return s;
    });
  };

  const startUs = state.summary?.startTimestampUs ?? 0;

  return (
    <div className={styles.logPanel}>
      <div className={styles.logFilters}>
        <input
          className={styles.searchInput}
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜尋日誌..."
          style={{ flex: 1 }}
        />
      </div>
      <div className={styles.levelToggles}>
        {['ERR','WARNING','INFO','DEBUG'].map(lvl => (
          <button
            key={lvl}
            className={`${styles.levelBtn} ${levelFilter.has(lvl) ? styles.levelActive : ''}`}
            style={{ '--lvl-color': LEVEL_COLORS[lvl] } as React.CSSProperties}
            onClick={() => toggleLevel(lvl)}
          >
            {lvl}
          </button>
        ))}
      </div>
      <div className={styles.logList}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>無日誌訊息</div>
        ) : (
          filtered.map((m, i) => (
            <div key={i} className={styles.logRow}>
              <span className={styles.logTime}>
                {((m.timestamp - startUs) / 1e6).toFixed(2)}s
              </span>
              <span className={styles.logLevel} style={{ color: LEVEL_COLORS[m.level] }}>
                {m.level}
              </span>
              <span className={styles.logMsg}>{m.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
