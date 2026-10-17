// 檔案：tests/utils/pricing.test.js
// 【新增】pricing.js 單元測試。單價 = 規格價 + 選項加價；ID 一律是字串，不做 Number 轉換。
import { describe, it, expect } from 'vitest';
import {
    toNumber,
    roundMoney,
    pickDefaultVariant,
    getDisplayPrice,
    calculateUnitPrice,
    calculateLineTotal,
    calculateCartTotal,
    nextCartItemId,
    buildCartItem,
    toOrderItemDto,
} from '../../js/utils/pricing.js';

// 超過 Number.MAX_SAFE_INTEGER 的 TSID，用來驗證 ID 沒有被轉成 Number
const PRODUCT_ID = '861234567890123457';
const VARIANT_M = '861234567890123458';
const VARIANT_L = '861234567890123459';
const OPT_1 = '861234567890123460';
const OPT_2 = '861234567890123461';

const product = {
    id: PRODUCT_ID,
    name: '珍珠奶茶',
    basePrice: 50,
    variants: [
        { id: VARIANT_L, name: '大杯', price: 70 },
        { id: VARIANT_M, name: '中杯', price: 60 },
    ],
    optionGroups: [{
        groupId: '1',
        name: '加料',
        selectionType: 'MULTIPLE',
        options: [
            { optionId: OPT_1, optionName: '珍珠', priceAdjustment: 10, isDefault: false },
            { optionId: OPT_2, optionName: '椰果', priceAdjustment: 5.5, isDefault: false },
        ],
    }],
};

describe('toNumber / roundMoney', () => {
    it('無效值視為 0', () => {
        expect(toNumber(null)).toBe(0);
        expect(toNumber(undefined)).toBe(0);
        expect(toNumber(NaN)).toBe(0);
        expect(toNumber('abc')).toBe(0);
        expect(toNumber('12.5')).toBe(12.5);
    });

    it('roundMoney 消除浮點誤差', () => {
        expect(roundMoney(0.1 + 0.2)).toBe(0.3);
        expect(roundMoney('10.126')).toBe(10.13);
    });
});

describe('規格與顯示價格', () => {
    it('預設規格是價格最低者；空陣列回傳 null', () => {
        expect(pickDefaultVariant(product.variants).id).toBe(VARIANT_M);
        expect(pickDefaultVariant([])).toBeNull();
        expect(pickDefaultVariant(undefined)).toBeNull();
    });

    it('顯示最低規格價；沒有規格退回 basePrice', () => {
        expect(getDisplayPrice(product)).toEqual({ price: 60, hasRange: true });
        expect(getDisplayPrice({ basePrice: 55, variants: [] })).toEqual({ price: 55, hasRange: false });
    });
});

describe('金額計算', () => {
    it('單價 = 規格價 + 選項加價', () => {
        expect(calculateUnitPrice(product.variants[1], product.optionGroups[0].options, 50)).toBe(75.5);
    });

    it('沒有規格時使用備援價格；加價為 null 不影響', () => {
        expect(calculateUnitPrice(null, [{ priceAdjustment: 5 }], 50)).toBe(55);
        expect(calculateUnitPrice({ price: 60 }, [{ priceAdjustment: null }])).toBe(60);
    });

    it('小計與購物車總計', () => {
        expect(calculateLineTotal(75.5, 2)).toBe(151);
        expect(calculateCartTotal([{ unitPrice: 60, quantity: 2 }, { unitPrice: 75.5, quantity: 1 }])).toBe(195.5);
        expect(calculateCartTotal(undefined)).toBe(0);
    });
});

describe('buildCartItem / toOrderItemDto', () => {
    it('組出品項：ID 保持字串、單價含規格與加料', () => {
        const item = buildCartItem(product, {
            variantId: VARIANT_L,
            selectedOptionIds: [OPT_1, OPT_2],
            quantity: 2,
            notes: '少冰',
        });
        expect(item.productId).toBe(PRODUCT_ID);
        expect(item.variantId).toBe(VARIANT_L);
        expect(item.unitPrice).toBe(85.5);
        expect(item.selectedOptions.map((o) => o.optionId)).toEqual([OPT_1, OPT_2]);
    });

    it('找不到規格時拋出錯誤', () => {
        expect(() => buildCartItem(product, { variantId: 'nope', selectedOptionIds: [], quantity: 1 })).toThrow();
        expect(() => buildCartItem({ ...product, variants: [] }, { variantId: null, quantity: 1 })).toThrow();
    });

    it('DTO 符合後端契約且大整數 ID 不失真', () => {
        const dto = toOrderItemDto(buildCartItem(product, {
            variantId: VARIANT_M, selectedOptionIds: [OPT_2], quantity: 1, notes: '',
        }));
        expect(dto).toEqual({
            productId: PRODUCT_ID, variantId: VARIANT_M, quantity: 1, notes: '', optionIds: [OPT_2],
        });
        expect(JSON.stringify(dto)).toContain('"861234567890123457"');
    });

    it('缺少 notes / selectedOptions 時給預設值', () => {
        expect(toOrderItemDto({ productId: 'p', variantId: 'v', quantity: 3 }))
            .toEqual({ productId: 'p', variantId: 'v', quantity: 3, notes: '', optionIds: [] });
    });
});

describe('nextCartItemId', () => {
    it('連續呼叫不重複', () => {
        const ids = new Set(Array.from({ length: 500 }, () => nextCartItemId()));
        expect(ids.size).toBe(500);
    });
});
