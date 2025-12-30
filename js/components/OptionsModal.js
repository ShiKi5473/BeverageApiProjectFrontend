import '@material/web/chips/filter-chip.js';
import '@material/web/chips/chip-set.js';
import '@material/web/textfield/filled-text-field.js';

import { createQuantitySelector } from "./QuantitySelector.js";

// 為 <md-chip> 建立的輔助函式
function createChip(option) {
    const chip = document.createElement("md-filter-chip");
    let labelText = option.optionName;
    if (option.priceAdjustment > 0) {
        labelText += ` (+NT$ ${option.priceAdjustment})`;
    }
    chip.label = labelText;
    chip.dataset.optionId = option.optionId;
    return chip;
}

/**
 * 建立客製化選項 Modal 的 "內容" (MWC 版本)
 */
export function createOptionsModalContent(product) {
    // 1. 建立根元素
    const modalContent = document.createElement("div");

    // 2. 建立標題
    const title = document.createElement("h3");
    title.textContent = product.name;
    modalContent.appendChild(title);

    // 3. 遍歷 OptionGroups
    product.optionGroups.forEach((group) => {
        const groupContainer = document.createElement("div");
        groupContainer.className = "option-group";

        const groupTitle = document.createElement("h4");
        const selectionType = group.selectionType === "SINGLE" ? "單選" : "多選";
        groupTitle.textContent = `${group.name} (${selectionType})`;
        groupContainer.appendChild(groupTitle);

        // 【修改】建立 <md-chip-set>
        const chipSet = document.createElement("md-chip-set");
        groupContainer.appendChild(chipSet);

        // 處理單選/多選
        if (group.selectionType === "SINGLE") {
            chipSet.singleSelect = true;
        }

        // 加入 Chip
        group.options.forEach((option) => {
            const chip = createChip(option);
            chipSet.appendChild(chip);
        });

        modalContent.appendChild(groupContainer);
    });

    // 4. 建立數量選擇器 (可以保留原樣，或也用 MWC 替換)
    const quantitySelector = createQuantitySelector(1);
    modalContent.appendChild(quantitySelector.element);

    // 5. 建立備註 (替換為 <md-filled-text-field>)
    const notesInput = document.createElement("md-filled-text-field");
    notesInput.label = "備註...";
    notesInput.className = "modal-notes";
    notesInput.style.width = "100%";
    modalContent.appendChild(notesInput);

    // 6. 取得資料的函式
    const getSelectedData = () => {
        // 【修改】從 <md-filter-chip> 取得選中項
        const selectedChips = Array.from(
            modalContent.querySelectorAll("md-filter-chip[selected]")
        );
        const selectedOptionIds = selectedChips.map((chip) => chip.dataset.optionId);

        return {
            quantity: quantitySelector.getQuantity(),
            notes: notesInput.value, // .value 依然可用
            selectedOptionIds: selectedOptionIds,
        };
    };

    return {
        element: modalContent,
        getSelectedData: getSelectedData,
    };
}