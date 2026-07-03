# PX4 ULog Analyzer 🛸 飛行日誌視覺化分析儀表板 / Flight Log Visualization Dashboard

> **極致流暢、無須安裝、資料不外傳的專業無人機飛行日誌分析工具。**
> 
> **A high-performance, local-first, zero-install, and secure UAV flight log analysis tool.**

本專案是一個 100% 純前端（Client-side）的無人機 ULog 日誌分析儀表板。所有日誌解析與渲染均在本地瀏覽器（Web Worker & WASM）中完成，保證飛行數據的絕對隱私與安全。
This project is a 100% client-side UAV ULog flight analysis dashboard. All log parsing and rendering are performed locally in the browser (Web Worker & WASM), ensuring absolute privacy and security of flight data.

### 🚀 [點此開啟線上分析儀表板 / Click here to open Live App Demo](https://labujuice.github.io/HuLogAnalyzer/dist/)

---

## 🌟 核心功能特色 / Core Features

### 📊 1. 高效能時序數據圖表 / High-Performance Time-Series Chart (uPlot)
* **大數據降採樣對齊 / Downsampled Alignment (LTTB)**：在 ULog 數據量極大時，採用 LTTB 演算法對時間軸及各欄位同步降採樣，徹底解決數據點數不一導致的縮線 Bug。
  Uses the LTTB algorithm to downsample timestamps and fields synchronously for large ULog files, resolving alignment bugs caused by mismatched sample rates.
* **高流暢互動 / Fluent Interaction**：支援滑鼠滾輪縮放、中鍵拖曳平移、方向性左鍵拖曳（左拉放大、右拉縮小）、快速鍵一鍵重置視角（`Esc` / `R`）。
  Supports mouse wheel zoom in/out, middle button drag-to-pan, directional left-click drag (top-left to bottom-right to zoom in, bottom-right to top-left to zoom out), and hotkeys (`Esc` / `R`) to reset the viewport.
* **實時數值懸浮框 / Real-Time Value Tooltip**：完全繞過 React 渲染流程，直接以 DOM 驅動的數據 Tooltip，保證 60 FPS 級別的懸浮對齊流暢度。
  Bypasses React virtual DOM rendering, using direct DOM updates to render data tooltips at 60 FPS.
* **多維度欄位拖曳 / Multi-Field Drag & Drop**：支援 `Ctrl+Click` 與 `Shift+Click` 複選欄位，可成批拖曳進圖表中自動對齊並插值。
  Supports `Ctrl+Click` and `Shift+Click` to select multiple fields and drag them concurrently onto the chart with auto-interpolation.

### 🛸 2. 3D 實時姿態與軌跡觀測器 / 3D Real-Time Attitude & Path Viewer (Three.js)
* **三維模型動態回放 / Dynamic 3D Replay**：以 Three.js 動態建立高質感四軸飛行器模型，播放時實時解算四元數姿態進行三維旋轉。
  Creates a premium custom quadcopter model using Three.js, rotating it in real-time by solving attitude quaternions during playback.
* **起飛點為原點 / Takeoff Point as Origin**：讀取日誌本地位置第一點作為相對原點 `(0, 0, 0)`，自動將 NED (北-東-地) 座標平移映射至 WebGL 空間。
  Maps NED coordinates to WebGL axes relative to the takeoff location as origin `(0, 0, 0)`.
* **歷史/未來雙色軌跡 / Dual-Color Traveled & Remaining Paths**：
  * **🔴 紅色實線 / Red Solid Line**：代表已經飛過的歷史航線 / Traveled history trail.
  * **🟡 黃色實線 / Yellow Solid Line**：代表即將飛行的未來預計航線 / Remaining future path.
* **鏡頭控制與跟隨 / Camera Orbit & Follow**：鏡頭焦點鎖定無人機平滑平移，並支援按住左鍵任意旋轉視角與滾輪縮放。
  Smoothly locks onto the drone position while supporting orbital rotation via left-click drag and zoom via scroll wheel.
* **中鍵平移與一鍵恢復跟隨 / Middle-Button Pan & One-Click Follow Reset**：支援按住滑鼠中鍵在 3D 空間中移動相機鏡頭焦點；一旦進行手動平移便會解除鎖定，並在右下角顯示毛玻璃質感的「恢復跟隨」按鈕。
  Allows panning camera target using middle mouse button. If panned, follow mode is paused, and a floating blur-effect button "Resume Follow" appears to lock focus back on the drone.

### ✈️ 3. AHRS 航空水平儀 HUD / 2D Canvas AHRS PFD HUD (Canvas 2D)
* **主飛行指示器 / Primary Flight Display (PFD)**：在圓形遮罩下以 HTML5 Canvas 實時渲染航空級水平儀儀表。
  Renders an aviation-grade primary flight instrument inside a circular mask at 60 FPS.
* **航向與高度刻度帶 / Heading & Altitude Tapes**：頂端包含 scrolling compass tape（顯示度數與紅字 N/E/S/W 方位標記）；左右兩側分別設有垂直滑動的 airspeed tape 與 altitude tape。
  Displays a scrolling compass tape at the top (with digital readout and cardinal points) and vertical speed/altitude tapes on the sides.
* **垂直速度爬升率 / Vertical Speed Indicator (VSI)**：位於高度帶右側，實時指出上升或下降速率（$\pm 5\text{ m/s}$）。
  Renders a vertical rate of climb indicator scale next to the altitude tape.

### 🗺️ 4. 2D GIS 地圖軌跡追蹤 / 2D GIS Map Trajectory Tracker (Leaflet)
* **無須 API Key 的底圖 / Zero-Key Tile Map**：整合 Google 的衛星混合圖 (Satellite Hybrid) 與向量道路圖 (Roadmap)，隨時一鍵切換。
  Integrates Google Hybrid Satellite and Vector Roadmap tile layers with offline compatibility.
* **雙色軌跡路徑 / Dual-Color Path Segmenting**：
  * **🔴 紅色實線 / Red Solid Line**：代表已飛過的歷史軌跡 / Traveled history trail.
  * **🟡 黃色虛線 / Yellow Dashed Line**：代表尚未飛過的未來預計軌跡 / Remaining future path.
* **跟隨鎖定與自適應視野 / Follow Mode & fitBounds**：支援指針跟隨與根據偏航角（Yaw）實時旋轉。在 GPS 數據載入完畢後，自動執行一次完整視野對焦（`fitBounds`）。
  Aligns vehicle pointer rotation with Yaw. Autocenters view if Follow is checked, and triggers a one-time `fitBounds` fit when data loads.

### ⚡ 5. 極致流暢時脈與零 React 負載 / Zero-React High-Frequency Playback Loop
* **時間發佈器機制 / Time Publisher Event Loop**：建立純 JS 的高頻時間事件訂閱機制。播放時直接驅動 DOM 元素、uPlot、Three.js 與 Leaflet，**完全跳過 React 的 Virtual DOM 比對**，大幅降低 CPU 負載。
  A high-frequency pub/sub time emitter directly triggers timeline, charts, Leaflet, and WebGL updates, bypassing React virtual DOM diffing entirely to maintain a stable 60 FPS playback.
* **高精準時脈 / Precise Timing**：播放速度精準契合物理時間，支援 0.25x ~ 10x 倍速。
  Aligns RAF cycles to actual elapsed time, offering 0.25x to 10x speeds.

---

## 🛠️ 本地開發與編譯 / Local Development & Build

### 1. 安裝環境 / Prerequisite Installation
本專案基於 **Node.js**、**Vite** 與 **TypeScript** 建置。請先複製專案並安裝依賴：
This project is built on Node.js, Vite, and TypeScript. Clone the repo and install dependencies:
```bash
npm install
```

### 2. 啟動本機開發與測試伺服器 / Running Dev & Preview Servers
* **僅啟動開發伺服器 (即時熱重載 HMR) / Dev Server (Hot Module Replacement)**：
  ```bash
  npm run dev
  ```
  啟動後可在瀏覽器開啟 `http://localhost:5173/` 進行即時開發偵錯。
  Serves files from source with HMR at `http://localhost:5173/`.

* **僅啟動編譯產物預覽伺服器 / Preview Server (Static Production Assets)**：
  ```bash
  npm run preview
  ```
  啟動後可在瀏覽器開啟 `http://localhost:4173/` 測試已打包的 `dist` 靜態部署檔。
  Serves production files from `dist/` at `http://localhost:4173/`.

* **一鍵同時啟動雙伺服器 (開發 + 靜態預覽) / Concurrent Double-Server Serve**：
  ```bash
  npm run serve:all
  ```
  同時在背景執行 Dev 伺服器 (`:5173`) 與 Preview 伺服器 (`:4173`)。
  Runs both servers concurrently in the background.

* **關閉所有測試伺服器 / Stopping Servers**：
  ```bash
  npm stop
  ```
  一鍵釋放並關閉 Port `5173` 與 Port `4173` 的所有背景伺服器。
  Kills processes binding to ports 5173 and 4173.

### 3. 編譯為生產環境靜態網頁 / Production Build
```bash
npm run build
```
編譯完成後，所有的靜態網頁產物均會輸出至 **`dist/`** 資料夾。
Outputs compiled production assets to `dist/`. Since `base: './'` is configured, you can double-click `dist/index.html` to open it offline.

---

## 📝 更新日誌與合併管理規範 / Update Log & Merge Management Rules

為了維持專案更新歷程的清晰性，本專案採用雙軌制更新日誌管理。不論是**人類開發人員**或 **AI Coding Agent** 均須嚴格遵守以下操作規範：
To maintain a clean version history, this project enforces strict update log rules. Both **human developers** and **AI Coding Agents** must adhere to the following specifications:

### 1. 更新日誌路徑 / File Path & Dual-Track Files
* 繁體中文異動記錄必須寫入 / Traditional Chinese changelogs must be written to: [UPDATE_LOG.md](./UPDATE_LOG.md)
* 英文異動記錄必須寫入 / English changelogs must be written to: [UPDATE_LOG_EN.md](./UPDATE_LOG_EN.md)

### 2. 分支開發規範 / Branch Development Guidelines
* 當從 `main` 分支切出新分支進行開發時（例如當前分支 `0704_optimize` 係由 `main` 分支 `2022367` 節點切出）：
  When creating a feature branch (e.g. branch `0704_optimize` cut from `main` commit `2022367`):
  * **必須**在兩個日誌檔案的**最頂端**建立一個全新的最新區塊。
    **MUST** insert a new entry block at the very **top** of both update logs.
  * 標題格式必須對齊如下：
    Header format must be strictly structured as follows:
    * `UPDATE_LOG.md` (TC): `## [Branch: 分支名稱] (基於 main 分支 CommitID 節點切出)`
    * `UPDATE_LOG_EN.md` (EN): `## [Branch: Branch_Name] (Cut from main branch at CommitID)`
  * 於該分支進行的任何代碼調整與功能變更，皆須同步在該區塊的 `更新項目明細 / Changelog Details` 中進行即時增修。
    Add and maintain precise descriptions under the changelog bullets as changes accumulate.

### 3. 主分支直接提交規範 / Direct Commits on `main` Branch
* 如果是直接在 `main` 主分支上進行調整或修復：
  If committing directly to the `main` branch:
  * **每一次的 Commit** 都必須同時修改並更新 `UPDATE_LOG.md` 與 `UPDATE_LOG_EN.md`，在最頂端的區塊（或新增對應日期的區塊）中加上本次 Commit 調整項目的說明。
    **Every single commit** must append corresponding descriptions to the top section of both update log files.

### 🤖 4. 給 AI Agent 的特別調度指令 / Machine-Readable Instructions for LLM & AI Agents
> [!IMPORTANT]
> **LLM / AI Agent Action Protocol:**
> 1. **Read Logs First**: Before writing any code, search and read [UPDATE_LOG.md](./UPDATE_LOG.md) and [UPDATE_LOG_EN.md](./UPDATE_LOG_EN.md) to parse the current work state.
> 2. **Identify Current Branch**: Run `git branch` or `git status` to determine the active branch name and its origin parent.
> 3. **Append Changes Dynamically**: Before finishing the turn or creating a commit, you **MUST** write the details of your modifications to the top section of both `UPDATE_LOG.md` and `UPDATE_LOG_EN.md`. If a new branch was just cut from `main`, you must create the branch section header at the top of the files.
> 4. **Enforce Relative Paths**: Ensure all file paths, package outputs, and import statements utilize **relative paths** (`./` or `../`). Absolute paths (e.g. `/assets/...`) are strictly prohibited in code references.
> 5. **Commit Documentation**: Keep all update log modifications grouped in your final commit. Do not skip document updates.

### 5. 相對路徑制規範 / Relative Path System
* **TC**: 本專案內所有檔案引用、資源載入、打包路徑與開發路徑，皆必須強制使用**相對路徑**（例如 `./assets/...` 或 `../components/...`），嚴禁使用絕對路徑（例如以 `/` 開頭的路徑）。這可確保編譯後的 `dist/` 靜態檔案可以藉由雙擊 `index.html` 離線直接啟動（點開即用）。
* **EN**: All file references, resource loading, asset compilation paths, and source code imports in this project MUST strictly use **relative paths** (e.g., `./assets/...` or `../components/...`). Absolute paths (e.g., starting with `/`) are strictly prohibited. This ensures the compiled `dist/index.html` can be double-clicked to run offline directly.

---

## 📄 授權條款 / License
本專案採用 MIT 授權條款。 / This project is licensed under the MIT License.
