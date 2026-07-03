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
