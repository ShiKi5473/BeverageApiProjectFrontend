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
    findMemberByPhone
} from "./api.js";
import { createNavbar } from "./components/Navbar.js";

const paymentMethodChips = document.getElementById("payment-method-chips");

document.addEventListener("DOMContentLoaded", async () => {

    // --- 1. 狀態變數 ---
    let currentCartItems = [];
    let currentMember = null;
    let selectedPaymentMethod = null;
    let originalTotalAmount = 0; // 訂單原始小計
    let pointsDiscount = 0; // 點數折抵金額
    let finalAmount = 0; // 最終應付金額
    let cashReceived = 0; // 實收現金

    // --- 2. 取得 DOM 元素 ---
    const layoutEl = document.getElementById("checkout-layout");
    const mainEl = document.getElementById("checkout-main");
    const checkoutContent = document.getElementById("checkout-main");

    // 左欄
    const itemCountEl = document.getElementById("item-count");
    const itemsListEl = document.getElementById("order-items-list");
    const originalTotalEl = document.getElementById("original-total");
    const discountRowEl = document.getElementById("discount-row");
    const discountAmountEl = document.getElementById("discount-amount");
    const finalTotalEl = document.getElementById("final-total");
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
    const handleLogout = () => {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("brandId");
        window.location.href = "login.html";
    };
    const navbar = createNavbar("結帳系統", handleLogout);
    layoutEl.insertBefore(navbar, mainEl);

    // --- 4. 核心功能函式 ---

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
            if (!cartItems || cartItems.length === 0) {
                throw new Error("購物車是空的");
            }

            currentCartItems = cartItems;

            // 計算總金額
            originalTotalAmount = currentCartItems.reduce((sum, item) => {
                return sum + (item.unitPrice * item.quantity);
            }, 0);

            // 填充左欄 (訂單明細)
            itemCountEl.textContent = currentCartItems.length;
            renderOrderItems(currentCartItems);

            // 更新所有金額顯示
            updateAllTotals();

            checkoutContent.style.display = "grid";

        } catch (error) {
            alert(`載入購物車失敗: ${error.message}。即將返回點餐頁。`);
            window.location.href = "pos.html";
        }
    }

    /**
     * 渲染訂單品項列表 (左欄)
     */
    function renderOrderItems(items) {
        itemsListEl.innerHTML = ""; // 清空
        if (!items || items.length === 0) {
            itemsListEl.innerHTML = "<p>訂單中沒有品項</p>";
            return;
        }
        items.forEach(item => {
            const optionsStr = item.selectedOptions.map(opt => opt.optionName).join(", ");
            const itemEl = document.createElement("div");
            itemEl.className = "checkout-item";
            itemEl.innerHTML = `
        <div class="checkout-item-details">
          <span class="checkout-item-name">${item.name} (x${item.quantity})</span> ${optionsStr ? `<span class="checkout-item-options">${optionsStr}</span>` : ''}
        </div>
        <span class="checkout-item-subtotal">NT$ ${item.unitPrice * item.quantity}</span> 
      `;
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
            updateAllTotals(); // 查詢後更新總額
        } catch (error) {
            alert(error.message);
            memberInfoTextEl.textContent = "查詢失敗";
        } finally {
            findMemberBtn.disabled = false;
            findMemberBtn.textContent = "查詢";
        }
    }

    /**
     * (核心) 更新所有金額顯示
     */
    function updateAllTotals() {
        let pointsToUse = pointsToUseInput.valueAsNumber || 0;

        // 檢查點數
        if (currentMember && pointsToUse > currentMember.totalPoints) {
            pointsToUse = currentMember.totalPoints;
            pointsToUseInput.value = pointsToUse;
            pointsErrorEl.textContent = "已達上限";
        } else {
            pointsErrorEl.textContent = "";
        }

        // 規則：10 點折 1 元
        pointsDiscount = Math.floor(pointsToUse / 10);
        finalAmount = originalTotalAmount - pointsDiscount;

        // 更新左欄
        originalTotalEl.textContent = `NT$ ${originalTotalAmount}`;
        finalTotalEl.textContent = `NT$ ${finalAmount}`;
        if (pointsDiscount > 0) {
            discountAmountEl.textContent = `- NT$ ${pointsDiscount}`;
            discountRowEl.style.display = "flex";
        } else {
            discountRowEl.style.display = "none";
        }

        // 更新右欄結帳按鈕
        confirmBtnAmountEl.textContent = `NT$ ${finalAmount}`;

        // 更新計算機與按鈕狀態
        updateCalculatorDisplay();
    }

    /**
     * 更新現金計算機顯示 (右欄)
     */
    function updateCalculatorDisplay() {
        calcDisplayReceivedEl.textContent = `$${cashReceived}`;
        const change = cashReceived - finalAmount;

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
            cashReceived = Number(fastVal);
        } else if (val === 'clear') {
            cashReceived = 0;
        } else if (val === 'exact') {
            cashReceived = finalAmount;
        } else {
            let currentStr = String(cashReceived);
            if (currentStr === '0') currentStr = '';
            currentStr += val;
            cashReceived = Number(currentStr);
        }

        updateCalculatorDisplay();
    }

    /**
     * 更新主結帳按鈕的狀態
     */
    function updateConfirmButtonState() {
        if (!selectedPaymentMethod) {
            confirmBtnTextEl.textContent = "請選擇付款方式";
            confirmPaymentButton.disabled = true;
            return;
        }

        if (selectedPaymentMethod === "CASH") {
            if (cashReceived < finalAmount) {
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
        if (confirmPaymentButton.disabled) return;

        confirmPaymentButton.disabled = true;
        confirmBtnTextEl.textContent = "付款處理中...";

        const itemsDto = currentCartItems.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            notes: item.notes,
            optionIds: item.selectedOptions.map(opt => opt.optionId)
        }));

        const checkoutData = {
            items: itemsDto,
            memberId: currentMember ? currentMember.userId : null,
            pointsToUse: pointsToUseInput.valueAsNumber || 0,
            paymentMethod: selectedPaymentMethod,
        };

        try {
            const paidOrder = await posCheckoutComplete(checkoutData);
            alert(
                `付款成功！ 訂單 ${paidOrder.orderNumber} 狀態已更新為 ${paidOrder.status}`
            );
            localStorage.removeItem("cartForCheckout");
            window.location.href = "pos.html";
        } catch (error) {
            alert(`付款失敗: ${error.message}`);
            confirmPaymentButton.disabled = false;
            updateConfirmButtonState(); // 恢復按鈕文字
        }
    }


    // --- 5. 綁定所有事件監聽器 ---

    // 中欄
    findMemberBtn.addEventListener("click", handleFindMember);
    pointsToUseInput.addEventListener("input", updateAllTotals);

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