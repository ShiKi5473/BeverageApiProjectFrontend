// 檔案：js/utils/escapeHtml.js
// 【新增】XSS 防護：跳脫要插入 innerHTML 模板的動態字串。
// 背景：JWT 存在 localStorage，商品名稱／備註／選項名稱若含 <script> 或 onerror 等內容，
// 直接以模板字串寫入 innerHTML 會在所有員工的 POS 上執行腳本。

const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
};

/**
 * 跳脫 HTML 特殊字元（可安全用於元素內容與屬性值）
 * null / undefined 會轉為空字串；數字等其他型別會先轉成字串
 * @param {unknown} value - 任意動態值
 * @returns {string} 已跳脫的字串
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

/**
 * 驗證圖片／連結網址，僅允許 http(s)、站內絕對路徑與 data:image，
 * 擋掉 javascript: 之類的危險協定。不合法時回傳空字串。
 * @param {unknown} url - 後端回傳的網址
 * @returns {string} 安全網址或空字串
 */
export function sanitizeUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    if (!trimmed) return '';
    // 站內絕對路徑（以單一 / 開頭；// 開頭是協定相對網址，一併排除）
    if (/^\/(?!\/)/.test(trimmed)) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^data:image\/(png|jpe?g|gif|webp);/i.test(trimmed)) return trimmed;
    return '';
}
