import { getAccessToken, logout } from './auth.js';
import logger from './utils/logger.js';
// 【修改】匯入統一錯誤處理工具，取代各處不一致的 .text()/.json() 解析
import { handleApiError } from './utils/apiError.js';
// 【新增】冪等鍵產生工具
import { createIdempotencyKey } from './utils/idempotency.js';
// 【修改】API 基底 URL 改由 config.js 統一提供（api / SSE / WebSocket 共用）
import { API_BASE_URL } from './config.js';

/**
 * 【新增】路徑參數一律 encodeURIComponent，避免特殊字元（/、?、# 等）破壞 URL 或造成路徑注入。
 * ID 在前端是字串，不做 Number 轉換。
 */
function seg(value) {
    return encodeURIComponent(String(value));
}

/**
 * 【新增】安全讀取 JSON：回應可能是空 body（204 或沒有內容的 200），此時回傳 null 而不是拋 SyntaxError
 */
async function readJsonBody(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

// ==========================================
// 🔐 認證相關 API
// ==========================================

/**
 * 員工/會員登入
 * @param {object} credentials - { username, password, brandId }（brandId 以字串傳送，避免大整數精度遺失）
 */
export async function login(credentials) {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
    });

    if (!response.ok) {
        await handleApiError(response, "登入失敗");
    }
    return response.json();
}

/**
 * 訪客快速登入
 * 【修改】後端需要 brandId 才能簽發帶品牌的 GUEST token
 * @param {string} displayName - 訪客暱稱
 * @param {string} brandId - 品牌 ID（字串）
 */
export async function guestLogin(displayName, brandId) {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, brandId: String(brandId) }),
    });

    if (!response.ok) {
        // 【修改】改用統一錯誤處理（含 429 速率限制訊息）
        await handleApiError(response, "訪客登入失敗");
    }
    return response.json();
}


/**
 * 取得一次性 SSE 連線票券
 * 用於建立 EventSource 連線（因為 EventSource API 不支援自訂 Header，
 * 所以改用短期一次性 ticket 取代在 URL 中直接暴露 JWT）。
 * 票券有效期 30 秒，僅能使用一次。
 * @returns {Promise<string>} ticket 字串
 */
export async function getSseTicket() {
    const response = await fetchWithAuth("/api/v1/auth/sse-ticket", {
        method: "POST",
    });

    if (!response.ok) {
        throw new Error("取得 SSE ticket 失敗");
    }
    const data = await response.json();
    return data.ticket;
}

// ==========================================
// 🛠️ 通用 Fetch 工具
// ==========================================

/**
 * 自動帶入 Token 的 Fetch 封裝
 * 【修改】
 * 1. 401 時先登出，再「拋出錯誤」（原本 return undefined，呼叫端讀 .ok 會 TypeError）
 * 2. 只有帶 body 時才設定 Content-Type（GET 帶 Content-Type 會讓跨網域請求多一次 preflight）
 */
async function fetchWithAuth(endpoint, options = {}) {
    const token = getAccessToken(); // 從 auth.js 取得

    const headers = { ...options.headers };

    if (options.body !== undefined && options.body !== null && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    // 處理完整 URL (若 endpoint 不是以 http 開頭，補上 API 基底 URL)
    const url = endpoint.startsWith("http") ? endpoint : `${API_BASE_URL}${endpoint}`;

    let response;
    try {
        response = await fetch(url, { ...options, headers });
    } catch (error) {
        logger.error("API 請求失敗:", error);
        throw error;
    }

    if (response.status === 401) {
        logger.warn("Token 失效 (401)，自動登出");
        logout(); // 呼叫 auth.js 的登出
        // 【修改】拋出錯誤讓呼叫端中止流程，而不是回傳 undefined
        throw new Error("登入已失效，請重新登入");
    }

    return response;
}

/**
 * 【新增】組出冪等請求的 headers；key 由呼叫端「每次送出產生一次、重試沿用」
 */
function idempotencyHeaders(idempotencyKey) {
    return { "Idempotency-Key": idempotencyKey || createIdempotencyKey() };
}

/**
 * 取得 POS 商品列表
 */
export async function getPosProducts() {
  const response = await fetchWithAuth("/api/v1/brands/products/pos", {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error("取得商品失敗");
  }
  return response.json();
}

export async function getCategories() {
  const response = await fetchWithAuth("/api/v1/brands/categories", {
    method: "GET",
  });
  if (!response.ok) {
    throw new Error("取得分類失敗");
  }
  return response.json();
}

/**
 * 對一筆現有訂單進行結帳 (付款、綁定會員)
 * (對應 OrderController)
 * @param {string} orderId - 訂單 ID（字串）
 * @param {object} paymentData - { memberId, pointsToUse, paymentMethod }
 */
export async function processPayment(orderId, paymentData) {
  const response = await fetchWithAuth(`/api/v1/orders/${seg(orderId)}/checkout`, {
    method: "PATCH",
    body: JSON.stringify(paymentData),
  });

  if (!response.ok) {
    await handleApiError(response, "付款失敗");
  }
  return response.json();
}

/**
 * 建立一筆新訂單（POS 暫存 HELD / PENDING）
 * @param {object} orderData - { status, items }
 * @param {string} [idempotencyKey] - 【新增】冪等鍵；呼叫端重試時請傳入同一個
 */
export async function createOrder(orderData, idempotencyKey) {
    const response = await fetchWithAuth("/api/v1/orders", {
        method: "POST",
        headers: idempotencyHeaders(idempotencyKey),
        body: JSON.stringify(orderData),
    });

    if (!response.ok) {
        await handleApiError(response, "建立訂單失敗");
    }
    return response.json();
}

/**
 * 【新增】訂單金額試算（不寫入資料庫）
 * 對應後端: POST /api/v1/orders/preview
 * @param {object} previewData - { storeId?, items, memberId?, pointsToUse? }
 * @returns {Promise<{totalAmount:number, promotionDiscount:number, pointsDiscount:number, pointsUsed:number, finalAmount:number}>}
 */
export async function previewOrder(previewData) {
    const response = await fetchWithAuth("/api/v1/orders/preview", {
        method: "POST",
        body: JSON.stringify(previewData),
    });

    if (!response.ok) {
        await handleApiError(response, "金額試算失敗");
    }
    return response.json();
}

/**
 * 【新增】店員接單（線上訂單 AWAITING_ACCEPTANCE -> PREPARING）
 * 對應後端: PATCH /api/v1/orders/{id}/accept
 */
export async function acceptOrder(orderId) {
    const response = await fetchWithAuth(`/api/v1/orders/${seg(orderId)}/accept`, {
        method: "PATCH",
    });

    if (!response.ok) {
        await handleApiError(response, "接單失敗");
    }
    return readJsonBody(response);
}

/**
 * 建立線上訂單 (非同步)
 * 對應後端: POST /api/v1/online-orders
 * @param {object} orderData - { storeId, items, customerNote }（不可帶 status）
 * @param {string} [idempotencyKey] - 冪等鍵；重試時沿用同一個
 * @returns {Promise<{ticketId:string, status:string, message:string}>}
 */
export async function createOnlineOrder(orderData, idempotencyKey) {
    const response = await fetchWithAuth("/api/v1/online-orders", {
        method: "POST",
        headers: idempotencyHeaders(idempotencyKey),
        body: JSON.stringify(orderData),
    });

    if (response.status !== 202) { // 預期回傳 202 Accepted
        await handleApiError(response, "線上訂單建立失敗");
    }
    return response.json();
}

/**
 * 【新增】查詢線上訂單 ticket 狀態（只有下單者本人能查）
 * 對應後端: GET /api/v1/online-orders/{ticketId}
 * @returns {Promise<{ticketId:string, status:'QUEUED'|'CREATED'|'FAILED', orderId:string|null, orderNumber:string|null, orderStatus:string|null, message:string|null}>}
 */
export async function getOnlineOrderTicket(ticketId) {
    const response = await fetchWithAuth(`/api/v1/online-orders/${seg(ticketId)}`, {
        method: "GET",
    });

    if (!response.ok) {
        await handleApiError(response, "查詢訂單進度失敗");
    }
    return response.json();
}

/**
 * 執行 POS 現場「一步到位」結帳
 * (對應 OrderController @PostMapping("/pos-checkout"))
 * @param {object} checkoutData - 包含 items, memberId, pointsToUse, paymentMethod 的 DTO
 * @param {string} [idempotencyKey] - 冪等鍵；網路失敗重試時務必沿用同一個，避免重複扣款／扣點
 */
export async function posCheckoutComplete(checkoutData, idempotencyKey) {
    const response = await fetchWithAuth("/api/v1/orders/pos-checkout", {
        method: "POST",
        headers: idempotencyHeaders(idempotencyKey),
        body: JSON.stringify(checkoutData),
    });

    if (!response.ok) {
        await handleApiError(response, "結帳失敗");
    }
    return response.json();
}
/**
 * 取得單一訂單的詳細資料
 * (對應 OrderController GET /api/v1/orders/{orderId})
 * @param {string} orderId 訂單 ID
 */
export async function getOrderDetails(orderId) {
    const response = await fetchWithAuth(`/api/v1/orders/${seg(orderId)}`, {
        method: "GET",
    });

    if (!response.ok) {
        await handleApiError(response, "取得訂單詳情失敗");
    }
    return response.json();
}

/**
 * 根據手機號碼查詢會員
 * (對應 UserController GET /api/v1/users/member/by-phone/{phone})
 * @param {string} phone 會員手機
 */
export async function findMemberByPhone(phone) {
    const response = await fetchWithAuth(`/api/v1/users/member/by-phone/${seg(phone)}`, {
        method: "GET",
    });

    if (response.status === 404) {
        // 404 不是伺服器錯誤，是「查無此人」，回傳 null
        return null;
    }

    if (!response.ok) {
        await handleApiError(response, "查詢會員失敗");
    }
    return response.json();
}

/**
 * 根據狀態查詢訂單列表
 * (對應 OrderController GET /api/v1/orders?storeId=...&status=...)
 * @param {string} storeId
 * @param {string} status (e.g., "AWAITING_ACCEPTANCE", "PREPARING", "READY_FOR_PICKUP")
 */
export async function getOrdersByStatus(storeId, status) {
    // 【修改】改用 URLSearchParams 自動編碼查詢參數
    const params = new URLSearchParams({ storeId: String(storeId), status });
    const response = await fetchWithAuth(
        `/api/v1/orders?${params}`,
        { method: "GET" }
    );
    if (!response.ok) {
        await handleApiError(response, `取得 ${status} 訂單失敗`);
    }
    return response.json();
}

/**
 * 更新訂單狀態
 * (對應 OrderController PATCH /api/v1/orders/{orderId}/status)
 * @param {string} orderId
 * @param {string} newStatus (e.g., "READY_FOR_PICKUP", "CLOSED")
 */
export async function updateOrderStatus(orderId, newStatus) {
    const response = await fetchWithAuth(
        `/api/v1/orders/${seg(orderId)}/status`,
        {
            method: "PATCH",
            body: JSON.stringify({ status: newStatus }),
        }
    );
    if (!response.ok) {
        await handleApiError(response, `更新訂單狀態為 ${newStatus} 失敗`);
    }
    return readJsonBody(response);
}

/**
 * 取得品牌下所有分店
 * (對應 StoreController GET /api/v1/stores)
 */
export async function getStores() {
    const response = await fetchWithAuth("/api/v1/stores", {
        method: "GET",
    });
    if (!response.ok) {
        throw new Error("取得分店列表失敗");
    }
    return response.json();
}

/**
 * 取得分店日結統計 (折線圖資料)
 */
export async function getStoreDailyStats(storeId, startDate, endDate) {
    const params = new URLSearchParams({
        storeId: String(storeId),
        startDate,
        endDate
    });
    const response = await fetchWithAuth(`/api/v1/reports/store-daily?${params}`, {
        method: "GET"
    });
    if (!response.ok) await handleApiError(response, "取得營收統計失敗");
    return response.json();
}

/**
 * 取得熱銷商品排行 (長條圖資料)
 */
export async function getProductSalesRanking(storeId, startDate, endDate) {
    const params = new URLSearchParams({
        storeId: String(storeId),
        startDate,
        endDate
    });
    const response = await fetchWithAuth(`/api/v1/reports/product-sales?${params}`, {
        method: "GET"
    });
    if (!response.ok) await handleApiError(response, "取得商品排行失敗");
    return response.json();
}

/**
 * 取得品牌總覽 (KPI 卡片資料) - 僅品牌管理員
 */
export async function getBrandSummary(startDate, endDate) {
    const params = new URLSearchParams({ startDate, endDate });
    const response = await fetchWithAuth(`/api/v1/reports/brand-summary?${params}`, {
        method: "GET"
    });
    if (!response.ok) await handleApiError(response, "取得品牌總覽失敗");
    return response.json();
}

/**
 * 取得分店排行 (長條圖資料) - 僅品牌管理員
 */
export async function getStoreRanking(startDate, endDate) {
    const params = new URLSearchParams({ startDate, endDate });
    const response = await fetchWithAuth(`/api/v1/reports/store-ranking?${params}`, {
        method: "GET"
    });
    if (!response.ok) await handleApiError(response, "取得分店排行失敗");
    return response.json();
}

// ==========================================
// 📦 庫存管理相關 API (Inventory)
// ==========================================

/**
 * 取得當前使用者所屬分店的庫存清單
 * 對應後端: GET /api/v1/inventory/audit-list (自動識別 Store)
 */
export async function getInventoryItems() {
    // 不需要再傳 storeId，後端會自己查
    const response = await fetchWithAuth(`/api/v1/inventory/audit-list`, {
        method: "GET",
    });

    if (!response.ok) {
        await handleApiError(response, "無法取得庫存列表");
    }
    return response.json();
}

/**
 * 提交盤點結果
 * 對應後端: POST /api/v1/inventory/audit (自動識別 Store)
 * 【修改】與其他 helper 一致：失敗時內部拋出錯誤、成功回傳解析後的 body（可能為 null），
 * 不再回傳原始 Response 讓呼叫端自己檢查 .ok
 */
export async function submitInventoryAudit(data) {
    const response = await fetchWithAuth('/api/v1/inventory/audit', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        await handleApiError(response, "盤點提交失敗");
    }
    return readJsonBody(response);
}

/**
 * 提交進貨單
 * 對應後端: POST /api/v1/inventory/shipments
 * DTO: AddShipmentRequestDto
 */
export async function submitShipment(data) {
    const response = await fetchWithAuth('/api/v1/inventory/shipments', {
        method: 'POST',
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        await handleApiError(response, "進貨提交失敗");
    }
    return readJsonBody(response);
}
