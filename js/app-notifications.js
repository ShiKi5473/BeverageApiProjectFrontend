import { connectToWebSocket } from './ws-client.js';
import { toastManager } from './components/Notification.js';
import { getStoreId, isAuthenticated } from './auth.js';
import logger from './utils/logger.js';

/**
 * 啟動全域通知監聽
 */
export async function initAppNotifications() {
    if (!isAuthenticated()) {
        logger.debug("使用者未登入，不啟動通知連線");
        return;
    }

    const storeId = getStoreId();
    if (!storeId) {
        logger.warn("找不到 storeId，無法完整訂閱通知");
        // 即使沒 storeId，或許還是可以連線受 user 特定通知 (如果是消費者)
    }

    try {
        await connectToWebSocket(
            storeId || 0, 
            handleGlobalMessage,
            () => logger.info("全域即時通知連線成功"),
            (err) => logger.error("全域通知連線失敗:", err)
        );
    } catch (e) {
        logger.error("啟動全域通知失敗:", e);
    }
}

/**
 * 處理來自 WebSocket 的所有訊息
 * @param {string} action - 動作類型
 * @param {object} payload - 數據
 */
function handleGlobalMessage(action, payload) {
    if (action === 'USER_NOTIFICATION') {
        const type = payload.status === 'READY_FOR_PICKUP' ? 'success' : 'info';
        toastManager.show(
            "訂單狀態更新", 
            payload.message, 
            type
        );
        
        // Trigger global event for specific pages (like online_order.html tracker)
        if (typeof window.dispatchOrderNotification === 'function') {
            window.dispatchOrderNotification(payload);
        }
    } else {
        // 可以在這裡處理其他類型的推播 (例如：系統維護公告)
        logger.debug("收到未定義動作的 WS 訊息:", action, payload);
    }
}

// 自動啟動 (如果是在網頁中直接載入此 module)
// initAppNotifications();
