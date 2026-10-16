// 檔案：js/utils/format.js
// 【新增】數字與日期格式化的純函式（report.js / inventory_audit.js 共用）

/**
 * 千分位格式化；null / undefined / NaN 以 0 顯示（原本 num.toString() 遇到 null 會拋 TypeError）
 */
export function formatNumber(num) {
    const n = Number(num);
    const safe = Number.isFinite(n) ? n : 0;
    return safe.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 以「本地時區」輸出 YYYY-MM-DD。
 * 不用 toISOString()/valueAsDate，因為它們以 UTC 計算，台灣早上 8 點前會差一天。
 * @param {Date} date
 */
export function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
