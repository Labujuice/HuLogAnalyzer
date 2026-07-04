import React, { useState, useMemo, useCallback } from 'react';
import { useApp } from '../store/appStore';
import { CHART_COLORS } from '../types/ulog';
import type { ChartSeries } from '../types/ulog';
import { QuickPlotPresets } from './QuickPlotPresets';
import styles from './Sidebar.module.css';

type SidebarTab = 'topics' | 'info' | 'messages';

export function Sidebar({ width }: { width?: number }) {
  const { state } = useApp();
  const [activeTab, setActiveTab] = useState<SidebarTab>('topics');

  return (
    <aside className={styles.root} style={width ? { width } : undefined}>
      <div className={styles.tabs}>
        {([
          ['topics', state.language === 'en' ? 'Topics' : '主題數據'],
          ['info', state.language === 'en' ? 'Metadata' : '日誌資訊'],
          ['messages', state.language === 'en' ? 'Messages' : '系統日誌']
        ] as [SidebarTab, string][]).map(([id, label]) => (
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
        {activeTab === 'topics' && (
          <div className={styles.topicsSplitWrapper}>
            <div className={styles.topicsTreeSection}>
              <TopicTree />
            </div>
            <div className={styles.presetsSection}>
              <QuickPlotPresets />
            </div>
          </div>
        )}
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
  const [lastClickedKey, setLastClickedKey] = useState<string | null>(null);

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

  const handleFieldClick = useCallback((e: React.MouseEvent, fieldKey: string) => {
    if (e.ctrlKey || e.metaKey) {
      toggleField(fieldKey);
      setLastClickedKey(fieldKey);
    } else if (e.shiftKey && lastClickedKey) {
      const flatVisibleFields: string[] = [];
      for (const topic of topics) {
        const topicKey = `${topic.name}:${topic.multiId}`;
        if (expanded.has(topicKey)) {
          for (const f of topic.fields) {
            flatVisibleFields.push(`${topic.name}:${topic.multiId}:${f}`);
          }
        }
      }

      const idx1 = flatVisibleFields.indexOf(lastClickedKey);
      const idx2 = flatVisibleFields.indexOf(fieldKey);

      if (idx1 >= 0 && idx2 >= 0) {
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        const toAdd = flatVisibleFields.slice(start, end + 1);

        setSelected(prev => {
          const s = new Set(prev);
          toAdd.forEach(k => s.add(k));
          return s;
        });
      }
      setLastClickedKey(fieldKey);
    } else {
      setSelected(new Set([fieldKey]));
      setLastClickedKey(fieldKey);
    }
  }, [expanded, topics, lastClickedKey]);

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

  if (!state.summary) return <div className={styles.empty}>{state.language === 'en' ? 'No ULog file loaded' : '尚未載入 ULog 檔案'}</div>;

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
          placeholder={state.language === 'en' ? 'Search Topic / Field...' : '搜尋 Topic / 欄位...'}
          id="sidebar-search"
        />
        {search && (
          <button className={styles.clearBtn} onClick={() => setSearch('')} title={state.language === 'en' ? 'Clear search' : '清除搜尋'}>×</button>
        )}
      </div>

      {/* 多選提示列 */}
      {selectedCount > 0 && (
        <div className={styles.selectionBar}>
          <span className={styles.selectionCount}>
            {state.language === 'en' ? `Selected ${selectedCount} fields` : `已選 ${selectedCount} 個欄位`}
          </span>
          <button
            className={styles.selectionClear}
            onClick={() => setSelected(new Set())}
          >
            {state.language === 'en' ? 'Clear' : '清除'}
          </button>
          <div
            className={styles.selectionDrag}
            draggable
            onDragStart={e => {
              const series = buildSeriesFromSelected();
              e.dataTransfer.setData('application/ulog-series', JSON.stringify(series));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            title={state.language === 'en' ? 'Drag all selected fields to chart' : '拖曳所有已選欄位至圖表'}
          >
            ⠿ {state.language === 'en' ? 'Drag to chart' : '拖曳至圖表'}
          </div>
        </div>
      )}

      <div className={styles.treeList}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>{state.language === 'en' ? 'No matches' : '無符合結果'}</div>
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
                          onClick={e => handleFieldClick(e, fieldKey)}
                          title={isChecked && selected.size > 1
                            ? `拖曳所有 ${selected.size} 個已選欄位`
                            : `拖曳至圖表：${topic.name}.${field}`}
                        >
                          <input
                            type="checkbox"
                            className={styles.fieldCheckbox}
                            checked={isChecked}
                            onChange={(e) => {
                              // We let handleFieldClick handle selection, but if the checkbox itself is toggled:
                              e.stopPropagation();
                              toggleField(fieldKey);
                            }}
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

  const [paramSearch, setParamSearch] = useState('');
  const [showAllParams, setShowAllParams] = useState(false);
  const [paramSort, setParamSort] = useState<'none' | 'name-asc' | 'name-desc'>('none');

  if (!meta || !sum) return <div className={styles.empty}>{state.language === 'en' ? 'No data' : '無資料'}</div>;

  const rows: [string, string][] = [
    [state.language === 'en' ? 'System Name' : '系統名稱', meta.systemName],
    [state.language === 'en' ? 'Hardware Ver' : '硬體版本', meta.hardwareVersion],
    [state.language === 'en' ? 'Firmware Ver' : '韌體版本', meta.softwareVersion],
    [state.language === 'en' ? 'Topic Count' : 'Topic 數量', `${sum.topics.length}`],
    [state.language === 'en' ? 'Log Messages' : '日誌訊息', `${sum.messages.length}`],
    [state.language === 'en' ? 'Flight Duration' : '飛行時長', `${(sum.durationUs / 1e6).toFixed(1)}s`],
  ];

  // 搜尋與過濾參數
  const fullParams = Object.entries(meta.parameters);
  const filteredParams = fullParams.filter(([k, v]) => {
    const q = paramSearch.toLowerCase().trim();
    if (!q) return true;
    return k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q);
  });

  // 排序參數
  const sortedParams = [...filteredParams];
  if (paramSort === 'name-asc') {
    sortedParams.sort((a, b) => a[0].localeCompare(b[0]));
  } else if (paramSort === 'name-desc') {
    sortedParams.sort((a, b) => b[0].localeCompare(a[0]));
  }

  // 是否需要截斷
  const hasActiveSearch = paramSearch.trim().length > 0;
  const displayParams = (showAllParams || hasActiveSearch) 
    ? sortedParams 
    : sortedParams.slice(0, 30);

  const totalCount = fullParams.length;
  const filteredCount = filteredParams.length;

  return (
    <div className={styles.metaPanel}>
      <div className={styles.metaSection}>
        <div className={styles.metaTitle}>{state.language === 'en' ? 'Basic Info' : '基礎資訊'}</div>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.metaRow}>
            <span className={styles.metaKey}>{k}</span>
            <span className={styles.metaVal}>{v}</span>
          </div>
        ))}
      </div>

      {totalCount > 0 && (
        <div className={styles.metaSection}>
          <div className={styles.metaTitle}>
            <span>
              {state.language === 'en' ? 'Parameters' : '參數'} ({filteredCount}/{totalCount})
            </span>
          </div>

          {/* 參數搜尋與排序控制列 */}
          <div className={styles.paramControls}>
            <input
              type="text"
              className={styles.paramSearchInput}
              value={paramSearch}
              onChange={(e) => setParamSearch(e.target.value)}
              placeholder={state.language === 'en' ? 'Search parameters...' : '搜尋參數與數值...'}
            />
            <button
              className={`${styles.paramSortBtn} ${paramSort !== 'none' ? styles.active : ''}`}
              onClick={() => {
                setParamSort(prev => {
                  if (prev === 'none') return 'name-asc';
                  if (prev === 'name-asc') return 'name-desc';
                  return 'none';
                });
              }}
              title={
                paramSort === 'none'
                  ? (state.language === 'en' ? 'Sort alphabetically' : '字母排序')
                  : paramSort === 'name-asc'
                    ? (state.language === 'en' ? 'Sort Z-A' : '反向排序')
                    : (state.language === 'en' ? 'Reset sort' : '取消排序')
              }
            >
              {paramSort === 'none' ? 'Sort' : paramSort === 'name-asc' ? 'A-Z ↓' : 'Z-A ↑'}
            </button>
          </div>

          <div className={styles.paramList} style={{ maxHeight: '350px' }}>
            {displayParams.map(([k, v]) => (
              <div key={k} className={styles.paramRow}>
                <span className={styles.paramKey} title={k}>{k}</span>
                <span className={styles.paramVal}>{typeof v === 'number' ? v.toPrecision(6) : v}</span>
              </div>
            ))}
            
            {/* Show All / Show Less 展開按鈕 */}
            {!hasActiveSearch && sortedParams.length > 30 && (
              <button
                className={styles.showAllBtn}
                onClick={() => setShowAllParams(!showAllParams)}
              >
                {showAllParams 
                  ? (state.language === 'en' ? 'Show Less' : '▲ 顯示部分')
                  : (state.language === 'en' ? `Show All (${sortedParams.length})` : `▼ 顯示全部 (${sortedParams.length})`)
                }
              </button>
            )}

            {hasActiveSearch && displayParams.length === 0 && (
              <div className={styles.emptyParamsHint}>
                {state.language === 'en' ? 'No matching parameters' : '無符合的參數'}
              </div>
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
          placeholder={state.language === 'en' ? 'Search logs...' : '搜尋日誌...'}
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
          <div className={styles.empty}>{state.language === 'en' ? 'No log messages' : '無日誌訊息'}</div>
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
