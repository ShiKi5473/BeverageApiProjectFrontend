/**
 * 商品卡片元件
 * @param {object} product - 來自後端的 ProductPosDto 物件
 * @returns {HTMLElement} - 回傳一個商品卡片的 DOM 元素
 */
export function createProductCard(product) {
  // 1. 建立卡片的根元素
  const productCard = document.createElement("div");
  productCard.className = "product-card";

  productCard.dataset.productId = product.id;

  const imageHtml = product.imgUrl
    ? `<img src="${product.imgUrl}" alt="${product.name}" class="product-image">`
    : '<div class="product-image-placeholder"></div>';

  productCard.innerHTML = `
    ${imageHtml}
        <div class="product-name">${product.name}</div>
        <div class="product-price">NT$ ${product.basePrice}</div>
    `;

  // 3. 回傳建立好的 DOM 元素
  return productCard;
}
