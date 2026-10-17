// 檔案：js/constants.js
// 集中管理前端常數，避免程式碼中出現魔術數字（Magic Numbers）

// 【修改】已移除 POINTS_PER_CURRENCY_UNIT：點數折抵比率由後端品牌設定（redeemRate）決定，
// 前端結帳頁改用 POST /api/v1/orders/preview 的試算結果，不再自己用固定比率計算。

/** SSE 斷線後重連延遲（毫秒） */
export const SSE_RECONNECT_DELAY_MS = 5000;

/** 盤點差異警告門檻（超過此數量差異時顯示額外警告） */
export const INVENTORY_VARIANCE_THRESHOLD = 5;
