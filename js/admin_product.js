import { createNavbar } from './components/Navbar.js';
import { logout } from './auth.js';
import * as API from './api.js';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 1. 渲染 Navbar
    const navbar = createNavbar("商品管理中心", logout);
    document.getElementById("navbar-root").appendChild(navbar);

    // 2. 綁定 Tabs 切換事件
    setupTabs();

    // 3. 綁定按鈕事件
    setupButtons();

    // 4. 預設載入商品列表
    loadProducts();
});

// ===========================
// UI 切換邏輯
// ===========================
function setupTabs() {
    const tabs = document.getElementById('admin-tabs');
    const panels = {
        'tab-products': document.getElementById('panel-products'),
        'tab-categories': document.getElementById('panel-categories'),
        'tab-options': document.getElementById('panel-options')
    };

    tabs.addEventListener('change', (event) => {
        // 隱藏所有 panel
        Object.values(panels).forEach(p => p.style.display = 'none');
        // 顯示選中的 panel
        const selectedId = tabs.activeTab.id;
        if (panels[selectedId]) {
            panels[selectedId].style.display = 'block';
            // 根據 tab 載入對應資料
            if(selectedId === 'tab-products') loadProducts();
            if(selectedId === 'tab-categories') loadCategories();
            if(selectedId === 'tab-options') loadOptionGroups();
        }
    });
}

// ===========================
// 資料載入與渲染
// ===========================

// --- 商品 ---
async function loadProducts() {
    const container = document.getElementById('product-list');
    container.innerHTML = '<p>讀取中...</p>';
    try {
        const products = await API.getProductSummaries();
        container.innerHTML = '';
        products.forEach(p => {
            const card = document.createElement('div');
            card.className = 'card';
            card.innerHTML = `
                <h3>${p.name}</h3>
                <p style="color: #666;">$${p.basePrice}</p>
                <div class="chip-container">
                    ${p.categoryName ? `<md-assist-chip label="${p.categoryName}"></md-assist-chip>` : ''}
                    <md-assist-chip label="${p.status}"></md-assist-chip>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (e) {
        container.innerHTML = `<p class="error">${e.message}</p>`;
    }
}

// --- 分類 ---
async function loadCategories() {
    const list = document.getElementById('category-list');
    list.innerHTML = '';
    try {
        const categories = await API.getCategories();
        categories.forEach(c => {
            const item = document.createElement('md-list-item');
            item.headline = c.name;
            list.appendChild(item);
        });
    } catch (e) {
        console.error(e);
    }
}

// --- 選項群組 ---
async function loadOptionGroups() {
    const container = document.getElementById('option-group-list');
    container.innerHTML = '讀取中...';
    try {
        const groups = await API.getOptionGroups();
        container.innerHTML = '';
        groups.forEach(g => {
            const card = document.createElement('div');
            card.className = 'card';
            // 渲染選項標籤
            const optionsHtml = g.options.map(opt =>
                `<span style="background:#f0f0f0; padding:2px 6px; border-radius:4px; font-size:0.8em; margin-right:4px;">
                    ${opt.name} (+$${opt.priceAdjustment})
                 </span>`
            ).join('');

            card.innerHTML = `
                <div style="display:flex; justify-content:space-between;">
                    <h3>${g.name} <small style="color:#888; font-size:0.6em;">${g.selectionType}</small></h3>
                    <md-icon-button class="btn-add-opt" data-id="${g.groupId}" data-name="${g.name}">
                        <md-icon>add</md-icon>
                    </md-icon-button>
                </div>
                <div style="margin-top:8px;">${optionsHtml}</div>
            `;
            container.appendChild(card);
        });

        // 綁定「新增細項」按鈕
        document.querySelectorAll('.btn-add-opt').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const groupId = btn.dataset.id;
                openAddOptionDialog(groupId);
            });
        });

    } catch (e) {
        console.error(e);
    }
}

// ===========================
// 表單與對話框邏輯
// ===========================

// 重置商品表單的函式
function resetProductForm() {
    // 1. 清空文字欄位
    document.getElementById('input-prod-name').value = '';
    document.getElementById('input-prod-desc').value = '';
    document.getElementById('input-prod-price').value = '';

    // 2. 重置 Checkbox (Chip)
    document.querySelectorAll('md-filter-chip').forEach(chip => {
        chip.selected = false;
    });

    // 3. 重置規格列表 (只保留標題列，移除所有動態新增的列)
    const container = document.getElementById('variant-rows-container');
    container.innerHTML = `
        <div class="variant-row">
            <input type="text" placeholder="規格名 (如: 大杯)" class="var-name" required>
            <input type="number" placeholder="加價" class="var-price" value="0">
            <input type="text" placeholder="SKU Code" class="var-sku">
            <md-icon-button type="button" onclick="this.parentElement.remove()">
                <md-icon>delete</md-icon>
            </md-icon-button>
        </div>
    `;
}

function setupButtons() {
    // 1. 商品相關
    const dialogProd = document.getElementById('dialog-product');

    document.getElementById('btn-add-product').addEventListener('click', async () => {
        resetProductForm(); // 先清空舊資料
        await prepareProductForm(); // 再載入選項
        dialogProd.show();
    });

    // 取消按鈕邏輯
    document.getElementById('btn-cancel-product').addEventListener('click', () => {
        resetProductForm(); // 關閉前清空 (雖然打開時會清，但這裡清是為了保險)
        dialogProd.close();
    });

    document.getElementById('btn-add-product').addEventListener('click', async () => {
        // 開啟前先載入分類與選項群組供選擇
        await prepareProductForm();
        dialogProd.show();
    });

    document.getElementById('btn-submit-product').addEventListener('click', async () => {
        await submitProductForm();
        dialogProd.close();
        loadProducts();
    });

    // 動態新增規格列
    document.getElementById('btn-add-variant-row').addEventListener('click', () => {
        const container = document.getElementById('variant-rows-container');
        const row = document.createElement('div');
        row.className = 'variant-row';
        row.innerHTML = `
            <input type="text" placeholder="規格名" class="var-name" required>
            <input type="number" placeholder="加價" class="var-price" value="0">
            <input type="text" placeholder="SKU" class="var-sku">
            <md-icon-button type="button" onclick="this.parentElement.remove()">
                <md-icon>delete</md-icon>
            </md-icon-button>
        `;
        container.appendChild(row);
    });

    // 2. 分類相關
    const dialogCat = document.getElementById('dialog-category');
    document.getElementById('btn-add-category').addEventListener('click', () => dialogCat.show());
    document.getElementById('btn-submit-category').addEventListener('click', async () => {
        const name = document.getElementById('input-cat-name').value;
        if(name) {
            await API.createCategory({ name, sortOrder: 0 });
            dialogCat.close();
            loadCategories();
        }
    });
    document.getElementById('btn-cancel-category').addEventListener('click', () => dialogCat.close());

    // 3. 選項群組相關
    const dialogOG = document.getElementById('dialog-option-group');
    document.getElementById('btn-add-option-group').addEventListener('click', () => {
        document.getElementById('input-og-name').value = ''; // 重置
        dialogOG.show();
    });
    document.getElementById('btn-submit-option-group').addEventListener('click', async () => {
        const name = document.getElementById('input-og-name').value;
        const type = document.getElementById('input-og-type').value;
        if(name) {
            await API.createOptionGroup({ name, selectionType: type, sortOrder: 0 });
            dialogOG.close();
            loadOptionGroups();
        }
    });
    document.getElementById('btn-cancel-option-group').addEventListener('click', () => dialogOG.close());

    // 4. 新增細項
    const dialogOpt = document.getElementById('dialog-add-option');
    document.getElementById('btn-cancel-option').addEventListener('click', () => dialogOpt.close());
    document.getElementById('btn-submit-option').addEventListener('click', async () => {
        const groupId = document.getElementById('input-target-group-id').value;
        const name = document.getElementById('input-opt-name').value;
        const price = document.getElementById('input-opt-price').value;
        if(name && groupId) {
            await API.createProductOption(groupId, { name, priceAdjustment: parseFloat(price) });
            dialogOpt.close();
            loadOptionGroups();
        }
    });
}

function openAddOptionDialog(groupId) {
    document.getElementById('input-target-group-id').value = groupId;
    document.getElementById('input-opt-name').value = '';
    document.getElementById('input-opt-price').value = '0';
    document.getElementById('dialog-add-option').show();
}

// 準備商品表單：載入 Checkbox 資料
async function prepareProductForm() {
    const [cats, groups] = await Promise.all([API.getCategories(), API.getOptionGroups()]);

    // 渲染分類 Checkbox (使用 md-filter-chip 作為多選)
    const catContainer = document.getElementById('check-list-categories');
    catContainer.innerHTML = cats.map(c => `
        <md-filter-chip label="${c.name}" data-value="${c.categoryId}" class="cat-chip"></md-filter-chip>
    `).join('');

    // 渲染選項群組 Checkbox
    const grpContainer = document.getElementById('check-list-options');
    grpContainer.innerHTML = groups.map(g => `
        <md-filter-chip label="${g.name}" data-value="${g.groupId}" class="grp-chip"></md-filter-chip>
    `).join('');

    // 切換 Chip 選取狀態的簡單邏輯
    document.querySelectorAll('md-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => chip.selected = !chip.selected);
    });
}

// 提交商品表單
async function submitProductForm() {
    const name = document.getElementById('input-prod-name').value;
    const description = document.getElementById('input-prod-desc').value;
    const basePrice = parseFloat(document.getElementById('input-prod-price').value);

    // 收集分類 IDs
    const categoryIds = Array.from(document.querySelectorAll('.cat-chip'))
        .filter(chip => chip.selected)
        .map(chip => parseInt(chip.dataset.value));

    // 收集選項群組 IDs
    const optionGroupIds = Array.from(document.querySelectorAll('.grp-chip'))
        .filter(chip => chip.selected)
        .map(chip => parseInt(chip.dataset.value));

    // 收集規格 (Variants)
    const variants = [];
    document.querySelectorAll('#variant-rows-container .variant-row').forEach(row => {
        const vName = row.querySelector('.var-name').value;
        const vPrice = row.querySelector('.var-price').value || 0;
        const vSku = row.querySelector('.var-sku').value;
        if (vName) {
            variants.push({
                name: vName,
                priceAdjustment: parseFloat(vPrice),
                skuCode: vSku
            });
        }
    });

    // 若沒填規格，至少給一個預設規格 (通常後端會有檢核，或是由後端自動產生預設)
    if(variants.length === 0) {
        variants.push({ name: "標準", priceAdjustment: 0, skuCode: "" });
    }

    const payload = {
        name,
        description,
        basePrice,
        imageUrl: "", // 暫時留空
        status: "ACTIVE",
        categoryIds,
        optionGroupIds,
        variants
    };

    console.log("Submit Payload:", payload);

    try {
        await API.createProduct(payload);
        alert("商品建立成功！");
    } catch (e) {
        alert("錯誤: " + e.message);
    }
}