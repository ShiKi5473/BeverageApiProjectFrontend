import logger from './utils/logger.js';
import '@material/web/textfield/filled-text-field.js';
import '@material/web/button/filled-button.js';
import { login } from './api.js';         // 引入 API 方法
import { setAuthSession, clearAuthSession } from './auth.js'; // 引入 Session 管理

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("login-form");
    const errorMessage = document.getElementById("error-message");

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorMessage.textContent = "";

        // 【修改】brandId 一律當字串處理（TSID 超過 JS 安全整數範圍，parseInt 會四捨五入造成登入失敗）
        const brandId = String(document.getElementById("brandId").value ?? "").trim();
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;

        // 只做格式檢查（純數字字串），不轉成 Number
        if (!/^\d+$/.test(brandId)) {
            errorMessage.textContent = "品牌 ID 必須是數字";
            return;
        }

        const loginData = {
            brandId: brandId,
            username: username,
            password: password,
        };

        try {
            // 1. 呼叫 api.js 的 login 方法
            const data = await login(loginData);

            // 2. 登入成功，呼叫 auth.js 儲存 Token
            // 【新增】先清掉前一個帳號殘留的工作階段（角色、storeId 等），再寫入新的
            clearAuthSession();
            // storeId 由後端以字串回傳（可能為 null），auth.js 以字串保存
            setAuthSession(data, username, brandId);

            // 3. 處理頁面跳轉邏輯 (View Logic)
            const userRole = data.role;

            if (userRole === "ROLE_BRAND_ADMIN") {
                alert("品牌管理員登入成功。\n即將進入報表頁面。");
                window.location.href = "report.html";

            } else if (userRole === "ROLE_MEMBER") {
                alert("會員登入成功。");
                // window.location.href = "member.html";

            } else {
                // 店長或店員
                if (data.storeId) {
                    window.location.href = "pos.html";
                } else {
                    logger.error("員工帳號異常：無分店綁定");
                    clearAuthSession(); // 【新增】不保留無法使用的工作階段
                    errorMessage.textContent = "帳號設定異常，請聯繫管理員";
                }
            }

        } catch (error) {
            // 4. 處理錯誤顯示
            logger.error("登入錯誤:", error);
            errorMessage.textContent = error.message || "無法連線至伺服器";
        }
    });
});
