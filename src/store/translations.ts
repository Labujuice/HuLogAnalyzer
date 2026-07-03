/**
 * 多語言字典 (Trad. Chinese & English i18n)
 */

export const translations = {
  en: {
    // General / Status Bar
    appName: "PX4 ULog Analyzer",
    statusIdle: "Idle",
    statusLoading: "Loading File...",
    statusParsing: "Parsing ULog...",
    statusReady: "Ready",
    statusError: "Error",
    selectLanguage: "Language",
    
    // Sidebar
    openFile: "Open ULog File",
    selectTopics: "Select Topics",
    typeAttitude: "Attitude",
    typeHUD: "HUD",
    typeMap: "2D Map",
    type3d: "3D Trail",
    closePanel: "Close",
    dragPrompt: "Drag & drop fields here",
    searchTopics: "Search topics...",

    // Landing Page
    landingTitle: "PX4 ULog Flight Log Analyzer",
    landingSub: "High-performance, offline-first, private flight log analysis dashboard.",
    dropPrompt: "Drop a ULog file (.ulg) here or click to browse",
    sampleLogs: "Quick Test with Sample ULogs",
    featureStaticTitle: "Static Web App (Zero Install)",
    featureStaticDesc: "All log parsing and rendering runs offline in your local browser.",
    featurePrivateTitle: "Local & Private (No Upload)",
    featurePrivateDesc: "Your flight data never leaves your machine. Absolutely secure.",
    featurePerfTitle: "High-Performance Event Loop",
    featurePerfDesc: "Bypasses React virtual DOM diffing to guarantee a smooth 60 FPS playback.",
    featureWebGLTitle: "WebGL 3D Flight Path Replay",
    featureWebGLDesc: "Dynamic quadcopter rotation, NED coordinate translation, and dual-trail rendering.",

    // PlayBar
    speed: "Speed",
    utcTime: "UTC Time",
    localTime: "Local Time",
    flightMode: "Flight Mode",
    noLog: "No Log Loaded",

    // Chart Panel / Layout Controls
    panelLayout: "Layout",
    splitH: "Split Horizontal",
    splitV: "Split Vertical",
    deletePanel: "Delete Panel",
    changeView: "Change View",
    noSeries: "No Series Selected",
    addSeriesPrompt: "Drag fields from the sidebar or click here to add data series.",
    resetZoom: "Reset Zoom (Esc)",
    chartTitle: "Time-Series Chart",

    // 3D Panel
    panel3dTitle: "3D Real-Time Attitude & Flight Path Viewer",
    noAttitude: "⚠️ No attitude data found (`vehicle_attitude`)",
    resumeFollow: "📍 Resume Follow",

    // AHRS HUD
    panelHUDTitle: "AHRS PFD HUD",
    
    // Map Panel
    panelMapTitle: "2D Map & GPS Path Tracker",
    mapSatellite: "Satellite Hybrid",
    mapStreet: "Roadmap",
    mapTerrain: "Terrain",
    mapFollow: "Lock Follow",
    noGps: "⚠️ No GPS / position data found"
  },
  
  zh: {
    // General / Status Bar
    appName: "PX4 ULog Analyzer 飛行分析儀",
    statusIdle: "閒置",
    statusLoading: "讀取檔案中...",
    statusParsing: "解析 ULog 中...",
    statusReady: "已就緒",
    statusError: "錯誤",
    selectLanguage: "語言",

    // Sidebar
    openFile: "打開 ULog 檔案",
    selectTopics: "選擇數據主題",
    typeAttitude: "3D 姿態",
    typeHUD: "HUD 儀表",
    typeMap: "2D 地圖",
    type3d: "3D 軌跡",
    closePanel: "關閉",
    dragPrompt: "拖曳數值至此",
    searchTopics: "搜尋主題...",

    // Landing Page
    landingTitle: "PX4 ULog 飛行日誌分析儀表板",
    landingSub: "極致流暢、無須安裝、資料不外傳的專業無人機飛行日誌分析工具。",
    dropPrompt: "將 ULog 檔案 (.ulg) 拖曳至此或點擊瀏覽",
    sampleLogs: "使用範例日誌快速測試",
    featureStaticTitle: "純網頁靜態版（點開即用）",
    featureStaticDesc: "所有日誌解析與渲染均在本地瀏覽器離線完成，無須架設後端 Server。",
    featurePrivateTitle: "本機隱私安全（資料不外傳）",
    featurePrivateDesc: "您的飛行數據絕對不會上傳至任何伺服器，保證數據隱私安全。",
    featurePerfTitle: "極致流暢時脈與低開銷",
    featurePerfDesc: "時間發佈器直接驅動 DOM/Canvas，完全跳過 React DOM 比對，保證 60 FPS 播放。",
    featureWebGLTitle: "3D 實時姿態與航線軌跡",
    featureWebGLDesc: "動態四軸機體旋轉、起飛點原點映射，與紅（已飛）黃（未飛）雙色軌跡顯示。",

    // PlayBar
    speed: "播放速度",
    utcTime: "顯示 UTC 時間",
    localTime: "顯示本機時間",
    flightMode: "飛行模式",
    noLog: "未載入日誌",

    // Chart Panel / Layout Controls
    panelLayout: "面板配置",
    splitH: "水平分割",
    splitV: "垂直分割",
    deletePanel: "刪除面板",
    changeView: "切換視角",
    noSeries: "尚未加入數據",
    addSeriesPrompt: "請從左側拖曳數據主題欄位，或點選以加入圖表線條。",
    resetZoom: "重置縮放 (Esc)",
    chartTitle: "時序圖表",

    // 3D Panel
    panel3dTitle: "3D 實時姿態與航線軌跡觀測器",
    noAttitude: "⚠️ 找不到 3D 姿態數據 (`vehicle_attitude`)",
    resumeFollow: "📍 恢復跟隨",

    // AHRS HUD
    panelHUDTitle: "AHRS 航空儀表",

    // Map Panel
    panelMapTitle: "2D 地圖軌跡追蹤",
    mapSatellite: "衛星地圖",
    mapStreet: "道路地圖",
    mapTerrain: "地形地貌",
    mapFollow: "鎖定跟隨",
    noGps: "⚠️ 找不到 GPS / 位置數據"
  }
};

export type Language = 'en' | 'zh';

/**
 * 簡易翻譯取值輔助函式
 */
export function getTranslation(lang: Language, key: keyof typeof translations.en): string {
  return translations[lang][key] || translations.en[key] || String(key);
}
