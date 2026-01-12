import '@material/web/chips/filter-chip.js';
import '@material/web/chips/chip-set.js';
import '@material/web/textfield/filled-text-field.js';

import { createQuantitySelector } from "./QuantitySelector.js";

// 為 <md-chip> 建立的輔助函式
function createChip(label, value, isSelected = false) {
    const chip = document.createElement("md-filter-chip");
    chip.label = label;
    chip.dataset.value = value;
    chip.selected = isSelected;
    return chip;
}

/**
 * 建立客製化選項 Modal 的 "內容" (MWC 版本)
 */
export function createOptionsModalContent(product) {
    const modalContent = document.createElement("div");

    // 1. 標題與價格顯示
    const header = document.createElement("div");
    header.style.marginBottom = "1rem";

    const title = document.createElement("h3");
    title.textContent = product.name;
    title.style.margin = "0 0 0.5rem 0";

    // 用來動態顯示當前價格的元素
    const priceDisplay = document.createElement("div");
    priceDisplay.style.color = "var(--md-sys-color-primary)";
    priceDisplay.style.fontWeight = "bold";
    // 預設顯示最低價或基本價
    let currentBasePrice = product.basePrice;

    // 如果有規格，找出最低價當預設顯示
    if (product.variants && product.variants.length > 0) {
        const minPrice = Math.min(...product.variants.map(v => v.price));
        currentBasePrice = minPrice;
    }
    priceDisplay.textContent = `NT$ ${currentBasePrice}`;

    header.appendChild(title);
    header.appendChild(priceDisplay);
    modalContent.appendChild(header);

    // --- 【新增】規格選擇區 (Variants) ---
    let selectedVariantId = null;
    let selectedVariantPrice = 0;

    if (product.variants && product.variants.length > 0) {
        const variantContainer = document.createElement("div");
        variantContainer.className = "option-group";

        const variantTitle = document.createElement("h4");
        variantTitle.textContent = "規格 (必選)";
        variantContainer.appendChild(variantTitle);

        const variantChipSet = document.createElement("md-chip-set");
        variantChipSet.singleSelect = true; // 規格一定是單選

        // 預設選中第一個規格
        const sortedVariants = product.variants.sort((a, b) => a.price - b.price);

        sortedVariants.forEach((variant, index) => {
            const isDefault = index === 0;
            const chip = createChip(`${variant.name} ($${variant.price})`, variant.id, isDefault);

            // 點擊事件：更新價格與選中狀態
            chip.addEventListener("click", () => {
                selectedVariantId = variant.id;
                selectedVariantPrice = variant.price;
                updateTotalPrice(); // 更新總價顯示
            });

            if (isDefault) {
                selectedVariantId = variant.id;
                selectedVariantPrice = variant.price;
            }
            variantChipSet.appendChild(chip);
        });

        variantContainer.appendChild(variantChipSet);
        modalContent.appendChild(variantContainer);
    } else {
        // 防呆：如果商品沒有規格資料 (舊資料)，使用基本價格
        selectedVariantPrice = product.basePrice;
    }

    // --- 選項群組 (Option Groups) ---
    product.optionGroups.forEach((group) => {
        const groupContainer = document.createElement("div");
        groupContainer.className = "option-group";

        const groupTitle = document.createElement("h4");
        const selectionType = group.selectionType === "SINGLE" ? "單選" : "多選";
        groupTitle.textContent = `${group.name} (${selectionType})`;
        groupContainer.appendChild(groupTitle);

        const chipSet = document.createElement("md-chip-set");
        if (group.selectionType === "SINGLE") {
            chipSet.singleSelect = true;
        }

        group.options.forEach((option) => {
            let label = option.optionName;
            if (option.priceAdjustment > 0) label += ` (+$${option.priceAdjustment})`;

            const chip = createChip(label, option.optionId);
            // 監聽點擊以更新價格
            chip.addEventListener("click", updateTotalPrice);
            chipSet.appendChild(chip);
        });
        groupContainer.appendChild(chipSet);
        modalContent.appendChild(groupContainer);
    });

    // 數量選擇器
    const quantitySelector = createQuantitySelector(1);
    // 監聽數量變化
    quantitySelector.element.addEventListener('click', updateTotalPrice); // 簡單觸發，精確點可以用 callback
    modalContent.appendChild(quantitySelector.element);

    // 備註
    const notesInput = document.createElement("md-filled-text-field");
    notesInput.label = "備註...";
    notesInput.style.width = "100%";
    notesInput.style.marginTop = "1rem";
    modalContent.appendChild(notesInput);

    // --- 輔助函式：計算並更新總價 ---
    function updateTotalPrice() {
        // 1. 取得選中的選項加價
        const selectedChips = Array.from(modalContent.querySelectorAll("md-filter-chip[selected]"));
        // 注意：這裡需要判斷 chip 是規格還是選項，但我們的規格 chip 沒有存 priceAdjustment
        // 較好的做法是重掃一次 product data，或簡單判定
        // 這裡簡化：我們只算 OptionGroups 的加價。
        // 規格的價格已經在 selectedVariantPrice 中了。

        let optionTotal = 0;

        // 找出選中的 Option IDs
        const selectedIds = selectedChips.map(c => c.dataset.value);

        // 從原始資料算加價 (比較安全)
        product.optionGroups.forEach(group => {
            group.options.forEach(opt => {
                if (selectedIds.includes(String(opt.optionId))) {
                    optionTotal += opt.priceAdjustment;
                }
            });
        });

        const qty = quantitySelector.getQuantity();
        const unitTotal = selectedVariantPrice + optionTotal;
        const finalTotal = unitTotal * qty;

        priceDisplay.textContent = `NT$ ${finalTotal} (單價: ${unitTotal})`;
    }

    // 初始化價格顯示
    updateTotalPrice();

    const getSelectedData = () => {
        // 排除規格的 Chip，只抓選項的 Chip
        // 由於結構上都在 md-chip-set 裡，我們可以用 ID 反查
        const allSelectedChips = Array.from(modalContent.querySelectorAll("md-filter-chip[selected]"));
        const allSelectedIds = allSelectedChips.map(c => c.dataset.value);

        // 區分出哪些是 OptionId
        // 方法：遍歷 product.optionGroups 檢查
        const selectedOptionIds = [];
        product.optionGroups.forEach(group => {
            group.options.forEach(opt => {
                if (allSelectedIds.includes(String(opt.optionId))) {
                    selectedOptionIds.push(String(opt.optionId));
                }
            });
        });

        // 檢查是否選擇了規格
        if (!selectedVariantId && product.variants && product.variants.length > 0) {
            alert("錯誤：請選擇規格");
            return null; // 回傳 null 表示驗證失敗
        }

        return {
            quantity: quantitySelector.getQuantity(),
            notes: notesInput.value,
            selectedOptionIds: selectedOptionIds,
            variantId: selectedVariantId,    // 【關鍵新增】
            variantPrice: selectedVariantPrice // 方便 pos.js 使用
        };
    };

    return {
        element: modalContent,
        getSelectedData: getSelectedData,
    };
}