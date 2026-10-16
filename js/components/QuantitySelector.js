/**
 * 建立一個數量選擇器元件
 * 【修改】改用 DOM API 建立（不再用 innerHTML 插入 initialValue）
 * @param {number} initialValue -
 * @returns { {element: HTMLElement, getQuantity: () => number} }
 */
export function createQuantitySelector(initialValue = 1) {
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
    let qty = parseInt(display.textContent, 10);
    if (qty > 1) {
      qty--;
      display.textContent = qty;
      plusBtn.disabled = false;
      if (qty === 1) {
        minusBtn.disabled = true;
      }
    }
  };

  plusBtn.onclick = () => {
    let qty = parseInt(display.textContent, 10);
    qty++;
    display.textContent = qty;
    minusBtn.disabled = false;
  };

  return {
    element: quantitySelector,
    getQuantity: () => parseInt(display.textContent, 10),
  };
}
