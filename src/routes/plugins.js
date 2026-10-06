/* 插件路由：安装/启停/配置/卸载/市场/客户端扩展
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');

module.exports = {
    mount(ctx) {
        const { app, checkAdmin, S, safeErrMsg, getPluginConfig, ROOT_DIR, DEFAULT_PLUGIN_REGISTRY, PLUGIN_REGISTRY_MIRRORS, pluginLogs, checkAdminAuth, addUpdateTask, finishUpdateTask } = ctx;

    /* ── 原 server.js L3508-3510 ── */
    app.get('/api/admin/plugins', checkAdmin, (req, res) => {
        res.json({ code: 0, data: { list: S.pluginManager.list(), services: Array.from(S.pluginManager.services.keys()), dir: 'plugins/' } });
    });

    /* ── 原 server.js L3512-3512 ── */
    /* 安装插件：仅支持 npm 包（pkg + 可选 version） */

    /* ── 原 server.js L3513-3522 ── */
    app.post('/api/admin/plugins/install', checkAdmin, async (req, res) => {
        try {
            const { pkg, version } = req.body || {};
            if (!pkg) return res.status(400).json({ code: 1, msg: '请输入 npm 包名' });
            const name = await S.pluginManager.install({ pkg, version });
            res.json({ code: 0, msg: '已安装插件 ' + name + '，可在列表中启用', data: { name } });
        } catch (e) {
            res.status(400).json({ code: 1, msg: '安装失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3524-3533 ── */
    app.post('/api/admin/plugins/toggle', checkAdmin, async (req, res) => {
        try {
            const { name, enabled } = req.body || {};
            await S.pluginManager.setEnabled(name, !!enabled);
            const meta = S.pluginManager.list().find(p => p.name === name);
            res.json({ code: 0, msg: enabled ? '已启用' : '已禁用', data: meta });
        } catch (e) {
            res.status(400).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3535-3543 ── */
    app.post('/api/admin/plugins/config', checkAdmin, async (req, res) => {
        try {
            const { name, config } = req.body || {};
            await S.pluginManager.setConfig(name, config);
            res.json({ code: 0, msg: '配置已保存并热重载' });
        } catch (e) {
            res.status(400).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3545-3553 ── */
    app.post('/api/admin/plugins/uninstall', checkAdmin, async (req, res) => {
        try {
            const { name } = req.body || {};
            await S.pluginManager.uninstall(name);
            res.json({ code: 0, msg: '已卸载插件 ' + name });
        } catch (e) {
            res.status(400).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3555-3555 ── */
    /* 更新插件（npm @latest，保留配置与启用状态） */

    /* ── 原 server.js L3556-3564 ── */
    app.post('/api/admin/plugins/update', checkAdmin, async (req, res) => {
        const { name } = req.body || {};
        if (!name || !S.pluginManager.list().some(p => p.name === name)) {
            return res.status(400).json({ code: 1, msg: '插件不存在: ' + (name || '') });
        }
        /* 立即响应，后台执行更新（npm 可能数分钟；进度与结果见顶栏任务列表，完成后自动重载） */
        const task = addUpdateTask('plugin', name, 'npm 后台更新（保留配置与启用状态，本地包自动切换 npm 来源）');
        res.json({ code: 0, msg: '插件 ' + name + ' 更新已在后台执行，完成后自动重载；进度见顶栏任务列表' });
        S.pluginManager.update(name)
            .then(() => finishUpdateTask(task.id, 'done', '已更新到最新版并重载'))
            .catch((e) => finishUpdateTask(task.id, 'failed', safeErrMsg(e)));
    });

    /* ── 原 server.js L3566-3566 ── */
    /* 插件市场 v2：registry 含版本列表与依赖（URL 可配置；?force=1 强制刷新，忽略缓存） */

    /* ── 原 server.js L3568-3628 ── */
    app.get('/api/admin/plugins/market', checkAdmin, async (req, res) => {
        try {
            const now = Date.now();
            if (!req.query.force && S.marketCache && now - S.marketCache.at < 10 * 60 * 1000) {
                return res.json({ code: 0, data: S.marketCache.data });
            }
            const cfg = getPluginConfig();
            /* 支持本地文件 registry（file:// 路径，插件开发环境用） */
            let text = null, usedRegistry = cfg.registry, lastErr = '';
            const fetchRegistry = async (url) => {
                const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'OpenVideoAPI' } });
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return await r.text();
            };
            if (/^file:\/\//i.test(cfg.registry)) {
                try {
                    const fp = cfg.registry.replace(/^file:\/\//i, '');
                    text = fs.readFileSync(path.resolve(ROOT_DIR, fp), 'utf8');
                } catch (e) {
                    return res.status(502).json({ code: 1, msg: '本地 registry 读取失败: ' + safeErrMsg(e) });
                }
            } else {
                /* 官方源失败时自动回退镜像（Gitee），国内直连友好 */
                const chain = [cfg.registry];
                if (cfg.registry === DEFAULT_PLUGIN_REGISTRY) chain.push(...Object.keys(PLUGIN_REGISTRY_MIRRORS));
                for (const url of chain) {
                    try {
                        text = await fetchRegistry(url);
                        usedRegistry = url;
                        break;
                    } catch (e) {
                        lastErr = (e && e.message) || String(e);
                    }
                }
                if (text == null) return res.status(502).json({ code: 1, msg: '插件市场获取失败: ' + lastErr });
            }
            const j = JSON.parse(text);
            const plugins = (Array.isArray(j.plugins) ? j.plugins : []).map(p => ({
                name: p.name || '',
                description: p.description || '',
                author: p.author || '',
                homepage: p.homepage || '',
                icon: p.icon || '',
                category: p.category || '',
                official: !!p.official,
                score: parseFloat(p.score) || 0,
                downloads: parseInt(p.downloads) || 0,
                created: p.created || '',
                updated: p.updated || '',
                tags: Array.isArray(p.tags) ? p.tags : [],
                versions: Array.isArray(p.versions) ? p.versions.map(v => String(v)) : [],
                latest: Array.isArray(p.versions) && p.versions.length ? String(p.versions[0]) : '',
                dependencies: Array.isArray(p.dependencies) ? p.dependencies : []
            })).filter(p => p.name);
            const data = { updated: j.updated || '', registry: usedRegistry, mirror: usedRegistry !== cfg.registry ? (PLUGIN_REGISTRY_MIRRORS[usedRegistry] || 'mirror') : '', categories: Array.isArray(j.categories) ? j.categories : [], list: plugins };
            S.marketCache = { at: now, data };
            res.json({ code: 0, data });
        } catch (e) {
            res.status(502).json({ code: 1, msg: '插件市场获取失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3630-3630 ── */
    /* 插件日志（调试工具） */

    /* ── 原 server.js L3631-3634 ── */
    app.get('/api/admin/plugins/logs', checkAdmin, (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
        res.json({ code: 0, data: pluginLogs.slice(-limit).reverse() });
    });

    /* ── 原 server.js L3636-3637 ── */
    /* 客户端扩展清单：player / login 公开，admin 需鉴权
       login 作用域：登录页加载的插件资源（用于扩展登录表单等，无需登录即可获取） */

    /* ── 原 server.js L3638-3650 ── */
    app.get('/api/plugins/manifest', async (req, res) => {
        const scope = ['admin', 'player', 'login'].includes(req.query.scope) ? req.query.scope : 'player';
        if (scope === 'admin') {
            const auth = checkAdminAuth(req);
            if (!auth) return res.status(401).json({ code: 401, msg: '未授权' });
        }
        try {
            const list = S.pluginManager.clientManifest(scope);
            res.json({ code: 0, data: { scope, plugins: list } });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3652-3652 ── */
    /* 客户端资源：/api/plugins/client/:scope/:pkg/* （admin 需鉴权，player / login 公开） */

    /* ── 原 server.js L3653-3668 ── */
    app.get('/api/plugins/client/:scope/:pkg/*splat', (req, res) => {
        const scope = ['admin', 'player', 'login'].includes(req.params.scope) ? req.params.scope : 'player';
        if (scope === 'admin' && !checkAdminAuth(req)) return res.status(401).json({ code: 401, msg: '未授权' });
        try {
            const splat = req.params.splat;
            const rel = decodeURIComponent(Array.isArray(splat) ? splat.join('/') : String(splat || ''));
            const file = S.pluginManager.resolveClientAsset(req.params.pkg, rel);
            const ext = path.extname(file).toLowerCase();
            const type = ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
            res.setHeader('Content-Type', type);
            res.setHeader('Cache-Control', 'no-cache');
            res.sendFile(file);
        } catch (e) {
            res.status(404).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── v2（T5，additive）插件 i18n 词条（公开只读；locale 缺省 zh，plugin 可选过滤） ── */
    app.get('/api/plugins/i18n', (req, res) => {
        try {
            const locale = String(req.query.locale || 'zh');
            const plugin = req.query.plugin ? String(req.query.plugin) : null;
            res.json({ code: 0, data: { locale, terms: S.pluginManager.mergedI18n(locale, plugin), manifest: S.pluginManager.i18nManifest() } });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── v2（T5，additive）插件自定义页面清单（公开只读；auth 页面由服务端 302 跳登录） ── */
    app.get('/api/plugins/pages', (req, res) => {
        try {
            res.json({ code: 0, data: { pages: S.pluginManager.pagesList() } });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });
    },
};
