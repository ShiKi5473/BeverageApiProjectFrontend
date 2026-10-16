// 檔案：js/utils/orderStatus.js
// 【新增】線上點餐追蹤頁用的訂單狀態對照（純函式）

/**
 * 訂單狀態 -> 追蹤頁顯示文字／圖示／樣式
 * @param {string} status - OrderStatus 或 ticket 狀態
 * @returns {{icon: string, text: string, cssClass: string, terminal: boolean}}
 */
export function describeOrderStatus(status) {
    switch (status) {
        case 'QUEUED':
            return { icon: 'hourglass_top', text: '排隊中，系統正在處理您的訂單', cssClass: '', terminal: false };
        case 'FAILED':
            return { icon: 'error', text: '下單失敗，請重新嘗試', cssClass: 'order-status-failed', terminal: true };
        case 'AWAITING_ACCEPTANCE':
            return { icon: 'receipt', text: '訂單已送出，等待店家接單', cssClass: '', terminal: false };
        case 'PREPARING':
            return { icon: 'local_cafe', text: '商家已接單，飲料製作中', cssClass: 'order-status-preparing', terminal: false };
        case 'READY_FOR_PICKUP':
            return { icon: 'check_circle', text: '製作完成，請取餐！', cssClass: 'order-status-ready', terminal: false };
        case 'CLOSED':
            return { icon: 'done_all', text: '訂單已結案', cssClass: '', terminal: true };
        case 'CANCELLED':
            return { icon: 'cancel', text: '訂單已被取消', cssClass: 'order-status-failed', terminal: true };
        default:
            return { icon: 'hourglass_empty', text: '', cssClass: '', terminal: false };
    }
}
