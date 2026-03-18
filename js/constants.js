// 檔案：js/constants.js
// 集中管理前端常數，避免程式碼中出現魔術數字（Magic Numbers）

/** 會員點數兌換比率：每 N 點折抵 1 元 */
export const POINTS_PER_CURRENCY_UNIT = 10;

/** SSE 斷線後重連延遲（毫秒） */
export const SSE_RECONNECT_DELAY_MS = 5000;

/** 盤點差異警告門檻（超過此數量差異時顯示額外警告） */
export const INVENTORY_VARIANCE_THRESHOLD = 5;
