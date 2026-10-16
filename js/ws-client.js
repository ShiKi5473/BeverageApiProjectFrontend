// 檔案：js/ws-client.js
// 【重寫】STOMP 即時通知用戶端
// 1. 以 @stomp/stompjs 取代已停止維護的 stompjs@2.3.3
// 2. 後端 endpoint 使用 withSockJS()，因此用 webSocketFactory 包 SockJS
// 3. reconnectDelay 自動重連 + 心跳；每次重連前重新讀取最新 token
// 4. 關閉 debug：舊版預設會把含 Authorization 的 CONNECT frame 印到 console
// 5. 只訂閱 /user/queue/orders（移除後端從不發送的 /topic/kds/store/{id}）
// 6. 不再於此處 prompt 訪客登入（訪客登入由 online_order.js 負責，需要 brandId）

import { Client } from '@stomp/stompjs';
import SockJS from 'sockjs-client';
import logger from './utils/logger.js';
import { API_BASE_URL } from './config.js';
import { getAccessToken, isAuthenticated } from './auth.js';

/** 重連間隔（毫秒） */
const RECONNECT_DELAY_MS = 5000;
/** 心跳間隔（毫秒） */
const HEARTBEAT_MS = 10000;

/**
 * 連線到 WebSocket (STOMP over SockJS) 並訂閱個人訂單通知
 * @param {(notification: {orderNumber: string, status: string, message: string}) => void} onNotification - 收到 /user/queue/orders 通知
 * @param {() => void} [onConnect] - 連線成功（含重連）
 * @param {(error: unknown) => void} [onError] - 連線失敗
 * @returns {Client|null} 可呼叫 deactivate() 關閉；未登入時回傳 null
 */
export function connectToWebSocket(onNotification, onConnect, onError) {
    if (!isAuthenticated()) {
        if (onError) onError('尚未登入，無法建立即時通知連線');
        return null;
    }

    const client = new Client({
        // 後端 WebSocketConfig 使用 withSockJS()，必須走 SockJS
        webSocketFactory: () => new SockJS(`${API_BASE_URL}/ws-kds`),
        reconnectDelay: RECONNECT_DELAY_MS,
        heartbeatIncoming: HEARTBEAT_MS,
        heartbeatOutgoing: HEARTBEAT_MS,
        // 關閉 debug，避免 Authorization header 被印到 console
        debug: () => {},
        // 每次（重）連線前重新帶入最新的 token
        beforeConnect: () => {
            client.connectHeaders = { Authorization: `Bearer ${getAccessToken()}` };
        },
        onConnect: () => {
            logger.info('WebSocket 已連線');
            if (onConnect) onConnect();

            // 唯一的訂閱：個人訂單通知（後端 convertAndSendToUser -> /user/queue/orders）
            client.subscribe('/user/queue/orders', (message) => {
                try {
                    const notification = JSON.parse(message.body);
                    logger.info('收到個人通知:', notification);
                    if (onNotification) onNotification(notification);
                } catch (e) {
                    logger.error('個人通知解析失敗:', e);
                }
            });
        },
        // STOMP 協定層錯誤（例如 CONNECT 被拒絕）；不印出 headers 以免洩漏敏感資訊
        onStompError: (frame) => {
            logger.error('STOMP 錯誤:', frame.headers?.message);
            if (onError) onError(frame.headers?.message || 'STOMP 錯誤');
        },
        onWebSocketError: (event) => {
            logger.warn('WebSocket 連線錯誤，將自動重連', event?.type);
            if (onError) onError(event);
        },
    });

    client.activate();
    return client;
}
