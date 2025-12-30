import '@material/web/chips/assist-chip.js';
import '@material/web/labs/card/filled-card.js';
import '@material/web/button/filled-button.js';

import { getOrdersByStatus, updateOrderStatus } from "./api.js";
import { getAccessToken, getStoreId } from './auth.js';


const MY_STORE_ID = getStoreId();

document.addEventListener("DOMContentLoaded", () => {
    if (!MY_STORE_ID) {
        const errorMsg = "錯誤：找不到店家 ID (storeId)。KDS 無法啟動。\n將導回登入頁。";
        console.error(errorMsg);
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
            console.error("載入初始訂單失敗:", error);
            preparingListEl.innerHTML = `<p class="error">${error.message}</p>`;
        }
    }

    /**
     * 【修改 2】啟動 SSE 連線 (取代 startWebSocket)
     */
    function startSse() {
        const token = getAccessToken();
        if (!token) {
            console.error("SSE 啟動失敗：找不到 Token");
            return;
        }

        console.log("嘗試建立 SSE 連線...");
        // 將 token 帶在 URL 上 (需配合後端 JwtAuthenticationFilter 修改)
        const eventSource = new EventSource(`/api/v1/kds/stream?token=${token}`);

        // 1. 連線成功
        eventSource.onopen = () => {
            console.log("SSE 已連線");
            statusChip.label = `SSE 已連線 (店家 ${MY_STORE_ID})`;
            statusChip.classList.remove("status-disconnected");
            statusChip.classList.add("status-connected");
        };

        // 2. 收到訊息
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // 呼叫原本的邏輯處理畫面更新
                handleKdsMessage(data.action, data.payload);
            } catch (e) {
                console.error("SSE 訊息解析失敗:", e);
            }
        };

        // 3. 連線錯誤
        eventSource.onerror = (err) => {
            console.error("SSE 連線錯誤:", err);
            statusChip.label = `連線中斷 (重試中...)`;
            statusChip.classList.remove("status-connected");
            statusChip.classList.add("status-disconnected");

            // EventSource 預設會自動重連，但如果 Token 失效可能需要額外處理 (例如關閉連線)
            if (eventSource.readyState === EventSource.CLOSED) {
                statusChip.label = `連線已關閉`;
            }
        };
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

        console.log("KDS 收到訊息:", action, order.orderNumber);

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
            console.error("更新訂單失敗:", error);
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