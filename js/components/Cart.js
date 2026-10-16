import { calculateCartTotal, calculateLineTotal } from '../utils/pricing.js';

/**
 * 小工具：建立帶 class 與文字的元素（一律 textContent，避免 XSS）
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * 建立一個購物車品項的 DOM 元素
 * 【修改】XSS 防護：改用 DOM API + textContent，不再用 innerHTML 插入商品名稱／備註／選項
 * 【修改】顯示規格名稱（variantName）
 * @param {object} item - 購物車品項
 * @returns {HTMLElement}
 */
export function createCartItem(item) {
  const itemElement = el("div", "cart-item");

  // 標題列：名稱 (規格) x數量 + 移除按鈕
  const header = el("div", "cart-item-header");
  const variantText = item.variantName ? ` (${item.variantName})` : "";
  header.appendChild(el("span", "cart-item-name", `${item.name}${variantText} (x${item.quantity})`));
  const removeBtn = el("button", "cart-item-remove-btn", "×");
  // 購物車 ID 是前端本地產生的數字，不是後端 ID
  removeBtn.dataset.cartId = String(item.id);
  header.appendChild(removeBtn);
  itemElement.appendChild(header);

  // 選項
  const optionsText = (item.selectedOptions ?? []).map((opt) => opt.optionName).join(", ");
  itemElement.appendChild(el("div", "cart-item-options", optionsText));

  // 備註
  if (item.notes) {
    itemElement.appendChild(el("div", "cart-item-notes", `備註: ${item.notes}`));
  }

  itemElement.appendChild(
    el("div", "cart-item-price", `NT$ ${calculateLineTotal(item.unitPrice, item.quantity)}`)
  );
  return itemElement;
}

/**
 * 更新購物車總金額
 * @param {Array} cart -
 * @param {HTMLElement} totalElement -
 */
export function updateCartTotal(cart, totalElement) {
  totalElement.textContent = `NT$ ${calculateCartTotal(cart)}`;
}
