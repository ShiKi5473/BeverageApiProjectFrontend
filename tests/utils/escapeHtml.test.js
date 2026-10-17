// 檔案：tests/utils/escapeHtml.test.js
// 【新增】escapeHtml / sanitizeUrl 單元測試（XSS 防護的核心純函式）
import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeUrl } from '../../js/utils/escapeHtml.js';

describe('escapeHtml', () => {
    it('跳脫 HTML 特殊字元', () => {
        expect(escapeHtml('&<>"\'`')).toBe('&amp;&lt;&gt;&quot;&#39;&#96;');
    });

    it('商品名稱含 img onerror 時不會留下可執行的標籤', () => {
        const escaped = escapeHtml('<img src=x onerror=alert(1)>');
        expect(escaped).toBe('&lt;img src=x onerror=alert(1)&gt;');
        expect(escaped).not.toContain('<');
    });

    it('雙引號被跳脫，無法跳出屬性值', () => {
        expect(escapeHtml('" onfocus="alert(1)')).not.toContain('"');
    });

    it('null / undefined 轉為空字串；0 與 false 不被當成空值', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(0)).toBe('0');
        expect(escapeHtml(false)).toBe('false');
    });

    it('中文維持原樣', () => {
        expect(escapeHtml('珍珠奶茶 (大杯)')).toBe('珍珠奶茶 (大杯)');
    });
});

describe('sanitizeUrl', () => {
    it('允許 http(s) 與站內絕對路徑', () => {
        expect(sanitizeUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
        expect(sanitizeUrl('/images/a.png')).toBe('/images/a.png');
    });

    it('擋掉 javascript: 與協定相對網址', () => {
        expect(sanitizeUrl('javascript:alert(1)')).toBe('');
        expect(sanitizeUrl('//evil.example.com/a.png')).toBe('');
    });

    it('data:image 只允許點陣圖', () => {
        expect(sanitizeUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
        expect(sanitizeUrl('data:image/svg+xml;base64,AAAA')).toBe('');
    });

    it('非字串或空白回傳空字串', () => {
        expect(sanitizeUrl(null)).toBe('');
        expect(sanitizeUrl(123)).toBe('');
        expect(sanitizeUrl('   ')).toBe('');
    });
});
