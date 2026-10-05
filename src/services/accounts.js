/* 账号认证：scrypt 哈希 + 令牌签发校验 + 管理员中间件
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const fs = require('fs');
const crypto = require('crypto');

module.exports = {
    define(ctx) {
        const { readConfig, ACCOUNTS_FILE, S, readJsonFile } = ctx;

    /* ── 原 server.js L384-384 ── */
    // ==================== 账号密码认证系统 ====================

    /* ── 原 server.js L385-385 ── */
    const TOKEN_SECRET = crypto.randomBytes(32).toString('hex');

    /* ── 原 server.js L388-391 ── */
    function getTokenExpiry() {
        const config = readConfig();
        return (config.security && config.security.sessionMinutes || 120) * 60 * 1000;
    }

    /* ── 原 server.js L393-394 ── */
    /* 密码哈希：scrypt（内存困难算法，防 GPU 爆破）
       兼容旧 sha256 格式：登录时按存储长度区分，成功登录后自动升级为 scrypt */

    /* ── 原 server.js L395-397 ── */
    function hashPassword(password, salt) {
        return crypto.scryptSync(String(password), salt, 64).toString('hex');
    }

    /* ── 原 server.js L398-409 ── */
    function verifyPassword(password, salt, stored) {
        if (!stored) return false;
        if (stored.length === 128) {
            const h = crypto.scryptSync(String(password), salt, 64);
            const b = Buffer.from(stored, 'hex');
            return b.length === h.length && crypto.timingSafeEqual(h, b);
        }
        return crypto.timingSafeEqual(
            Buffer.from(crypto.createHash('sha256').update(String(password) + salt).digest('hex'), 'utf8'),
            Buffer.from(stored, 'utf8')
        );
    }

    /* ── 原 server.js L411-420 ── */
    function initAccounts() {
        if (!fs.existsSync(ACCOUNTS_FILE)) {
            const salt = crypto.randomBytes(16).toString('hex');
            const defaultAccount = {
                admin: { salt, hash: hashPassword('admin123', salt), name: '管理员', created: Date.now() }
            };
            fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(defaultAccount, null, 2));
            console.log('[认证] 已创建默认账号 admin / admin123（请立即修改密码）');
        }
    }

    /* ── 原 server.js L422-424 ── */
    function readAccounts() {
        return S.store ? Promise.resolve(S.store.accountsAll()) : Promise.resolve(readJsonFile(ACCOUNTS_FILE, {}));
    }

    /* ── 原 server.js L426-429 ── */
    function writeAccounts(accounts) {
        if (!S.store) { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2)); return Promise.resolve(); }
        return S.store.accountsWrite(accounts);
    }

    /* ── 原 server.js L431-435 ── */
    function generateToken(username) {
        const payload = Buffer.from(JSON.stringify({ u: username, t: Date.now() })).toString('base64');
        const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
        return payload + '.' + sig;
    }

    /* ── 原 server.js L437-449 ── */
    function verifyToken(token) {
        if (!token) return null;
        const idx = token.lastIndexOf('.');
        if (idx === -1) return null;
        const payload = token.slice(0, idx);
        const sig = token.slice(idx + 1);
        if (crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex') !== sig) return null;
        try {
            const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
            if (Date.now() - data.t > getTokenExpiry()) return null;
            return data.u;
        } catch { return null; }
    }

    /* ── 原 server.js L451-458 ── */
    function checkAdmin(req, res, next) {
        const username = checkAdminAuth(req);
        if (!username) {
            return res.status(401).json({ code: 1, msg: '未登录或令牌已过期' });
        }
        req.adminUser = username;
        next();
    }

    /* ── 原 server.js L460-460 ── */
    /* 仅校验（不写 req），供需要按 scope 鉴权的接口复用 */

    /* ── 原 server.js L461-465 ── */
    function checkAdminAuth(req) {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : ((req.body && req.body.token) || req.headers['x-admin-token']);
        return verifyToken(token);
    }

    /* ── 原 server.js L471-471 ── */
    initAccounts();

        Object.assign(ctx, { TOKEN_SECRET, TOKEN_SECRET, getTokenExpiry, getTokenExpiry, hashPassword, hashPassword, verifyPassword, verifyPassword, initAccounts, initAccounts, readAccounts, readAccounts, writeAccounts, writeAccounts, generateToken, generateToken, verifyToken, verifyToken, checkAdmin, checkAdmin, checkAdminAuth, checkAdminAuth });
    },
};
