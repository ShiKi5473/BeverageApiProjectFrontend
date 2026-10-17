import logger from './utils/logger.js';
import {createNavbar} from './components/Navbar.js';
import { getInventoryItems, submitInventoryAudit, submitShipment } from './api.js';
// 【修改】匯入具名常數，取代魔術數字
import { INVENTORY_VARIANCE_THRESHOLD } from './constants.js';
// 【新增】XSS 防護用的跳脫工具、統一登出、顯示名稱、本地日期格式化
import { escapeHtml } from './utils/escapeHtml.js';
import { logout, getDisplayName } from './auth.js';
import { formatLocalDate } from './utils/format.js';

// --- 全域變數 ---
let currentInventoryItems = []; // 暫存庫存資料，避免重複 Fetch
let isAuditMode = false;        // 標記當前模式

// --- 初始化 ---
document.addEventListener('DOMContentLoaded', async () => {
    initNavbar();
    initStaffInfo();

    // 1. 初始載入 (預設為瀏覽模式)
    await loadInventoryData();

    // 2. 綁定按鈕事件
    bindEvents();
});

function bindEvents() {
    // --- Toolbar 按鈕 ---
    const btnShipment = document.getElementById('btn-open-shipment');
    const btnStartAudit = document.getElementById('btn-start-audit');

    if (btnShipment) btnShipment.addEventListener('click', openShipmentModal);
    if (btnStartAudit) btnStartAudit.addEventListener('click', startAuditMode);

    // --- 進貨 Modal 相關 ---
    const modal = document.getElementById('shipment-modal');
    const closeBtns = document.querySelectorAll('.close-modal, .close-modal-btn');
    const shipmentForm = document.getElementById('shipment-form');

    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => modal.classList.add('hidden'));
    });

    // 點擊 Modal 外部關閉
    window.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    // 提交進貨表單
    if (shipmentForm) shipmentForm.addEventListener('submit', handleShipmentSubmit);

    // --- 盤點 Footer 按鈕 ---
    const btnSubmitAudit = document.getElementById('btn-submit');
    // 綁定退出按鈕
    const btnCancelAudit = document.getElementById('btn-cancel-audit');

    if (btnSubmitAudit) btnSubmitAudit.addEventListener('click', submitAudit);
    if (btnCancelAudit) btnCancelAudit.addEventListener('click', exitAuditMode);
}

/**
 * 載入庫存資料 (Fetch Data)
 */
async function loadInventoryData() {
    const loadingIndicator = document.getElementById('loading-indicator');
    const listContainer = document.getElementById('audit-list');

    if (loadingIndicator) loadingIndicator.style.display = 'block';
    if (listContainer) listContainer.textContent = '';

    try {
        // 呼叫 API 取得最新庫存
        currentInventoryItems = await getInventoryItems();

        if (!currentInventoryItems || currentInventoryItems.length === 0) {
            document.getElementById('empty-state').style.display = 'block';
            return;
        } else {
            document.getElementById('empty-state').style.display = 'none';
        }

        // 根據目前模式渲染畫面
        renderInventoryList();

    } catch (error) {
        logger.error('載入庫存失敗:', error);
        alert('無法讀取庫存列表，請檢查網路或重新登入。');
    } finally {
        if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
}

/**
 * 渲染列表 (View Mode vs Audit Mode)
 */
function renderInventoryList() {
    const listContainer = document.getElementById('audit-list');
    listContainer.textContent = ''; // 清空

    currentInventoryItems.forEach(item => {
        let row;
        if (isAuditMode) {
            // 盤點模式：顯示輸入框
            row = createAuditRow(item);
        } else {
            // 瀏覽模式：顯示純文字卡片
            row = createViewRow(item);
        }
        listContainer.appendChild(row);
    });

    // 如果是盤點模式，更新進度條
    if (isAuditMode) updateProgress();
}

/**
 * [UI] 建立瀏覽模式的單行 (唯讀)
 */
function createViewRow(item) {
    const div = document.createElement('div');
    div.className = 'audit-item view-mode-item';
    // 【修改】XSS 防護：品項名稱／單位／數量都來自後端資料，插入 innerHTML 前一律跳脫
    div.innerHTML = `
        <div class="item-info">
            <span class="item-name">${escapeHtml(item.name)}</span>
            <span class="item-unit">${escapeHtml(item.unit)}</span>
        </div>
        <div class="data-col right-align">
            <span class="col-label">目前數量</span>
            <div class="system-stock large-text">${escapeHtml(item.quantity)}</div>
        </div>
        <div class="data-col mobile-hide">
            </div>
    `;
    return div;
}


/**
 * 建立單一盤點列 (DOM 操作)
 */
function createAuditRow(item) {
    const div = document.createElement('div');
    div.className = 'audit-item';
    div.dataset.id = String(item.id); // 綁定 ID 方便提交時抓取（ID 為字串，不轉 Number）
    div.dataset.systemQty = item.quantity;

    // 【修改】XSS 防護：動態值一律 escapeHtml；
    // 同時移除行內事件屬性 onfocus="this.select()"（CSP script-src 'self' 不允許行內事件處理器），改在下方用 addEventListener
    div.innerHTML = `
        <div class="item-info">
            <span class="item-name">${escapeHtml(item.name)}</span>
            <span class="item-unit">${escapeHtml(item.unit)}</span>
        </div>
        
        <div class="data-col">
            <span class="col-label">系統庫存</span>
            <div class="system-stock">${escapeHtml(item.quantity)}</div>
        </div>

        <div class="data-col">
            <span class="col-label">實際盤點</span>
            <input type="number" class="audit-input" 
                   value="${escapeHtml(item.quantity)}" 
                   inputmode="decimal">
            
            <input type="date" class="audit-expiry-input" 
                   title="若知曉效期請填寫，以利系統建立批次">

            <div class="warning-msg" style="display:none;"></div>
        </div>

        <div class="data-col">
            <span class="col-label">差異</span>
            <div class="variance-display variance-zero">0</div>
        </div>
    `;

    // 綁定輸入事件: 計算差異
    const input = div.querySelector('.audit-input');
    const expiryInput = div.querySelector('.audit-expiry-input');
    const varianceDisplay = div.querySelector('.variance-display');
    const warningMsg = div.querySelector('.warning-msg');

    // 取代原本的行內 onfocus：聚焦時全選，方便直接輸入新數量
    input.addEventListener('focus', () => input.select());

    input.addEventListener('input', () => {
        const actual = parseFloat(input.value) || 0;
        const system = parseFloat(item.quantity);
        if (isNaN(actual)) {
            varianceDisplay.textContent = '-';
            warningMsg.style.display = 'none';
            expiryInput.style.display = 'none';
            return;
        }
        const diff = actual - system;

        // 更新差異數字與顏色
        varianceDisplay.textContent = diff > 0 ? `+${diff}` : diff;
        varianceDisplay.className = 'variance-display';
        warningMsg.style.display = 'none';
        expiryInput.style.display = 'none';
        if (diff > 0) {
            // --- 🔥 盤盈 (變多) ---
            varianceDisplay.classList.add('variance-positive');

            // 1. 顯示效期輸入框
            expiryInput.style.display = 'block';

            // 2. 顯示警示/提示訊息
            warningMsg.style.display = 'block';
            if (diff > INVENTORY_VARIANCE_THRESHOLD) {
                warningMsg.textContent = "⚠️ 數量增加較多，請確認是否為進貨？(選填效期)";
            } else {
                warningMsg.textContent = "ℹ️ 庫存回補：建議填寫效期，若不填則由系統推斷。";
            }

        } else if (diff < 0) {
            // --- 💧 盤損 (變少) ---
            varianceDisplay.classList.add('variance-negative');
            // 盤損不需要填效期 (FIFO 自動扣)
        } else {
            varianceDisplay.classList.add('variance-zero');
        }

        updateProgress();
    });

    return div;
}


// ==========================================
// 邏輯控制 - 盤點模式
// ==========================================

function startAuditMode() {
    if (!confirm("確定要開始盤點嗎？\n這將進入盤點模式，您可以調整所有品項的數量。")) return;

    isAuditMode = true;

    // 1. 隱藏上方 Toolbar
    const toolbar = document.querySelector('.inventory-toolbar');
    if (toolbar) toolbar.style.display = 'none';

    // 2. 顯示底部 Footer
    const footer = document.getElementById('audit-footer');
    if (footer) {
        footer.style.display = 'flex';
        footer.classList.remove('hidden');
    }

    // 3. 啟用提交按鈕
    document.getElementById('btn-submit').disabled = false;

    // 4. 重新渲染列表為輸入框
    renderInventoryList();

    // 5. 滾動到頂部
    window.scrollTo({top: 0, behavior: 'smooth'});
}

/**
 * 退出盤點模式
 */
function exitAuditMode() {
    // 為了防止誤觸，加入確認對話框
    if (!confirm("確定要退出盤點模式嗎？\n未提交的盤點數據將會遺失。")) return;

    isAuditMode = false;

    // 1. 顯示 Toolbar
    const toolbar = document.querySelector('.inventory-toolbar');
    if (toolbar) toolbar.style.display = 'flex'; // 或 block，視你的 CSS 而定

    // 2. 隱藏 Footer
    const footer = document.getElementById('audit-footer');
    if (footer) {
        footer.classList.add('hidden');
        footer.style.display = 'none';
    }

    // 3. 重新渲染回瀏覽模式 (會讀取原本的 currentInventoryItems，所以輸入的數字會被重置)
    renderInventoryList();
}

/**
 * 提交盤點資料
 */
async function submitAudit() {
    const btn = document.getElementById('btn-submit');
    const rows = document.querySelectorAll('.audit-item');
    const auditData = [];

    // 收集資料
    rows.forEach(row => {
        const id = row.dataset.id;
        const systemQty = parseFloat(row.dataset.systemQty);

        const inputVal = row.querySelector('.audit-input').value;
        const actualQty = parseFloat(inputVal);

        // 取得效期輸入框的值
        const expiryVal = row.querySelector('.audit-expiry-input').value;

        if (isNaN(actualQty)) return;

        const diff = actualQty - systemQty;

        // 構建 DTO Item
        const itemPayload = {
            inventoryItemId: id,
            actualQuantity: actualQty,
            itemNote: ""
        };

        if (diff > 0 && expiryVal) {
            itemPayload.gainedItemExpiryDate = expiryVal;
        }

        auditData.push(itemPayload);

    });
    if (auditData.length === 0) return;

    if (!confirm(`確認提交共 ${auditData.length} 筆盤點資料？`)) return;

    try {
        btn.disabled = true;
        btn.textContent = '提交中...';

        const requestPayload = {
            note: "日常盤點 (Web)",
            items: auditData
        };

        // 呼叫後端 API
        // 【修改】api.js 的 submitInventoryAudit 失敗時自己拋出錯誤、成功回傳解析後的 body（可能為 null），
        // 不再回傳 Response；原本的 response.ok 檢查在 body 為 null 時會拋 TypeError，已移除
        await submitInventoryAudit(requestPayload);
        alert('✅ 盤點完成！庫存已更新。');
        window.location.reload(); // 重新整理

    } catch (error) {
        logger.error('提交失敗', error);
        alert(`提交失敗: ${error.message}`);
        btn.disabled = false;
        btn.textContent = '提交盤點報告 (Submit)';
    }
}

// ==========================================
// 邏輯控制 - 進貨模式 (新增功能)
// ==========================================

async function openShipmentModal() {
    const modal = document.getElementById('shipment-modal');
    const select = document.getElementById('shipment-item');

    // 清空舊表單
    document.getElementById('shipment-form').reset();

    // 顯示 Modal
    modal.classList.remove('hidden');

    // 填充下拉選單 (如果還沒填過)
    if (select.options.length <= 1) {
        // 如果 currentInventoryItems 已經有資料，直接用，不用再 call API
        if (!currentInventoryItems || currentInventoryItems.length === 0) {
            currentInventoryItems = await getInventoryItems();
        }

        // 重新填充
        // 【修改】改用 DOM API 建立選項（textContent），不用 innerHTML
        select.textContent = '';
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = '請選擇品項...';
        select.appendChild(placeholderOption);
        currentInventoryItems.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            // 顯示 名稱 + (目前庫存) 方便參考
            option.textContent = `${item.name} (庫存: ${item.quantity} ${item.unit})`;
            select.appendChild(option);
        });
    }
}

async function handleShipmentSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');

    // 收集資料
    const supplier = document.getElementById('shipment-supplier').value;
    const invoiceNo = document.getElementById('shipment-invoice').value;
    const itemId = document.getElementById('shipment-item').value;
    // 【修改】後端進貨數量是 BigDecimal，用 parseFloat 保留小數（原本 parseInt 會截斷小數）
    const quantity = parseFloat(document.getElementById('shipment-quantity').value);
    // 【修改】成本欄位（shipment-cost）目前後端 AddShipmentRequestDto 沒有對應欄位，先不讀取以免產生未使用變數
    const expiryDate = document.getElementById('shipment-expiry').value;

    // 【修改】輸入空白時 quantity 為 NaN，NaN <= 0 為 false 會被放行；改成「必須大於 0」才通過
    if (!itemId || !(quantity > 0)) {
        alert("請選擇品項並輸入正確數量");
        return;
    }
    // 【修改】有效期限為後端必填欄位（批次表 expiry_date NOT NULL），未填時直接提示，不送出請求
    if (!expiryDate) {
        alert("請輸入有效期限");
        return;
    }

    const payload = {
        supplier: supplier,   // String
        invoiceNo: invoiceNo, // String
        notes: "Web 進貨",    // 可選
        items: [              // List<BatchItemDto>
            {
                inventoryItemId: itemId,
                quantity: quantity,
                // cost: cost, // 注意：目前的後端 DTO 似乎沒有接收 cost 欄位，但可保留在前端
                expiryDate: expiryDate
            }
        ]
    };

    try {
        btn.disabled = true;
        btn.textContent = '處理中...';

        // Change 2: 這裡改用封裝後的函式，不再直接依賴 api.post
        await submitShipment(payload);

        alert('🚚 進貨成功！');
        document.getElementById('shipment-modal').classList.add('hidden');

        // 重新載入庫存列表 (View Mode)
        await loadInventoryData();

    } catch (error) {
        logger.error(error);
        alert('進貨失敗: ' + (error.message || '未知錯誤'));
    } finally {
        btn.disabled = false;
        btn.textContent = '確認進貨';
    }
}

// ==========================================
// 輔助函式
// ==========================================

function initNavbar() {
    const navbarRoot = document.getElementById('navbar-root');
    if (!navbarRoot) return;
    // 【修改】確認後統一呼叫 auth.logout()（原本只清 token / brandId，漏清 storeId 與角色）
    const handleLogout = () => {
        if (confirm("確定要登出嗎？")) {
            logout();
        }
    };
    const headerElement = createNavbar("庫存管理系統", handleLogout);
    navbarRoot.textContent = '';
    navbarRoot.appendChild(headerElement);
}

function initStaffInfo() {
    // 【修改】toISOString() 以 UTC 計算，台灣早上 8 點前會顯示成昨天；改用本地日期
    const today = formatLocalDate(new Date());
    document.getElementById('audit-date').textContent = today;
    // 【修改】優先顯示登入時記錄的名稱；沒有時才解析 JWT payload（JWT 是 base64url，需先轉成標準 base64，且要處理中文 UTF-8）
    const staffNameEl = document.getElementById('staff-name');
    const savedName = getDisplayName();
    if (savedName) {
        staffNameEl.textContent = savedName;
        return;
    }
    const token = localStorage.getItem('accessToken');
    if (token) {
        try {
            const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
            const payload = JSON.parse(new TextDecoder().decode(bytes));
            staffNameEl.textContent = payload.name || payload.sub || '店員';
        } catch (e) { /* ignore */
        }
    }
}

function updateProgress() {
    // 只有在 Audit Mode 下才需要更新進度條
    if (!isAuditMode) return;
    const total = document.querySelectorAll('.audit-item').length;
    document.getElementById('progress-count').textContent = `${total} 項`;
}
