import '@material/web/iconbutton/icon-button.js';
import '@material/web/icon/icon.js';

// 2. 為了 checkout.html 頁面本身
import '@material/web/textfield/filled-text-field.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/chips/chip-set.js';
import '@material/web/chips/filter-chip.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/filled-button.js';
import '@material/web/button/text-button.js';

// 匯入 API
import {
    posCheckoutComplete,
    findMemberByPhone,
    previewOrder
} from "./api.js";
import { createNavbar } from "./components/Navbar.js";
import { initAppNotifications } from './app-notifications.js';
import logger from './utils/logger.js';
// 【修改】統一登出、取得分店 ID
import { logout, getStoreId } from './auth.js';
// 【新增】DOM 建立工具（textContent，避免 XSS）、品項 DTO / 金額工具、冪等鍵、取餐號碼
import { el } from './utils/dom.js';
import { toOrderItemDto, calculateCartTotal, calculateLineTotal, roundMoney, toNumber } from './utils/pricing.js';
import { createIdempotencyHolder } from './utils/idempotency.js';
import { getPickupNumber } from './utils/orderNumber.js';

/** 現金計算機最多輸入的位數，避免輸入過長的數字 */
const MAX_CASH_DIGITS = 9;
/** 點數輸入停止輸入後，延遲多久才呼叫試算 API（毫秒），避免每按一個鍵就打一次後端 */
const PREVIEW_DEBOUNCE_MS = 400;

document.addEventListener("DOMContentLoaded", async () => {
    // 啟動全域通知監聽
    initAppNotifications();

    const paymentMethodChips = document.getElementById("payment-method-chips");

    // --- 1. 狀態變數 ---
    let currentCartItems = [];
    let currentMember = null;
    let selectedPaymentMethod = null;
    let cashReceived = 0; // 實收現金

    // 【修改】金額一律以後端 POST /orders/preview 的試算結果為準（取代前端自己算點數折抵 + 固定比率常數）。
    // previewStatus: 'idle' 尚未試算 | 'loading' 試算中 | 'ready' 已有最新結果 | 'error' 試算失敗
    let preview = null;
    let previewStatus = "idle";
    let previewSeq = 0;          // 流水號：只採用「最後一次請求」的結果，丟棄過期回應
    let previewTimer = null;     // 點數輸入的 debounce 計時器
    let previewedPoints = 0;     // 產生目前 preview 時使用的點數（結帳時送同一組，確保與畫面金額一致）
    let previewedMemberId = null; // 產生目前 preview 時使用的會員 ID（字串）
    let submitting = false;      // 結帳送出中，防止重複點擊

    // 【新增】結帳冪等鍵：網路失敗重試時沿用同一個 key（內容不變），成功後重置
    const checkoutIdempotency = createIdempotencyHolder();

    // --- 2. 取得 DOM 元素 ---
    const layoutEl = document.getElementById("checkout-layout");
    const mainEl = document.getElementById("checkout-main");
    const checkoutContent = document.getElementById("checkout-main");

    // 左欄
    const itemCountEl = document.getElementById("item-count");
    const itemsListEl = document.getElementById("order-items-list");
    const originalTotalEl = document.getElementById("original-total");
    const promoRowEl = document.getElementById("promo-row");
    const promoAmountEl = document.getElementById("promo-amount");
    const discountRowEl = document.getElementById("discount-row");
    const discountAmountEl = document.getElementById("discount-amount");
    const finalTotalEl = document.getElementById("final-total");
    const previewStatusEl = document.getElementById("preview-status");
    const previewRetryBtn = document.getElementById("preview-retry-btn");
    const holdAndReturnButton = document.getElementById("hold-and-return-button");

    // 中欄
    const memberPhoneInput = document.getElementById("member-phone");
    const findMemberBtn = document.getElementById("find-member-btn");
    const memberDisplayEl = document.getElementById("member-display");
    const memberNameEl = document.getElementById("member-name");
    const memberPointsBalanceEl = document.getElementById("member-points-balance");
    const pointsToUseInput = document.getElementById("points-to-use");
    const pointsErrorEl = document.getElementById("points-error");
    const memberInfoTextEl = document.getElementById("member-info-text");

    // 右欄
    const cashCalculatorEl = document.getElementById("cash-calculator");
    const calcDisplayReceivedEl = document.getElementById("calc-display-received");
    const calcDisplayChangeEl = document.getElementById("calc-display-change");
    const calculatorGrid = document.querySelector(".calculator-grid");
    const confirmPaymentButton = document.getElementById("confirm-payment-button");
    const cancelButton = document.getElementById("cancel-button");
    const confirmBtnTextEl = document.getElementById("confirm-btn-text");
    const confirmBtnAmountEl = document.getElementById("confirm-btn-amount");

    // --- 3. 初始化 ---

    // 注入 Navbar
    // 【修改】登出統一使用 auth.logout()（清除 token / 角色 / 品牌 / 分店後導回登入頁）
    const navbar = createNavbar("結帳系統", logout);
    layoutEl.insertBefore(navbar, mainEl);

    // --- 4. 核心功能函式 ---

    /**
     * 目前顯示用的金額（有試算結果用試算結果；否則退回前端暫估，僅供畫面顯示，不能用來結帳）
     */
    function getAmounts() {
        if (preview) {
            return {
                subtotal: toNumber(preview.totalAmount),
                promotionDiscount: toNumber(preview.promotionDiscount),
                pointsDiscount: toNumber(preview.pointsDiscount),
                finalAmount: toNumber(preview.finalAmount),
            };
        }
        const estimate = calculateCartTotal(currentCartItems);
        return { subtotal: estimate, promotionDiscount: 0, pointsDiscount: 0, finalAmount: estimate };
    }

    /**
     * 從 localStorage 載入購物車資料並渲染頁面
     */
    function loadCartData() {
        try {
            const cartJson = localStorage.getItem("cartForCheckout");
            if (!cartJson) {
                throw new Error("找不到購物車資料");
            }

            const cartItems = JSON.parse(cartJson);
            if (!Array.isArray(cartItems) || cartItems.length === 0) {
                throw new Error("購物車是空的");
            }
            // 【新增】舊版暫存的購物車沒有 variantId（後端必填，送出會 400），這裡提早擋下
            if (cartItems.some((item) => !item || !item.variantId || !item.productId)) {
                throw new Error("購物車資料格式過舊，請重新加入商品");
            }

            currentCartItems = cartItems;

            // 填充左欄 (訂單明細)
            itemCountEl.textContent = currentCartItems.length;
            renderOrderItems(currentCartItems);

            // 先用前端暫估顯示，再向後端試算正式金額
            render();
            requestPreview();

            checkoutContent.style.display = "grid";

        } catch (error) {
            alert(`載入購物車失敗: ${error.message}。即將返回點餐頁。`);
            window.location.href = "pos.html";
        }
    }

    /**
     * 渲染訂單品項列表 (左欄)
     * 【修改】XSS 防護：改用 DOM API + textContent，商品名稱／選項／備註不再插入 innerHTML
     */
    function renderOrderItems(items) {
        itemsListEl.textContent = ""; // 清空
        if (!items || items.length === 0) {
            itemsListEl.appendChild(el("p", "", "訂單中沒有品項"));
            return;
        }
        items.forEach(item => {
            const optionsStr = (item.selectedOptions ?? []).map(opt => opt.optionName).join(", ");
            const variantText = item.variantName ? ` (${item.variantName})` : "";

            const itemEl = el("div", "checkout-item");

            const details = el("div", "checkout-item-details");
            details.appendChild(el("span", "checkout-item-name", `${item.name}${variantText} (x${item.quantity})`));
            if (optionsStr) {
                details.appendChild(document.createTextNode(" "));
                details.appendChild(el("span", "checkout-item-options", optionsStr));
            }
            if (item.notes) {
                details.appendChild(document.createTextNode(" "));
                details.appendChild(el("span", "checkout-item-options", `備註: ${item.notes}`));
            }
            itemEl.appendChild(details);

            itemEl.appendChild(
                el("span", "checkout-item-subtotal", `NT$ ${calculateLineTotal(item.unitPrice, item.quantity)}`)
            );
            itemsListEl.appendChild(itemEl);
        });
    }

    /**
     * 處理會員查詢 (中欄)
     */
    async function handleFindMember() {
        const phone = memberPhoneInput.value;
        if (!phone) {
            alert("請輸入手機號碼");
            return;
        }

        findMemberBtn.disabled = true;
        findMemberBtn.textContent = "查詢中...";
        memberInfoTextEl.textContent = "";

        try {
            const member = await findMemberByPhone(phone);
            if (member) {
                currentMember = member;
                memberNameEl.textContent = `會員: ${member.fullName}`;
                memberPointsBalanceEl.textContent = member.totalPoints;
                pointsToUseInput.max = member.totalPoints;
                memberDisplayEl.style.display = "block";
                pointsToUseInput.value = 0; // 重設
            } else {
                currentMember = null;
                memberDisplayEl.style.display = "none";
                memberInfoTextEl.textContent = "查無此會員";
            }
            // 【修改】會員改變 -> 立即重新試算（會員可能影響點數折抵）
            schedulePreview(0);
        } catch (error) {
            alert(error.message);
            memberInfoTextEl.textContent = "查詢失敗";
        } finally {
            findMemberBtn.disabled = false;
            findMemberBtn.textContent = "查詢";
        }
    }

    /**
     * 【新增】讀取使用者輸入的點數：整數、不小於 0、不超過會員餘額；沒有會員時一律為 0
     */
    function readPointsToUse() {
        if (!currentMember) {
            pointsErrorEl.textContent = "";
            return 0;
        }

        const raw = pointsToUseInput.valueAsNumber;
        let points = Number.isFinite(raw) ? Math.floor(raw) : 0;
        if (points < 0) points = 0;

        const balance = Math.floor(toNumber(currentMember.totalPoints));
        if (points > balance) {
            points = balance;
            pointsToUseInput.value = points;
            pointsErrorEl.textContent = "已達上限";
        } else {
            pointsErrorEl.textContent = "";
        }
        return points;
    }

    /**
     * 【新增】排程一次金額試算。先把狀態標為 loading（結帳按鈕立刻停用，避免用舊金額結帳），
     * 再依 delay 延遲呼叫後端；連續輸入時只會送出最後一次。
     */
    function schedulePreview(delay = PREVIEW_DEBOUNCE_MS) {
        clearTimeout(previewTimer);
        previewSeq++; // 讓尚未回來的舊請求失效
        previewStatus = "loading";
        render();
        previewTimer = setTimeout(requestPreview, delay);
    }

    /**
     * 【新增】呼叫 POST /api/v1/orders/preview，取得小計／促銷折扣／點數折抵／應付金額
     */
    async function requestPreview() {
        clearTimeout(previewTimer);
        const seq = ++previewSeq;
        const pointsToUse = readPointsToUse();
        const memberId = currentMember ? String(currentMember.userId) : null;

        previewStatus = "loading";
        previewStatusEl.textContent = "";
        render();

        const body = { items: currentCartItems.map(toOrderItemDto) };
        const storeId = getStoreId();
        if (storeId) body.storeId = storeId;
        if (memberId) {
            body.memberId = memberId;
            body.pointsToUse = pointsToUse;
        }

        try {
            const result = await previewOrder(body);
            if (seq !== previewSeq) return; // 已有更新的請求，丟棄過期回應
            preview = result;
            previewedPoints = pointsToUse;
            previewedMemberId = memberId;
            previewStatus = "ready";
            previewStatusEl.textContent = "";
            // 折抵上限為訂單金額：實際扣的點數少於輸入時提示使用者
            if (memberId && toNumber(result.pointsUsed) < pointsToUse) {
                pointsErrorEl.textContent = `實際使用 ${toNumber(result.pointsUsed)} 點（折抵金額上限為訂單金額）`;
            }
        } catch (error) {
            if (seq !== previewSeq) return;
            logger.error("金額試算失敗:", error);
            preview = null;
            previewStatus = "error";
            previewStatusEl.textContent = `金額試算失敗：${error.message}`;
        }
        render();
    }

    /**
     * (核心) 依目前狀態更新所有金額顯示
     * 【修改】不再自己用常數計算點數折抵；金額來源是後端試算結果
     */
    function render() {
        const { subtotal, promotionDiscount, pointsDiscount, finalAmount } = getAmounts();

        // 更新左欄
        originalTotalEl.textContent = `NT$ ${subtotal}`;
        finalTotalEl.textContent = `NT$ ${finalAmount}`;
        if (promotionDiscount > 0) {
            promoAmountEl.textContent = `- NT$ ${promotionDiscount}`;
            promoRowEl.style.display = "flex";
        } else {
            promoRowEl.style.display = "none";
        }
        if (pointsDiscount > 0) {
            discountAmountEl.textContent = `- NT$ ${pointsDiscount}`;
            discountRowEl.style.display = "flex";
        } else {
            discountRowEl.style.display = "none";
        }
        previewRetryBtn.style.display = previewStatus === "error" ? "inline-flex" : "none";

        // 更新右欄結帳按鈕
        confirmBtnAmountEl.textContent = `NT$ ${finalAmount}`;

        // 更新計算機與按鈕狀態
        updateCalculatorDisplay();
    }

    /**
     * 更新現金計算機顯示 (右欄)
     */
    function updateCalculatorDisplay() {
        const { finalAmount } = getAmounts();
        calcDisplayReceivedEl.textContent = `$${cashReceived}`;
        const change = roundMoney(cashReceived - finalAmount);

        if (change >= 0) {
            calcDisplayChangeEl.textContent = `$${change}`;
            calcDisplayChangeEl.style.color = "#28a745"; // 綠色
        } else {
            calcDisplayChangeEl.textContent = `-$${-change}`;
            calcDisplayChangeEl.style.color = "#dc3545"; // 紅色
        }

        // 更新結帳按鈕狀態
        updateConfirmButtonState();
    }

    /**
     * 處理計算機按鈕點擊 (右欄)
     */
    function handleCalculatorClick(event) {
        const button = event.target.closest(".calc-btn");
        if (!button) return;

        const val = button.dataset.val;
        const fastVal = button.dataset.fast;

        if (fastVal) {
            cashReceived = toNumber(fastVal);
        } else if (val === 'clear') {
            cashReceived = 0;
        } else if (val === 'exact') {
            cashReceived = getAmounts().finalAmount;
        } else {
            let currentStr = String(cashReceived);
            if (currentStr === '0') currentStr = '';
            // 超過位數上限就忽略這次輸入
            if (currentStr.length + val.length <= MAX_CASH_DIGITS) {
                currentStr += val;
                cashReceived = toNumber(currentStr);
            }
        }

        updateCalculatorDisplay();
    }

    /**
     * 更新主結帳按鈕的狀態
     */
    function updateConfirmButtonState() {
        // 【新增】尚未取得最新試算金額時不可結帳（避免用過期金額收款）
        if (previewStatus === "loading" || previewStatus === "idle") {
            confirmBtnTextEl.textContent = "金額試算中...";
            confirmPaymentButton.disabled = true;
            return;
        }
        if (previewStatus === "error") {
            confirmBtnTextEl.textContent = "金額試算失敗";
            confirmPaymentButton.disabled = true;
            return;
        }

        if (!selectedPaymentMethod) {
            confirmBtnTextEl.textContent = "請選擇付款方式";
            confirmPaymentButton.disabled = true;
            return;
        }

        if (selectedPaymentMethod === "CASH") {
            if (cashReceived < getAmounts().finalAmount) {
                confirmBtnTextEl.textContent = "金額不足";
                confirmPaymentButton.disabled = true;
            } else {
                confirmBtnTextEl.textContent = "現金結帳";
                confirmPaymentButton.disabled = false;
            }
        } else if (selectedPaymentMethod === "CREDIT_CARD") {
            confirmBtnTextEl.textContent = "信用卡結帳";
            confirmPaymentButton.disabled = false;
        }
    }

    /**
     * 處理最終付款
     */
    async function handleConfirmPayment() {
        if (confirmPaymentButton.disabled || submitting) return;

        submitting = true;
        confirmPaymentButton.disabled = true;
        confirmBtnTextEl.textContent = "付款處理中...";

        // 【修改】品項 DTO 帶 variantId（後端必填），ID 一律是字串
        // 會員與點數使用「產生目前畫面金額的那一組」，確保送出內容與試算結果一致
        const checkoutData = {
            items: currentCartItems.map(toOrderItemDto),
            memberId: previewedMemberId,
            pointsToUse: previewedMemberId ? previewedPoints : 0,
            paymentMethod: selectedPaymentMethod,
        };

        try {
            // 【新增】Idempotency-Key：內容相同的重試（例如網路中斷後再按一次）沿用同一個 key，
            // 後端會重放第一次的結果，不會重複扣款／扣點
            const idempotencyKey = checkoutIdempotency.getKey(checkoutData);
            const paidOrder = await posCheckoutComplete(checkoutData, idempotencyKey);
            checkoutIdempotency.reset();
            // 【修改】顯示取餐號碼（訂單號碼最後一段）
            alert(`付款成功！ 取餐號碼 #${getPickupNumber(paidOrder.orderNumber)}`);
            localStorage.removeItem("cartForCheckout");
            window.location.href = "pos.html";
        } catch (error) {
            alert(`付款失敗: ${error.message}`);
            submitting = false;
            updateConfirmButtonState(); // 恢復按鈕文字
        }
    }


    // --- 5. 綁定所有事件監聽器 ---

    // 中欄
    findMemberBtn.addEventListener("click", handleFindMember);
    // 【修改】點數變動 -> debounce 後重新向後端試算
    pointsToUseInput.addEventListener("input", () => schedulePreview());
    previewRetryBtn.addEventListener("click", () => requestPreview());

    calculatorGrid.addEventListener("click", handleCalculatorClick);
    confirmPaymentButton.addEventListener("click", handleConfirmPayment);

    holdAndReturnButton.addEventListener("click", () => {
        window.location.href = "pos.html";
    });

    cancelButton.addEventListener("click", async () => {
        if (confirm("確定要取消結帳嗎？\n(購物車將被清空)")) {
            localStorage.removeItem("cartForCheckout");
            window.location.href = "pos.html";
        }
    });

    // 【修正重點】改用 click 事件 + 遍歷檢查 .selected 屬性
    paymentMethodChips.addEventListener("click", () => {
        // 由於 DOM 更新可能有微小延遲，使用 requestAnimationFrame 或 setTimeout 確保抓到最新狀態
        requestAnimationFrame(() => {
            const chips = Array.from(paymentMethodChips.querySelectorAll("md-filter-chip"));
            const selectedChip = chips.find(chip => chip.selected);

            if (selectedChip) {
                selectedPaymentMethod = selectedChip.dataset.method;
            } else {
                selectedPaymentMethod = null;
            }

            // 顯示/隱藏現金計算機
            cashCalculatorEl.style.display = (selectedPaymentMethod === "CASH") ? "block" : "none";

            // 觸發更新按鈕狀態 (信用卡會在此被啟用)
            updateCalculatorDisplay();
        });
    });


    // --- 6. 啟動 ---
    loadCartData();
});
