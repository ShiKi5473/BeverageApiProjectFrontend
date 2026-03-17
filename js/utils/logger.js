// 檔案：frontend/js/utils/logger.js

/**
 * 前端日誌封裝工具
 * 統一管理日誌輸出，可在生產環境中輕易關閉或切換輸出目標
 */

// 可透過環境變數或設定來控制是否啟用日誌
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const logger = {
    info: (...args) => {
        if (isDevelopment) {
            console.log('[INFO]', ...args);
        }
    },
    warn: (...args) => {
        if (isDevelopment) {
            console.warn('[WARN]', ...args);
        }
    },
    error: (...args) => {
        // 錯誤日誌通常即使在生產環境也保留，或者發送到遠端監控系統
        console.error('[ERROR]', ...args);
    },
    debug: (...args) => {
        if (isDevelopment) {
            console.debug('[DEBUG]', ...args);
        }
    }
};

export default logger;
