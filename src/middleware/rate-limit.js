/* 速率限制（API 限流器 + 写接口每 IP 限速）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const { ipKeyGenerator } = require('express-rate-limit');
const rateLimit = require('express-rate-limit');

module.exports = {
    define(ctx) {
        const { readConfig } = ctx;

    /* ── 原 server.js L348-348 ── */
    // ==================== 速率限制 ====================

    /* ── 原 server.js L349-361 ── */
    function getApiLimiter() {
        const config = readConfig();
        if (!config.rateLimit || !config.rateLimit.enabled) return (req, res, next) => next();
        return rateLimit({
            windowMs: config.rateLimit.windowMs || 60000,
            max: config.rateLimit.max || 60,
            standardHeaders: true,
            legacyHeaders: false,
            keyGenerator: safeRateKey,
            skip: (req) => req.ipWhitelisted,
            handler: (req, res) => res.status(429).json({ code: 429, msg: '请求过于频繁,请稍后再试' })
        });
    }

    /* ── 原 server.js L1223-1223 ── */
    /* 未授权写接口的每 IP 限速（防刷盘/刷映射） */

    /* ── 原 server.js L1224-1224 ── */
    const writeLimiterBuckets = new Map();

    /* ── 原 server.js L1225-1236 ── */
    function writeRateLimit(max, windowMs) {
        return (req, res, next) => {
            const ip = req.clientIp || req.ip || 'unknown';
            /* 本机自调用（插件后台任务等）放行：trust proxy 默认 'loopback'（仅信任同主机代理），
             * 外部客户端无法让 req.ip 解析成回环地址，此放行不会解除真实访客的限速 */
            if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return next();
            const now = Date.now();
            let arr = writeLimiterBuckets.get(ip);
            if (!arr) { arr = []; writeLimiterBuckets.set(ip, arr); }
            while (arr.length && arr[0] < now - windowMs) arr.shift();
            if (arr.length >= max) return res.status(429).json({ code: 429, msg: '操作过于频繁，请稍后再试' });
            arr.push(now);
            next();
        };
    }

    /* ── 原 server.js L1332-1334 ── */
    /* 限流 key 兜底：req.ip 为 undefined 时 express-rate-limit 会抛
       ERR_ERL_UNDEFINED_IP_ADDRESS 导致进程崩溃（Node>=15 默认崩溃）；
       ipKeyGenerator 处理 IPv6 子网聚合（防 IPv6 地址轮换绕过限流） */

    /* ── 原 server.js L1335-1335 ── */
    const { ipKeyGenerator } = require('express-rate-limit');

    /* ── 原 server.js L1336-1339 ── */
    function safeRateKey(req) {
        const ip = req.ip || req.clientIp || req.socket.remoteAddress || 'unknown';
        try { return ipKeyGenerator(ip, 56); } catch (e) { return String(ip); }
    }

        Object.assign(ctx, { getApiLimiter, getApiLimiter, writeLimiterBuckets, writeLimiterBuckets, writeRateLimit, writeRateLimit, safeRateKey, safeRateKey });
    },
};
