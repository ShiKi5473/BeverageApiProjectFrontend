import logger from './utils/logger.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/dialog/dialog.js';

import {
    getStores,
    getCategories,
    getPosProducts,
    createOnlineOrder,
    guestLogin
} from "./api.js";
import { getAccessToken, setAuthSession, isAuthenticated, getStoreId } from './auth.js';
import { createProductCard } from "./components/ProductCard.js";
import { createOptionsModalContent } from "./components/OptionsModal.js";
import { initAppNotifications } from './app-notifications.js';
import { toastManager } from './components/Notification.js';

let allProducts = [];
let shoppingCart = [];
let currentStoreId = getStoreId();

// DOM Elements
const categoryNav = document.getElementById("category-nav");
const productGrid = document.getElementById("customer-product-grid");
const cartBadge = document.getElementById("cart-badge");
const bottomCartBar = document.getElementById("bottom-cart-bar");
const bottomCartTotal = document.getElementById("bottom-cart-total");
const cartToggleBtn = document.getElementById("cart-toggle-btn");
const goToCheckoutBtn = document.getElementById("go-to-checkout-btn");

const checkoutSheet = document.getElementById("checkout-sheet");
const sheetOverlay = document.getElementById("sheet-overlay");
const closeSheetBtn = document.getElementById("close-sheet-btn");
const cartItemsContainer = document.getElementById("cart-items-container");
const sheetFinalAmount = document.getElementById("sheet-final-amount");
const submitOrderBtn = document.getElementById("submit-order-btn");

const optionsDialog = document.getElementById("options-dialog");
const dialogContentSlot = document.getElementById("dialog-content-slot");
const modalCloseBtn = document.getElementById("modal-close-btn");
const modalAddBtn = document.getElementById("modal-add-btn");

const storeSelectorDialog = document.getElementById("store-selector-dialog");
const storeListContainer = document.getElementById("store-list-container");
const currentStoreNameEl = document.getElementById("current-store-name");
const changeStoreBtn = document.getElementById("change-store-btn");

const activeOrderTracker = document.getElementById("active-order-tracker");
const trackerOrderNumber = document.getElementById("tracker-order-number");
const trackerStatusIcon = document.getElementById("tracker-icon");
const trackerStatusText = document.getElementById("tracker-text");

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Initial Login Check (Guest flow for MVP)
    await ensureAuth();

    // 2. Initialize real-time notifications
    initAppNotifications();

    // 3. Setup Store
    await setupStore();

    // 4. Load Products
    if (currentStoreId) {
        await loadProductsAndCategories();
    }

    // 5. Event Listeners
    setupEventListeners();
});

async function ensureAuth() {
    if (!isAuthenticated()) {
        const guestName = prompt("線上點餐系統\n請輸入您的稱呼：", "訪客");
        if (!guestName) {
            alert("需要稱呼才能為您準備飲料哦！");
            window.location.reload();
            return;
        }
        try {
            const res = await guestLogin(guestName);
            setAuthSession(res, guestName);
            logger.info("訪客登入成功");
        } catch (e) {
            logger.error("訪客登入失敗", e);
            alert("系統繁忙，請稍後再試。");
        }
    }
}

async function setupStore() {
    try {
        const stores = await getStores();
        if (stores.length === 0) {
            alert("目前沒有開放的分店");
            return;
        }

        // URL override
        const urlParams = new URLSearchParams(window.location.search);
        const urlStoreId = urlParams.get('storeId');
        
        if (urlStoreId) {
            currentStoreId = urlStoreId;
            setAuthSession({ accessToken: getAccessToken(), storeId: currentStoreId });
        } else if (!currentStoreId) {
            // Pick first one default
            currentStoreId = stores[0].storeId;
            setAuthSession({ accessToken: getAccessToken(), storeId: currentStoreId });
        }

        const store = stores.find(s => String(s.storeId) === String(currentStoreId));
        currentStoreNameEl.textContent = store ? store.name : "未知分店";

        // Render store selector
        storeListContainer.innerHTML = '';
        stores.forEach(s => {
            const btn = document.createElement('md-text-button');
            btn.textContent = s.name;
            btn.style.width = "100%";
            btn.style.marginBottom = "8px";
            btn.onclick = () => {
                currentStoreId = s.storeId;
                setAuthSession({ accessToken: getAccessToken(), storeId: currentStoreId });
                currentStoreNameEl.textContent = s.name;
                storeSelectorDialog.close();
                // Retain cart or clear cart? For MVP, just reload data
                loadProductsAndCategories();
            };
            storeListContainer.appendChild(btn);
        });

    } catch (e) {
        logger.error("載入分店失敗", e);
    }
}

async function loadProductsAndCategories() {
    productGrid.innerHTML = '<div class="loading-state">載入商品中...</div>';
    try {
        const [products, categories] = await Promise.all([
            getPosProducts(),
            getCategories()
        ]);
        allProducts = products;
        renderCategoryNav(categories);
        renderProductGrid("all");
    } catch (e) {
        productGrid.innerHTML = '<div class="loading-state">載入失敗，請重整頁面</div>';
    }
}

function renderCategoryNav(categories) {
    categoryNav.innerHTML = '';
    
    const allBtn = document.createElement('button');
    allBtn.className = 'cat-pill active';
    allBtn.textContent = '全部';
    allBtn.onclick = () => filterCategory('all', allBtn);
    categoryNav.appendChild(allBtn);

    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'cat-pill';
        btn.textContent = cat.name;
        btn.onclick = () => filterCategory(cat.categoryId, btn);
        categoryNav.appendChild(btn);
    });
}

function filterCategory(categoryId, btnElement) {
    document.querySelectorAll('.cat-pill').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    renderProductGrid(categoryId);
}

function renderProductGrid(categoryId) {
    productGrid.innerHTML = '';
    
    const displayProducts = categoryId === 'all' 
        ? allProducts 
        : allProducts.filter(p => p.categories?.some(c => c.categoryId === Number(categoryId)));

    if (displayProducts.length === 0) {
        productGrid.innerHTML = '<div class="loading-state">此分類無商品</div>';
        return;
    }

    displayProducts.forEach(product => {
        const productCard = createProductCard(product);
        productCard.addEventListener("click", () => openOptionsModal(product));
        productGrid.appendChild(productCard);
    });
}

// === Cart & Modal Logic ===
let currentModalOptions = null;

function openOptionsModal(product) {
    currentModalOptions = createOptionsModalContent(product);
    dialogContentSlot.innerHTML = "";
    dialogContentSlot.appendChild(currentModalOptions.element);
    optionsDialog.show();
}

modalCloseBtn.onclick = () => optionsDialog.close();
modalAddBtn.onclick = () => {
    if (currentModalOptions) {
        const selectedData = currentModalOptions.getSelectedData();
        addToCart(currentModalOptions.product, selectedData);
        optionsDialog.close();
    }
};

function addToCart(product, selectedData) {
    const allOptions = product.optionGroups.flatMap((group) => group.options);
    const selectedOptionsArr = allOptions.filter((option) =>
        selectedData.selectedOptionIds.includes(String(option.optionId))
    );
    const optionPriceAdjustment = selectedOptionsArr.reduce((sum, opt) => sum + opt.priceAdjustment, 0);
    const unitPrice = product.basePrice + optionPriceAdjustment;
    
    shoppingCart.push({
        id: Date.now(),
        productId: product.id,
        name: product.name,
        quantity: selectedData.quantity,
        unitPrice: unitPrice,
        selectedOptions: selectedOptionsArr,
        notes: selectedData.notes,
    });
    
    updateCartUI();
    toastManager.show('成功', '已加入購物車', 'success', 2000);
}

function updateCartUI() {
    const itemCount = shoppingCart.reduce((sum, item) => sum + item.quantity, 0);
    const totalAmount = shoppingCart.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
    
    if (itemCount > 0) {
        cartBadge.textContent = itemCount;
        cartBadge.classList.remove('hidden');
        bottomCartBar.classList.remove('hidden');
        bottomCartTotal.textContent = `NT$ ${totalAmount}`;
        sheetFinalAmount.textContent = `NT$ ${totalAmount}`;
    } else {
        cartBadge.classList.add('hidden');
        bottomCartBar.classList.add('hidden');
        closeCheckoutSheet();
    }
    
    renderCartList();
}

function toggleCheckoutSheet() {
    if (checkoutSheet.classList.contains('open')) {
        closeCheckoutSheet();
    } else {
        checkoutSheet.classList.add('open');
        sheetOverlay.classList.add('open');
    }
}

function closeCheckoutSheet() {
    checkoutSheet.classList.remove('open');
    sheetOverlay.classList.remove('open');
}

function renderCartList() {
    cartItemsContainer.innerHTML = '';
    shoppingCart.forEach(item => {
        const itemEl = document.createElement('div');
        itemEl.className = 'cart-list-item';
        
        const optionsStr = item.selectedOptions.map(o => o.optionName).join(', ');
        const notesStr = item.notes ? `(${item.notes})` : '';
        
        itemEl.innerHTML = `
            <div class="cart-item-info">
                <span class="cart-item-name">${item.name} x${item.quantity}</span>
                <span class="cart-item-options">${optionsStr} ${notesStr}</span>
            </div>
            <span class="cart-item-price">NT$ ${item.unitPrice * item.quantity}</span>
            <md-icon-button class="remove-btn" data-id="${item.id}">
                <md-icon>delete</md-icon>
            </md-icon-button>
        `;
        cartItemsContainer.appendChild(itemEl);
    });

    // Delegate remove events
    cartItemsContainer.querySelectorAll('.remove-btn').forEach(btn => {
        btn.onclick = () => {
            const idToRemove = Number(btn.dataset.id);
            shoppingCart = shoppingCart.filter(item => item.id !== idToRemove);
            updateCartUI();
        };
    });
}

function setupEventListeners() {
    changeStoreBtn.onclick = () => storeSelectorDialog.show();
    
    cartToggleBtn.onclick = toggleCheckoutSheet;
    goToCheckoutBtn.onclick = toggleCheckoutSheet;
    closeSheetBtn.onclick = closeCheckoutSheet;
    sheetOverlay.onclick = closeCheckoutSheet;

    submitOrderBtn.onclick = handleOrderSubmit;
}

// === Order Submission and Tracking ===

async function handleOrderSubmit() {
    if (shoppingCart.length === 0 || submitOrderBtn.disabled) return;
    
    submitOrderBtn.disabled = true;
    submitOrderBtn.textContent = "處理中...";
    
    const itemsDto = shoppingCart.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        notes: item.notes,
        optionIds: item.selectedOptions.map(opt => opt.optionId)
    }));

    const createOrderRequest = {
        items: itemsDto,
        status: 'RECEIVED' // Default status for online orders awaiting KDS
    };

    try {
        const result = await createOnlineOrder(createOrderRequest);
        
        // Clear cart
        shoppingCart = [];
        updateCartUI();
        closeCheckoutSheet();
        toggleTrackerUI(true, "排隊中...", "hourglass_top", "尚未取得訂單編號", "系統正在處理您的訂單，請稍候...");
        
        toastManager.show('訂單已送出', '您的訂單已非同步提交至後台', 'info');

        // We listen for WebSocket global notification in app-notifications.js to actually update the tracker state.
        
        // Expose a function to global scope so app-notifications can call it if needed, or we just listen to a custom event
        document.addEventListener('order-status-changed', (e) => {
            const detail = e.detail;
            updateTrackerFromNotification(detail);
        });

    } catch (e) {
        logger.error("下單失敗", e);
        alert(`下單失敗: ${e.message}`);
    } finally {
        submitOrderBtn.disabled = false;
        submitOrderBtn.textContent = "確認下單";
    }
}

function toggleTrackerUI(show, text = "", icon = "hourglass_empty", title = "", subtext = "") {
    if (show) {
        activeOrderTracker.classList.remove('hidden');
        trackerStatusText.textContent = text;
        trackerStatusIcon.textContent = icon;
        trackerOrderNumber.textContent = title;
        activeOrderTracker.querySelector('.tracker-subtext').textContent = subtext;
    } else {
        activeOrderTracker.classList.add('hidden');
    }
}

function updateTrackerFromNotification(notification) {
    activeOrderTracker.classList.remove('hidden');
    trackerOrderNumber.textContent = `單號：${notification.orderNumber}`;
    trackerStatusIcon.className = ''; // reset color classes

    switch (notification.status) {
        case 'RECEIVED':
            trackerStatusIcon.textContent = 'receipt';
            trackerStatusText.textContent = '商家已接單';
            break;
        case 'PREPARING':
            trackerStatusIcon.textContent = 'local_cafe';
            trackerStatusText.textContent = '飲料製作中';
            trackerStatusIcon.classList.add('order-status-preparing');
            break;
        case 'READY_FOR_PICKUP':
            trackerStatusIcon.textContent = 'check_circle';
            trackerStatusText.textContent = '製作完成，請取餐！';
            trackerStatusIcon.classList.add('order-status-ready');
            break;
        case 'CLOSED':
            trackerStatusIcon.textContent = 'done_all';
            trackerStatusText.textContent = '訂單已結案';
            setTimeout(() => toggleTrackerUI(false), 5000); // hide after 5 seconds
            break;
        case 'CANCELLED':
            trackerStatusIcon.textContent = 'cancel';
            trackerStatusText.textContent = '訂單被取消';
            trackerStatusIcon.style.color = '#e74c3c';
            break;
        default:
            trackerStatusText.textContent = notification.message;
    }
}

// To make this loosely coupled, we bind a listener here and trigger it from app-notifications.js
// Export a helper or use CustomEvent
window.dispatchOrderNotification = (notification) => {
    const event = new CustomEvent('order-status-changed', { detail: notification });
    document.dispatchEvent(event);
};

