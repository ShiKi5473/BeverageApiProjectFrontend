/**
 * 建立一個購物車品項的 DOM 元素
 * @param {object} item -
 * @returns {HTMLElement}
 */
export function createCartItem(item) {
  const itemElement = document.createElement("div");
  itemElement.className = "cart-item";

  const optionsText = item.selectedOptions
    .map((opt) => opt.optionName)
    .join(", ");

  const notesText = item.notes
    ? `<div class="cart-item-notes">備註: ${item.notes}</div>`
    : "";

  itemElement.innerHTML = `
    <div class="cart-item-header">
      <span class="cart-item-name">${item.name} (x${item.quantity})</span>
      <button class="cart-item-remove-btn" data-cart-id="${item.id}">×</button>
    </div>
    <div class="cart-item-options">${optionsText}</div>
    ${notesText}
    <div class="cart-item-price">NT$ ${item.unitPrice * item.quantity}</div>
  `;
  return itemElement;
}

/**
 * 更新購物車總金額
 * @param {Array} cart -
 * @param {HTMLElement} totalElement -
 */
export function updateCartTotal(cart, totalElement) {
  const total = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  );
  totalElement.textContent = `NT$ ${total}`;
}
