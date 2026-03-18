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
    getSseTicket // 取得一次性 SSE 連線票券（取代直接在 URL 中傳遞 JWT）
} from "./api.js";
import { logout, getStoreId } from './auth.js';
import { createProductCard } from "./components/ProductCard.js";
import { createOptionsModalContent } from "./components/OptionsModal.js";
import { createCartItem, updateCartTotal } from "./components/Cart.js";
import { createNavbar } from "./components/Navbar.js";
// 【修改 1】移除 WebSocket
// import { connectToWebSocket } from "./ws-client.js";

let allProducts = [];
let shoppingCart = [];
let currentModal = null;

const MY_STORE_ID = getStoreId()

const optionsDialog = document.getElementById("options-dialog");
const dialogContentSlot = document.getElementById("dialog-content-slot");
const modalCloseButton = document.getElementById("modal-close-btn");
const modalAddButton = document.getElementById("modal-add-btn");

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

    const navbar = createNavbar("POS 點餐系統", logout);
    posLayout.insertBefore(navbar, mainContent);

    // ... (holdOrder, goToCheckout, loadAllData, renderCategoryList, renderProducts 函式保持不變) ...
    // 為了節省篇幅，這裡省略中間未變動的商品渲染邏輯，請保留原本的代碼

    /**
     * 「僅」用於暫存訂單 (HELD)
     */
    async function holdOrder(action) {
        if (shoppingCart.length === 0) {
            alert("購物車是空的！");
            return;
        }
        const orderItemsDto = shoppingCart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            notes: item.notes,
            optionIds: item.selectedOptions.map((opt) => opt.optionId),
        }));
        const createOrderRequest = {
            items: orderItemsDto,
            status: 'HELD'
        };
        try {
            const newOrder = await createOrder(createOrderRequest);
            alert(`訂單 ${newOrder.orderNumber} 已暫存`);
            shoppingCart = [];
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
        productGrid.innerHTML = "<p>正在載入資料...</p>";
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
            productGrid.innerHTML = `<p class="error">資料載入失敗: ${error.message}</p>`;
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
            li.dataset.categoryId = category.categoryId;
            const liText = document.createElement("div");
            liText.setAttribute("slot", "headline");
            liText.textContent = category.name;
            li.appendChild(liText);
            categoryList.appendChild(li);
        });
    }

    function renderProducts(categoryId) {
        const productsToRender = categoryId === "all"
            ? allProducts
            : allProducts.filter((product) => product.categories && product.categories.some((cat) => cat.categoryId === Number(categoryId)));

        for (const child of Array.from(productGrid.children)) {
            if (!child.dataset.productId) child.remove();
        }
        const newIdSet = new Set(productsToRender.map(p => p.id));
        const existingCardMap = new Map();
        for (const cardElement of productGrid.children) {
            const productId = cardElement.dataset.productId;
            if (productId) existingCardMap.set(Number(productId), cardElement);
        }
        existingCardMap.forEach((cardElement, productId) => {
            if (!newIdSet.has(productId)) cardElement.remove();
        });
        productsToRender.forEach((product) => {
            if (!existingCardMap.has(product.id)) {
                const productCard = createProductCard(product);
                productCard.addEventListener("click", () => {
                    openOptionsModal(product);
                });
                productGrid.appendChild(productCard);
            }
        });
        if (productGrid.children.length === 0) {
            productGrid.innerHTML = "<p>這個分類沒有商品</p>";
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
        const allOptions = product.optionGroups.flatMap((group) => group.options);
        const selectedOptions = allOptions.filter((option) =>
            selectedData.selectedOptionIds.includes(String(option.optionId))
        );
        const optionPriceAdjustment = selectedOptions.reduce((sum, opt) => sum + opt.priceAdjustment, 0);
        const unitPrice = product.basePrice + optionPriceAdjustment;
        const cartItem = {
            id: Date.now(),
            productId: product.id,
            name: product.name,
            quantity: selectedData.quantity,
            unitPrice: unitPrice,
            selectedOptions: selectedOptions,
            notes: selectedData.notes,
        };
        shoppingCart.push(cartItem);
        renderCart();
        closeModal();
    }

    function renderCart() {
        cartItemsContainer.innerHTML = "";
        if (shoppingCart.length === 0) {
            cartItemsContainer.innerHTML = "<p class='cart-empty'>購物車是空的</p>";
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
                pickupListEl.innerHTML = "<p class='pickup-empty'>目前沒有待取餐點</p>";
            } else {
                orders.forEach(renderPickupItem);
            }
        } catch (e) {
            pickupListEl.innerHTML = `<p class="error">${e.message}</p>`;
        }
    }

    /**
     * 渲染單一待取餐項目
     */
    function renderPickupItem(order) {
        const orderId = `pickup-order-${order.orderId}`;
        if (document.getElementById(orderId)) return;

        const emptyEl = pickupListEl.querySelector(".pickup-empty");
        if (emptyEl) emptyEl.remove();

        const itemEl = document.createElement("div");
        itemEl.id = orderId;
        itemEl.className = "pickup-item";
        itemEl.innerHTML = `
          <span class="pickup-item-number">#${order.orderNumber}</span>
          <button class="btn-complete-pickup" data-order-id="${order.orderId}">完成取餐</button>
      `;
        pickupListEl.prepend(itemEl);
    }

    /**
     * 啟動 SSE 連線
     * 先向後端取得一次性 ticket，再用 ticket 建立 EventSource。
     * 避免 JWT 暴露在 URL query parameter 中（EventSource API 不支援自訂 Header）。
     */
    async function startSse() {
        try {
            // 透過已認證的 API 取得一次性 SSE ticket（有效期 30 秒，僅限使用一次）
            const ticket = await getSseTicket();

            // 用 ticket 建立 SSE 連線（後端驗證後會立即銷毀 ticket）
            const eventSource = new EventSource(`/api/v1/kds/stream?ticket=${ticket}`);

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handlePosSseMessage(data.action, data.payload);
                } catch (e) {
                    logger.error("POS SSE 訊息解析失敗:", e);
                }
            };

            // 連線錯誤：關閉當前連線並重新取得 ticket 再重連
            // （不能依賴 EventSource 自動重連，因為舊 ticket 已被銷毀）
            eventSource.onerror = (err) => {
                logger.error("POS SSE 連線錯誤:", err);
                eventSource.close();
                setTimeout(() => startSse(), 5000);
            };
        } catch (error) {
            logger.error("POS 取得 SSE ticket 失敗，5 秒後重試:", error);
            setTimeout(() => startSse(), 5000);
        }
    }

    /**
     * 【修改 3】處理 SSE 訊息 (原 handlePosWebSocketMessage)
     */
    function handlePosSseMessage(action, order) {
        logger.info("POS 收到 SSE 訊息:", action, order.orderNumber);
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
                pickupListEl.innerHTML = "<p class='pickup-empty'>目前沒有待取餐點</p>";
            }
        }
        // POS 不需要處理 NEW_ORDER (因為 KDS 會處理)
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
            alert(`訂單 ${orderId} 更新失敗: ${error.message}`);
            button.disabled = false;
            button.textContent = "完成取餐";
        }
    }

    // --- 10. 啟動程序 ---

    const checkoutButton = document.getElementById("checkout-button");
    const holdButton = document.getElementById("hold-button");
    checkoutButton.addEventListener("click", goToCheckout);
    holdButton.addEventListener("click", holdOrder);
    pickupListEl.addEventListener("click", handleCompletePickup);

    loadAllData();
    loadPickupOrders();

    const restoredCartJson = localStorage.getItem("cartForCheckout");
    if (restoredCartJson) {
        try {
            shoppingCart = JSON.parse(restoredCartJson);
        } catch (e) {
            shoppingCart = [];
        }
    } else {
        shoppingCart = [];
    }

    renderCart();

    // 【修改 4】啟動 SSE
    startSse();
});