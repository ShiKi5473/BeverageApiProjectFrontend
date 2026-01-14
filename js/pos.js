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
    updateOrderStatus // 雖然 pos.js 主要用來顯示待取餐，但如果需要在這頁完成取餐也需要這個
} from "./api.js";
import { getAccessToken, logout, getStoreId } from './auth.js';
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
const restoreButton = document.getElementById("restore-button");
const heldOrdersDialog = document.getElementById("held-orders-dialog");
const heldOrdersList = document.getElementById("held-orders-list");
const heldModalCloseBtn = document.getElementById("held-modal-close-btn");

document.addEventListener("DOMContentLoaded", () => {
    if (!MY_STORE_ID) {
        const errorMsg = "錯誤：找不到店家 ID (storeId)。\n\n品牌管理員帳號無法使用 POS 點餐系統。\n\n將導回登入頁。";
        console.error(errorMsg);
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

        // 轉換為後端 OrderItemDto 格式
        const orderItemsDto = shoppingCart.map((item) => ({
            productId: item.productId,
            variantId: item.variantId, // [重要] 必須傳送 variantId
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
            console.error(` ${action} 失敗:`, error);
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
            console.error("無法儲存 localStorage:", e);
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
            console.error("載入資料時發生錯誤:", error);
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

        // 綁定加入購物車按鈕事件
        modalAddButton.onclick = () => {
            if (currentModal) {
                // 1. 取得選擇的資料（若驗證失敗會回傳 null）
                const selectedData = currentModal.getSelectedData();

                // 2. 檢查是否驗證通過
                if (!selectedData) {
                    return; // 驗證失敗 (例如沒選規格)，直接中斷，不關閉視窗
                }

                // 3. 執行加入購物車 (修正變數名稱：currentProduct -> product)
                handleAddToCart(product, selectedData);
            }
        };

        modalCloseButton.onclick = closeModal;
        optionsDialog.show();
    }

    function closeModal() {
        optionsDialog.close();
        currentModal = null;
    }

    function handleAddToCart(product, selectedData) {
        // 1. 找出對應的規格物件 (為了取得正確價格)
        let selectedVariant = null;
        let basePrice = product.basePrice; // 預設使用原價

        if (selectedData.variantId) {
            // 注意: dataset 取出的 id 是字串，需轉型或寬鬆比對
            if (product.variants) {
                selectedVariant = product.variants.find(v => String(v.id) === String(selectedData.variantId));
            }
            if (selectedVariant) {
                basePrice = selectedVariant.price; // 改用規格價格
            }
        }

        // 2. 篩選出選中的配料/選項物件
        const allOptions = product.optionGroups ? product.optionGroups.flatMap((group) => group.options) : [];
        const selectedOptions = allOptions.filter((option) =>
            selectedData.selectedOptionIds.includes(String(option.optionId))
        );

        // 3. 計算單價: 規格價格 + 選項加價
        const optionPriceAdjustment = selectedOptions.reduce((sum, opt) => sum + opt.priceAdjustment, 0);
        const unitPrice = basePrice + optionPriceAdjustment;

        // 4. 建立購物車項目
        const cartItem = {
            id: Date.now(),
            productId: product.id,
            name: product.name,
            // [重要] 記錄規格資訊
            variantId: selectedVariant ? selectedVariant.id : null,
            variantName: selectedVariant ? selectedVariant.name : "",
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
     * 【修改 2】啟動 SSE 連線 (取代 WebSocket)
     */
    function startSse() {
        const token = getAccessToken();
        if (!token) return;

        // 使用與 kds.js 相同的 SSE 端點
        const eventSource = new EventSource(`/api/v1/kds/stream?token=${token}`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handlePosSseMessage(data.action, data.payload);
            } catch (e) {
                console.error("POS SSE 訊息解析失敗:", e);
            }
        };

        eventSource.onerror = (err) => {
            console.error("POS SSE 連線錯誤 (將自動重連):", err);
            if (eventSource.readyState === EventSource.CLOSED) {
                // Token 可能過期，可考慮導向登入或提示
            }
        };
    }

    /**
     * 【修改 3】處理 SSE 訊息 (原 handlePosWebSocketMessage)
     */
    function handlePosSseMessage(action, order) {
        console.log("POS 收到 SSE 訊息:", action, order.orderNumber);
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
            console.error("更新訂單為 CLOSED 失敗:", error);
            alert(`訂單 ${orderId} 更新失敗: ${error.message}`);
            button.disabled = false;
            button.textContent = "完成取餐";
        }
    }

    /**
     * 開啟暫存訂單選擇面板
     */
    async function openHeldOrdersModal() {
        // 如果購物車不為空，提示使用者
        if (shoppingCart.length > 0) {
            if (!confirm("購物車內尚有商品，取出暫存訂單將會清空目前購物車。是否繼續？")) {
                return;
            }
        }

        heldOrdersList.innerHTML = "<md-list-item>載入中...</md-list-item>";
        heldOrdersDialog.show();

        try {
            // 呼叫 API 取得 HELD 狀態的訂單
            const orders = await getOrdersByStatus(MY_STORE_ID, "HELD");

            renderHeldOrdersList(orders);
        } catch (error) {
            console.error("讀取暫存訂單失敗:", error);
            heldOrdersList.innerHTML = `<md-list-item>讀取失敗: ${error.message}</md-list-item>`;
        }
    }

    /**
     * 渲染暫存訂單列表
     */
    function renderHeldOrdersList(orders) {
        heldOrdersList.innerHTML = "";

        if (!orders || orders.length === 0) {
            heldOrdersList.innerHTML = "<div style='padding:15px; text-align:center;'>沒有暫存訂單</div>";
            return;
        }

        // 依時間倒序排列 (最新的在上面)
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        orders.forEach(order => {
            const itemEl = document.createElement("md-list-item");
            itemEl.className = "held-order-item";

            // 格式化時間
            const timeStr = new Date(order.createdAt).toLocaleString('zh-TW', {
                hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric'
            });

            // 建立顯示內容 (訂單號 + 金額 + 時間)
            itemEl.innerHTML = `
                <div slot="headline">單號: #${order.orderNumber}</div>
                <div slot="supporting-text">品項數: ${order.items.length} | 時間: ${timeStr}</div>
                <div slot="trailing-supporting-text" class="held-order-price">NT$ ${order.totalAmount}</div>
            `;

            // 點擊事件：恢復此訂單
            itemEl.addEventListener("click", () => restoreHeldOrder(order));
            heldOrdersList.appendChild(itemEl);
        });
    }

    /**
     * 恢復選定的暫存訂單到購物車
     */
    async function restoreHeldOrder(order) {
        try {
            const restoredCart = [];

            // 遍歷訂單項目，將後端資料 (ItemDto) 轉換回前端購物車格式 (CartItem)
            for (const item of order.items) {
                // 1. 從 allProducts 找回完整的商品資訊
                const product = allProducts.find(p => String(p.id) === String(item.productId));
                // 遍歷訂單項目，將後端資料 (ItemDto) 轉換回前端購物車格式 (CartItem)
                for (const item of order.items) {
                    // 1. 從 allProducts 找回完整的商品資訊
                    // [修正點 1] 使用 String() 轉換 ID，避免 數值 vs 字串 的型別錯誤
                    const product = allProducts.find(p => String(p.id) === String(item.productId));

                    if (!product) {
                        console.warn(`找不到商品 ID: ${item.productId} (型別: ${typeof item.productId})，略過此項目`);
                        continue;
                    }

                    // --- [修正點 2] 補回處理規格 (Variant) 的邏輯 ---
                    let basePrice = product.basePrice;
                    let variantName = "";

                    // 檢查後端回傳的項目是否有 variantId
                    if (item.variantId && product.variants) {
                        // 同樣使用 String() 確保比對正確
                        const variant = product.variants.find(v => String(v.id) === String(item.variantId));
                        if (variant) {
                            basePrice = variant.price; // 使用規格價格
                            variantName = variant.name;
                        }
                    }
                    // --- 規格邏輯結束 ---

                    // 2. 找回選項詳細資訊
                    const allProductOptions = product.optionGroups.flatMap(g => g.options);
                    const selectedOptions = allProductOptions.filter(opt =>
                        item.optionIds && item.optionIds.includes(opt.optionId)
                    );

                    // 3. 重新計算單價 (使用正確的 basePrice)
                    const optionPriceAdjustment = selectedOptions.reduce((sum, opt) => sum + opt.priceAdjustment, 0);
                    const unitPrice = basePrice + optionPriceAdjustment;

                    // 4. 建立購物車物件
                    restoredCart.push({
                        id: Date.now() + Math.random(),
                        productId: product.id,
                        name: product.name,
                        // [修正點 3] 寫入規格資訊
                        variantId: item.variantId || null,
                        variantName: variantName,
                        quantity: item.quantity,
                        unitPrice: unitPrice,
                        selectedOptions: selectedOptions,
                        notes: item.notes || ""
                    });
                }

                // 更新購物車
                if (restoredCart.length === 0) {
                    alert("無法還原訂單內容 (可能找不到對應商品)");
                    return;
                }

                shoppingCart = restoredCart;
                renderCart();

                // 關閉視窗
                heldOrdersDialog.close();

                // 取出後，將原本後端的該筆「暫存單」取消
                await updateOrderStatus(order.orderId, "CANCELLED");

                // 這裡不需 alert，體驗較順暢
                // alert(`已取出訂單 #${order.orderNumber}`);

            }

        }catch(error){
            console.error("取出訂單失敗:", error);
            alert("取出訂單時發生錯誤，請稍後再試");
        }
    }

    // --- 10. 啟動程序 ---

    const checkoutButton = document.getElementById("checkout-button");
    const holdButton = document.getElementById("hold-button");
    checkoutButton.addEventListener("click", goToCheckout);
    holdButton.addEventListener("click", holdOrder);
    pickupListEl.addEventListener("click", handleCompletePickup);
    restoreButton.addEventListener("click", openHeldOrdersModal);

    heldModalCloseBtn.addEventListener("click", () => {
        heldOrdersDialog.close();
    });

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