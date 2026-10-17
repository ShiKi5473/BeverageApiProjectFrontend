import logger from './utils/logger.js';
// frontend/js/report.js
import * as echarts from 'echarts';
import '@material/web/button/filled-button.js';
import { createNavbar } from "./components/Navbar.js";
// 【修改】統一登出、取得分店 ID（字串）
import { logout, getStoreId } from './auth.js';
// 【新增】null 安全的千分位格式化、以「本地時區」輸出日期的工具、數字轉換
import { formatNumber, formatLocalDate } from './utils/format.js';
import { toNumber } from './utils/pricing.js';
import {
    getStores,
    getStoreDailyStats,
    getProductSalesRanking,
    getBrandSummary,
    getStoreRanking
} from "./api.js";

// 狀態變數
let revenueChartInstance = null;
let rankingChartInstance = null;

document.addEventListener("DOMContentLoaded", async () => {
    // 1. 初始化 Navbar
    // 【修改】登出統一使用 auth.logout()（原本各頁自己 removeItem，且漏清角色／顯示名稱）
    const navbar = createNavbar("營收報表中心", logout);
    document.getElementById("navbar-placeholder").replaceWith(navbar);

    // 2. 初始化日期 (過去 7 天)
    const endDateInput = document.getElementById("end-date");
    const startDateInput = document.getElementById("start-date");
    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 6);
    // 【修改】valueAsDate 以 UTC 計算，台灣早上 8 點前會差一天；
    // 改用本地時區輸出 YYYY-MM-DD 字串並寫入 value
    endDateInput.value = formatLocalDate(today);
    startDateInput.value = formatLocalDate(lastWeek);

    // 3. 初始化圖表
    initCharts();

    // 4. 初始化分店選單 & 權限判斷
    const storeSelect = document.getElementById("store-select");
    const storeSelectGroup = document.getElementById("store-selector-group");
    // 【修改】改用 auth.getStoreId()；分店 ID 是字串，不轉 Number
    const myStoreId = getStoreId();

    if (myStoreId) {
        // 情境 A: 店長/店員 (鎖定分店)
        storeSelectGroup.style.display = "none"; // 隱藏選單
        // 直接載入該店資料
        loadReportData(myStoreId);
    } else {
        // 情境 B: 品牌管理員 (顯示選單)
        storeSelectGroup.style.display = "block";
        try {
            const stores = await getStores();
            // 填充選單
            stores.forEach(store => {
                const option = document.createElement("option");
                option.value = store.storeId;
                option.textContent = store.name;
                storeSelect.appendChild(option);
            });
            // 預設載入 "全品牌" (storeId = "")
            loadReportData("");
        } catch (e) {
            logger.error("無法載入分店列表", e);
            alert("無法載入分店列表");
        }
    }

    // 5. 綁定查詢按鈕
    document.getElementById("search-btn").addEventListener("click", () => {
        const selectedStoreId = myStoreId || storeSelect.value;
        loadReportData(selectedStoreId);
    });

    // 6. RWD
    window.addEventListener("resize", () => {
        revenueChartInstance?.resize();
        rankingChartInstance?.resize();
    });
});

function initCharts() {
    revenueChartInstance = echarts.init(document.getElementById('revenue-chart'));
    rankingChartInstance = echarts.init(document.getElementById('product-chart'));
}

/**
 * 核心資料載入函式
 * @param {string} storeId - 若為空字串，代表查詢「全品牌」
 */
async function loadReportData(storeId) {
    const startDate = document.getElementById("start-date").value;
    const endDate = document.getElementById("end-date").value;

    // 【新增】日期為 YYYY-MM-DD 字串，可直接比較大小；起訖顛倒時提示使用者而不是送出無意義的查詢
    if (!startDate || !endDate || startDate > endDate) {
        alert("請選擇正確的日期區間（開始日期不可晚於結束日期）");
        return;
    }

    revenueChartInstance.showLoading();
    rankingChartInstance.showLoading();

    try {
        if (storeId) {
            // === 單一分店模式 ===
            // 1. 平行撈取資料
            const [dailyStats, productStats] = await Promise.all([
                getStoreDailyStats(storeId, startDate, endDate),
                getProductSalesRanking(storeId, startDate, endDate)
            ]);

            // 2. 更新 KPI 卡片 (前端自行加總)
            updateKpiCardsFromDailyStats(dailyStats);

            // 3. 渲染 折線圖 (營收趨勢)
            const dates = dailyStats.map(s => s.date);
            const revenues = dailyStats.map(s => toNumber(s.finalRevenue));
            renderRevenueChart(dates, revenues, "分店營收趨勢");

            // 4. 渲染 長條圖 (商品排行)
            // 取前 10 名
            const top10 = productStats.slice(0, 10);
            const productNames = top10.map(p => p.productName);
            const sales = top10.map(p => toNumber(p.totalSalesAmount)); // 或 p.totalQuantity 看你想顯示哪個
            renderBarChart(productNames, sales, "熱銷商品排行 (銷售額)", "#28a745");

        } else {
            // === 全品牌模式 (管理員) ===
            // 1. 撈取品牌總覽 & 分店排行
            const [brandSummary, storeRanking] = await Promise.all([
                getBrandSummary(startDate, endDate),
                getStoreRanking(startDate, endDate)
            ]);

            // 2. 更新 KPI 卡片 (直接用後端算好的 Summary)
            updateKpiCardsFromSummary(brandSummary);

            // 3. 渲染 長條圖 (分店排行) -> 顯示在原本的「商品排行」位置
            // 因為沒有每日品牌總營收的 API (只有區間加總)，折線圖暫時清空或顯示提示
            revenueChartInstance.clear();
            revenueChartInstance.setOption({
                title: {
                    text: '全品牌模式下暫不顯示每日趨勢 (請選擇單一分店)',
                    left: 'center', top: 'center',
                    textStyle: { color: '#999', fontSize: 14 }
                }
            });

            // 4. 渲染 分店排行
            // 【修改】後端已提供 storeName；舊資料沒有名稱時才退回顯示店號
            const storeNames = storeRanking.map(s => s.storeName || `店號 ${s.storeId}`);
            const revenues = storeRanking.map(s => toNumber(s.totalRevenue));
            renderBarChart(storeNames, revenues, "分店營收排行", "#17a2b8");
        }

    } catch (error) {
        logger.error("載入報表失敗", error);
        alert(error.message);
    } finally {
        revenueChartInstance.hideLoading();
        rankingChartInstance.hideLoading();
    }
}

// --- 輔助函式：更新 KPI ---

function updateKpiCardsFromDailyStats(stats) {
    let totalRev = 0, totalOrd = 0, cancelled = 0;
    // 【修改】欄位可能為 null（沒有資料的日期），用 toNumber 轉成 0，避免 NaN
    stats.forEach(s => {
        totalRev += toNumber(s.finalRevenue);
        totalOrd += toNumber(s.totalOrders);
        cancelled += toNumber(s.cancelledOrders);
    });
    updateKpiDom(totalRev, totalOrd, cancelled);
}

function updateKpiCardsFromSummary(summary) {
    updateKpiDom(toNumber(summary.finalRevenue), toNumber(summary.totalOrders), toNumber(summary.cancelledOrders));
}

function updateKpiDom(revenue, orders, cancelled) {
    document.getElementById("metric-revenue").textContent = `NT$ ${formatNumber(revenue)}`;
    document.getElementById("metric-orders").textContent = orders;
    document.getElementById("metric-cancelled").textContent = cancelled;

    const aov = orders > 0 ? Math.round(revenue / orders) : 0;
    document.getElementById("metric-aov").textContent = `NT$ ${aov}`;
}

// 【修改】formatNumber 改由 utils/format.js 提供（null 安全，原本 num.toString() 遇到 null 會拋 TypeError）

// --- 圖表渲染 ---

function renderRevenueChart(dates, values, title) {
    revenueChartInstance.setOption({
        title: { text: title, left: 'center' },
        tooltip: { trigger: 'axis' },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'category', data: dates },
        yAxis: { type: 'value' },
        series: [{
            data: values,
            type: 'line',
            smooth: true,
            areaStyle: { opacity: 0.3 },
            itemStyle: { color: '#007bff' }
        }]
    }, true); // true = 不合併舊配置 (徹底重繪)
}

function renderBarChart(labels, values, title, color) {
    rankingChartInstance.setOption({
        title: { text: title, left: 'center' },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: labels, inverse: true },
        series: [{
            type: 'bar',
            data: values,
            itemStyle: { color: color }
        }]
    }, true);
}