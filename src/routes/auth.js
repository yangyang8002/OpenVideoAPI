/* 认证路由：登录（限流+锁定）/初始化向导/改密/改用户名
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { createStore, collectAll, restoreAll } = require('../../lib/store');

module.exports = {
    mount(ctx) {
        const { safeRateKey, readConfig, readLoginFails, logLogin, app, readAccounts, verifyPassword, writeLoginFails, hashPassword, writeAccounts, generateToken, checkAdmin, TIMEZONES, DB_TYPES, buildDbCfg, dbHostError, S, safeErrMsg, writeConfig, applyTrustProxy } = ctx;

    /* ── 原 server.js L1330-1330 ── */
    // ==================== 管理员API ====================

    /* ── 原 server.js L1341-1349 ── */
    const loginLimiter = rateLimit({
        windowMs: 60000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: safeRateKey,
        skip: (req) => req.ipWhitelisted,
        handler: (req, res) => res.status(429).json({ code: 429, msg: '登录尝试过于频繁，请1分钟后再试' })
    });

    /* ── 原 server.js L1351-1351 ── */
    /* 登录失败锁定：每 IP 计数，超过阈值锁定（配置可调，持久化） */

    /* ── 原 server.js L1352-1365 ── */
    async function loginGuard(req, res, next) {
        const ip = req.clientIp || req.ip || 'unknown';
        const L = (readConfig().security || {}).loginLimit || {};
        const maxFail = L.maxFail || 5, windowMin = L.windowMin || 10, lockMin = L.lockMin || 15;
        const fails = await readLoginFails();
        const f = fails[ip];
        if (f && f.lockedUntil && f.lockedUntil > Date.now()) {
            await logLogin(ip, req.body && req.body.username, false, 'locked');
            const mins = Math.ceil((f.lockedUntil - Date.now()) / 60000);
            return res.status(429).json({ code: 429, msg: '登录已锁定，请' + mins + '分钟后再试' });
        }
        req.loginGuard = { maxFail, windowMin, lockMin, fails };
        next();
    }

    /* ── 原 server.js L1367-1406 ── */
    app.post('/api/admin/login', loginLimiter, loginGuard, async (req, res) => {
        const ip = req.clientIp || req.ip || 'unknown';
        const { username, password } = req.body;
        const g = req.loginGuard;
        if (!username || !password) {
            await logLogin(ip, username, false, 'params');
            return res.status(400).json({ code: 1, msg: '请输入账号和密码' });
        }
        const accounts = await readAccounts();
        const account = accounts[username];
        const ok = !!account && verifyPassword(password, account.salt, account.hash);
        if (!ok) {
            const fails = g.fails;
            const now = Date.now();
            let f = fails[ip];
            if (!f) { f = { count: 0, firstAt: now, lockedUntil: 0 }; fails[ip] = f; }
            if (now - f.firstAt > g.windowMin * 60000) { f.count = 0; f.firstAt = now; }
            f.count++;
            if (f.count >= g.maxFail) {
                f.lockedUntil = now + g.lockMin * 60000;
                f.count = 0;
                await writeLoginFails(fails);
                await logLogin(ip, username, false, 'lock:' + g.lockMin);
                if (S.pluginManager) S.pluginManager.emit('admin:login-fail', { username, ip, reason: 'lock' });
                return res.status(429).json({ code: 429, msg: '登录失败次数过多，已锁定' + g.lockMin + '分钟' });
            }
            await writeLoginFails(fails);
            await logLogin(ip, username, false, 'fail');
            if (S.pluginManager) S.pluginManager.emit('admin:login-fail', { username, ip, reason: 'fail' });
            return res.status(401).json({ code: 2, msg: '账号或密码错误' });
        }
        /* 旧 sha256 哈希自动升级为 scrypt */
        if (account.hash.length !== 128) {
            account.hash = hashPassword(password, account.salt);
            await writeAccounts(accounts);
        }
        delete g.fails[ip];
        await writeLoginFails(g.fails);
        await logLogin(ip, username, true, 'ok');
        if (S.pluginManager) S.pluginManager.emit('admin:login-ok', { username, ip });
        const token = generateToken(username);
        res.json({ code: 0, msg: '登录成功', data: { token, username, name: account.name || username, firstRun: !!(readConfig().security || {}).firstRun } });
    });

    /* ── 原 server.js L1408-1408 ── */
    /* 首次初始化向导：语言 / 时区 / 数据库 / 修改管理员密码 + 设置安全入口（完成后 firstRun=false） */

    /* ── 原 server.js L1409-1462 ── */
    app.post('/api/admin/init', checkAdmin, async (req, res) => {
        const config = readConfig();
        if (!(config.security && config.security.firstRun)) return res.status(400).json({ code: 1, msg: '系统已完成初始化' });
        const { newPassword, adminPath, timezone, language, db } = req.body || {};
        if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ code: 2, msg: '新密码至少4位' });
        const ap = String(adminPath || '').replace(/^\/+|\/+$/g, '');
        if (ap && !/^[a-zA-Z0-9_\-]+$/.test(ap)) return res.status(400).json({ code: 3, msg: '入口路径仅允许字母、数字、下划线和中划线' });
        const tz = TIMEZONES.includes(timezone) ? timezone : 'Asia/Shanghai';
        const lang = ['zh', 'zhHant', 'wyw', 'en', 'ja', 'fr'].includes(language) ? language : 'zh';

        /* 数据库配置（可选）：校验类型与连接，必要时热切换存储 */
        let dbApplied = false;
        if (db && db.type) {
            if (!DB_TYPES.includes(db.type)) return res.status(400).json({ code: 4, msg: '无效的存储类型' });
            const dbCfg = buildDbCfg(db.type, db.sqlite || {}, db.mysql || {}, db.postgres || {}, db.mongodb || {}, config.db || {});
            const hostErr = dbHostError(dbCfg, db.type);
            if (hostErr) return res.status(400).json({ code: 5, msg: hostErr });
            if (db.type !== S.store.type) {
                let next = null;
                try {
                    next = await createStore(db.type, dbCfg);
                    const data = await collectAll(S.store);
                    await restoreAll(next, data);
                    const old = S.store;
                    S.store = next; next = null;
                    try { await old.close(); } catch (e) {}
                    if (S.pluginManager) S.pluginManager.rebindStore(S.store, S.pluginModel);
                    dbApplied = true;
                } catch (e) {
                    if (next) { try { await next.close(); } catch (x) {} }
                    return res.status(500).json({ code: 6, msg: '数据库切换失败: ' + safeErrMsg(e) });
                }
            }
            config.db = { type: db.type, ...dbCfg };
        }

        /* 修改密码 */
        const accounts = await readAccounts();
        const account = accounts[req.adminUser];
        if (!account) return res.status(401).json({ code: 1, msg: '账号不存在，请重新登录' });
        const newSalt = crypto.randomBytes(16).toString('hex');
        account.salt = newSalt;
        account.hash = hashPassword(newPassword, newSalt);
        accounts[req.adminUser] = account;
        await writeAccounts(accounts);

        /* 保存配置 */
        config.security = { ...config.security, adminPath: ap, firstRun: false };
        config.timezone = tz;
        config.language = lang;
        writeConfig(config);
        applyTrustProxy(config);
        res.json({ code: 0, msg: '初始化完成，请使用新密码重新登录', data: { adminPath: ap, timezone: tz, language: lang, dbApplied } });
    });

    /* ── 原 server.js L1464-1479 ── */
    app.post('/api/admin/change-password', checkAdmin, async (req, res) => {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) return res.status(400).json({ code: 1, msg: '参数不完整' });
        if (newPassword.length < 4) return res.status(400).json({ code: 2, msg: '新密码至少4位' });
        const accounts = await readAccounts();
        const account = accounts[req.adminUser];
        if (!verifyPassword(oldPassword, account.salt, account.hash)) {
            return res.status(403).json({ code: 3, msg: '原密码错误' });
        }
        const newSalt = crypto.randomBytes(16).toString('hex');
        account.salt = newSalt;
        account.hash = hashPassword(newPassword, newSalt);
        accounts[req.adminUser] = account;
        await writeAccounts(accounts);
        res.json({ code: 0, msg: '密码已更新，请重新登录' });
    });

    /* ── 原 server.js L1481-1497 ── */
    app.post('/api/admin/change-username', checkAdmin, async (req, res) => {
        const { password, newUsername } = req.body;
        if (!password || !newUsername) return res.status(400).json({ code: 1, msg: '参数不完整' });
        if (newUsername.length < 2) return res.status(400).json({ code: 2, msg: '用户名至少2位' });
        if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) return res.status(400).json({ code: 3, msg: '用户名只能包含字母数字和下划线' });
        const accounts = await readAccounts();
        if (accounts[newUsername]) return res.status(400).json({ code: 4, msg: '该用户名已存在' });
        const account = accounts[req.adminUser];
        if (!verifyPassword(password, account.salt, account.hash)) {
            return res.status(403).json({ code: 5, msg: '密码错误' });
        }
        accounts[newUsername] = account;
        delete accounts[req.adminUser];
        await writeAccounts(accounts);
        const token = generateToken(newUsername);
        res.json({ code: 0, msg: '用户名已更换，请使用新用户名重新登录', data: { token, username: newUsername } });
    });
    },
};
