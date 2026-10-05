/* 请求日志中间件
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    define(ctx) {
        const { appLogs, MAX_LOG } = ctx;

    /* ── 原 server.js L179-194 ── */
    function logRequest(req, res, next) {
        const start = Date.now();
        res.on('finish', () => {
            const entry = {
                t: new Date().toISOString(),
                m: req.method,
                p: req.originalUrl.split('?')[0],
                s: res.statusCode,
                ip: req.ip || req.socket.remoteAddress || '-',
                ms: Date.now() - start
            };
            appLogs.push(entry);
            if (appLogs.length > MAX_LOG) appLogs.shift();
        });
        next();
    }

        Object.assign(ctx, { logRequest, logRequest });
    },
};
