'use strict';
/* ==========================================================================
 * OpenVideoAPI 插件：OTP 双因素登录（TOTP 动态验证码 + 恢复码）
 *
 * 能力：
 *   1. 登录页二次验证：登录时先调 /api/plugin/otp/verify 校验 TOTP 验证码，
 *      通过后再走 /api/admin/login（由 lib/client/login/otp.js 注入登录表单）
 *   2. 后台管理 tab：启用 / 禁用 / 重新生成密钥、二维码、一次性恢复码
 *      （由 lib/client/admin/otp.js 提供）
 *   3. 纯 Node 实现 RFC 6238 TOTP（HMAC-SHA1 / Base32），兼容
 *      Google Authenticator / Microsoft Authenticator / 1Password 等
 *   4. 恢复码：启用时生成 8 个一次性恢复码（仅存 sha256 哈希），
 *      可替代验证码登录，防止丢失验证器后无法登录
 *
 * 安全：
 *   - 管理操作（setup/confirm/disable）需要管理员密码；已启用时还需
 *     当前验证码/恢复码，防止他人直接启用/篡改
 *   - verify 与管理接口均按 用户名|IP 限流（5 次/分钟，超限锁 10 分钟）
 *   - 密钥存于 ctx.model 动态表（随存储切换自动迁移）；恢复码仅存哈希
 *
 * API：
 *   GET  /api/plugin/otp/config    公开：插件参数（issuer/period/digits/window）
 *   POST /api/plugin/otp/status    公开：查询账号是否已启用 OTP
 *   POST /api/plugin/otp/verify    公开：校验 TOTP / 恢复码（登录页用，限流）
 *   POST /api/plugin/otp/setup     管理：生成新密钥（pending；需密码，已启用还需验证码）
 *   POST /api/plugin/otp/confirm   管理：确认并启用（校验验证码匹配 pending 密钥）
 *   POST /api/plugin/otp/disable   管理：关闭 OTP（需密码 + 当前验证码/恢复码）
 * ========================================================================== */
const crypto = require('crypto');

/* ---------- Base32 (RFC 4648) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(str) {
    const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, val = 0;
    const out = [];
    for (const ch of clean) {
        const idx = B32.indexOf(ch);
        if (idx < 0) continue;
        val = (val << 5) | idx;
        bits += 5;
        if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
    }
    return Buffer.from(out);
}
function base32Encode(buf) {
    let bits = 0, val = 0, out = '';
    for (const b of buf) {
        val = (val << 8) | b;
        bits += 8;
        while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
    }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
}

/* ---------- TOTP (RFC 6238, HMAC-SHA1) ---------- */
function hotp(secret, counter, digits) {
    const msg = Buffer.alloc(8);
    msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
    msg.writeUInt32BE(counter >>> 0, 4);
    const h = crypto.createHmac('sha1', secret).update(msg).digest();
    const o = h[h.length - 1] & 0x0f;
    const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % Math.pow(10, digits);
    return String(code).padStart(digits, '0');
}
function totpAt(secret, unixSeconds, period, digits) {
    return hotp(secret, Math.floor(unixSeconds / (period || 30)), digits || 6);
}
function verifyTotp(secretB32, code, opts) {
    const period = opts.period || 30;
    const digits = opts.digits || 6;
    const win = opts.window == null ? 1 : opts.window;
    const now = opts.now == null ? Math.floor(Date.now() / 1000) : opts.now;
    const want = String(code || '').replace(/\s+/g, '');
    if (!/^\d+$/.test(want)) return false;
    const secret = base32Decode(secretB32);
    for (let i = -win; i <= win; i++) {
        if (totpAt(secret, now + i * period, period, digits) === want) return true;
    }
    return false;
}

/* ---------- 恢复码（8 × 8 位，避免易混淆字符） ---------- */
const REC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genRecoveryCodes(count) {
    const codes = [];
    for (let i = 0; i < (count || 8); i++) {
        const bytes = crypto.randomBytes(8);
        let c = '';
        for (let j = 0; j < 8; j++) c += REC_ALPHABET[bytes[j] % REC_ALPHABET.length];
        codes.push(c);
    }
    return codes;
}
function sha256Hex(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
/* 校验并消耗一条恢复码（命中则标记 used，由调用方持久化） */
function useRecovery(recovery, code) {
    const h = sha256Hex(String(code || '').trim().toUpperCase());
    for (const r of (recovery || [])) {
        if (!r.used && r.h === h) { r.used = true; return true; }
    }
    return false;
}

/* ---------- otpauth URI（二维码 / 手动导入） ---------- */
function otpauthUri(username, secret, config) {
    const issuer = String(config.issuer || 'OpenVideoAPI').replace(/[:&?]/g, '');
    return 'otpauth://totp/' + encodeURIComponent(issuer + ':' + username)
        + '?secret=' + secret
        + '&issuer=' + encodeURIComponent(issuer)
        + '&period=' + (config.period || 30)
        + '&digits=' + (config.digits || 6)
        + '&algorithm=SHA1';
}

/* ---------- 密码校验（与 server.js 保持一致：scrypt / 旧 sha256） ---------- */
async function checkPassword(store, username, password) {
    try {
        const accounts = await store.accountsAll();
        const acc = accounts && accounts[username];
        if (!acc || !acc.salt || !acc.hash || !password) return false;
        if (acc.hash.length === 128) {
            return crypto.timingSafeEqual(
                crypto.scryptSync(String(password), acc.salt, 64),
                Buffer.from(acc.hash, 'hex')
            );
        }
        return crypto.timingSafeEqual(
            Buffer.from(crypto.createHash('sha256').update(String(password) + acc.salt).digest('hex'), 'utf8'),
            Buffer.from(acc.hash, 'utf8')
        );
    } catch (e) { return false; }
}

/* ---------- 简易限流（内存，进程内） ---------- */
function makeLimiter(maxPerWindow, windowMs, blockMs) {
    const map = new Map();
    return {
        check(key) {
            const now = Date.now();
            const r = map.get(key);
            if (r && r.blockUntil > now) return { ok: false, retryIn: Math.ceil((r.blockUntil - now) / 1000) };
            if (!r || now - r.firstAt > windowMs) map.set(key, { count: 0, firstAt: now, blockUntil: 0 });
            const rec = map.get(key);
            rec.count++;
            if (rec.count > maxPerWindow) { rec.blockUntil = now + blockMs; return { ok: false, retryIn: Math.ceil(blockMs / 1000) }; }
            return { ok: true };
        },
        reset(key) { const r = map.get(key); if (r) { r.count = 0; r.firstAt = Date.now(); r.blockUntil = 0; } },
        prune() {
            const now = Date.now();
            for (const [k, v] of map) if (v.blockUntil < now && now - v.firstAt > windowMs * 3) map.delete(k);
        }
    };
}

module.exports = {
    apply(ctx, config) {
        const master = config.enabled !== false;
        const limiter = makeLimiter(5, 60 * 1000, 10 * 60 * 1000);
        const pruneTimer = setInterval(() => limiter.prune(), 5 * 60 * 1000);
        ctx.on('dispose', () => clearInterval(pruneTimer));

        /* 密钥 / 恢复码存储：随主存储切换自动迁移 */
        const otpKeys = ctx.model.define('otp_keys', {
            primary: 'username',
            fields: {
                username: { type: 'string' },
                secret: { type: 'string' },
                enabled: { type: 'boolean' },
                recovery: { type: 'json' },
                pending: { type: 'json' },
                createdAt: { type: 'number' },
                updatedAt: { type: 'number' }
            }
        });

        const clientIp = (req) => (req.clientIp || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');
        const bad = (msg, status) => { const e = new Error(msg); e.status = status || 400; throw e; };

        async function getRow(username) { return otpKeys.get(String(username || '').slice(0, 64)) || null; }
        async function saveRow(row) { row.updatedAt = Date.now(); await otpKeys.create(row); }

        /* 校验 TOTP 或恢复码（恢复码命中会持久化标记已用） */
        async function checkCode(row, code) {
            if (!row || !row.secret) return false;
            if (verifyTotp(row.secret, code, { period: config.period, digits: config.digits, window: config.window })) return true;
            if (useRecovery(row.recovery, code)) { await saveRow(row); return true; }
            return false;
        }

        /* 管理操作鉴权：未启用 → 需密码；已启用 → 需密码 + 当前验证码/恢复码 */
        async function authManage(req, row) {
            const { username, password, code } = req.body || {};
            if (!username || !password) bad('请输入账号和密码', 400);
            if (!(await checkPassword(ctx.store, username, password))) bad('账号或密码错误', 401);
            if (row && row.enabled) {
                if (!(await checkCode(row, code))) bad('验证码错误或已过期', 401);
            }
        }

        const wrap = (fn) => async (req, res) => {
            try {
                await fn(req, res);
            } catch (e) {
                const status = e.status || 500;
                res.status(status).json({ code: status === 500 ? 1 : status, msg: e.message || '操作失败' });
            }
        };

        /* 公开：插件参数 */
        ctx.router.get('/api/plugin/otp/config', (req, res) => {
            res.json({ code: 0, data: {
                enabled: master,
                issuer: config.issuer || 'OpenVideoAPI',
                period: config.period || 30,
                digits: config.digits || 6,
                window: config.window == null ? 1 : config.window
            } });
        });

        /* 公开：账号是否启用 OTP（登录页据此决定是否显示验证码输入框） */
        ctx.router.post('/api/plugin/otp/status', wrap(async (req, res) => {
            const username = String((req.body || {}).username || '').trim();
            const row = await getRow(username);
            res.json({ code: 0, data: { enabled: !!(master && row && row.enabled) } });
        }));

        /* 公开：校验 TOTP / 恢复码（登录页在 /api/admin/login 之前调用；按 用户名|IP 限流） */
        ctx.router.post('/api/plugin/otp/verify', wrap(async (req, res) => {
            const { username, code } = req.body || {};
            const key = String(username || '') + '|' + clientIp(req);
            const rl = limiter.check(key);
            if (!rl.ok) return res.status(429).json({ code: 429, msg: '验证尝试过于频繁，请 ' + rl.retryIn + ' 秒后再试' });
            if (!username) return res.status(400).json({ code: 2, msg: '请输入账号' });
            if (!code) return res.status(400).json({ code: 3, msg: '请输入验证码' });
            const row = await getRow(username);
            if (!master || !row || !row.enabled) return res.status(400).json({ code: 2, msg: '该账号未启用 OTP' });
            if (!(await checkCode(row, String(code).trim()))) return res.status(401).json({ code: 1, msg: '验证码错误或已过期' });
            limiter.reset(key);
            res.json({ code: 0, data: { ok: true } });
        }));

        /* 管理：生成新密钥（pending，未启用）；已启用则需先验证当前验证码 */
        ctx.router.post('/api/plugin/otp/setup', wrap(async (req, res) => {
            if (!master) bad('插件已停用，请在插件配置中启用', 400);
            const { username } = req.body || {};
            if (!username) bad('请输入账号', 400);
            const row = await getRow(username);
            await authManage(req, row);
            const secret = base32Encode(crypto.randomBytes(20));
            const recovery = genRecoveryCodes(8);
            const pending = { secret, recovery, at: Date.now() };
            if (row) await saveRow({ ...row, pending });
            else await saveRow({ username, secret: '', enabled: false, recovery: [], pending, createdAt: Date.now() });
            res.json({ code: 0, data: { secret, uri: otpauthUri(username, secret, config), recovery, pending: true } });
        }));

        /* 管理：确认并启用（校验验证码匹配 pending 密钥） */
        ctx.router.post('/api/plugin/otp/confirm', wrap(async (req, res) => {
            if (!master) bad('插件已停用，请在插件配置中启用', 400);
            const { username, code } = req.body || {};
            if (!username) bad('请输入账号', 400);
            const row = await getRow(username);
            if (!row || !row.pending || !row.pending.secret) bad('没有待确认的密钥，请先「生成密钥」', 400);
            await authManage(req, row);
            if (!verifyTotp(row.pending.secret, code, { period: config.period, digits: config.digits, window: config.window })) {
                bad('验证码错误或已过期', 401);
            }
            await saveRow({
                ...row,
                secret: row.pending.secret,
                recovery: row.pending.recovery.map(c => ({ h: sha256Hex(c), used: false })),
                enabled: true,
                pending: null
            });
            res.json({ code: 0, data: { enabled: true, recovery: row.pending.recovery } });
        }));

        /* 管理：关闭 OTP（需密码 + 当前验证码/恢复码，防止被他人关闭） */
        ctx.router.post('/api/plugin/otp/disable', wrap(async (req, res) => {
            const { username } = req.body || {};
            if (!username) bad('请输入账号', 400);
            const row = await getRow(username);
            await authManage(req, row);
            await otpKeys.remove(username);
            res.json({ code: 0, data: { enabled: false } });
        }));

        ctx.logger.info('otp', 'OTP 双因素登录插件已加载（主开关: ' + (master ? '开' : '关') + '，issuer: ' + (config.issuer || 'OpenVideoAPI') + '）');
    }
};
