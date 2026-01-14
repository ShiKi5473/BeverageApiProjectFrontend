import '@material/web/chips/filter-chip.js';
import '@material/web/chips/chip-set.js';
import '@material/web/textfield/filled-text-field.js';

import { createQuantitySelector } from "./QuantitySelector.js";

/**
 * 建立 Chip 的輔助函式
 */
function createChip(label, value, isVariant = false, isSelected = false) {
    const chip = document.createElement("md-filter-chip");
    chip.label = label;

    // 透過 dataset 區分是 variantId 還是 optionId
    if (isVariant) {
        chip.dataset.variantId = value;
    } else {
        chip.dataset.optionId = value;
    }

    // 設定初始選取狀態
    if (isSelected) {
        chip.selected = true;
    }

    return chip;
}

/**
 * 強制設定 ChipSet 為單選行為 (Radio Button 模式)
 * @param {HTMLElement} chipSet - <md-chip-set> 元素
 */
function setupSingleSelectLogic(chipSet) {
    // 雖然設定 singleSelect = true，但為了保險起見，我們手動監聽點擊事件
    chipSet.singleSelect = true;

    chipSet.addEventListener('click', (e) => {
        // 找到被點擊的 chip (處理事件冒泡)
        const clickedChip = e.target.closest('md-filter-chip');
        if (!clickedChip) return;

        // 1. 強制選取被點擊的項目 (防止使用者點擊已選取的項目時將其取消)
        // 注意：Web Component 的內部狀態更新可能有時間差，這裡直接強制設定
        clickedChip.selected = true;

        // 2. 取消選取其他所有項目
        Array.from(chipSet.children).forEach(child => {
            if (child !== clickedChip) {
                child.selected = false;
            }
        });
    });
}

/**
 * 建立客製化選項 Modal 的 "內容"
 */
export function createOptionsModalContent(product) {
    const modalContent = document.createElement("div");

    // 1. 標題
    const title = document.createElement("h3");
    title.textContent = product.name;
    modalContent.appendChild(title);

    // --- 2. 規格選擇區塊 (Variants) - 必選且單選 ---
    if (product.variants && product.variants.length > 0) {
        const variantContainer = document.createElement("div");
        variantContainer.className = "option-group variant-group";

        const variantTitle = document.createElement("h4");
        variantTitle.textContent = "規格 (必選)";
        variantContainer.appendChild(variantTitle);

        const variantChipSet = document.createElement("md-chip-set");

        // 套用強制單選邏輯
        setupSingleSelectLogic(variantChipSet);

        product.variants.forEach(variant => {
            const label = `${variant.name} (NT$ ${variant.price})`;
            // 規格暫無預設值，isSelected 傳入 false (強制手動選擇)
            const chip = createChip(label, variant.id, true, false);
            variantChipSet.appendChild(chip);
        });

        variantContainer.appendChild(variantChipSet);
        modalContent.appendChild(variantContainer);
    } else {
        const msg = document.createElement("p");
        msg.style.color = "red";
        msg.textContent = "此商品無規格資料";
        modalContent.appendChild(msg);
    }

    // --- 3. 選項群組 (OptionGroups) ---
    if (product.optionGroups) {
        product.optionGroups.forEach((group) => {
            const groupContainer = document.createElement("div");
            groupContainer.className = "option-group";

            const groupTitle = document.createElement("h4");
            const selectionType = group.selectionType === "SINGLE" ? "單選" : "多選";
            // 若為單選，標示為必選
            const requiredText = group.selectionType === "SINGLE" ? " (必選)" : "";
            groupTitle.textContent = `${group.name} - ${selectionType}${requiredText}`;
            groupContainer.appendChild(groupTitle);

            const chipSet = document.createElement("md-chip-set");

            // 判斷是否為單選群組
            if (group.selectionType === "SINGLE") {
                setupSingleSelectLogic(chipSet);
            }

            group.options.forEach((option) => {
                let labelText = option.optionName;
                if (option.priceAdjustment > 0) {
                    labelText += ` (+NT$ ${option.priceAdjustment})`;
                }
                // 讀取後端建議的 default 值
                const isDefault = option.default === true;
                const chip = createChip(labelText, option.optionId, false, isDefault);
                chipSet.appendChild(chip);
            });

            groupContainer.appendChild(chipSet);
            modalContent.appendChild(groupContainer);
        });
    }

    // 4. 數量選擇器
    const quantitySelector = createQuantitySelector(1);
    modalContent.appendChild(quantitySelector.element);

    // 5. 備註欄位
    const notesInput = document.createElement("md-filled-text-field");
    notesInput.label = "備註...";
    notesInput.className = "modal-notes";
    notesInput.style.width = "100%";
    modalContent.appendChild(notesInput);

    // --- 6. 資料取得與驗證函式 ---
    const getSelectedData = () => {
        // 取得 DOM 中的選取狀態
        const selectedVariantChip = modalContent.querySelector(".variant-group md-filter-chip[selected]");
        const selectedVariantId = selectedVariantChip ? selectedVariantChip.dataset.variantId : null;

        const selectedOptionChips = Array.from(
            modalContent.querySelectorAll("md-filter-chip[selected]:not([data-variant-id])")
        );
        const selectedOptionIds = selectedOptionChips.map((chip) => chip.dataset.optionId);

        // --- 驗證邏輯 ---

        // (1) 驗證規格：若商品有規格列表，則必須選擇一個
        if (product.variants && product.variants.length > 0) {
            if (!selectedVariantId) {
                alert("請選擇規格 (如: 中杯/大杯)");
                return null;
            }
        }

        // (2) 驗證單選群組：若 selectionType 為 SINGLE，則視為必選
        if (product.optionGroups) {
            for (const group of product.optionGroups) {
                if (group.selectionType === "SINGLE") {
                    const groupOptionIds = group.options.map(opt => String(opt.optionId));
                    const hasSelected = selectedOptionIds.some(selectedId =>
                        groupOptionIds.includes(selectedId)
                    );

                    if (!hasSelected) {
                        alert(`請選擇 ${group.name}`);
                        return null;
                    }
                }
            }
        }

        return {
            variantId: selectedVariantId,
            quantity: quantitySelector.getQuantity(),
            notes: notesInput.value,
            selectedOptionIds: selectedOptionIds,
        };
    };

    return {
        element: modalContent,
        getSelectedData: getSelectedData,
    };
}