/* 弹幕发送频控（每 IP 每分钟上限）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    define(ctx) {
        const { readConfig } = ctx;

    /* ── 原 server.js L991-991 ── */
    // ==================== 弹幕API ====================

    /* ── 原 server.js L993-993 ── */
    const danmakuCounters = new Map();

    /* ── 原 server.js L995-1014 ── */
    function checkDanmakuLimit(req, res) {
        const config = readConfig();
        if (!config.danmakuLimit || !config.danmakuLimit.enabled) return true;
        if (req.ipWhitelisted) return true;
        const max = config.danmakuLimit.maxPerMinute || 10;
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        const key = 'dm_' + ip;
        const now = Date.now();
        let entry = danmakuCounters.get(key);
        if (!entry || now > entry.resetAt) {
            danmakuCounters.set(key, { count: 1, resetAt: now + 60000 });
            return true;
        }
        if (entry.count >= max) {
            res.status(429).json({ code: 3, msg: `发送过快，每分钟最多 ${max} 条弹幕` });
            return false;
        }
        entry.count++;
        return true;
    }

        Object.assign(ctx, { danmakuCounters, danmakuCounters, checkDanmakuLimit, checkDanmakuLimit });
    },
};
