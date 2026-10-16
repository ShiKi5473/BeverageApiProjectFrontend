// 檔案：js/utils/idempotency.js
// 【新增】Idempotency-Key 管理：同一次「送出」只產生一個 key，網路失敗重試時沿用，
// 讓後端重放第一次的結果而不是重複建單。

/** 產生新的冪等鍵（crypto.randomUUID 需要安全環境；不支援時退回隨機字串） */
export function createIdempotencyKey() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 建立一個 key 持有者：
 * - 內容（payload）完全相同的重試 -> 回傳同一個 key
 * - 內容改變（使用者改了購物車/點數）-> 換新 key，避免後端把新內容當成舊請求重放
 * - 成功後呼叫 reset() 清掉，下一次送出才會用新 key
 */
export function createIdempotencyHolder() {
    let key = null;
    let fingerprint = null;
    return {
        getKey(payload) {
            const fp = JSON.stringify(payload);
            if (!key || fp !== fingerprint) {
                key = createIdempotencyKey();
                fingerprint = fp;
            }
            return key;
        },
        reset() {
            key = null;
            fingerprint = null;
        },
    };
}
