import { sanitizeUrl } from '../utils/escapeHtml.js';
import { getDisplayPrice } from '../utils/pricing.js';

/**
 * 商品卡片元件
 * 【修改】XSS 防護：改用 DOM API + textContent 建立，不再用 innerHTML 插入商品名稱／圖片網址
 * 【修改】價格顯示最低規格價（有多種價格時加「起」），商品本身沒有單一價格
 * @param {object} product - 來自後端的 ProductPosDto 物件
 * @returns {HTMLElement} - 回傳一個商品卡片的 DOM 元素
 */
export function createProductCard(product) {
  // 1. 建立卡片的根元素
  const productCard = document.createElement("div");
  productCard.className = "product-card";

  // ID 一律是字串（dataset 本身也只存字串）
  productCard.dataset.productId = String(product.id);

  // 2. 圖片：後端欄位為 imageUrl（舊程式用 imgUrl，兩者都接受），並驗證網址協定
  const imageUrl = sanitizeUrl(product.imageUrl ?? product.imgUrl);
  if (imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = product.name ?? "";
    img.className = "product-image";
    productCard.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "product-image-placeholder";
    productCard.appendChild(placeholder);
  }

  // 3. 名稱
  const nameEl = document.createElement("div");
  nameEl.className = "product-name";
  nameEl.textContent = product.name ?? "";
  productCard.appendChild(nameEl);

  // 4. 價格
  const { price, hasRange } = getDisplayPrice(product);
  const priceEl = document.createElement("div");
  priceEl.className = "product-price";
  priceEl.textContent = `NT$ ${price}${hasRange ? " 起" : ""}`;
  productCard.appendChild(priceEl);

  return productCard;
}
