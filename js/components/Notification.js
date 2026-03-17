/**
 * Toast 通知組件
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
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let iconName = 'notifications';
        if (type === 'success') iconName = 'check_circle';
        if (type === 'warning') iconName = 'warning';

        toast.innerHTML = `
            <div class="toast-icon">
                <span class="material-symbols-outlined">${iconName}</span>
            </div>
            <div class="toast-content">
                <span class="toast-title">${title}</span>
                <span class="toast-message">${message}</span>
            </div>
            <button class="toast-close">&times;</button>
        `;

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
        toast.querySelector('.toast-close').addEventListener('click', () => {
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
