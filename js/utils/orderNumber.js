// 檔案：js/utils/orderNumber.js
// 【新增】取餐號碼：訂單號碼格式為 {storeId}-{yyyyMMdd}-{seq:04d}，
// 前端只顯示最後一段（流水號）作為取餐號碼。

/**
 * @param {string|null|undefined} orderNumber - 完整訂單號碼，例如 "1-20260101-0007"
 * @returns {string} 取餐號碼，例如 "0007"；無法解析時回傳原字串（null 回傳空字串）
 */
export function getPickupNumber(orderNumber) {
    if (orderNumber === null || orderNumber === undefined) return '';
    const text = String(orderNumber).trim();
    if (!text) return '';
    const parts = text.split('-');
    return parts[parts.length - 1];
}
