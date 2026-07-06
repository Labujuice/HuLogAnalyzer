# Update Log (更新日誌)

本檔案用於記錄與管理每次合併請求 (Merge Request) 之前的更新項目。所有開發人員與 AI Agent 於調整代碼時均應嚴格遵守更新日誌管理規範。

---

## [Branch: 0707_fix_topic_lost] (基於 `main` 分支 `d04f305` 節點切出)
* **日期**：2026-07-07
* **更新狀態**：已完成開發 / 準備合併
* **更新項目明細**：
  * **⚡ ULog 巢狀格式相依性與解析修復 (ULogParser)**：
    * **延遲與遞迴格式解析機制**：將 ULog 格式定義讀取 (`_parseFormat`) 與格式解析 (`_resolveFormat`) 解耦。在定義區讀取時，僅暫存原始欄位字串；定義區讀取完畢後，再對所有格式進行遞迴解析。這解決了當巢狀結構（如 `esc_report`）在外部結構（如 `esc_status`）之後被定義時，外部結構因無法找到內層定義而將其誤判為 `uint8_t[8]` 導致位元組大小、偏移量計算錯誤及後續數據讀取錯位的嚴重問題。
    * **循環依賴保護**：引入 `resolvingFormats` 追蹤集合，在遞迴解析時對正在解析的類型進行門控標記，防止惡意或毀損日誌中出現循環相依導致堆疊溢位。
    * **巢狀欄位展開還原**：修復後，`esc_status.esc[i].esc_rpm` 等巢狀陣列欄位均能正確展開，偏移量與型別解析無誤，馬達與電調 RPM 數據得以順利提取及繪製。

## [Branch: 0705_plot_feature] (基於 `main` 分支 `d04f305` 節點切出)
* **日期**：2026-07-05
* **更新狀態**：已完成開發 / 準備合併
* **更新項目明細**：
  * **✈️ 飛行狀態與模式工具箱 (StatusModePanel)**：
    * **飛行模式與解鎖狀態（獨立圖表）**：將 Flight Mode 與 Arming State 獨立出一個格子畫圖（`Flight Mode & Arming History`），採用階躍折線圖（Stepped Line）方式繪製，支援左右 Y 軸雙軸（左側為 Arm/Disarmed，右側為對應的 PX4 模式字串標籤如 POSCTL, ALTCTL, RTL...），時間軸與上方搖桿、下方 Failsafe 精確對齊。
    * **遙控器操縱桿多模式快捷分頁**：在背景同時平行載入 `manual_control_setpoint`、`rc_channels` 與 `input_rc`（若存在於日誌中），並在操縱桿圖表右上角新增快捷分頁切換器 `[Setpoint]`、`[RC Channels]` 與 `[Raw RC]`，使用者可隨時點擊切換比對。
    * **完整通道與 PWM 數值繪製**：切換至 `Raw RC (PWM us)` 分頁時，自動解析並繪製 `input_rc.values[0..n]` 的所有可用通道，並自動將 Y 軸範圍固定為與遙控信號相符的 `850 ~ 2150 us` 區間，展示完整的開關與微調旋鈕變化。
    * **事件日誌（Mission Event Log）**：優化右側日誌輸出，顯示 Mode Transitions 與 Safety & Failsafe Events 狀態。
  * **🧲 多磁力計同步模長與 EKF GSF 航向比對 (MagneticPanel)**：
    * **磁力計 `sensor_mag` 相容自動識別**：自動在 `vehicle_magnetometer` 與 `sensor_mag` 之間進行多實例檢測（Compass 0, 1, 2...），相容 `magnetometer_ga` 以及舊款 `x`、`y`、`z` 欄位命名，多個指南針對齊後直接疊加在同一個 Vector Norm 磁強圖表中。
    * **原始三軸圖表 (X, Y, Z)**：左側新增第三張圖表 `Raw 3-Axis Magnetic Values`，以 Gauss 為單位繪製 X、Y、Z 三軸原始地磁波形，並且在右上角提供了 Compass 實例的下拉選單 (Dropdown Selector)，供隨時切換不同 Compass 進行觀測。
    * **純磁力計傾角補償航向角 (Pure Mag Headings)**：藉由讀取姿態解算（`vehicle_attitude`）所得到的俯仰 (Pitch) 與橫滾 (Roll) 角度，對所有偵測到的磁力計實例（Compass 0, 1, 2...）進行即時傾角投影計算，得出各自的純地磁航向角，並在 `Multi-Source Heading Comparison` 中同時重疊繪製為獨立曲線（黃色、紫色、青色）。
    * **自訂曲線顯示 (Checkbox Selector)**：在航向比較圖標頭新增核取方塊控制列（EKF Yaw, GSF Yaw, GPS COG, Mag 0/1/2 Yaw），允許使用者自由勾選組合要在圖表中顯示的線條，點選後圖表即時刷新，且該設置與上方原始三軸資料的 Compass 實例選擇完全分離。
    * **全磁力計診斷清單**：右側診斷控制台改為循環列表展示所有偵測到的指南針實例，分別列出其平均模長 (Avg Norm)、磁力振盪幅度 (Fluct) 與 EMI 警告狀態，讓電磁干擾無所凸顯。
  * **📊 工具箱全圖表滑鼠滾輪縮放與橫軸同步 (Zoom & Pan Sync)**：
    * 在 `VibrationPanel` (FFT 圖表)、`PidResponsePanel` (2張圖表)、`MagneticPanel` (3張圖表)、`StatusModePanel` (3張圖表)、`MotorStatusPanel` (Actuator Output/RPM 圖表) 中全面實作了滑鼠滾輪 `'wheel'` 縮放事件。
    * 在 PID、磁力計、飛行狀態等包含複數圖表的模組中，使用了 `uPlot.sync` 共享縮放同步實例。當在同一個模組的任一圖表上使用滾輪縮放、游標懸浮或拖曳平移 (Pan) 時，其餘圖表皆會即時聯動更新，保證橫軸時間軸精確對齊。
  * **⚡ 開啟新繪圖視窗統一以 Blank Chart (空白圖表) 初始化**：
    * 修改了全域狀態管理 [appStore.tsx](file:///home/kenny/Git_KennySpace/HTML_uLog_analyzer/src/store/appStore.tsx)。現在不論是點擊水平/垂直分割視窗（`SPLIT_PANEL`），或是關閉最後一個視窗觸發重設（`REMOVE_PANEL`），新產生的繪圖面板類型均會統一且直接地初始化為 `type: 'chart'`（即空白圖表），使用者無需再手動點擊「建立空白圖表」按鈕，即可直接進行拖曳欄位繪圖。

## [Branch: 0704_optimize] (基於 `main` 分支 `2022367` 節點切出)
* **日期**：2026-07-04
* **更新狀態**：開發中 / 待合併
* **更新項目明細**：
  * **✈️ AHRS 儀表盤升級 (AhrsPanel)**：
    * 新增滾動式航向刻度帶（Compass Tape），包含方位角數位框及 cardinal points (N, E, S, W) 紅字提示。
    * 新增垂直滾動空速/地速刻度帶（Speed Tape），動態合成並插值 `vx` 與 `vy`。
    * 新增垂直滾動高度刻度帶（Altitude Tape），同步呈現本地高度 `-z`。
    * 新增垂直攀升率指示儀（VSI / Vario），動態指引爬升與下沉速度（$\pm 5\text{ m/s}$）。
  * **🗺️ 地圖視野自適應 (MapPanel)**：
    * 新增單次觸發的自動 `fitBounds` 軌跡視野對齊，在 GPS 快取資料載入完成時立即調整為最佳觀測角度，且不干擾後續的使用者手動縮放。
  * **🛸 3D 軌跡觀測器增強 (Attitude3dPanel)**：
    * 支援滑鼠中鍵拖曳進行平移（平移），靈敏度與相機縮放半徑自適應掛鉤。
    * 新增視角脫離後的懸浮式「📍 恢復跟隨」按鈕，點選即可重新鎖定無人機焦點。
  * **⚙️ 開發腳本標準化 (package.json & README.md)**：
    * 新增一鍵開啟 Dev + Preview 的伺服器腳本：`npm run serve:all`。
    * 新增一鍵殺除伺服器占用 Port 的腳本：`npm stop`。
  * **🛠️ 專案路徑規範 (Relative Path Rule)**：
    * 建立 `.agents/AGENTS.md` 並在 `README.md` 的開發和 AI Agent 執行規範中加入「強制使用相對路徑制」的規則，確保離線點開即用。
  * **🌐 全系統雙語切換 (i18n)**：
    * 於首頁 (LandingPage)、頂部狀態列 (TopBar)、播放控制列 (PlayBar)、圖表視窗 (ChartPanel) 及側邊欄 (Sidebar) 新增多語言翻譯字典支持。
    * 在狀態列及首頁右上角加上「語言切換」下拉選單，支援「English」與「繁體中文」，並預設為英文。
  * **🛸 3D 視野限制解除與遮擋修正 (Attitude3dPanel)**：
    * 解除 3D 相機縮放距離邊界（延伸為 1.0m 至 2000m），並解除相機俯仰俯視邊界（允許 0.01 到 $\pi - 0.01$），使用戶能從無人機下方等任意角度進行 3D 航線觀測。
    * 修正 WebGL 渲染快照漏洞，在更新路徑線段頂點時強制呼叫 `computeBoundingSphere` 與 `computeBoundingBox`，解決特定視角或移動平移時線段被 Frustum Culling 判定在視野外而意外消失的 Bug。
  * **🗺️ 2D 地貌地形圖支持 (MapPanel)**：
    * 在地圖面板控制項中，除了原本的「道路圖」與「衛星圖」外，新增「地形圖 (Google Terrain `lyrs=p`)」選項，提供立體陰影山體地貌、等高線物理地圖的疊加觀測。
  * **🎛️ 可自訂寬度側邊欄 (Sidebar Resize)**：
    * 於首頁核心版面 (`App.tsx` & `App.module.css`) 加入具備懸浮高亮提示（Cyan 霓虹發光）的縱向拖曳手柄。
    * 使用者可透過滑鼠直接左右拖曳側邊數據區，支援在 `200px` 與 `600px` 之間無縫調節寬度，解決長數據欄位名稱與參數標籤被截斷、看不到全貌的問題。
  * **📋 參數瀏覽器增強 (Metadata Explorer)**：
    * 在側邊欄基礎資訊分頁中，新增「全域參數搜尋 (Filter)」與「名稱排序 (Sorting: A-Z / Z-A)」的控制面板，支援實時針對參數名稱及設定數值進行動態過濾。
    * 新增「展開全部 (Show All)」與「收折部分」的摺疊切換，克服原本僅寫死顯示前 30 個參數的局限，讓使用者輕鬆查閱與篩選完整參數檔。
  * **🛰️ 3D 衛星空照地面投影與實時地貌垂線 (Attitude3dPanel)**：
    * 依據 ULog 日誌中的 GPS 起飛點自動計算與轉換 Web Mercator 坐標，動態計算飛行半徑，在 3D 面板非同步載入合適 Zoom 等級的 $3 \times 3$ Google 衛星照片做為地面背景貼圖。
    * 提供「🛰️ 衛星背景」快捷開關，使用者可視需求一鍵切換衛星底圖呈現或保留簡約三維格線。
    * 新增地面投影軌跡線與無人機對地垂線（Plumb Line），支援實時解析並插值 `dist_bottom` 欄位（地面測距儀數據），使三維垂線與地面軌跡線能隨著下方山體地貌起伏動態升降，如無地貌感測器則自動投影於平坦起飛面 ($Y = 0$)，極大增強了無人機相對地形高度的立體可視化表現。
  * **🔺 2D 地圖載具三角形圖標規範化 (MapPanel)**：
    * 將 2D 地圖中的無人機圖標更新為符合航天視覺規範的「黑色邊框、紅色填充」等腰三角形標記。
    * 修改 CSS 與 SVG 配置，修正雷達波紋與箭頭類名綁定，確保無人機圖標在任何地圖縮放級別 (Zoom In/Out) 下均維持恆定的物理像素尺寸，不隨地圖縮放而變形或縮小。
  * **🏷️ 3D 體座標系 FRD 指示儀 (Attitude3dPanel)**：
    * 於 3D 載具中心點動態綁定航空航天標準的 FRD（Forward-Right-Down）體座標軸。
    * 紅色代表 Forward (前軸，WebGL -Z 軸)；綠色代表 Right (右軸，WebGL +X 軸)；藍色代表 Down (下軸，WebGL -Y 軸)。
    * 新增 2D Canvas 繪製的遮罩穿透三維文字精靈 (Text Sprite F, R, D)，並置於三維箭頭頂端，即使相機移動旋轉也始終正面朝向屏幕，指示清晰直觀。
  * **🛸 3D 多重載具外型庫與動畫演繹 (Attitude3dPanel)**：
    * 新增 3D 載具模型選單，支援使用者自由切換以下六種高解析度 Primitive 機體外型：
      1. `X-type multirotor`：機身中心精簡比例（16cm x 6cm x 16cm），並使用兩個長方體 (BoxGeometry) 呈 90 度垂直交叉拼湊出機臂骨架。包含四個螺旋槳、紅色機頭標記，且螺旋槳旋轉速度會實時根據 `actuator_outputs` 或 `actuator_motors` 的馬達轉速平均值進行動力學插值模擬，真實呈現起飛大油門高速旋轉、懸停及落地慢速旋轉的物理效果。
      2. `Fixwing`：定翼飛機模型，包含主機翼、紅色翼尖、水平與垂直安定面，以及機頭高速旋轉的槳葉。
      3. `car`：陸地無人車，包含橙色底板、深色駕駛艙、防撞欄與四個在行進時滾動的黑色橡膠車輪。
      4. `turtle`：可愛海龜模型，包含墨綠色球形龜殼、頭部與四個在播放時擺動划水的鰭肢。
      5. `eagle`：雄鷹模型，包含白頭、黃喙與雙側大型羽翼，播放時會依據時脈拍打翅膀。
      6. `kabibala`：呆萌水豚模型，包含桶形軀幹、大頭、圓耳朵及瞇瞇眼，前行時四條小短腿會快速交替奔跑。
    * 藉由 `modelTypeRef` 與播放狀態的 `isPlayingRef`、`speedMultiplierRef` 繞過 React 閉包快照，修正播放時螺旋槳不旋轉與動態零件動畫靜止的 stale closure 漏洞，確保 60 FPS 渲染循環中動態零件（槳旋轉、輪捲動、雙翼拍打、四肢擺動）的動畫流暢度。
    * 新增 `sceneReady` 狀態門控機制，將其與模型構建 `useEffect` 進行同步綁定，修正 3D 檢視面板初始化首次載入時無人機模型偶發消失或未成功加載的渲染漏洞。
  * **📄 專案開源授權聲明 (LICENSE)**：
    * 於專案根目錄新增 MIT 授權條款宣告檔案 [LICENSE](./LICENSE)，與 `README.md` 開源條款聲明呼應。
  * **🎨 拖曳上傳區塊樣式修復 (LandingPage)**：
    * 修正首頁拖曳區的 camelCase 類名大小寫拼寫錯誤（`dropzone` 改為 `dropZone`，`dropzoneActive` 改為 `dragOver`），成功恢復虛線方框、背景微發光與拖曳時放大回饋之精美玻璃態外觀，指引用戶進行拖曳上傳。
  * **🏷️ 全域 GitHub 連結與版本更新日誌整合 (LandingPage & TopBar & Vite)**：
    * 於首頁上傳區底部 (LandingPage) 與日誌分析頁頂部狀態列 (TopBar) 同步新增 GitHub 項目鏈結與帶有 Build Date 的版本號 (`v1.1.2_20260704`)。
    * 版本號設定為可點選連結，並能根據目前的介面語言自動開啟對應的更新日誌檔：英文界面連至 `UPDATE_LOG_EN.md`，中文界面連至 `UPDATE_LOG.md`。
    * 修改 `vite.config.ts`, 新增 Vite 打包關閉後的 `copy-update-logs` 自訂 hook，在打包時自動將更新日誌複製至 `dist/`，保證離線狀態下雙擊 `dist/index.html` 時，點選版本號仍能成功以相對路徑開啟對應日誌。
