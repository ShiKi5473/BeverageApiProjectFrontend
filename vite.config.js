// 檔案： frontend/vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
    define: {

        global: 'window',
    },
    optimizeDeps: {
        include: [
            // --- POS / Navbar / OptionsModal ---
            '@material/web/icon/icon.js',
            '@material/web/iconbutton/icon-button.js',
            '@material/web/list/list.js',
            '@material/web/list/list-item.js',
            '@material/web/button/filled-button.js',
            '@material/web/button/outlined-button.js',
            '@material/web/dialog/dialog.js',
            '@material/web/divider/divider.js',
            '@material/web/chips/chip-set.js',
            '@material/web/chips/filter-chip.js',
            '@material/web/textfield/filled-text-field.js',

            // --- KDS ---
            '@material/web/chips/assist-chip.js',
            '@material/web/labs/card/filled-card.js',

            // --- Checkout ---
            '@material/web/button/filled-tonal-button.js',
            '@material/web/button/text-button.js'

            // 注意：auth.js 用到的元件 (filled-text-field, filled-button)
            // 已經包含在上面了，不需重複。
        ]
    },
    server: {
        // 我們在開發時，前端伺服器會開在 5173 (Vite 預設)
        port: 5173,
        proxy: {
            // 1. 代理 API 請求：
            // 任何 /api 開頭的請求 (例如 /api/v1/orders)
            // 都會被自動轉發到 http://localhost:8080/api/v1/orders
            '/api': {
                target: 'http://localhost:8080',
                changeOrigin: true,
            },
            // 2. 代理 WebSocket 請求：
            // 任何 /ws-kds 開頭的請求
            // 都會被自動轉發到 http://localhost:8080/ws-kds
            '/ws-kds': {
                target: 'http://localhost:8080',
                ws: true, // 啟用 WebSocket 代理
            },
        },
    },
    build: {
        // 讓 Vite 知道我們的多頁面入口
        rollupOptions: {
            input: {
                login: 'pages/login.html',
                pos: 'pages/pos.html',
                checkout: 'pages/checkout.html',
                kds: 'pages/kds.html',
                report: 'pages/report.html',
            }
        }
    }
});