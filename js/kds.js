import logger from './utils/logger.js';
import '@material/web/chips/assist-chip.js';
import '@material/web/labs/card/filled-card.js';
import '@material/web/button/filled-button.js';

import { getOrdersByStatus, updateOrderStatus, getSseTicket } from "./api.js";
import { getStoreId } from './auth.js';


const MY_STORE_ID = getStoreId();

document.addEventListener("DOMContentLoaded", () => {
    if (!MY_STORE_ID) {
        const errorMsg = "錯誤：找不到店家 ID (storeId)。KDS 無法啟動。\n將導回登入頁。";
        logger.error(errorMsg);
        alert(errorMsg);
        window.location.href = "login.html";
        return; // 中斷執行
    }
    // DOM 元素
    const preparingListEl = document.getElementById("preparing-list");
    const pickupListEl = document.getElementById("pickup-list");
    const statusChip = document.getElementById("connection-status");

    /**
     * 1. 頁面載入時，抓取所有 "製作中" 和 "待取餐" 的訂單
     */
    async function loadInitialOrders() {
        try {
            // 平行抓取
            const [preparingOrders, pickupOrders] = await Promise.all([
                getOrdersByStatus(MY_STORE_ID, "PREPARING"),
                getOrdersByStatus(MY_STORE_ID, "READY_FOR_PICKUP")
            ]);

            preparingListEl.innerHTML = "";
            pickupListEl.innerHTML = "";

            preparingOrders.forEach(order => renderOrderCard(order, preparingListEl));
            pickupOrders.forEach(order => renderOrderCard(order, pickupListEl));

        } catch (error) {
            logger.error("載入初始訂單失敗:", error);
            preparingListEl.innerHTML = `<p class="error">${error.message}</p>`;
        }
    }

    /**
     * 啟動 SSE 連線
     * 流程：先向後端取得一次性 ticket，再用 ticket 建立 EventSource。
     * 這樣做是因為 EventSource API 不支援自訂 Header（無法帶 Authorization），
     * 改用短期一次性 ticket 避免 JWT 暴露在 URL 中。
     */
    async function startSse() {
        try {
            // 第一步：透過已認證的 API 取得一次性 SSE ticket（有效期 30 秒，僅限使用一次）
            const ticket = await getSseTicket();

            logger.info("已取得 SSE ticket，嘗試建立連線...");
            // 第二步：用 ticket 建立 SSE 連線（ticket 會在後端驗證後立即銷毀）
            const eventSource = new EventSource(`/api/v1/kds/stream?ticket=${ticket}`);

            // 連線成功
            eventSource.onopen = () => {
                logger.info("SSE 已連線");
                statusChip.label = `SSE 已連線 (店家 ${MY_STORE_ID})`;
                statusChip.classList.remove("status-disconnected");
                statusChip.classList.add("status-connected");
            };

            // 收到訊息
            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleKdsMessage(data.action, data.payload);
                } catch (e) {
                    logger.error("SSE 訊息解析失敗:", e);
                }
            };

            // 連線錯誤：關閉當前連線，等待後重新取得 ticket 再重連
            // （不能依賴 EventSource 自動重連，因為舊 ticket 已被銷毀）
            eventSource.onerror = (err) => {
                logger.error("SSE 連線錯誤:", err);
                statusChip.label = `連線中斷 (重試中...)`;
                statusChip.classList.remove("status-connected");
                statusChip.classList.add("status-disconnected");

                // 關閉舊連線，避免 EventSource 用過期的 ticket 自動重連
                eventSource.close();
                // 5 秒後重新取得新 ticket 並建立連線
                setTimeout(() => startSse(), 5000);
            };
        } catch (error) {
            logger.error("取得 SSE ticket 失敗，5 秒後重試:", error);
            statusChip.label = `連線失敗 (重試中...)`;
            statusChip.classList.remove("status-connected");
            statusChip.classList.add("status-disconnected");
            setTimeout(() => startSse(), 5000);
        }
    }

    /**
     * 2. 渲染訂單卡片
     */
    function renderOrderCard(order, targetListElement) {
        const orderId = `kds-order-${order.orderId}`;

        // 避免重複渲染
        if (document.getElementById(orderId)) return;

        const card = document.createElement("md-filled-card");
        card.id = orderId;
        card.className = "kds-card";

        // 組合品項 HTML
        let itemsHtml = order.items.map(item => `
            <li>
                <strong>${item.productName} (x${item.quantity})</strong>
                ${item.options.length > 0 ?
            `<div class="kds-item-options">${item.options.map(opt => opt.optionName).join(", ")}</div>` : ''
        }
                ${item.notes ?
            `<div class="kds-item-notes">備註: ${item.notes}</div>` : ''
        }
            </li>
        `).join("");

        // 根據狀態決定是否顯示按鈕
        const buttonHtml = order.status === "PREPARING" ?
            `<md-filled-button class="kds-complete-btn" data-order-id="${order.orderId}" style="width: 100%; margin-top: 15px;">
                製作完成
            </md-filled-button>` :
            '';

        card.innerHTML = `
            <h3>#${order.orderNumber}</h3>
            <ul>${itemsHtml}</ul>
            ${buttonHtml}
        `;

        // 新訂單放在最前面
        targetListElement.prepend(card);
    }

    /**
     * 3. 處理 KDS 訊息 (邏輯不變，只是來源變成了 SSE)
     */
    function handleKdsMessage(action, order) {
        const orderId = `kds-order-${order.orderId}`;
        const existingCard = document.getElementById(orderId);

        logger.info("KDS 收到訊息:", action, order.orderNumber);

        if (action === "NEW_ORDER") {
            renderOrderCard(order, preparingListEl);

        } else if (action === "MOVE_TO_PICKUP") {
            if (existingCard) existingCard.remove();
            renderOrderCard(order, pickupListEl);

        } else if (action === "CANCEL_ORDER") {
            if (existingCard) {
                existingCard.classList.add("cancelled");
                const btn = existingCard.querySelector("md-filled-button"); // 注意這裡選取器可能要對應您的按鈕標籤
                if (btn) btn.remove();
            }

        } else if (action === "REMOVE_FROM_PICKUP") {
            if (existingCard) existingCard.remove();
        }
    }

    /**
     * 4. 處理 KDS 上的「製作完成」按鈕點擊
     */
    async function handleCompleteProduction(event) {
        const button = event.target.closest(".kds-complete-btn");
        if (!button) return;

        const orderId = button.dataset.orderId;
        button.disabled = true;
        button.textContent = "傳送中...";

        try {
            // 呼叫 API，將狀態從 PREPARING -> READY_FOR_PICKUP
            await updateOrderStatus(orderId, "READY_FOR_PICKUP");
            // 成功後不需手動移卡片，等待 SSE 的 MOVE_TO_PICKUP 事件
        } catch (error) {
            logger.error("更新訂單失敗:", error);
            alert(`訂單 ${orderId} 更新失敗: ${error.message}`);
            button.disabled = false;
            button.textContent = "製作完成";
        }
    }

    // --- 啟動程序 ---

    // 1. 綁定按鈕點擊
    preparingListEl.addEventListener("click", handleCompleteProduction);

    // 2. 載入初始訂單
    loadInitialOrders();

    // 3. 【修改 3】啟動 SSE (不再呼叫 startWebSocket)
    startSse();
});