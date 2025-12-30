import '@material/web/textfield/filled-text-field.js';
import '@material/web/button/filled-button.js';
import { login } from './api.js';         // 引入 API 方法
import { setAuthSession } from './auth.js'; // 引入 Session 管理

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("login-form");
    const errorMessage = document.getElementById("error-message");

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorMessage.textContent = "";

        const brandId = document.getElementById("brandId").value;
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;

        const loginData = {
            brandId: parseInt(brandId),
            username: username,
            password: password,
        };

        try {
            // 1. 呼叫 api.js 的 login 方法
            const data = await login(loginData);

            // 2. 登入成功，呼叫 auth.js 儲存 Token
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
                    console.error("員工帳號異常：無分店綁定");
                    errorMessage.textContent = "帳號設定異常，請聯繫管理員";
                }
            }

        } catch (error) {
            // 4. 處理錯誤顯示
            console.error("登入錯誤:", error);
            errorMessage.textContent = error.message || "無法連線至伺服器";
        }
    });
});