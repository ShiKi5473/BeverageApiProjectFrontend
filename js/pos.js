import logger from './utils/logger.js';
import { initAppNotifications } from './app-notifications.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/list/list.js';
import '@material/web/list/list-item.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/dialog/dialog.js';
import '@material/web/divider/divider.js';
import '@material/web/chips/chip-set.js';
import '@material/web/chips/filter-chip.js';
import '@material/web/textfield/filled-text-field.js';

import {
    getCategories,
    getPosProducts,
    createOrder,
    getOrdersByStatus,
    updateOrderStatus,
} from "./api.js";
import { logout, getStoreId } from './auth.js';
import { createProductCard } from "./components/ProductCard.js";
import { createOptionsModalContent } from "./components/OptionsModal.js";
import { createCartItem, updateCartTotal } from "./components/Cart.js";
import { createNavbar } from "./components/Navbar.js";
// 【修改】匯入共用 SSE 連線工具，取代頁面內重複的 SSE 邏輯
import { createSseConnection } from './utils/sseClient.js';
// 【新增】金額／品項組裝、取餐號碼、冪等鍵工具
import { buildCartItem, toOrderItemDto } from './utils/pricing.js';
import { getPickupNumber } from './utils/orderNumber.js';
import { createIdempotencyHolder } from './utils/idempotency.js';

let allProducts = [];
let shoppingCart = [];
let currentModal = null;

const MY_STORE_ID = getStoreId()

const optionsDialog = document.getElementById("options-dialog");
const dialogContentSlot = document.getElementById("dialog-content-slot");
const modalCloseButton = document.getElementById("modal-close-btn");
const modalAddButton = document.getElementById("modal-add-btn");

// 【新增】暫存訂單的冪等鍵：同一份購物車重試沿用同一個 key，成功後重置
const holdIdempotency = createIdempotencyHolder();

document.addEventListener("DOMContentLoaded", () => {
    // 啟動全域通知監聽
    initAppNotifications();

    if (!MY_STORE_ID) {
        const errorMsg = "錯誤：找不到店家 ID (storeId)。\n\n品牌管理員帳號無法使用 POS 點餐系統。\n\n將導回登入頁。";
        logger.error(errorMsg);
        alert(errorMsg);
        logout();
        return;
    }

    // 1. 取得元素
    const productGrid = document.getElementById("product-grid");
    const posLayout = document.querySelector(".pos-layout");
    const mainContent = document.querySelector(".pos-main-content");
    const categoryList = document.getElementById("category-list");
    const cartItemsContainer = document.getElementById("cart-items");
    const cartTotalAmount = document.getElementById("cart-total-amount");
    const pickupListEl = document.getElementById("pickup-list");

    // 【修改】登出統一使用 auth.logout()
    const navbar = createNavbar("POS 點餐系統", logout);
    posLayout.insertBefore(navbar, mainContent);

    /**
     * 小工具：以 textContent 建立提示訊息（避免把錯誤訊息當 HTML 插入）
     */
    function setMessage(container, text, className) {
        container.textContent = "";
        const p = document.createElement("p");
        if (className) p.className = className;
        p.textContent = text;
        container.appendChild(p);
    }

    /**
     * 「僅」用於暫存訂單 (HELD)
     * 【修改】原本被當成 click 事件處理器，參數 action 實際收到的是 Event 物件，
     * 錯誤訊息會變成 "[object PointerEvent] 失敗"；現在由呼叫端明確傳入字串
     * @param {string} action - 動作名稱（用於訊息）
     */
    async function holdOrder(action = "暫存訂單") {
        if (shoppingCart.length === 0) {
            alert("購物車是空的！");
            return;
        }
        // 【修改】品項需帶 variantId（後端必填）
        const createOrderRequest = {
            items: shoppingCart.map(toOrderItemDto),
            status: 'HELD'
        };
        try {
            // 【新增】Idempotency-Key：內容不變的重試沿用同一個 key
            const newOrder = await createOrder(createOrderRequest, holdIdempotency.getKey(createOrderRequest));
            holdIdempotency.reset();
            alert(`訂單 #${getPickupNumber(newOrder.orderNumber)} 已暫存`);
            shoppingCart = [];
            localStorage.removeItem("cartForCheckout");
            renderCart();
        } catch (error) {
            logger.error(` ${action} 失敗:`, error);
            alert(` ${action} 失敗: ${error.message}`);
        }
    }

    function goToCheckout() {
        if (shoppingCart.length === 0) {
            alert("購物車是空的！");
            return;
        }
        try {
            localStorage.setItem("cartForCheckout", JSON.stringify(shoppingCart));
            window.location.href = "checkout.html";
        } catch (e) {
            alert("儲存購物車失敗，可能是瀏覽器空間不足。");
            logger.error("無法儲存 localStorage:", e);
        }
    }

    async function loadAllData() {
        setMessage(productGrid, "正在載入資料...");
        categoryList.innerHTML = `<md-list-item headline="載入中..."></md-list-item>`;
        try {
            const [products, categories] = await Promise.all([
                getPosProducts(),
                getCategories(),
            ]);
            allProducts = products;
            renderCategoryList(categories);
            renderProducts("all");
            addCategoryClickListeners();
        } catch (error) {
            logger.error("載入資料時發生錯誤:", error);
            // 【修改】XSS 防護：錯誤訊息用 textContent，不再插入 innerHTML
            setMessage(productGrid, `資料載入失敗: ${error.message}`, "error");
            categoryList.innerHTML = `<md-list-item headline="載入失敗"></md-list-item>`;
        }
    }

    function renderCategoryList(categories) {
        categoryList.innerHTML = "";
        const allLi = document.createElement("md-list-item");
        allLi.setAttribute("headline", "全部商品");
        allLi.dataset.categoryId = "all";
        allLi.classList.add("active");
        const allLiText = document.createElement("div");
        allLiText.setAttribute("slot", "headline");
        allLiText.textContent = "全部商品";
        allLi.appendChild(allLiText);
        categoryList.appendChild(allLi);

        categories.forEach((category) => {
            const li = document.createElement("md-list-item");
            li.dataset.categoryId = String(category.categoryId);
            const liText = document.createElement("div");
            liText.setAttribute("slot", "headline");
            liText.textContent = category.name;
            li.appendChild(liText);
            categoryList.appendChild(li);
        });
    }

    function renderProducts(categoryId) {
        // 【修改】分類 ID 為字串，改用 String() 比較（原本 Number(categoryId) 會讓 TSID 失去精度）
        const productsToRender = categoryId === "all"
            ? allProducts
            : allProducts.filter((product) => product.categories && product.categories.some((cat) => String(cat.categoryId) === String(categoryId)));

        for (const child of Array.from(productGrid.children)) {
            if (!child.dataset.productId) child.remove();
        }
        const newIdSet = new Set(productsToRender.map(p => String(p.id)));
        const existingCardMap = new Map();
        for (const cardElement of productGrid.children) {
            const productId = cardElement.dataset.productId;
            if (productId) existingCardMap.set(productId, cardElement);
        }
        existingCardMap.forEach((cardElement, productId) => {
            if (!newIdSet.has(productId)) cardElement.remove();
        });
        productsToRender.forEach((product) => {
            if (!existingCardMap.has(String(product.id))) {
                const productCard = createProductCard(product);
                productCard.addEventListener("click", () => {
                    openOptionsModal(product);
                });
                productGrid.appendChild(productCard);
            }
        });
        if (productGrid.children.length === 0) {
            setMessage(productGrid, "這個分類沒有商品");
        }
    }

    function addCategoryClickListeners() {
        categoryList.addEventListener("click", (event) => {
            const target = event.target.closest("md-list-item");
            if (target) {
                categoryList.querySelectorAll("md-list-item").forEach((a) => a.classList.remove("active"));
                target.classList.add("active");
                const selectedCategoryId = target.getAttribute("data-category-id");
                renderProducts(selectedCategoryId);
            }
        });
    }

    function openOptionsModal(product) {
        currentModal = createOptionsModalContent(product);
        dialogContentSlot.innerHTML = "";
        dialogContentSlot.appendChild(currentModal.element);
        modalAddButton.onclick = () => {
            handleAddToCart(product, currentModal.getSelectedData());
        };
        modalCloseButton.onclick = closeModal;
        optionsDialog.show();
    }

    function closeModal() {
        optionsDialog.close();
        currentModal = null;
    }

    function handleAddToCart(product, selectedData) {
        // 【修改】單價 = 規格價 + 選項加價（原本用 basePrice，與後端計價不一致）；並帶 variantId
        let cartItem;
        try {
            cartItem = buildCartItem(product, selectedData);
        } catch (error) {
            alert(error.message);
            return;
        }
        shoppingCart.push(cartItem);
        renderCart();
        closeModal();
    }

    function renderCart() {
        cartItemsContainer.innerHTML = "";
        if (shoppingCart.length === 0) {
            setMessage(cartItemsContainer, "購物車是空的", "cart-empty");
        } else {
            shoppingCart.forEach((item) => {
                const itemElement = createCartItem(item);
                cartItemsContainer.appendChild(itemElement);
            });
        }
        updateCartTotal(shoppingCart, cartTotalAmount);
    }

    function handleRemoveFromCart(cartId) {
        shoppingCart = shoppingCart.filter((item) => item.id !== cartId);
        renderCart();
    }

    cartItemsContainer.addEventListener("click", (event) => {
        const removeButton = event.target.closest(".cart-item-remove-btn");
        if (removeButton) {
            // 購物車 ID 是前端本地產生的數字，可以安全轉 Number
            const cartId = Number(removeButton.dataset.cartId);
            handleRemoveFromCart(cartId);
        }
    });

    // ... (以上為商品相關邏輯) ...

    /**
     * 載入待取餐訂單 (READY_FOR_PICKUP)
     */
    async function loadPickupOrders() {
        try {
            const orders = await getOrdersByStatus(MY_STORE_ID, "READY_FOR_PICKUP");
            pickupListEl.innerHTML = ""; // 清空
            if (orders.length === 0) {
                setMessage(pickupListEl, "目前沒有待取餐點", "pickup-empty");
            } else {
                orders.forEach(renderPickupItem);
            }
        } catch (e) {
            // 【修改】XSS 防護：錯誤訊息用 textContent
            setMessage(pickupListEl, e.message, "error");
        }
    }

    /**
     * 渲染單一待取餐項目
     * 【修改】改用 DOM API 建立；顯示取餐號碼（訂單號碼最後一段）而非完整訂單號
     */
    function renderPickupItem(order) {
        const orderId = `pickup-order-${order.orderId}`;
        if (document.getElementById(orderId)) return;

        const emptyEl = pickupListEl.querySelector(".pickup-empty");
        if (emptyEl) emptyEl.remove();

        const itemEl = document.createElement("div");
        itemEl.id = orderId;
        itemEl.className = "pickup-item";

        const numberEl = document.createElement("span");
        numberEl.className = "pickup-item-number";
        numberEl.textContent = `#${getPickupNumber(order.orderNumber)}`;

        const btn = document.createElement("button");
        btn.className = "btn-complete-pickup";
        btn.dataset.orderId = String(order.orderId);
        btn.textContent = "完成取餐";

        itemEl.append(numberEl, btn);
        pickupListEl.prepend(itemEl);
    }

    /**
     * 【修改】啟動 SSE 連線 — 改用共用的 createSseConnection 工具
     * 內建 ticket 取得、訊息解析、斷線自動重連邏輯
     */
    function startSse() {
        createSseConnection('/api/v1/kds/stream', {
            onMessage: handlePosSseMessage,
        });
    }

    /**
     * 【修改 3】處理 SSE 訊息 (原 handlePosWebSocketMessage)
     */
    function handlePosSseMessage(action, order) {
        if (!order) return;
        logger.info("POS 收到 SSE 訊息:", action, getPickupNumber(order.orderNumber));
        const orderElId = `pickup-order-${order.orderId}`;
        const existingEl = document.getElementById(orderElId);

        if (action === "MOVE_TO_PICKUP") {
            // KDS 製作完成 -> 加入待取餐
            if (!existingEl) {
                renderPickupItem(order);
            }
        } else if (action === "REMOVE_FROM_PICKUP" || action === "CANCEL_ORDER") {
            // 顧客已取餐 (CLOSED) 或 訂單取消 (CANCELLED)
            if (existingEl) {
                existingEl.remove();
            }
            // 檢查列表是否空了
            if (pickupListEl.children.length === 0) {
                setMessage(pickupListEl, "目前沒有待取餐點", "pickup-empty");
            }
        }
        // POS 不需要處理 NEW_ORDER / PENDING_ACCEPTANCE (因為 KDS 會處理)
    }

    /**
     * 處理 POS 上的「完成取餐」按鈕點擊
     */
    async function handleCompletePickup(event) {
        const button = event.target.closest(".btn-complete-pickup");
        if (!button) return;

        const orderId = button.dataset.orderId;
        button.disabled = true;
        button.textContent = "處理中...";

        try {
            await updateOrderStatus(orderId, "CLOSED");
            // 成功！SSE "REMOVE_FROM_PICKUP" 事件會自動更新 UI
        } catch (error) {
            logger.error("更新訂單為 CLOSED 失敗:", error);
            alert(`訂單更新失敗: ${error.message}`);
            button.disabled = false;
            button.textContent = "完成取餐";
        }
    }

    // --- 10. 啟動程序 ---

    const checkoutButton = document.getElementById("checkout-button");
    const holdButton = document.getElementById("hold-button");
    checkoutButton.addEventListener("click", goToCheckout);
    // 【修改】包一層箭頭函式，避免把 click Event 當成 action 參數傳進 holdOrder
    holdButton.addEventListener("click", () => holdOrder("暫存訂單"));
    pickupListEl.addEventListener("click", handleCompletePickup);

    loadAllData();
    loadPickupOrders();

    const restoredCartJson = localStorage.getItem("cartForCheckout");
    if (restoredCartJson) {
        try {
            const restored = JSON.parse(restoredCartJson);
            // 【新增】舊版暫存的購物車沒有 variantId（後端會 400），還原時略過這類品項
            shoppingCart = Array.isArray(restored) ? restored.filter((item) => item && item.variantId) : [];
        } catch {
            shoppingCart = [];
        }
    } else {
        shoppingCart = [];
    }

    renderCart();

    // 【修改 4】啟動 SSE
    startSse();
});
