// 檔案：js/utils/sseClient.js
// 共用 SSE 連線工具，整合 ticket 取得與自動重連邏輯
// 解決 pos.js 與 kds.js 中重複的 SSE 連線程式碼

import { getSseTicket } from '../api.js';
import logger from './logger.js';
import { SSE_RECONNECT_DELAY_MS } from '../constants.js';

/**
 * 建立 SSE 連線（含 ticket 取得與自動重連）
 *
 * 流程：先向後端取得一次性 ticket，再用 ticket 建立 EventSource。
 * EventSource API 不支援自訂 Header，因此使用短期 ticket 避免 JWT 暴露在 URL 中。
 * 斷線時會自動重新取得 ticket 並重連（因為舊 ticket 已被後端銷毀，不能依賴 EventSource 自動重連）。
 *
 * @param {string} url - SSE endpoint 路徑（不含 ticket 參數，例如 '/api/v1/kds/stream'）
 * @param {object} callbacks - 回呼函式集合
 * @param {Function} callbacks.onMessage - 收到訊息時呼叫，參數為 (action, payload)
 * @param {Function} [callbacks.onOpen] - 連線成功時呼叫
 * @param {Function} [callbacks.onError] - 連線錯誤時呼叫，參數為 (error)
 * @returns {{ close: Function }} 控制物件，呼叫 close() 可手動關閉連線並停止重連
 */
export function createSseConnection(url, callbacks) {
    let closed = false;

    async function connect() {
        if (closed) return;
        try {
            // 取得一次性 SSE ticket（有效期 30 秒，僅限使用一次）
            const ticket = await getSseTicket();

            // 用 ticket 建立 SSE 連線（後端驗證後會立即銷毀 ticket）
            const eventSource = new EventSource(`${url}?ticket=${ticket}`);

            eventSource.onopen = () => {
                if (callbacks.onOpen) callbacks.onOpen();
            };

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    callbacks.onMessage(data.action, data.payload);
                } catch (e) {
                    logger.error('SSE 訊息解析失敗:', e);
                }
            };

            // 連線錯誤：關閉當前連線並延遲後重新取得 ticket 再重連
            eventSource.onerror = (err) => {
                logger.error('SSE 連線錯誤:', err);
                eventSource.close();
                if (callbacks.onError) callbacks.onError(err);
                if (!closed) {
                    setTimeout(connect, SSE_RECONNECT_DELAY_MS);
                }
            };
        } catch (error) {
            // ticket 取得失敗，延遲後重試
            logger.error('取得 SSE ticket 失敗，稍後重試:', error);
            if (callbacks.onError) callbacks.onError(error);
            if (!closed) {
                setTimeout(connect, SSE_RECONNECT_DELAY_MS);
            }
        }
    }

    connect();

    return {
        close: () => { closed = true; }
    };
}
