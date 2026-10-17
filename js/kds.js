import logger from './utils/logger.js';
import '@material/web/chips/assist-chip.js';
import '@material/web/labs/card/filled-card.js';
import '@material/web/button/filled-button.js';

// 【修改】新增 acceptOrder：線上訂單（待接單）由店員按「接單」後才進入製作中
import { getOrdersByStatus, updateOrderStatus, acceptOrder } from "./api.js";
// 【修改】沒有分店 ID 時統一使用 auth.logout()（清除工作階段並導回登入頁）
import { getStoreId, logout } from './auth.js';
// 【修改】匯入共用 SSE 連線工具，取代頁面內重複的 SSE 邏輯
// （工具內部會先 POST /auth/sse-ticket 取得一次性 ticket，再以 API_BASE_URL + /kds/stream?ticket= 建立連線）
import { createSseConnection } from './utils/sseClient.js';
// 【新增】DOM 建立工具（textContent，避免 XSS）與取餐號碼工具
import { el, setMessage } from './utils/dom.js';
import { getPickupNumber } from './utils/orderNumber.js';

/** 訂單狀態常數（與後端 OrderStatus 名稱一致） */
const STATUS_AWAITING = "AWAITING_ACCEPTANCE";
const STATUS_PREPARING = "PREPARING";
const STATUS_READY = "READY_FOR_PICKUP";

/** 按下「接單」/「製作完成」後，若 SSE 一直沒把卡片移走，延遲多久後重新載入列表（毫秒） */
const STALE_RESYNC_DELAY_MS = 3000;

const MY_STORE_ID = getStoreId();

document.addEventListener("DOMContentLoaded", () => {
    if (!MY_STORE_ID) {
        // 【修改】後端 KDS SSE 需要綁定分店的員工帳號（未綁店的品牌管理員會收到 400），先給出明確說明
        const errorMsg = "此帳號沒有綁定分店（例如品牌管理員），無法使用 KDS。\n請改用店長或店員帳號登入。\n將導回登入頁。";
        logger.error(errorMsg);
        alert(errorMsg);
        logout();
        return; // 中斷執行
    }
    // DOM 元素
    // 【新增】待接單欄
    const awaitingListEl = document.getElementById("awaiting-list");
    const preparingListEl = document.getElementById("preparing-list");
    const pickupListEl = document.getElementById("pickup-list");
    const statusChip = document.getElementById("connection-status");
    const mainLayoutEl = document.querySelector(".kds-main-layout");

    /**
     * 【新增】更新各欄標題旁的訂單數量（已取消的卡片不計入）
     */
    function updateCounts() {
        const pairs = [
            ["awaiting-count", awaitingListEl],
            ["preparing-count", preparingListEl],
            ["pickup-count", pickupListEl],
        ];
        pairs.forEach(([countId, listEl]) => {
            const countEl = document.getElementById(countId);
            if (countEl) countEl.textContent = String(listEl.querySelectorAll(".kds-card:not(.cancelled)").length);
        });
    }

    /**
     * 1. 頁面載入時，抓取所有 "待接單"、"製作中" 和 "待取餐" 的訂單
     * 【修改】三欄各自處理失敗（allSettled），某一欄載入失敗不會讓其他欄一起空白；
     * 錯誤訊息一律用 textContent 顯示，不插入 innerHTML
     */
    async function loadInitialOrders() {
        const columns = [
            { status: STATUS_AWAITING, listEl: awaitingListEl },
            { status: STATUS_PREPARING, listEl: preparingListEl },
            { status: STATUS_READY, listEl: pickupListEl },
        ];
        // 平行抓取
        const results = await Promise.allSettled(
            columns.map((column) => getOrdersByStatus(MY_STORE_ID, column.status))
        );

        results.forEach((result, index) => {
            const { listEl } = columns[index];
            listEl.textContent = "";
            if (result.status === "fulfilled") {
                (result.value ?? []).forEach((order) => renderOrderCard(order, listEl));
            } else {
                logger.error("載入初始訂單失敗:", result.reason);
                setMessage(listEl, result.reason?.message || "載入訂單失敗", "error");
            }
        });
        updateCounts();
    }

    /**
     * 【修改】啟動 SSE 連線 — 改用共用的 createSseConnection 工具
     * 內建 ticket 取得、訊息解析、斷線自動重連邏輯
     */
    function startSse() {
        // 第一次連線成功時列表剛由 loadInitialOrders 載入；之後每次「重連」成功，
        // 斷線期間可能漏掉事件，所以重新載入三欄列表做同步
        let connectedOnce = false;
        createSseConnection('/api/v1/kds/stream', {
            onMessage: handleKdsMessage,
            // 連線成功時更新狀態 Chip
            onOpen: () => {
                logger.info("SSE 已連線");
                statusChip.label = `SSE 已連線 (店家 ${MY_STORE_ID})`;
                statusChip.classList.remove("status-disconnected");
                statusChip.classList.add("status-connected");
                if (connectedOnce) loadInitialOrders();
                connectedOnce = true;
            },
            // 連線錯誤時更新狀態 Chip（重連由 sseClient 自動處理）
            onError: () => {
                statusChip.label = `連線中斷 (重試中...)`;
                statusChip.classList.remove("status-connected");
                statusChip.classList.add("status-disconnected");
            },
        });
    }

    /**
     * 2. 渲染訂單卡片
     * 【修改】
     * - XSS 防護：商品名稱／選項／備註一律用 textContent，不再插入 innerHTML
     * - options 做 null 防護（舊資料或後端未填時為 null/undefined，原本 item.options.length 會拋 TypeError 讓整頁崩潰）
     * - 標題顯示取餐號碼（訂單號碼最後一段），完整訂單號放在 title 提示
     * - 依狀態顯示按鈕：待接單 -> 「接單」；製作中 -> 「製作完成」
     */
    function renderOrderCard(order, targetListElement) {
        if (!order || order.orderId === undefined || order.orderId === null) return;
        const cardId = `kds-order-${order.orderId}`;

        // 避免重複渲染
        if (document.getElementById(cardId)) return;

        // 清掉列表裡殘留的載入失敗訊息
        const staleMessage = targetListElement.querySelector(":scope > p.error");
        if (staleMessage) staleMessage.remove();

        const card = document.createElement("md-filled-card");
        card.id = cardId;
        card.className = "kds-card";

        const title = el("h3", "kds-card-number", `#${getPickupNumber(order.orderNumber)}`);
        title.title = order.orderNumber ?? "";
        card.appendChild(title);

        // 訂單層級的備註（線上點餐的整單備註）
        if (order.customerNote) {
            card.appendChild(el("div", "kds-order-note", `訂單備註: ${order.customerNote}`));
        }

        // 組合品項
        const list = document.createElement("ul");
        (order.items ?? []).forEach((item) => {
            const li = document.createElement("li");
            const variantText = item.variantName ? ` [${item.variantName}]` : "";
            li.appendChild(el("strong", "", `${item.productName ?? ""}${variantText} (x${item.quantity})`));

            const options = Array.isArray(item.options) ? item.options : [];
            if (options.length > 0) {
                li.appendChild(el("div", "kds-item-options", options.map((opt) => opt.optionName).join(", ")));
            }
            if (item.notes) {
                li.appendChild(el("div", "kds-item-notes", `備註: ${item.notes}`));
            }
            list.appendChild(li);
        });
        card.appendChild(list);

        // 根據狀態決定顯示哪個按鈕
        if (order.status === STATUS_AWAITING) {
            const acceptBtn = el("md-filled-button", "kds-accept-btn", "接單");
            acceptBtn.dataset.orderId = String(order.orderId);
            acceptBtn.style.width = "100%";
            acceptBtn.style.marginTop = "15px";
            card.appendChild(acceptBtn);
        } else if (order.status === STATUS_PREPARING) {
            const completeBtn = el("md-filled-button", "kds-complete-btn", "製作完成");
            completeBtn.dataset.orderId = String(order.orderId);
            completeBtn.style.width = "100%";
            completeBtn.style.marginTop = "15px";
            card.appendChild(completeBtn);
        }

        // 新訂單放在最前面
        targetListElement.prepend(card);
    }

    /** 移除畫面上某張訂單卡片（若存在） */
    function removeCard(order) {
        const existingCard = document.getElementById(`kds-order-${order.orderId}`);
        if (existingCard) existingCard.remove();
    }

    /** 把訂單卡片移到指定欄位（先移除舊卡片，再用最新資料重新渲染） */
    function moveCard(order, targetListElement) {
        removeCard(order);
        renderOrderCard(order, targetListElement);
    }

    /**
     * 3. 處理 KDS 訊息（SSE）
     * 【修改】處理後端的五種 action：
     * - PENDING_ACCEPTANCE：線上訂單進入「待接單」
     * - NEW_ORDER：訂單進入「製作中」（POS 結帳，或店員接單之後）
     * - MOVE_TO_PICKUP：製作完成，進入「待取餐」
     * - REMOVE_FROM_PICKUP：顧客已取餐（CLOSED），移除卡片
     * - CANCEL_ORDER：訂單取消
     */
    function handleKdsMessage(action, order) {
        if (!order) return;
        logger.info("KDS 收到訊息:", action, order.orderNumber);

        switch (action) {
            case "PENDING_ACCEPTANCE":
                moveCard(order, awaitingListEl);
                break;
            case "NEW_ORDER":
                moveCard(order, preparingListEl);
                break;
            case "MOVE_TO_PICKUP":
                moveCard(order, pickupListEl);
                break;
            case "REMOVE_FROM_PICKUP":
                removeCard(order);
                break;
            case "CANCEL_ORDER": {
                const existingCard = document.getElementById(`kds-order-${order.orderId}`);
                if (existingCard) {
                    existingCard.classList.add("cancelled");
                    // 已取消的訂單不能再接單／完成：移除卡片上所有按鈕
                    existingCard.querySelectorAll("md-filled-button").forEach((btn) => btn.remove());
                }
                break;
            }
            default:
                logger.warn("KDS 收到未知的 action:", action);
        }
        updateCounts();
    }

    /**
     * 4. 處理 KDS 上的「接單」與「製作完成」按鈕點擊（事件委派，三欄共用一個監聽器）
     * - 接單：PATCH /api/v1/orders/{id}/accept（AWAITING_ACCEPTANCE -> PREPARING）
     * - 製作完成：PATCH /api/v1/orders/{id}/status（PREPARING -> READY_FOR_PICKUP）
     */
    async function handleCardAction(event) {
        const acceptButton = event.target.closest(".kds-accept-btn");
        const completeButton = event.target.closest(".kds-complete-btn");
        const button = acceptButton || completeButton;
        if (!button || button.disabled) return;

        const orderId = button.dataset.orderId;
        const idleLabel = acceptButton ? "接單" : "製作完成";
        button.disabled = true;
        button.textContent = "傳送中...";

        try {
            if (acceptButton) {
                await acceptOrder(orderId);
            } else {
                // 呼叫 API，將狀態從 PREPARING -> READY_FOR_PICKUP
                await updateOrderStatus(orderId, STATUS_READY);
            }
            // 成功後不需手動移卡片，等待 SSE 的 NEW_ORDER / MOVE_TO_PICKUP 事件；
            // 萬一 SSE 剛好斷線沒收到，數秒後若卡片還在原處就重新載入列表
            setTimeout(() => {
                if (document.getElementById(`kds-order-${orderId}`)?.contains(button)) loadInitialOrders();
            }, STALE_RESYNC_DELAY_MS);
        } catch (error) {
            logger.error("更新訂單失敗:", error);
            alert(`訂單 ${orderId} 更新失敗: ${error.message}`);
            button.disabled = false;
            button.textContent = idleLabel;
        }
    }

    // --- 啟動程序 ---

    // 1. 綁定按鈕點擊（三欄共用同一個委派監聽器，只註冊一次）
    mainLayoutEl.addEventListener("click", handleCardAction);

    // 2. 載入初始訂單
    loadInitialOrders();

    // 3. 【修改 3】啟動 SSE (不再呼叫 startWebSocket)
    startSse();
});
