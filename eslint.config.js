// 檔案：frontend/eslint.config.js
// 【新增】ESLint flat config（ESLint 9+ 格式）。
// 規則來源：@eslint/js 的 recommended；瀏覽器程式碼使用 browser 全域，設定檔與測試使用 node 全域。
import js from '@eslint/js';
import globals from 'globals';

export default [
    // 不檢查建置輸出與第三方套件
    { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

    js.configs.recommended,

    // 前端原始碼：ES Modules + 瀏覽器環境
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.browser },
        },
        rules: {
            // 允許以底線開頭的參數／變數刻意不使用
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
            // 專案約定：ID 一律是字串，不應被 parseInt / Number 轉換；金額數量的轉換請使用 utils/pricing.js 的 toNumber
            'no-restricted-globals': ['error', { name: 'parseInt', message: 'ID 為字串（TSID 超過安全整數），不可用 parseInt；數量請用 utils/pricing.js 的 toNumber。' }],
        },
    },

    // 設定檔與測試：Node 環境
    {
        files: ['vite.config.js', 'eslint.config.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: { ...globals.node },
        },
    },
];
