// 檔案：js/utils/dom.js
// 【新增】建立 DOM 元素的小工具。一律使用 textContent 寫入文字，
// 避免把商品名稱／備註／伺服器訊息等動態字串當成 HTML 解析（XSS 防護，取代 innerHTML 模板）。

/**
 * 建立帶 class 與文字的元素
 * @param {string} tag - 標籤名稱
 * @param {string} [className] - class 名稱
 * @param {string} [text] - 文字內容（以 textContent 寫入，不會被當成 HTML）
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
}

/**
 * 清空容器後放入一則純文字訊息（載入中／錯誤提示）
 * @param {HTMLElement} container - 容器
 * @param {string} text - 訊息文字
 * @param {string} [className] - 訊息元素的 class
 * @param {string} [tag='p'] - 訊息元素標籤
 */
export function setMessage(container, text, className, tag = 'p') {
    container.textContent = '';
    container.appendChild(el(tag, className, text));
}
