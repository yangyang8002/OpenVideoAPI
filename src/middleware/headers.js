/* 高级安全头 / CORS 中间件（配置驱动）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    define(ctx) {
        const { readConfig } = ctx;

    /* ── 原 server.js L204-204 ── */
    /* 高级安全头（配置驱动，即时生效） */

    /* ── 原 server.js L205-216 ── */
    function advancedHeaders(req, res, next) {
        const a = (readConfig().security || {}).advanced || {};
        if (a.hidePoweredBy === false) res.setHeader('X-Powered-By', 'Express');
        else res.removeHeader('X-Powered-By');
        if (a.noSniff === false) res.removeHeader('X-Content-Type-Options');
        else res.setHeader('X-Content-Type-Options', 'nosniff');
        if (a.hsts === false) res.removeHeader('Strict-Transport-Security');
        else res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        if (a.referrer) res.setHeader('Referrer-Policy', a.referrer);
        else res.removeHeader('Referrer-Policy');
        next();
    }

    /* ── 原 server.js L223-233 ── */
    function corsMiddleware(req, res, next) {
        const a = (readConfig().security || {}).advanced || {};
        if (a.cors === false) return next();
        res.header('Access-Control-Allow-Origin', a.corsOrigin || '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    }

        Object.assign(ctx, { advancedHeaders, advancedHeaders, corsMiddleware, corsMiddleware });
    },
};
