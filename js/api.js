import { getAccessToken, logout } from './auth.js';
import logger from './utils/logger.js';

// ==========================================
// 🔐 認證相關 API
// ==========================================

/**
 * 員工/會員登入
 * @param {object} credentials - { username, password, brandId }
 */
export async function login(credentials) {
    const response = await fetch("http://localhost:8080/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
    });

    if (!response.ok) {
        // 嘗試讀取錯誤訊息
        const errorText = await response.text();
        throw new Error(errorText || "登入失敗");
    }
    return response.json();
}

/**
 * 訪客快速登入
 * @param {string} displayName
 */
export async function guestLogin(displayName) {
    const response = await fetch("http://localhost:8080/api/v1/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
    });

    if (!response.ok) {
        throw new Error("訪客登入失敗");
    }
    return response.json();
}


// ==========================================
// 🛠️ 通用 Fetch 工具
// ==========================================

/**
 * 自動帶入 Token 的 Fetch 封裝
 */
async function fetchWithAuth(endpoint, options = {}) {
    const token = getAccessToken(); // 從 auth.js 取得

    const headers = {
        "Content-Type": "application/json",
        ...options.headers,
    };

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    // 處理完整 URL (若 endpoint 不是以 http 開頭，補上 localhost)
    const url = endpoint.startsWith("http") ? endpoint : `http://localhost:8080${endpoint}`;

    try {
        const response = await fetch(url, { ...options, headers });

        if (response.status === 401) {
            logger.warn("Token 失效 (401)，自動登出");
            logout(); // 呼叫 auth.js 的登出
            return;
        }

        return response;
    } catch (error) {
        logger.error("API 請求失敗:", error);
        throw error;
    }
}

/**
 * 取得 POS 商品列表
 * (對應 ProductController [cite: shiki5473/beverageapiproject/BeverageApiProject-frontendPosView/src/main/java/tw/niels/beverage_api_project/modules/product/controller/ProductController.java])
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
 * @param {number} orderId -
 * @param {object} paymentData -
 */
export async function processPayment(orderId, paymentData) {
  const response = await fetchWithAuth(`/api/v1/orders/${orderId}/checkout`, {
    method: "PATCH",
    body: JSON.stringify(paymentData),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`付款失敗: ${errorBody}`);
  }
  return response.json();
}

/**
 * 建立一筆新訂單
 * (對應 OrderController)
 * @param {object} orderData - 包含 storeId 和 items 的訂單資料
 */
export async function createOrder(orderData) {
    // 呼叫後端的 POST /api/v1/orders
    const response = await fetchWithAuth("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify(orderData),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`建立訂單失敗: ${errorBody}`);
    }
    return response.json();
}

/**
 * 建立線上訂單 (非同步)
 * 對應後端: POST /api/v1/online-orders
 */
export async function createOnlineOrder(orderData) {
    const response = await fetchWithAuth("/api/v1/online-orders", {
        method: "POST",
        body: JSON.stringify(orderData),
    });

    if (response.status !== 202) { // 預期回傳 202 Accepted
        const errorBody = await response.text();
        throw new Error(`線上訂單建立失敗: ${errorBody}`);
    }
    return response.json();
}

/**
 * 執行 POS 現場「一步到位」結帳
 * (對應 OrderController @PostMapping("/pos-checkout"))
 * @param {object} checkoutData - 包含 items, memberId, pointsToUse, paymentMethod 的 DTO
 */
export async function posCheckoutComplete(checkoutData) {
    const response = await fetchWithAuth("/api/v1/orders/pos-checkout", {
        method: "POST",
        body: JSON.stringify(checkoutData),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`結帳失敗: ${errorBody}`);
    }
    return response.json();
}
/**
 * 取得單一訂單的詳細資料
 * (對應 OrderController GET /api/v1/orders/{orderId})
 * @param {number} orderId 訂單 ID
 */
export async function getOrderDetails(orderId) {
    const response = await fetchWithAuth(`/api/v1/orders/${orderId}`, {
        method: "GET",
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`取得訂單詳情失敗: ${errorBody}`);
    }
    return response.json();
}

/**
 * 根據手機號碼查詢會員
 * (對應 UserController GET /api/v1/users/member/by-phone/{phone})
 * @param {string} phone 會員手機
 */
export async function findMemberByPhone(phone) {
    const response = await fetchWithAuth(`/api/v1/users/member/by-phone/${phone}`, {
        method: "GET",
    });

    if (response.status === 404) {
        // 404 不是伺服器錯誤，是「查無此人」，回傳 null
        return null;
    }

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`查詢會員失敗: ${errorBody}`);
    }
    return response.json();
}

/**
 * 根據狀態查詢訂單列表
 * (對應 OrderController GET /api/v1/orders?storeId=...&status=...)
 * @param {number} storeId
 * @param {string} status (e.g., "PREPARING", "READY_FOR_PICKUP")
 */
export async function getOrdersByStatus(storeId, status) {
    const response = await fetchWithAuth(
        `/api/v1/orders?storeId=${storeId}&status=${status}`,
        { method: "GET" }
    );
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`取得 ${status} 訂單失敗: ${errorBody}`);
    }
    return response.json();
}

/**
 * 更新訂單狀態
 * (對應 OrderController PATCH /api/v1/orders/{orderId}/status)
 * @param {number} orderId
 * @param {string} newStatus (e.g., "READY_FOR_PICKUP", "CLOSED")
 */
export async function updateOrderStatus(orderId, newStatus) {
    const response = await fetchWithAuth(
        `/api/v1/orders/${orderId}/status`,
        {
            method: "PATCH",
            body: JSON.stringify({ status: newStatus }),
        }
    );
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`更新訂單狀態為 ${newStatus} 失敗: ${errorBody}`);
    }
    return response.json();
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
        storeId,
        startDate,
        endDate
    });
    const response = await fetchWithAuth(`/api/v1/reports/store-daily?${params}`, {
        method: "GET"
    });
    if (!response.ok) throw new Error("取得營收統計失敗");
    return response.json();
}

/**
 * 取得熱銷商品排行 (長條圖資料)
 */
export async function getProductSalesRanking(storeId, startDate, endDate) {
    const params = new URLSearchParams({
        storeId,
        startDate,
        endDate
    });
    const response = await fetchWithAuth(`/api/v1/reports/product-sales?${params}`, {
        method: "GET"
    });
    if (!response.ok) throw new Error("取得商品排行失敗");
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
    if (!response.ok) throw new Error("取得品牌總覽失敗");
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
    if (!response.ok) throw new Error("取得分店排行失敗");
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
        const errText = await response.text();
        throw new Error(errText || "無法取得庫存列表");
    }
    return response.json();
}

/**
 * 提交盤點結果
 * 對應後端: POST /api/v1/inventory/audit (自動識別 Store)
 */
export function submitInventoryAudit(data) {
    return fetchWithAuth('/api/v1/inventory/audit', {
        method: 'POST',
        body: JSON.stringify(data)
    });
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
        const errorText = await response.text();
        throw new Error(errorText || "進貨提交失敗");
    }
    return response.json();
}