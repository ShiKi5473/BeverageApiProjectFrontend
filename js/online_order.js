import logger from './utils/logger.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/dialog/dialog.js';
// 【新增】整單備註輸入框
import '@material/web/textfield/filled-text-field.js';

import {
    getStores,
    getCategories,
    getPosProducts,
    createOnlineOrder,
    guestLogin,
    previewOrder,
    getOnlineOrderTicket
} from "./api.js";
import {
    isAuthenticated,
    setAuthSession,
    clearAuthSession,
    getBrandId,
    getStoreId,
    setStoreId,
    logout
} from './auth.js';
import { createProductCard } from "./components/ProductCard.js";
import { createOptionsModalContent } from "./components/OptionsModal.js";
import { initAppNotifications } from './app-notifications.js';
import { toastManager } from './components/Notification.js';
// 【新增】DOM 建立工具（textContent）、金額／品項組裝、冪等鍵、取餐號碼、訂單狀態對照
import { el, setMessage } from './utils/dom.js';
import { buildCartItem, toOrderItemDto, calculateCartTotal, calculateLineTotal, toNumber } from './utils/pricing.js';
import { createIdempotencyHolder } from './utils/idempotency.js';
import { getPickupNumber } from './utils/orderNumber.js';
import { describeOrderStatus } from './utils/orderStatus.js';

/** ticket 還在排隊（QUEUED）時的輪詢間隔（毫秒） */
const POLL_QUEUED_MS = 2000;
/** 訂單已建立後的輪詢間隔（毫秒）；主要靠 STOMP 即時推播，輪詢只是備援 */
const POLL_CREATED_MS = 5000;
/** 連續查詢失敗幾次後放棄追蹤 */
const POLL_MAX_FAILURES = 6;
/** 訂單結案後，追蹤卡片多久後自動隱藏（毫秒） */
const TRACKER_HIDE_DELAY_MS = 5000;
/** 購物車變動後，延遲多久才向後端試算金額（毫秒） */
const PREVIEW_DEBOUNCE_MS = 300;
/** 目前追蹤中的 ticketId 存在 sessionStorage 的 key（重新整理後可接續追蹤） */
const TICKET_STORAGE_KEY = 'activeOnlineTicketId';

let allProducts = [];
let shoppingCart = [];
// 【修改】分店 ID 在 setupStore() 驗證後才設定（原本直接信任 localStorage 殘留值）
let currentStoreId = null;
// 【修改】開啟選項視窗時保留「商品」參照，加入購物車才拿得到 product
// （原本讀 currentModalOptions.product，該屬性從來沒有被設定，加入購物車必拋 TypeError）
let currentModal = null; // { product, content }
let submitting = false;
let listenersBound = false;
let serverPreview = null; // 後端試算結果（POST /orders/preview）
let previewSeq = 0;
let previewTimer = null;
let lastSubmittedCart = null; // 送出前的購物車快照；下單失敗時用來還原
// 【新增】下單冪等鍵：內容不變的重試沿用同一個 key，成功後重置
const orderIdempotency = createIdempotencyHolder();
// 目前追蹤中的線上訂單：{ ticketId, orderNumber, timer, polling, stopped, failures }
let tracker = null;

// 【新增】網址參數：店內 QR code 形如 online_order.html?brandId=1&storeId=1
const urlParams = new URLSearchParams(window.location.search);
const urlBrandId = (urlParams.get('brandId') || '').trim();
const urlStoreId = (urlParams.get('storeId') || '').trim();

// DOM Elements
const categoryNav = document.getElementById("category-nav");
const productGrid = document.getElementById("customer-product-grid");
const cartBadge = document.getElementById("cart-badge");
const bottomCartBar = document.getElementById("bottom-cart-bar");
const bottomCartTotal = document.getElementById("bottom-cart-total");
const cartToggleBtn = document.getElementById("cart-toggle-btn");
const goToCheckoutBtn = document.getElementById("go-to-checkout-btn");
const userProfileBtn = document.getElementById("user-profile-btn");

const checkoutSheet = document.getElementById("checkout-sheet");
const sheetOverlay = document.getElementById("sheet-overlay");
const closeSheetBtn = document.getElementById("close-sheet-btn");
const cartItemsContainer = document.getElementById("cart-items-container");
const sheetFinalAmount = document.getElementById("sheet-final-amount");
const sheetDiscountRow = document.getElementById("sheet-discount-row");
const sheetDiscountAmount = document.getElementById("sheet-discount-amount");
const customerNoteInput = document.getElementById("customer-note");
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
const trackerSubtext = activeOrderTracker.querySelector('.tracker-subtext');
const TRACKER_DEFAULT_SUBTEXT = trackerSubtext.textContent;

document.addEventListener("DOMContentLoaded", async () => {
    // 0. 事件監聽器只在這裡註冊一次
    // （原本每次送單都會 document.addEventListener 一次，送 N 張單就會重複處理 N 次）
    setupEventListeners();

    // 1. 訪客登入（品牌從網址參數 brandId 取得）
    if (!(await ensureAuth())) return;

    // 2. 啟動即時通知（STOMP /user/queue/orders），通知會以 order-status-changed 事件轉給本頁
    initAppNotifications();

    // 3. 分店
    if (!(await setupStore())) return;

    // 4. 商品
    await loadProductsAndCategories();

    // 5. 重新整理頁面後，接續追蹤尚未結案的訂單
    resumeTracking();
});

/** 無法繼續時，在商品區顯示說明訊息（textContent） */
function showFatal(message) {
    setMessage(productGrid, message, 'loading-state', 'div');
    currentStoreNameEl.textContent = "—";
}

/**
 * 確認登入狀態；沒有登入就以網址上的 brandId 做訪客登入
 * 【修改】訪客登入需要 brandId（POST /auth/guest {displayName, brandId}），後端據此簽發帶品牌的 GUEST token
 * @returns {Promise<boolean>} 是否已具備可用的登入狀態
 */
async function ensureAuth() {
    // 網址指定的品牌與目前工作階段的品牌不同 -> 丟掉舊 token，重新以新品牌做訪客登入
    // （ID 一律以字串比較，不轉 Number）
    if (isAuthenticated() && urlBrandId && getBrandId() && getBrandId() !== urlBrandId) {
        clearAuthSession();
    }
    if (isAuthenticated()) return true;

    if (!/^\d+$/.test(urlBrandId)) {
        showFatal("缺少品牌資訊，請掃描店內的 QR code 進入線上點餐。");
        return false;
    }

    const guestName = prompt("線上點餐系統\n請輸入您的稱呼：", "訪客");
    if (!guestName || !guestName.trim()) {
        alert("需要稱呼才能為您準備飲料哦！");
        window.location.reload();
        return false;
    }
    try {
        const res = await guestLogin(guestName.trim(), urlBrandId);
        clearAuthSession();
        setAuthSession(res, guestName.trim(), urlBrandId);
        logger.info("訪客登入成功");
        return true;
    } catch (e) {
        logger.error("訪客登入失敗", e);
        // 429（速率限制）或品牌不存在時，後端訊息會顯示在這裡
        showFatal(e.message || "系統繁忙，請稍後再試。");
        return false;
    }
}

/**
 * 載入分店並決定目前分店
 * 優先順序：網址 storeId > 先前記住的分店 > 第一間；選定的分店必須存在於後端回傳的清單中
 * @returns {Promise<boolean>}
 */
async function setupStore() {
    try {
        const stores = await getStores();
        if (!Array.isArray(stores) || stores.length === 0) {
            showFatal("目前沒有開放的分店");
            return false;
        }

        const candidates = [urlStoreId, getStoreId()];
        const matched = candidates.find((id) => id && stores.some((s) => String(s.storeId) === String(id)));
        currentStoreId = String(matched ?? stores[0].storeId);
        setStoreId(currentStoreId);

        const store = stores.find((s) => String(s.storeId) === currentStoreId);
        currentStoreNameEl.textContent = store ? store.name : "未知分店";

        // Render store selector
        storeListContainer.textContent = '';
        stores.forEach((s) => {
            const btn = document.createElement('md-text-button');
            btn.textContent = s.name;
            btn.style.width = "100%";
            btn.style.marginBottom = "8px";
            btn.addEventListener('click', () => {
                currentStoreId = String(s.storeId);
                setStoreId(currentStoreId);
                currentStoreNameEl.textContent = s.name;
                storeSelectorDialog.close();
                // 商品是品牌層級，切換分店不需重新載入商品；購物車保留，但金額要重新試算
                scheduleServerPreview();
            });
            storeListContainer.appendChild(btn);
        });
        return true;

    } catch (e) {
        logger.error("載入分店失敗", e);
        showFatal(e.message || "載入分店失敗，請重新整理頁面");
        return false;
    }
}

async function loadProductsAndCategories() {
    setMessage(productGrid, "載入商品中...", 'loading-state', 'div');
    try {
        const [products, categories] = await Promise.all([
            getPosProducts(),
            getCategories()
        ]);
        allProducts = products;
        renderCategoryNav(categories);
        renderProductGrid("all");
    } catch (e) {
        logger.error("載入商品失敗", e);
        setMessage(productGrid, "載入失敗，請重整頁面", 'loading-state', 'div');
    }
}

function renderCategoryNav(categories) {
    categoryNav.textContent = '';

    const allBtn = document.createElement('button');
    allBtn.className = 'cat-pill active';
    allBtn.textContent = '全部';
    allBtn.addEventListener('click', () => filterCategory('all', allBtn));
    categoryNav.appendChild(allBtn);

    categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'cat-pill';
        btn.textContent = cat.name;
        btn.addEventListener('click', () => filterCategory(cat.categoryId, btn));
        categoryNav.appendChild(btn);
    });
}

function filterCategory(categoryId, btnElement) {
    document.querySelectorAll('.cat-pill').forEach(btn => btn.classList.remove('active'));
    btnElement.classList.add('active');
    renderProductGrid(categoryId);
}

function renderProductGrid(categoryId) {
    productGrid.textContent = '';

    // 【修改】分類 ID 是字串，用 String() 比較（原本 Number(categoryId) 會讓大整數失去精度）
    const displayProducts = categoryId === 'all'
        ? allProducts
        : allProducts.filter(p => p.categories?.some(c => String(c.categoryId) === String(categoryId)));

    if (displayProducts.length === 0) {
        setMessage(productGrid, "此分類無商品", 'loading-state', 'div');
        return;
    }

    displayProducts.forEach(product => {
        const productCard = createProductCard(product);
        productCard.addEventListener("click", () => openOptionsModal(product));
        productGrid.appendChild(productCard);
    });
}

// === Cart & Modal Logic ===

function openOptionsModal(product) {
    // 【修改】同時保留 product 與 modal 內容
    currentModal = { product, content: createOptionsModalContent(product) };
    dialogContentSlot.textContent = "";
    dialogContentSlot.appendChild(currentModal.content.element);
    optionsDialog.show();
}

/**
 * 把選擇結果加入購物車
 * 【修改】改用共用的 buildCartItem：單價 = 規格價 + 選項加價，並帶 variantId
 * （原本用 product.basePrice，且品項沒有 variantId，後端會 400）
 * @returns {boolean} 是否加入成功
 */
function addToCart(product, selectedData) {
    let cartItem;
    try {
        cartItem = buildCartItem(product, selectedData);
    } catch (error) {
        toastManager.show('無法加入', error.message, 'warning', 3000);
        return false;
    }
    shoppingCart.push(cartItem);

    updateCartUI();
    toastManager.show('成功', '已加入購物車', 'success', 2000);
    return true;
}

/** 顯示用金額：優先採用後端試算結果，沒有（尚未回來或試算失敗）就用前端暫估 */
function renderTotals() {
    const estimate = calculateCartTotal(shoppingCart);
    const finalAmount = serverPreview ? toNumber(serverPreview.finalAmount) : estimate;
    const discount = serverPreview ? toNumber(serverPreview.promotionDiscount) : 0;

    bottomCartTotal.textContent = `NT$ ${finalAmount}`;
    sheetFinalAmount.textContent = `NT$ ${finalAmount}`;
    if (discount > 0) {
        sheetDiscountAmount.textContent = `- NT$ ${discount}`;
        sheetDiscountRow.style.display = "flex";
    } else {
        sheetDiscountRow.style.display = "none";
    }
}

/**
 * 【新增】購物車變動後，向 POST /api/v1/orders/preview 試算正式金額（含促銷折扣）。
 * 訪客也可呼叫；失敗時靜默退回前端暫估（實際金額以後端建單為準）。
 */
function scheduleServerPreview() {
    clearTimeout(previewTimer);
    const seq = ++previewSeq;
    serverPreview = null;
    renderTotals();
    if (shoppingCart.length === 0 || !currentStoreId) return;

    previewTimer = setTimeout(async () => {
        try {
            const result = await previewOrder({
                storeId: currentStoreId,
                items: shoppingCart.map(toOrderItemDto),
            });
            if (seq !== previewSeq) return; // 購物車又變了，丟棄過期結果
            serverPreview = result;
            renderTotals();
        } catch (e) {
            logger.warn("金額試算失敗，改用前端暫估", e);
        }
    }, PREVIEW_DEBOUNCE_MS);
}

function updateCartUI() {
    const itemCount = shoppingCart.reduce((sum, item) => sum + item.quantity, 0);

    if (itemCount > 0) {
        cartBadge.textContent = itemCount;
        cartBadge.classList.remove('hidden');
        bottomCartBar.classList.remove('hidden');
    } else {
        cartBadge.classList.add('hidden');
        bottomCartBar.classList.add('hidden');
        closeCheckoutSheet();
    }

    renderCartList();
    scheduleServerPreview();
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

/**
 * 渲染購物車明細
 * 【修改】XSS 防護：改用 DOM API + textContent（原本把商品名稱／選項／備註直接插入 innerHTML）；
 * 移除按鈕不再各自綁 onclick，改由容器上的單一委派監聽器處理（見 setupEventListeners）
 */
function renderCartList() {
    cartItemsContainer.textContent = '';
    shoppingCart.forEach(item => {
        const itemEl = el('div', 'cart-list-item');

        const optionsStr = (item.selectedOptions ?? []).map(o => o.optionName).join(', ');
        const notesStr = item.notes ? `(${item.notes})` : '';
        const variantText = item.variantName ? ` (${item.variantName})` : '';

        const info = el('div', 'cart-item-info');
        info.appendChild(el('span', 'cart-item-name', `${item.name}${variantText} x${item.quantity}`));
        info.appendChild(el('span', 'cart-item-options', `${optionsStr} ${notesStr}`.trim()));
        itemEl.appendChild(info);

        itemEl.appendChild(el('span', 'cart-item-price', `NT$ ${calculateLineTotal(item.unitPrice, item.quantity)}`));

        const removeBtn = document.createElement('md-icon-button');
        removeBtn.className = 'remove-btn';
        removeBtn.dataset.id = String(item.id);
        const icon = document.createElement('md-icon');
        icon.textContent = 'delete';
        removeBtn.appendChild(icon);
        itemEl.appendChild(removeBtn);

        cartItemsContainer.appendChild(itemEl);
    });
}

/**
 * 註冊所有靜態元素的事件監聽器（只會執行一次，由 listenersBound 保證）
 */
function setupEventListeners() {
    if (listenersBound) return;
    listenersBound = true;

    changeStoreBtn.addEventListener('click', () => storeSelectorDialog.show());

    cartToggleBtn.addEventListener('click', toggleCheckoutSheet);
    goToCheckoutBtn.addEventListener('click', toggleCheckoutSheet);
    closeSheetBtn.addEventListener('click', closeCheckoutSheet);
    sheetOverlay.addEventListener('click', closeCheckoutSheet);

    submitOrderBtn.addEventListener('click', handleOrderSubmit);

    // 選項視窗按鈕（原本每次 openOptionsModal 之外都在模組頂層賦值，這裡統一註冊一次）
    modalCloseBtn.addEventListener('click', () => optionsDialog.close());
    modalAddBtn.addEventListener('click', () => {
        if (!currentModal) return;
        const selectedData = currentModal.content.getSelectedData();
        // 【修改】用保留下來的 product 參照加入購物車
        if (addToCart(currentModal.product, selectedData)) {
            optionsDialog.close();
        }
    });

    // 購物車移除按鈕：事件委派。購物車本地 ID 以字串比較，不做 Number 轉換
    cartItemsContainer.addEventListener('click', (event) => {
        const btn = event.target.closest('.remove-btn');
        if (!btn) return;
        const idToRemove = btn.dataset.id;
        shoppingCart = shoppingCart.filter(item => String(item.id) !== idToRemove);
        updateCartUI();
    });

    // 【修改】登出統一使用 auth.logout()（線上點餐頁登出後會重新載入並重新做訪客登入）
    userProfileBtn.addEventListener('click', () => {
        if (confirm("要登出並重新輸入稱呼嗎？")) logout();
    });

    // 【新增】STOMP 個人通知（app-notifications.js 以 CustomEvent 轉發）。
    // 只在這裡註冊一次，取代原本每次送單都 document.addEventListener 一個新的監聽器
    document.addEventListener('order-status-changed', (e) => handleOrderNotification(e.detail));
}

// === Order Submission and Tracking ===

async function handleOrderSubmit() {
    if (shoppingCart.length === 0 || submitting) return;
    if (!currentStoreId) {
        toastManager.show('無法下單', '尚未選擇分店', 'warning');
        return;
    }

    submitting = true;
    submitOrderBtn.disabled = true;
    submitOrderBtn.textContent = "處理中...";

    // 【修改】請求內容 {storeId, items, customerNote}：
    // - 品項帶 variantId（toOrderItemDto）
    // - 不再送 status（初始狀態 AWAITING_ACCEPTANCE 由後端決定，前端送 'RECEIVED' 會造成 500）
    const createOrderRequest = {
        storeId: currentStoreId,
        items: shoppingCart.map(toOrderItemDto),
        customerNote: (customerNoteInput.value || '').trim(),
    };

    try {
        // 【新增】Idempotency-Key：內容相同的重試沿用同一個 key，不會重複建單
        const ticket = await createOnlineOrder(createOrderRequest, orderIdempotency.getKey(createOrderRequest));
        orderIdempotency.reset();

        // 保留一份快照，萬一下單失敗（ticket FAILED）可以還原購物車
        lastSubmittedCart = shoppingCart;
        shoppingCart = [];
        customerNoteInput.value = '';
        updateCartUI();
        closeCheckoutSheet();

        toastManager.show('訂單已送出', '您的訂單已非同步提交至後台', 'info');

        // 開始追蹤：輪詢 GET /online-orders/{ticketId} + STOMP 即時通知
        startTracking(ticket.ticketId, ticket);

    } catch (e) {
        logger.error("下單失敗", e);
        alert(`下單失敗: ${e.message}`);
    } finally {
        submitting = false;
        submitOrderBtn.disabled = false;
        submitOrderBtn.textContent = "確認下單";
    }
}

// --- 訂單進度追蹤 ---

function saveTicketId(ticketId) {
    try {
        if (ticketId) sessionStorage.setItem(TICKET_STORAGE_KEY, String(ticketId));
        else sessionStorage.removeItem(TICKET_STORAGE_KEY);
    } catch {
        // sessionStorage 不可用（隱私模式等）時略過，只是無法跨重新整理接續追蹤
    }
}

function loadSavedTicketId() {
    try {
        return sessionStorage.getItem(TICKET_STORAGE_KEY);
    } catch {
        return null;
    }
}

/** 頁面載入後，若上次有尚未結案的 ticket 就接續追蹤 */
function resumeTracking() {
    const ticketId = loadSavedTicketId();
    if (ticketId) startTracking(ticketId);
}

/**
 * 開始追蹤一張線上訂單 ticket
 * @param {string} ticketId - 後端回傳的 ticketId（字串）
 * @param {object} [initialTicket] - POST 回應（QUEUED）
 */
function startTracking(ticketId, initialTicket) {
    stopTracking();
    tracker = {
        ticketId: String(ticketId),
        orderNumber: null,
        timer: null,
        polling: false,
        stopped: false,
        failures: 0,
    };
    saveTicketId(tracker.ticketId);
    renderTracker({ status: 'QUEUED', orderNumber: null, message: initialTicket?.message });
    pollTicket(tracker);
}

/** 停止目前的追蹤（清除輪詢計時器） */
function stopTracking() {
    if (!tracker) return;
    tracker.stopped = true;
    clearTimeout(tracker.timer);
    tracker = null;
}

/**
 * 查詢一次 ticket 狀態，並依結果決定是否繼續輪詢
 * GET /api/v1/online-orders/{ticketId} -> {ticketId, status: QUEUED|CREATED|FAILED, orderId, orderNumber, orderStatus, message}
 */
async function pollTicket(t) {
    if (!t || t.stopped || t.polling) return;
    t.polling = true;
    clearTimeout(t.timer);
    let nextDelay = POLL_CREATED_MS;

    try {
        const data = await getOnlineOrderTicket(t.ticketId);
        if (t.stopped) return;
        t.failures = 0;
        if (applyTicket(t, data)) return; // 已到終態，不再輪詢
        nextDelay = data.status === 'QUEUED' ? POLL_QUEUED_MS : POLL_CREATED_MS;
    } catch (e) {
        if (t.stopped) return;
        t.failures += 1;
        logger.warn(`查詢訂單進度失敗 (${t.failures}/${POLL_MAX_FAILURES})`, e);
        if (t.failures >= POLL_MAX_FAILURES) {
            // 多次失敗（例如 ticket 已過期）：放棄追蹤，避免無止盡重試
            renderTracker({ status: null, orderNumber: t.orderNumber, message: '無法取得訂單進度，請洽店員確認' });
            saveTicketId(null);
            stopTracking();
            return;
        }
    } finally {
        t.polling = false;
    }

    if (!t.stopped) {
        t.timer = setTimeout(() => pollTicket(t), nextDelay);
    }
}

/**
 * 把 ticket 查詢結果套用到畫面
 * @returns {boolean} 是否已到終態（FAILED / CLOSED / CANCELLED）
 */
function applyTicket(t, data) {
    if (data.orderNumber) t.orderNumber = data.orderNumber;

    // CREATED 之後以「訂單目前狀態」為準；否則用 ticket 狀態（QUEUED / FAILED）
    const displayStatus = data.status === 'CREATED' && data.orderStatus ? data.orderStatus : data.status;
    renderTracker({ status: displayStatus, orderNumber: t.orderNumber, message: data.message });

    if (data.status === 'FAILED') {
        restoreCartAfterFailure();
    }
    return finishTrackingIfTerminal(t, displayStatus);
}

/** 終態：停止輪詢；結案後數秒隱藏追蹤卡片。回傳是否為終態 */
function finishTrackingIfTerminal(t, status) {
    if (!describeOrderStatus(status).terminal) return false;
    saveTicketId(null);
    t.stopped = true;
    clearTimeout(t.timer);
    if (status === 'CLOSED') {
        setTimeout(() => {
            // 期間若已開始追蹤新訂單，不要把新的追蹤卡片藏起來
            if (!tracker || tracker === t) activeOrderTracker.classList.add('hidden');
        }, TRACKER_HIDE_DELAY_MS);
    }
    if (tracker === t) tracker = null;
    return true;
}

/** 下單失敗（ticket FAILED）時，把送出前的購物車還原，方便使用者直接重送 */
function restoreCartAfterFailure() {
    if (lastSubmittedCart && shoppingCart.length === 0) {
        shoppingCart = lastSubmittedCart;
        lastSubmittedCart = null;
        updateCartUI();
        toastManager.show('下單失敗', '已為您保留購物車內容，請重新送出', 'warning');
    }
}

/**
 * 處理 STOMP /user/queue/orders 通知：{orderNumber, status, message}
 * - 已知單號且與通知相符 -> 直接更新畫面（比輪詢更即時）
 * - 還不知道單號（ticket 仍在排隊）-> 立刻查詢一次 ticket 取得權威資料
 */
function handleOrderNotification(notification) {
    const t = tracker;
    if (!t || !notification) return;

    if (t.orderNumber && notification.orderNumber === t.orderNumber) {
        renderTracker({ status: notification.status, orderNumber: t.orderNumber, message: notification.message });
        finishTrackingIfTerminal(t, notification.status);
    } else if (!t.orderNumber) {
        pollTicket(t);
    }
}

/**
 * 更新追蹤卡片
 * 【修改】文字與樣式改由 orderStatus.js 的 describeOrderStatus 提供；全部使用 textContent
 * @param {{status: string|null, orderNumber: string|null, message?: string|null}} view
 */
function renderTracker({ status, orderNumber, message }) {
    const info = describeOrderStatus(status);

    activeOrderTracker.classList.remove('hidden');
    // 顯示取餐號碼（訂單號碼最後一段），尚未取得單號時顯示提示
    trackerOrderNumber.textContent = orderNumber
        ? `取餐號碼：#${getPickupNumber(orderNumber)}`
        : "尚未取得訂單編號";

    // 重設狀態顏色 class 後再套用
    trackerStatusIcon.classList.remove('order-status-preparing', 'order-status-ready', 'order-status-failed');
    if (info.cssClass) trackerStatusIcon.classList.add(info.cssClass);
    trackerStatusIcon.textContent = info.icon;
    trackerStatusText.textContent = info.text || message || '';

    // 失敗時把後端說明放在副標；其餘維持預設說明
    trackerSubtext.textContent = (status === 'FAILED' || status === null) && message ? message : TRACKER_DEFAULT_SUBTEXT;
}
