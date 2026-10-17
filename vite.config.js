// 檔案： frontend/vite.config.js
import { defineConfig, loadEnv } from 'vite';

/**
 * 【新增】依 VITE_API_BASE_URL 產生 CSP 的 connect-src 允許清單。
 * - 開發環境 VITE_API_BASE_URL 為空字串 -> API / SSE / WebSocket 都走同源（Vite proxy），只需要 'self'
 * - 正式環境 API 在不同網域 -> 需額外允許該網域的 http(s)（fetch / EventSource / SockJS XHR）
 *   與對應的 ws(s)（SockJS WebSocket 傳輸）
 * @param {string} apiBaseUrl - VITE_API_BASE_URL
 * @returns {string} 以空白分隔的 connect-src 來源清單
 */
function buildConnectSrc(apiBaseUrl) {
    const sources = ["'self'"];
    if (apiBaseUrl) {
        try {
            const url = new URL(apiBaseUrl);
            sources.push(url.origin);
            // https -> wss、http -> ws（同主機同埠）
            const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
            sources.push(`${wsProtocol}//${url.host}`);
        } catch {
            // 設定值不是合法網址時忽略，退回同源
        }
    }
    return sources.join(' ');
}

/**
 * 【新增】Vite 外掛：把各頁 HTML 裡的 CSP meta 佔位字串 __CSP_CONNECT_SRC__ 換成實際的 API 來源。
 * 這樣每一頁只需寫一份相同的 CSP meta，API 網域則集中由環境變數控制。
 * 說明：Material Web 與 echarts 都由 Vite 打包成同源腳本，因此 script-src 只需要 'self'，
 * 不需要 'unsafe-inline' / 'unsafe-eval'，也不再從 CDN 載入任何腳本。
 */
function cspPlugin(connectSrc) {
    return {
        name: 'inject-csp-connect-src',
        transformIndexHtml(html) {
            return html.replaceAll('__CSP_CONNECT_SRC__', connectSrc);
        },
    };
}

export default defineConfig(({ mode }) => {
    // 讀取 .env / .env.production 中以 VITE_ 開頭的變數
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const connectSrc = buildConnectSrc(env.VITE_API_BASE_URL);

    return {
        plugins: [cspPlugin(connectSrc)],
        define: {
            // 【修改】原本是 'window'（只在瀏覽器可用，Vitest 的 node 環境會 ReferenceError）；
            // sockjs-client 等舊套件讀取 global，globalThis 在瀏覽器與 Node 都存在
            global: 'globalThis',
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
                    online_order: 'pages/online_order.html',         // 【修改】新增：線上點餐頁面入口
                    inventory_audit: 'pages/inventory_audit.html',   // 【修改】新增：庫存盤點頁面入口
                }
            }
        },
        // 【新增】Vitest 設定：只跑 tests/ 底下的純函式測試（不需要 DOM）
        test: {
            environment: 'node',
            include: ['tests/**/*.test.js'],
        },
    };
});
