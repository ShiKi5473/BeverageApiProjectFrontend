// 檔案：js/utils/pricing.js
// 【新增】購物車金額與品項組裝的純函式（可單元測試）。
// 規則（與後端一致）：單價 = 規格(variant)價格 + 所選選項的 priceAdjustment。
// 後端金額以 JSON number 傳回；ID 一律是字串，這裡全程以 String() 比較，不做 parseInt/Number。

/** 轉成有限數字；null / undefined / NaN 一律視為 0 */
export function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/** 金額四捨五入到小數 2 位，避免 0.1 + 0.2 之類的浮點誤差 */
export function roundMoney(value) {
    return Math.round(toNumber(value) * 100) / 100;
}

/**
 * 取得預設規格：價格最低者（價格相同時取第一個）
 * @param {Array<{id: string, name: string, price: number}>} variants
 * @returns {object|null}
 */
export function pickDefaultVariant(variants) {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    return variants.reduce((best, v) => (toNumber(v.price) < toNumber(best.price) ? v : best), variants[0]);
}

/**
 * 商品卡片顯示價格：最低規格價；沒有規格時退回 basePrice
 * @returns {{price: number, hasRange: boolean}} hasRange 代表有多種不同價格（可顯示「起」）
 */
export function getDisplayPrice(product) {
    const variants = product?.variants ?? [];
    if (variants.length === 0) return { price: toNumber(product?.basePrice), hasRange: false };
    const prices = variants.map((v) => toNumber(v.price));
    const min = Math.min(...prices);
    return { price: min, hasRange: prices.some((p) => p !== min) };
}

/**
 * 計算單價 = 規格價 + 選項加價總和
 * @param {{price: number}|null} variant - 已選規格（null 時以 fallbackBasePrice 代替）
 * @param {Array<{priceAdjustment: number}>} selectedOptions - 已選選項
 * @param {number} [fallbackBasePrice=0] - 商品沒有規格時的備援價格
 */
export function calculateUnitPrice(variant, selectedOptions = [], fallbackBasePrice = 0) {
    const base = variant ? toNumber(variant.price) : toNumber(fallbackBasePrice);
    const adjustments = (selectedOptions ?? []).reduce((sum, opt) => sum + toNumber(opt.priceAdjustment), 0);
    return roundMoney(base + adjustments);
}

/** 單一品項小計 */
export function calculateLineTotal(unitPrice, quantity) {
    return roundMoney(toNumber(unitPrice) * toNumber(quantity));
}

/** 購物車總計（僅供顯示用的暫估；實際金額以 POST /orders/preview 為準） */
export function calculateCartTotal(cart) {
    return roundMoney((cart ?? []).reduce((sum, item) => sum + calculateLineTotal(item.unitPrice, item.quantity), 0));
}

let cartIdSeq = 0;
/** 產生購物車本地 ID（僅前端使用的數字，不會送到後端） */
export function nextCartItemId() {
    cartIdSeq = (cartIdSeq + 1) % 1000;
    return Date.now() * 1000 + cartIdSeq;
}

/**
 * 依 OptionsModal 回傳的選擇組裝購物車品項
 * @param {object} product - ProductPosDto
 * @param {{variantId: string|null, selectedOptionIds: string[], quantity: number, notes: string}} selectedData
 * @returns {object} 購物車品項
 * @throws {Error} 商品沒有可選規格時
 */
export function buildCartItem(product, selectedData) {
    const variants = product.variants ?? [];
    const variant = variants.find((v) => String(v.id) === String(selectedData.variantId)) ?? null;
    if (!variant) {
        throw new Error('此商品尚未設定規格，無法下單');
    }
    const selectedIds = new Set((selectedData.selectedOptionIds ?? []).map(String));
    const allOptions = (product.optionGroups ?? []).flatMap((group) => group.options ?? []);
    const selectedOptions = allOptions.filter((opt) => selectedIds.has(String(opt.optionId)));

    return {
        id: nextCartItemId(),
        productId: String(product.id),
        variantId: String(variant.id),
        variantName: variant.name ?? '',
        name: product.name,
        quantity: selectedData.quantity,
        unitPrice: calculateUnitPrice(variant, selectedOptions, product.basePrice),
        selectedOptions,
        notes: selectedData.notes ?? '',
    };
}

/**
 * 購物車品項 -> 後端訂單品項 DTO：{productId, variantId, quantity, notes, optionIds}
 */
export function toOrderItemDto(cartItem) {
    return {
        productId: String(cartItem.productId),
        variantId: String(cartItem.variantId),
        quantity: cartItem.quantity,
        notes: cartItem.notes ?? '',
        optionIds: (cartItem.selectedOptions ?? []).map((opt) => String(opt.optionId)),
    };
}
