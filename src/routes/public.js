/* 公开路由：公共配置 / 主题 / favicon / player / admin 入口
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = {
    mount(ctx) {
        const { app, readConfig, getNavConfig, ROOT_DIR } = ctx;

    /* ── 原 server.js L1835-1838 ── */
    app.get('/api/config/public', (req, res) => {
        const config = readConfig();
        res.json({ code: 0, data: { cdn: config.cdn, theme: config.theme || 'bili', render: config.render, timezone: config.timezone || 'Asia/Shanghai', language: config.language || 'zh', nav: getNavConfig() } });
    });

    /* ── 原 server.js L3807-3807 ── */
    // 主题 API

    /* ── 原 server.js L3808-3808 ── */
    // ==================== 页面路由 ====================

    /* ── 原 server.js L3810-3810 ── */
    const THEME_DIR = path.join(ROOT_DIR, 'theme');

    /* ── 原 server.js L3811-3823 ── */
    app.get('/api/theme/:type/list', (req, res) => {
        const type = req.params.type === 'player' || req.params.type === 'admin' ? req.params.type : null;
        if (!type) return res.status(400).json({ code: 1, msg: '类型错误' });
        const dir = path.join(THEME_DIR, type);
        if (!fs.existsSync(dir)) return res.json({ code: 0, data: [] });
        const list = fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'theme.json'))).map(n => {
            try {
                const j = JSON.parse(fs.readFileSync(path.join(dir, n, 'theme.json'), 'utf8'));
                return { id: j.id || n, name: j.displayName || n };
            } catch (e) { return { id: n, name: n }; }
        });
        res.json({ code: 0, data: list });
    });

    /* ── 原 server.js L3824-3831 ── */
    app.get('/api/theme/:type.css', (req, res) => {
        const type = req.params.type === 'player' || req.params.type === 'admin' ? req.params.type : null;
        if (!type) return res.status(400).json({ code: 1, msg: '类型错误' });
        const file = path.join(THEME_DIR, type + '.css');
        if (!fs.existsSync(file)) return res.status(404).json({ code: 1, msg: 'CSS 未构建' });
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.sendFile(file);
    });

    /* ── 原 server.js L3833-3836 ── */
    app.get('/favicon.ico', (req, res) => {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.sendFile(path.join(ROOT_DIR, 'public', 'favicon.svg'));
    });

    /* ── 原 server.js L3838-3840 ── */
    app.get('/player/', (req, res) => {
        res.sendFile(path.join(ROOT_DIR, 'public', 'player.html'));
    });

    },

    /* ── admin 入口兜底（原 server.js L3842-3861）：自定义 adminPath 即时生效。
       注意：由 app.js 在全部路由挂载完成后最后调用（对应原 L3850 的末位注册）；
       若随本模块按 MOUNT_ORDER 第 8 位挂载，adminPath='api' 时会剥掉 /api 前缀、
       吞掉后挂的 security/db/backup/subtitle/deps/plugins/update 模块路由 ── */
    mountFallback(ctx) {
        const { app, readConfig, ROOT_DIR } = ctx;
        function adminBasePath() {
            const config = readConfig();
            const ap = (config.security && config.security.adminPath) ? String(config.security.adminPath).replace(/^\/+|\/+$/g, '') : '';
            return ap ? '/' + ap : '/admin';
        }
        const adminStatic = express.static(path.join(ROOT_DIR, 'public'));
        app.use((req, res, next) => {
            const base = adminBasePath();
            if (req.path === base || (base !== '/' && req.path.startsWith(base + '/'))) {
                res.setHeader('X-Frame-Options', 'DENY');
                if (req.path === base || req.path === base + '/') {
                    return res.sendFile(path.join(ROOT_DIR, 'public', 'admin.html'));
                }
                req.url = req.url.slice(base.length) || '/';
                return adminStatic(req, res, next);
            }
            next();
        });
    }
};
