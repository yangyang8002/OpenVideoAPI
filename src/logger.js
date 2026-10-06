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
    const debugLogs = [];
    /* 后台任务注册表（依赖更新/插件安装/程序更新/重启）——供顶栏任务列表展示 */
    const updateTasks = [];
    let taskSeq = 1;
    function addUpdateTask(type, name, detail, batch) {
        const t = { id: taskSeq++, type, name, status: 'running', detail: detail || '', batch: batch || '', at: new Date().toISOString() };
        updateTasks.push(t);
        if (updateTasks.length > MAX_LOG) updateTasks.shift();
        return t;
    }
    function finishUpdateTask(id, status, detail) {
        const t = updateTasks.find(x => x.id === id);
        if (t) { t.status = status || 'done'; if (detail) t.detail = detail; t.at = new Date().toISOString(); }
    }

        Object.assign(ctx, { MAX_LOG, MAX_LOG, appLogs, appLogs, debugLogs, debugLogs, updateTasks, updateTasks, addUpdateTask, addUpdateTask, finishUpdateTask, finishUpdateTask });
    },
};
