# Behavioral Rules (專案開發規範)

## Relative Path System (相對路徑制)
* **Rule (TC)**: 本專案內所有檔案引用、資源載入、打包路徑與開發路徑，皆必須強制使用**相對路徑**（例如 `./assets/...` 或 `../components/...`），嚴禁使用絕對路徑（例如以 `/` 開頭的路徑）。這可確保編譯後的 `dist/` 靜態檔案可以藉由雙擊 `index.html` 離線直接啟動（點開即用）。
* **Rule (EN)**: All file references, resource loading, asset compilation paths, and source code imports in this project MUST strictly use **relative paths** (e.g., `./assets/...` or `../components/...`). Absolute paths (e.g., starting with `/`) are strictly prohibited. This ensures the compiled `dist/index.html` can be double-clicked to run offline directly.
