/* 全局错误处理（统一 JSON 兜底）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    define(ctx) {
        const { readConfig } = ctx;

    /* ── 原 server.js L3923-3924 ── */
    /* 全局错误处理：屏蔽堆栈/路径泄露；透传客户端错误状态（如 body-parser 400）；
       高级设置开启调试模式时返回错误详情 */

    /* ── 原 server.js L3925-3936 ── */
    function errorHandler(err, req, res, next) {
        if (res.headersSent) return next(err);
        const status = err.status || err.statusCode || 500;
        if (status >= 500) {
            console.error('[error]', req.method, req.path, '-', err.message);
            const a = (readConfig().security || {}).advanced || {};
            if (a.debug) return res.status(500).json({ code: 1, msg: '服务器内部错误', detail: String(err.message).slice(0, 300) });
            return res.status(500).json({ code: 1, msg: '服务器内部错误' });
        }
        if (err.type === 'entity.parse.failed') return res.status(400).json({ code: 1, msg: '请求体格式错误（无效 JSON）' });
        res.status(status).json({ code: 1, msg: '请求错误' });
    }

        Object.assign(ctx, { errorHandler, errorHandler });
    },
};
