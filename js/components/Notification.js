/**
 * Toast 通知組件
 * 【修改】XSS 防護：標題與內容改用 textContent（訊息來自伺服器，不可當成 HTML 解析）
 */

export class ToastNotification {
    constructor() {
        this.container = document.querySelector('.notification-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'notification-container';
            document.body.appendChild(this.container);
        }
    }

    /**
     * 顯示 Toast 通知
     * @param {string} title - 標題
     * @param {string} message - 內容文字
     * @param {string} type - 類型: 'info' | 'success' | 'warning'
     * @param {number} duration - 持續時間 (ms)
     */
    show(title, message, type = 'info', duration = 5000) {
        // type 只允許白名單值，避免被拿來注入 class
        const safeType = ['info', 'success', 'warning'].includes(type) ? type : 'info';

        const toast = document.createElement('div');
        toast.className = `toast toast-${safeType}`;

        let iconName = 'notifications';
        if (safeType === 'success') iconName = 'check_circle';
        if (safeType === 'warning') iconName = 'warning';

        // 圖示
        const iconWrap = document.createElement('div');
        iconWrap.className = 'toast-icon';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'material-symbols-outlined';
        iconSpan.textContent = iconName;
        iconWrap.appendChild(iconSpan);

        // 標題與內容
        const content = document.createElement('div');
        content.className = 'toast-content';
        const titleEl = document.createElement('span');
        titleEl.className = 'toast-title';
        titleEl.textContent = title ?? '';
        const messageEl = document.createElement('span');
        messageEl.className = 'toast-message';
        messageEl.textContent = message ?? '';
        content.append(titleEl, messageEl);

        // 關閉按鈕
        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.textContent = '×';

        toast.append(iconWrap, content, closeBtn);

        this.container.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto remove
        const timer = setTimeout(() => {
            this.remove(toast);
        }, duration);

        // Manual close
        closeBtn.addEventListener('click', () => {
            clearTimeout(timer);
            this.remove(toast);
        });

        return toast;
    }

    remove(toast) {
        toast.classList.add('hide');
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => {
            toast.remove();
        }, { once: true });
    }
}

// Global instance
export const toastManager = new ToastNotification();
