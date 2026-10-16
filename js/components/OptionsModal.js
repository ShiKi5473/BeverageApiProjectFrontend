import '@material/web/chips/filter-chip.js';
import '@material/web/chips/chip-set.js';
import '@material/web/textfield/filled-text-field.js';

import { createQuantitySelector } from "./QuantitySelector.js";
import { pickDefaultVariant, calculateUnitPrice, toNumber } from "../utils/pricing.js";

// 為 <md-chip> 建立的輔助函式
function createChip(label, selected) {
    const chip = document.createElement("md-filter-chip");
    chip.label = label;
    chip.selected = !!selected;
    return chip;
}

/**
 * 建立客製化選項 Modal 的 "內容" (MWC 版本)
 *
 * 【修改】
 * 1. 新增「規格 (variant)」單選區塊：預設選價格最低者；後端 variantId 為必填
 * 2. 預先選取 isDefault 的選項
 * 3. 真正強制 SINGLE 群組只能選一個（原本 chipSet.singleSelect 在 Material Web 2.x 並不存在，沒有任何效果）
 * 4. getSelectedData() 回傳 variantId；畫面即時顯示「規格價 + 選項加價」的單價
 * 5. ID 一律當字串處理，不做 Number 轉換
 */
export function createOptionsModalContent(product) {
    // 1. 建立根元素
    const modalContent = document.createElement("div");

    // 2. 建立標題
    const title = document.createElement("h3");
    title.textContent = product.name;
    modalContent.appendChild(title);

    const variants = product.variants ?? [];
    const optionGroups = product.optionGroups ?? [];

    // 目前選到的規格（物件）；沒有規格時為 null
    let selectedVariant = pickDefaultVariant(variants);

    // 單價顯示（會在規格／選項變動時更新）
    const priceDisplay = document.createElement("div");
    priceDisplay.className = "modal-unit-price";

    // 所有選項 chip 與對應的選項資料，供計算價格與回傳選中項使用
    /** @type {Array<{chip: HTMLElement, option: object, group: object}>} */
    const optionChips = [];

    const getSelectedOptions = () => optionChips.filter((entry) => entry.chip.selected).map((entry) => entry.option);

    const refreshPrice = () => {
        const unitPrice = calculateUnitPrice(selectedVariant, getSelectedOptions(), product.basePrice);
        priceDisplay.textContent = `單價：NT$ ${unitPrice}`;
    };

    // 3. 規格區塊（單選，不可取消選取）
    if (variants.length > 0) {
        const variantContainer = document.createElement("div");
        variantContainer.className = "option-group variant-group";

        const variantTitle = document.createElement("h4");
        variantTitle.textContent = "規格 (單選)";
        variantContainer.appendChild(variantTitle);

        const variantChipSet = document.createElement("md-chip-set");
        variantContainer.appendChild(variantChipSet);

        /** @type {Array<{chip: HTMLElement, variant: object}>} */
        const variantChips = variants.map((variant) => {
            const chip = createChip(
                `${variant.name} (NT$ ${toNumber(variant.price)})`,
                String(variant.id) === String(selectedVariant?.id)
            );
            chip.dataset.variantId = String(variant.id);
            variantChipSet.appendChild(chip);
            return { chip, variant };
        });

        variantChips.forEach(({ chip, variant }) => {
            // 點擊時 Material Web 已先切換 selected（redispatch 的 click 事件在切換之後才送達）
            chip.addEventListener("click", () => {
                // 規格必選：不允許把唯一選中的規格取消
                chip.selected = true;
                selectedVariant = variant;
                variantChips.forEach((other) => {
                    if (other.chip !== chip) other.chip.selected = false;
                });
                refreshPrice();
            });
        });

        modalContent.appendChild(variantContainer);
    } else {
        // 後端沒有提供規格時給出明確提示（下單需要 variantId）
        const warn = document.createElement("p");
        warn.className = "error";
        warn.textContent = "此商品尚未設定規格，暫時無法下單";
        modalContent.appendChild(warn);
    }

    // 4. 遍歷 OptionGroups
    optionGroups.forEach((group) => {
        const groupContainer = document.createElement("div");
        groupContainer.className = "option-group";

        const isSingle = group.selectionType === "SINGLE";

        const groupTitle = document.createElement("h4");
        const selectionType = isSingle ? "單選" : "多選";
        groupTitle.textContent = `${group.name} (${selectionType})`;
        groupContainer.appendChild(groupTitle);

        const chipSet = document.createElement("md-chip-set");
        groupContainer.appendChild(chipSet);

        // 單選群組若有多個預設值，只保留第一個，確保初始狀態符合 SINGLE 規則
        let defaultTaken = false;
        const groupEntries = (group.options ?? []).map((option) => {
            let selected = !!option.isDefault;
            if (isSingle && selected) {
                if (defaultTaken) selected = false;
                defaultTaken = defaultTaken || selected;
            }
            let labelText = option.optionName;
            if (toNumber(option.priceAdjustment) > 0) {
                labelText += ` (+NT$ ${toNumber(option.priceAdjustment)})`;
            }
            const chip = createChip(labelText, selected);
            chip.dataset.optionId = String(option.optionId);
            chipSet.appendChild(chip);
            const entry = { chip, option, group };
            optionChips.push(entry);
            return entry;
        });

        groupEntries.forEach((entry) => {
            entry.chip.addEventListener("click", () => {
                // 單選群組：選中某一個時取消同組其他項（可再點一次取消，代表不加選）
                if (isSingle && entry.chip.selected) {
                    groupEntries.forEach((other) => {
                        if (other !== entry) other.chip.selected = false;
                    });
                }
                refreshPrice();
            });
        });

        modalContent.appendChild(groupContainer);
    });

    // 5. 建立數量選擇器 (可以保留原樣，或也用 MWC 替換)
    const quantitySelector = createQuantitySelector(1);
    modalContent.appendChild(quantitySelector.element);

    modalContent.appendChild(priceDisplay);
    refreshPrice();

    // 6. 建立備註 (替換為 <md-filled-text-field>)
    const notesInput = document.createElement("md-filled-text-field");
    notesInput.label = "備註...";
    notesInput.className = "modal-notes";
    notesInput.style.width = "100%";
    modalContent.appendChild(notesInput);

    // 7. 取得資料的函式
    const getSelectedData = () => {
        return {
            // 規格 ID（字串）；沒有規格時為 null，由呼叫端（buildCartItem）擋下
            variantId: selectedVariant ? String(selectedVariant.id) : null,
            quantity: quantitySelector.getQuantity(),
            notes: notesInput.value, // .value 依然可用
            // 選項 ID 一律是字串
            selectedOptionIds: getSelectedOptions().map((opt) => String(opt.optionId)),
        };
    };

    return {
        element: modalContent,
        getSelectedData: getSelectedData,
    };
}
