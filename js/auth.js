// 檔案：frontend/js/auth.js

/**
 * Auth 模組：負責管理 Token 與登入狀態 (LocalStorage 操作)
 */

const TOKEN_KEY = "accessToken";
const ROLE_KEY = "userRole";
const NAME_KEY = "displayName";
const BRAND_KEY = "brandId";
const STORE_KEY = "storeId";

/**
 * 儲存登入工作階段 (Session)
 * @param {object} authResponse - 後端回傳的 JwtAuthResponseDto
 * @param {string} [displayName] - 使用者名稱
 * @param {string} [brandId] - 登入時選定的品牌 ID
 */
export function setAuthSession(authResponse, displayName = "", brandId = "") {
    if (authResponse.accessToken) {
        localStorage.setItem(TOKEN_KEY, authResponse.accessToken);
    }
    if (authResponse.role) {
        localStorage.setItem(ROLE_KEY, authResponse.role);
    }
    if (displayName) {
        localStorage.setItem(NAME_KEY, displayName);
    }
    if (brandId) {
        // 【修改】ID 一律以字串保存（TSID 超過 JS 安全整數範圍，不可轉成 Number）
        localStorage.setItem(BRAND_KEY, String(brandId));
    }
    // 如果後端有回傳 storeId（字串或 null），也存起來
    if (authResponse.storeId) {
        localStorage.setItem(STORE_KEY, String(authResponse.storeId));
    }
}

/**
 * 取得 Access Token
 */
export function getAccessToken() {
    return localStorage.getItem(TOKEN_KEY);
}

/**
 * 檢查是否已登入
 */
export function isAuthenticated() {
    return !!localStorage.getItem(TOKEN_KEY);
}

/**
 * 【新增】只清除本機的登入資料，不做頁面導向
 * （線上點餐頁切換品牌、重新做訪客登入時使用）
 */
export function clearAuthSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(NAME_KEY);
    localStorage.removeItem(BRAND_KEY);
    localStorage.removeItem(STORE_KEY);
}

/**
 * 執行登出 (清除所有資料並導向)
 * 【修改】所有頁面統一呼叫此函式登出（原本各頁自己 removeItem，且漏清 storeId／角色）
 */
export function logout() {
    clearAuthSession();

    if (window.location.pathname.endsWith("online_order.html")) {
        // 【修改】線上點餐頁是訪客頁面，不應被導到員工登入頁；重新載入後會重新做訪客登入
        window.location.reload();
        return;
    }

    // 如果不是在登入頁，則導向登入頁
    if (!window.location.pathname.endsWith("login.html")) {
        window.location.href = "/pages/login.html"; // 請確認您的路徑結構
    }
}

/**
 * 取得使用者角色
 * @returns {string|null} e.g., "ROLE_STAFF"
 */
export function getUserRole() {
    return localStorage.getItem(ROLE_KEY);
}

/**
 * 取得目前分店 ID
 * @returns {string|null}
 */
export function getStoreId() {
    return localStorage.getItem(STORE_KEY);
}

/**
 * 取得目前品牌 ID
 * @returns {string|null}
 */
export function getBrandId() {
    return localStorage.getItem(BRAND_KEY);
}