/**
 * 建立一個數量選擇器元件
 * 【修改】改用 DOM API 建立（不再用 innerHTML 插入 initialValue）
 * @param {number} initialValue -
 * @returns { {element: HTMLElement, getQuantity: () => number} }
 */
export function createQuantitySelector(initialValue = 1) {
  // 【修改】數量改存在變數中，不再從畫面文字 parseInt（專案規範禁止使用 parseInt，避免和 ID 轉換混用）
  let quantity = initialValue;
  const quantitySelector = document.createElement("div");
  quantitySelector.className = "quantity-selector";

  const minusBtn = document.createElement("button");
  minusBtn.type = "button";
  minusBtn.className = "quantity-btn minus-btn";
  minusBtn.textContent = "-";

  const display = document.createElement("span");
  display.className = "quantity-display";
  display.textContent = String(initialValue);

  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "quantity-btn plus-btn";
  plusBtn.textContent = "+";

  quantitySelector.append(minusBtn, display, plusBtn);

  //
  minusBtn.disabled = initialValue === 1;

  minusBtn.onclick = () => {
    if (quantity > 1) {
      quantity--;
      display.textContent = String(quantity);
      plusBtn.disabled = false;
      if (quantity === 1) {
        minusBtn.disabled = true;
      }
    }
  };

  plusBtn.onclick = () => {
    quantity++;
    display.textContent = String(quantity);
    minusBtn.disabled = false;
  };

  return {
    element: quantitySelector,
    getQuantity: () => quantity,
  };
}
