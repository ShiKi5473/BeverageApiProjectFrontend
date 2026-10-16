import { connectToWebSocket } from './ws-client.js';
import { toastManager } from './components/Notification.js';
import { isAuthenticated } from './auth.js';
import logger from './utils/logger.js';

// 【新增】每個頁面只維持一條 STOMP 連線，避免重複呼叫 initAppNotifications 造成重複通知
let activeClient = null;

/**
 * 啟動全域通知監聽（訂閱 /user/queue/orders 個人訂單通知）
 * 【修改】不再需要 storeId：後端已移除 /topic/kds/store/{id} 廣播，只剩個人通知
 */
export function initAppNotifications() {
    if (!isAuthenticated()) {
        logger.debug("使用者未登入，不啟動通知連線");
        return;
    }
    if (activeClient) return;

    try {
        activeClient = connectToWebSocket(
            handleOrderNotification,
            () => logger.info("全域即時通知連線成功"),
            (err) => logger.warn("全域通知連線異常:", err)
        );
    } catch (e) {
        logger.error("啟動全域通知失敗:", e);
    }

    // 離開頁面時關閉連線
    window.addEventListener('pagehide', () => {
        if (activeClient) {
            activeClient.deactivate();
            activeClient = null;
        }
    });
}

/**
 * 處理 /user/queue/orders 的通知
 * @param {{orderNumber: string, status: string, message: string}} payload
 */
function handleOrderNotification(payload) {
    const type = payload.status === 'READY_FOR_PICKUP' ? 'success' : 'info';
    // Notification.js 以 textContent 輸出，伺服器訊息不會被當成 HTML 解析
    toastManager.show("訂單狀態更新", payload.message, type);

    // 【修改】改用 CustomEvent 通知特定頁面（例如 online_order 的進度追蹤），
    // 取代原本掛在 window 上的全域函式 dispatchOrderNotification
    document.dispatchEvent(new CustomEvent('order-status-changed', { detail: payload }));
}
