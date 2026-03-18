// 檔案：js/utils/apiError.js
// 統一 API 錯誤處理，解決各處 .text() 與 .json() 解析方式不一致的問題

/**
 * 統一處理 API 回應錯誤
 * 自動根據 Content-Type 判斷使用 .json() 或 .text() 解析錯誤內容
 * @param {Response} response - Fetch API 回應物件
 * @param {string} defaultMessage - 預設錯誤訊息（當無法解析回應時使用）
 * @returns {Promise<never>} 永遠拋出 Error
 */
export async function handleApiError(response, defaultMessage = '請求失敗') {
    let errorMessage = defaultMessage;
    try {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            // 後端回傳 JSON 格式錯誤（例如 { message: "..." }）
            const errorBody = await response.json();
            errorMessage = errorBody.message || errorBody.error || JSON.stringify(errorBody);
        } else {
            // 後端回傳純文字錯誤
            const errorText = await response.text();
            if (errorText) errorMessage = errorText;
        }
    } catch (e) {
        // 解析失敗時使用預設訊息，不中斷流程
    }
    throw new Error(errorMessage);
}
