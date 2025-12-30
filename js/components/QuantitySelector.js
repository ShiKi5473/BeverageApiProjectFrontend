/**
 * 建立一個數量選擇器元件
 * @param {number} initialValue -
 * @returns { {element: HTMLElement, getQuantity: () => number} }
 */
export function createQuantitySelector(initialValue = 1) {
  const quantitySelector = document.createElement("div");
  quantitySelector.className = "quantity-selector";
  quantitySelector.innerHTML = `
    <button type="button" class="quantity-btn minus-btn">-</button>
    <span class="quantity-display">${initialValue}</span>
    <button type="button" class="quantity-btn plus-btn">+</button>
  `;

  const display = quantitySelector.querySelector(".quantity-display");
  const minusBtn = quantitySelector.querySelector(".minus-btn");
  const plusBtn = quantitySelector.querySelector(".plus-btn");

  //
  minusBtn.disabled = initialValue === 1;

  minusBtn.onclick = () => {
    let qty = parseInt(display.textContent);
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
    let qty = parseInt(display.textContent);
    qty++;
    display.textContent = qty;
    minusBtn.disabled = false;
  };

  return {
    element: quantitySelector,
    getQuantity: () => parseInt(display.textContent),
  };
}
