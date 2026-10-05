/* 内存日志环形缓冲（管理后台日志查看数据源）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    define(ctx) {

    /* ── 原 server.js L38-38 ── */
    // ==================== 日志（内存环形缓冲） ====================

    /* ── 原 server.js L39-39 ── */
    const MAX_LOG = 500;

    /* ── 原 server.js L40-40 ── */
    const appLogs = [];

        Object.assign(ctx, { MAX_LOG, MAX_LOG, appLogs, appLogs });
    },
};
