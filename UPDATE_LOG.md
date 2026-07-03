# Update Log (更新日誌)

本檔案用於記錄與管理每次合併請求 (Merge Request) 之前的更新項目。所有開發人員與 AI Agent 於調整代碼時均應嚴格遵守更新日誌管理規範。

---

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
