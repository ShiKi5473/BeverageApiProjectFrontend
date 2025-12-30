import '@material/web/iconbutton/icon-button.js';
import '@material/web/icon/icon.js';
import { logout } from '../auth.js';

/**
 * 建立一個可複用的導覽列元件 (標準 HTML <header> 版本)
 * @param {string} title - 顯示在導覽列上的標題
 * @param {function} onLogout - 點擊登出按鈕時要執行的回呼函式
 * @returns {HTMLElement} - <header> 元素
 */
export function createNavbar(title, onLogout) {
    // 1. 【修改】建立 <header> 容器
    const header = document.createElement("header");
    // 我們借用 kds.css 或 navbar.css 中的樣式
    // 假設 .pos-navbar (from navbar.css) 是我們想要的
    header.className = "pos-navbar";

    // 2. 建立標題
    const h1 = document.createElement("h1");
    h1.textContent = title;
    header.appendChild(h1);

    // 3. 建立登出按鈕 (使用 Icon Button)
    const logoutButton = document.createElement("md-icon-button");
    logoutButton.id = "logout-button";

    // 4. 建立登出圖示
    const icon = document.createElement("md-icon");
    icon.textContent = "logout"; // 使用 Material Symbols 圖示名稱
    logoutButton.appendChild(icon);

    // 5. 綁定事件
    if (onLogout && typeof onLogout === "function") {
        logoutButton.addEventListener("click", onLogout);
    }

    // 6. 附加到 <header>
    header.appendChild(logoutButton);

    return header;
}