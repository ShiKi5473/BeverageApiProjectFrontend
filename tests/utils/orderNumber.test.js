// 檔案：tests/utils/orderNumber.test.js
// 【新增】取餐號碼（訂單號碼最後一段）單元測試
import { describe, it, expect } from 'vitest';
import { getPickupNumber } from '../../js/utils/orderNumber.js';

describe('getPickupNumber', () => {
    it('取訂單號碼最後一段', () => {
        expect(getPickupNumber('1-20260101-0007')).toBe('0007');
        expect(getPickupNumber('123456789012345678-20261017-0123')).toBe('0123');
    });

    it('沒有分隔符號時回傳原字串，並去除前後空白', () => {
        expect(getPickupNumber('A001')).toBe('A001');
        expect(getPickupNumber('  1-20260101-0042 ')).toBe('0042');
    });

    it('null / undefined / 空字串回傳空字串', () => {
        expect(getPickupNumber(null)).toBe('');
        expect(getPickupNumber(undefined)).toBe('');
        expect(getPickupNumber('   ')).toBe('');
    });
});
