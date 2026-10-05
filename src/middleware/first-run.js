/* 首启初始化拦截中间件（未初始化仅放行登录/初始化/库测试）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    define(ctx) {
        const { readConfig } = ctx;

    /* ── 原 server.js L235-235 ── */
    /* 首次初始化拦截：未完成「修改密码 + 设置安全入口」前，仅允许登录、初始化与数据库连接测试接口（初始化向导「测试连接」需要） */

    /* ── 原 server.js L236-241 ── */
    /* 原挂载：/api/admin */
    function firstRunGuard(req, res, next) {
        const sec = readConfig().security || {};
        if (!sec.firstRun) return next();
        if (req.path === '/login' || req.path === '/init' || req.path === '/db/test') return next();
        return res.status(403).json({ code: 403, msg: '请先完成初始化（修改密码与安全入口）' });
    }

        Object.assign(ctx, { firstRunGuard, firstRunGuard });
    },
};
