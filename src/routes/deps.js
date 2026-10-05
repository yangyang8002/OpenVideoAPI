/* 依赖管理路由：检查（npm+前端 CDN）/ 一键更新
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');

module.exports = {
    define(ctx) {
        const { ROOT_DIR, S, checkVersionUpdate } = ctx;

    /* ── 原 server.js L3318-3318 ── */
    // ==================== 依赖管理 ====================

    /* ── 原 server.js L3322-3323 ── */
    /* 前端 CDN 依赖（player.html 经 jsdelivr 引入）：纳入依赖检查与一键更新。
       find 为版本占位正则（捕获 $1 前缀 / $2 后缀），replace 用 @版本 模板。 */

    /* ── 原 server.js L3324-3329 ── */
    const FRONTEND_DEPS = [
        { name: 'artplayer', page: 'player.html', find: /(npm\/)artplayer(?:@[0-9.]+)?(\/dist\/artplayer\.js)/, replace: (v) => '$1artplayer@' + v + '$2' },
        { name: 'hls.js', page: 'player.html', find: /(npm\/)hls\.js@[0-9.]+(\/dist\/hls\.min\.js)/, replace: (v) => '$1hls.js@' + v + '$2' },
        { name: 'flv.js', page: 'player.html', find: /(npm\/)flv\.js@[0-9.]+(\/dist\/flv\.min\.js)/, replace: (v) => '$1flv.js@' + v + '$2' },
        { name: 'misans', page: 'player.html', find: /(npm\/)misans@[0-9.]+(\/lib\/Normal\/MiSans-(?:Regular|Medium|Semibold|Bold)\.min\.css)/, replace: (v) => '$1misans@' + v + '$2' }
    ];

    /* ── 原 server.js L3330-3340 ── */
    function readFrontendDeps() {
        return FRONTEND_DEPS.map(d => {
            let ver = '?';
            try {
                const html = fs.readFileSync(path.join(ROOT_DIR, 'public', d.page), 'utf8');
                const m = html.match(d.find);
                if (m) ver = (m[0].match(/@([0-9.]+)/) || [])[1] || 'latest';
            } catch (e) {}
            return { name: d.name, current: ver, type: 'frontend', page: d.page };
        });
    }

    /* ── 原 server.js L3341-3384 ── */
    async function getDeps(force) {
        const now = Date.now();
        if (!force && S.depsCache && now - S.depsCache.at < 1800000) return S.depsCache.data;
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
        const deps = Object.entries(pkg.dependencies || {}).map(([name, cur]) => ({ name, current: cur.replace(/^[\^~]/, ''), type: 'dependency' }));
        /* 合并前端 CDN 依赖（artplayer / hls.js / flv.js / misans 等） */
        deps.push(...readFrontendDeps());
        /* 查询最新版本 */
        const latest = {};
        await Promise.all(deps.slice(0, 40).map(async (d) => {
            try {
                const r = await fetch('https://registry.npmjs.org/' + encodeURIComponent(d.name) + '/latest', { signal: AbortSignal.timeout(8000) });
                if (r.ok) { const j = await r.json(); latest[d.name] = j.version || ''; }
            } catch (e) {}
        }));
        const list = deps.map(d => ({ ...d, latest: latest[d.name] || '' }));
        /* 程序版本更新信息（复用版本检测，1h 缓存） */
        let version = null;
        try {
            const info = await checkVersionUpdate(false);
            version = {
                current: info.current,
                latest: info.latest || info.current,
                hasUpdate: info.hasUpdate,
                deploy: info.deploy,
                releaseNotes: info.releaseNotes || '',
                releaseUrl: info.releaseUrl || '',
                changedFiles: info.changedFiles || []
            };
        } catch (e) {}
        /* 插件更新信息：npm 来源支持在线更新 */
        const plugins = S.pluginManager ? S.pluginManager.list().map(p => ({
            name: p.name,
            enabled: p.enabled,
            status: p.status,
            source: p.source.type,
            version: (p.info && p.info.package && p.info.package.version) || (p.source && p.source.version) || '',
            description: (p.info && (p.info.package || {}).description) || '',
            updatable: p.source.type === 'npm'
        })) : [];
        const result = { list, checkedAt: now, version, plugins };
        S.depsCache = { at: now, data: result };
        return result;
    }

        Object.assign(ctx, { FRONTEND_DEPS, FRONTEND_DEPS, readFrontendDeps, readFrontendDeps, getDeps, getDeps });
    },

    mount(ctx) {
        const { app, checkAdmin, getDeps, safeErrMsg, ROOT_DIR, FRONTEND_DEPS, npmRegistryArg } = ctx;

    /* ── 原 server.js L3386-3393 ── */
    app.get('/api/admin/deps', checkAdmin, async (req, res) => {
        try {
            const data = await getDeps(req.query.force === '1');
            res.json({ code: 0, data });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3395-3395 ── */
    /* 更新依赖：前端 CDN 依赖直接改写页面版本号（立即生效）；服务端依赖后台 npm install */

    /* ── 原 server.js L3396-3439 ── */
    app.post('/api/admin/deps/update', checkAdmin, async (req, res) => {
        const { names } = req.body || {};
        const want = names && names.length ? names : null;
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
        const frontNames = want ? want.filter(n => FRONTEND_DEPS.some(d => d.name === n)) : FRONTEND_DEPS.map(d => d.name);
        const backNames = want ? want.filter(n => !FRONTEND_DEPS.some(d => d.name === n)) : Object.keys(pkg.dependencies || {});
        /* 前端依赖：改写 public/<page> 中的 CDN 版本（无需重启，刷新页面生效） */
        const updated = [];
        for (const n of frontNames) {
            try {
                const d = FRONTEND_DEPS.find(x => x.name === n);
                const r = await fetch('https://registry.npmjs.org/' + encodeURIComponent(n) + '/latest', { signal: AbortSignal.timeout(8000) });
                if (!r.ok) continue;
                const j = await r.json();
                const ver = j.version || '';
                if (!ver) continue;
                const file = path.join(ROOT_DIR, 'public', d.page);
                let html = fs.readFileSync(file, 'utf8');
                const re = new RegExp(d.find.source, 'g');
                const before = html;
                html = html.replace(re, d.replace(ver));
                if (html !== before) {
                    fs.writeFileSync(file, html);
                    updated.push(n + '@' + ver);
                }
            } catch (e) {}
        }
        /* 服务端依赖：后台 npm install */
        let bgMsg = '';
        if (backNames.length) {
            const child = require('child_process').spawn('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false', ...backNames.map(n => n + '@latest'), ...(npmRegistryArg() ? [npmRegistryArg()] : [])], {
                cwd: ROOT_DIR,
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
            console.log('[依赖] 更新进程已启动: ' + backNames.join(', '));
            bgMsg = '服务端依赖更新已在后台执行（' + backNames.length + ' 个），完成后需重启服务生效';
        }
        const parts = [];
        if (updated.length) parts.push('前端依赖已更新: ' + updated.join(', ') + '（刷新页面生效）');
        if (bgMsg) parts.push(bgMsg);
        res.json({ code: 0, msg: parts.join('；') || '没有需要更新的依赖' });
    });
    },
};
