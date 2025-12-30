import Stomp from 'stompjs';
import SockJS from 'sockjs-client'
import { guestLogin } from './api.js';
import {
    isAuthenticated,
    getAccessToken,
    setAuthSession,
    logout
} from './auth.js';

/**
 * 連線到 WebSocket 服務 (支援自動訪客登入)
 */
export async function connectToWebSocket(storeId, onMessageCallback, onConnectCallback, onErrorCallback) {
    // 1. 使用 auth.js 檢查是否已登入
    if (!isAuthenticated()) {
        const guestName = prompt("您目前未登入。請輸入暱稱以加入點餐：", "訪客");

        if (!guestName) {
            if (onErrorCallback) onErrorCallback("使用者取消訪客登入，無法連線");
            return;
        }

        try {
            const res = await guestLogin(guestName);
            // 【修改】使用 setAuthSession 儲存 Token
            setAuthSession(res, guestName);
        } catch (e) {
            console.error("訪客登入失敗:", e);
            if (onErrorCallback) onErrorCallback("訪客登入失敗，無法建立連線");
            return;
        }
    }

    // 2. 取得 Token (使用 auth.js)
    const token = getAccessToken();

    // 3. 建立連線
    const socket = new SockJS("http://localhost:8080/ws-kds");
    const stompClient = Stomp.over(socket);
    // stompClient.debug = null;

    const headers = {
        "Authorization": `Bearer ${token}`
    };

    stompClient.connect(headers,
        // On Connect
        (frame) => {
            console.log("WebSocket 已連線:", frame);
            if (onConnectCallback) onConnectCallback();

            const topic = `/topic/kds/store/${storeId}`;
            stompClient.subscribe(topic, (message) => {
                try {
                    const kdsMessage = JSON.parse(message.body);
                    if (onMessageCallback) {
                        onMessageCallback(kdsMessage.action, kdsMessage.payload);
                    }
                } catch (e) {
                    console.error("WS 訊息解析失敗:", e);
                }
            });

            stompClient.subscribe('/user/queue/orders', (message) => {
                console.log("收到個人通知:", message.body);
                // TODO: 觸發 Toast
            });
        },
        // On Error
        (error) => {
            console.error("WS 連線失敗:", error);
            const errorMsg = typeof error === 'string' ? error : error.headers?.message;

            // 若 Token 失效，呼叫統一的 logout 或清除邏輯
            if (errorMsg && (errorMsg.includes("401") || errorMsg.includes("403") || errorMsg.includes("Unauthorized"))) {
                // 這裡可以選擇直接 logout() 導回首頁，或是僅清除 Token 讓使用者下次重試
                // localStorage.removeItem("accessToken"); // 原本寫法
                logout(); // 建議寫法：清除所有 Session 資訊
            }

            if (onErrorCallback) onErrorCallback(error);
        }
    );
}