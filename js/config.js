// 檔案：js/config.js
// 【新增】集中管理前端執行環境設定，讓 api.js / sseClient.js / ws-client.js 共用同一個 API 基底 URL，
// 避免各檔案各自讀取環境變數、或在正式環境（API 與前端不同網域）使用相對路徑而連錯主機。

/** API 基底 URL；空字串代表使用相對路徑（開發時由 Vite proxy 轉發） */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
