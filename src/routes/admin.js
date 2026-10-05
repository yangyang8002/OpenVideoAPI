/* 管理路由：配置/API管理/日志/控制台/重启/更新配置
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const fs = require('fs');

module.exports = {
    define(ctx) {
        const { readConfig, S, apiTotals } = ctx;

    /* ── 原 server.js L1499-1499 ── */
    /* 侧边导航默认分组（后台 tab 分类；可在服务器配置中调整顺序/分组/默认折叠） */

    /* ── 原 server.js L1500-1509 ── */
    const DEFAULT_NAV = {
        groups: [
            { id: 'content', name: '内容管理', items: ['words', 'danmu', 'videos', 'subs'], collapsed: true },
            { id: 'system', name: '系统', items: ['config', 'security', 'db', 'backup', 'files'], collapsed: false },
            { id: 'ext', name: '扩展', items: ['plugins', 'market', 'deps'], collapsed: true },
            { id: 'monitor', name: '监控', items: ['logs', 'api'], collapsed: true }
        ],
        pinnedTop: ['console'],
        pinnedBottom: ['about']
    };

    /* ── 原 server.js L1510-1524 ── */
    function getNavConfig() {
        const c = readConfig();
        const nav = c.ui && c.ui.nav;
        if (!nav || typeof nav !== 'object') return DEFAULT_NAV;
        /* 容错：缺失字段回退默认（防止部分更新破坏结构）；每组默认折叠回退对应默认组 */
        const out = { ...DEFAULT_NAV, ...nav };
        if (!Array.isArray(out.groups)) out.groups = DEFAULT_NAV.groups;
        else out.groups = out.groups.map(g => {
            const def = DEFAULT_NAV.groups.find(d => d.id === g.id) || {};
            return { ...def, ...g, collapsed: g.collapsed == null ? (def.collapsed == null ? true : def.collapsed) : !!g.collapsed };
        });
        if (!Array.isArray(out.pinnedTop)) out.pinnedTop = DEFAULT_NAV.pinnedTop;
        if (!Array.isArray(out.pinnedBottom)) out.pinnedBottom = DEFAULT_NAV.pinnedBottom;
        return out;
    }

    /* ── 原 server.js L3238-3238 ── */
    // ==================== 控制台（统计与性能监控） ====================

    /* ── 原 server.js L3244-3254 ── */
    function samplePerf() {
        const now = Date.now();
        const cpu = process.cpuUsage(S.lastCpuUsage);
        S.lastCpuUsage = process.cpuUsage();
        const cpuPct = Math.max(0, Math.min(100, (cpu.user + cpu.system) / 1000 / Math.max(1, now - S.lastCpuAt) * 100));
        S.lastCpuAt = now;
        const mem = process.memoryUsage();
        const totalCalls = Object.values(apiTotals.calls).reduce((a, b) => a + b, 0);
        S.perfHistory.push({ t: now, mem: Math.round(mem.rss / 1048576 * 10) / 10, cpu: Math.round(cpuPct * 10) / 10, req: totalCalls });
        if (S.perfHistory.length > 240) S.perfHistory.shift(); /* 5s 采样 → 保留 20 分钟 */
    }

    /* ── 原 server.js L3255-3255 ── */
    setInterval(samplePerf, 5000);

        Object.assign(ctx, { DEFAULT_NAV, DEFAULT_NAV, getNavConfig, getNavConfig, samplePerf, samplePerf });
    },

    mount(ctx) {
        const { app, checkAdmin, readConfig, DEFAULT_API_RULES, apiLayers, API_START_TIME, apiTotals, getRetentionDays, writeConfig, invalidateApiConfig, appLogs, DEFAULT_NAV, applyTrustProxy, S, ipTotals, listBackups, ROOT_DIR, APP_VERSION, safeErrMsg, restartServer, getNpmRegistry, getPluginConfig } = ctx;

    /* ── 原 server.js L1526-1529 ── */
    app.get('/api/admin/config', checkAdmin, (req, res) => {
        const config = readConfig();
        res.json({ code: 0, data: config });
    });

    /* ── 原 server.js L1531-1531 ── */
    // ==================== API 管理 ====================

    /* ── 原 server.js L1532-1549 ── */
    app.get('/api/admin/api/stats', checkAdmin, (req, res) => {
        const config = readConfig();
        const rules = (config.api && config.api.apis) || DEFAULT_API_RULES;
        const spanSec = Math.max(30, Math.min(90 * 86400, parseInt(req.query.span) || 3600));
        // 按跨度选择层：≤1天 → 秒桶；≤30天 → 分钟桶；其余 → 小时桶
        let layer = apiLayers.h, unit = 3600;
        if (spanSec <= 24 * 3600) { layer = apiLayers.s; unit = 1; }
        else if (spanSec <= 30 * 86400) { layer = apiLayers.m; unit = 60; }
        const cutoff = Math.floor(Date.now() / 1000) - spanSec;
        const buckets = layer.buckets.filter(b => b.ts >= cutoff).map(b => ({
            t: b.t,
            calls: { ...b.calls },
            bytes: { ...b.bytes }
        }));
        const uptimeSec = Math.floor((Date.now() - API_START_TIME) / 1000);
        const totalCalls = Object.values(apiTotals.calls).reduce((a, b) => a + b, 0);
        res.json({ code: 0, data: { rules, retentionDays: getRetentionDays(config), bucketUnit: unit, buckets, totals: apiTotals, uptimeSec, totalCalls, spanSec } });
    });

    /* ── 原 server.js L1551-1562 ── */
    app.post('/api/admin/api', checkAdmin, (req, res) => {
        const { apis, retentionDays } = req.body || {};
        const config = readConfig();
        if (!config.api) config.api = {};
        if (apis && typeof apis === 'object') {
            config.api.apis = { ...DEFAULT_API_RULES, ...config.api.apis, ...apis };
        }
        if (retentionDays) config.api.retentionDays = Math.max(1, Math.min(90, parseInt(retentionDays) || 1));
        writeConfig(config);
        invalidateApiConfig();
        res.json({ code: 0, msg: 'API 配置已保存' });
    });

    /* ── 原 server.js L1564-1564 ── */
    // ==================== 日志查看 ====================

    /* ── 原 server.js L1565-1568 ── */
    app.get('/api/admin/logs', checkAdmin, (req, res) => {
        const limit = parseInt(req.query.limit) || 100;
        res.json({ code: 0, data: appLogs.slice(-limit).reverse() });
    });

    /* ── 原 server.js L1803-1833 ── */
    app.post('/api/admin/config', checkAdmin, (req, res) => {
        const config = readConfig();
        const { pow, rateLimit: rl, danmakuLimit: dl, danmaku, upload: up, render, bannedWords, api, security: sec, theme, adminTheme, cdn, ui } = req.body;
        if (pow) config.pow = { ...config.pow, ...pow };
        if (rl) config.rateLimit = { ...config.rateLimit, ...rl };
        if (dl) config.danmakuLimit = { ...config.danmakuLimit, ...dl };
        if (danmaku) config.danmaku = { ...config.danmaku, ...danmaku };
        if (up) config.upload = { ...config.upload, ...up };
        if (render) config.render = { ...config.render, ...render };
        if (bannedWords) config.bannedWords = { ...config.bannedWords, ...bannedWords };
        if (api) config.api = { ...config.api, ...api };
        if (sec) config.security = { ...config.security, ...sec };
        if (theme) config.theme = theme;
        if (adminTheme) config.adminTheme = adminTheme;
        if (cdn) config.cdn = { ...config.cdn, ...cdn };
        if (ui) {
            /* nav 部分更新时合并缺失字段（只改单项不会丢失分组配置） */
            if (ui.nav && typeof ui.nav === 'object') {
                const base = ((config.ui && config.ui.nav) || {});
                ui.nav = {
                    groups: Array.isArray(ui.nav.groups) ? ui.nav.groups : (Array.isArray(base.groups) ? base.groups : DEFAULT_NAV.groups),
                    pinnedTop: Array.isArray(ui.nav.pinnedTop) ? ui.nav.pinnedTop : (Array.isArray(base.pinnedTop) ? base.pinnedTop : DEFAULT_NAV.pinnedTop),
                    pinnedBottom: Array.isArray(ui.nav.pinnedBottom) ? ui.nav.pinnedBottom : (Array.isArray(base.pinnedBottom) ? base.pinnedBottom : DEFAULT_NAV.pinnedBottom)
                };
            }
            config.ui = { ...config.ui, ...ui };
        }
        writeConfig(config);
        applyTrustProxy(config);
        res.json({ code: 0, msg: '配置已更新', data: config });
    });

    /* ── 原 server.js L3257-3316 ── */
    app.get('/api/admin/dashboard', checkAdmin, async (req, res) => {
        try {
            const danmuCount = (await S.store.danmuAll()).length;
            const videoCount = Object.keys(await S.store.videosAll()).length;
            const subtitleCount = (await S.store.subtitleAll()).length;
            const bannedCount = (await S.store.bannedAll(true)).length;
            const ipCount = Object.keys(ipTotals.calls).length;
            const totalCalls = Object.values(apiTotals.calls).reduce((a, b) => a + b, 0);
            const totalBytes = Object.values(apiTotals.bytes).reduce((a, b) => a + b, 0);
            const mem = process.memoryUsage();
            const cpu = process.cpuUsage();
            const loginLogCount = (await S.store.loginLogs()).length;
            const backupCount = listBackups().length;
            /* 最近 1 分钟请求（秒桶累计） */
            const now = Math.floor(Date.now() / 1000);
            const lastMin = apiLayers.s.buckets.filter(b => now - b.ts < 60).reduce((a, b) => a + Object.values(b.calls).reduce((x, y) => x + y, 0), 0);
            /* 24h 活跃 IP（在线访客估计） */
            let activeIps24h = 0;
            for (const t of Object.values(ipTotals.last)) if (t > Date.now() - 86400000) activeIps24h++;
            /* 今日请求（按本地时区零点切分秒桶） */
            const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
            const dayTs0 = Math.floor(dayStart.getTime() / 1000);
            const todayCalls = apiLayers.s.buckets.filter(b => b.ts >= dayTs0).reduce((a, b) => a + Object.values(b.calls).reduce((x, y) => x + y, 0), 0);
            /* 今日弹幕 / 今日新视频 */
            const todayIso = new Date().toISOString().slice(0, 10);
            let danmuToday = 0, videoToday = 0;
            try {
                const all = await S.store.danmuAll();
                for (const d of all) { if (String(d.date || '').slice(0, 10) === todayIso) danmuToday++; }
                const vids = await S.store.videosAll();
                for (const v of Object.values(vids)) { if (String(v.createdAt || '').slice(0, 10) === todayIso) videoToday++; }
            } catch (e) {}
            /* 磁盘占用（Node 18.15+ fs.statfs，失败则省略） */
            let disk = null;
            try {
                const st = fs.statfsSync(ROOT_DIR);
                disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize };
            } catch (e) {}
            res.json({
                code: 0,
                data: {
                    totals: { calls: totalCalls, bytes: totalBytes, ips: ipCount, lastMinuteCalls: lastMin, activeIps24h, todayCalls },
                    counts: { danmu: danmuCount, videos: videoCount, subtitles: subtitleCount, bannedWords: bannedCount, logins: loginLogCount, backups: backupCount, danmuToday, videoToday },
                    perf: {
                        memRss: Math.round(mem.rss / 1048576), memHeap: Math.round(mem.heapUsed / 1048576),
                        cpuMs: cpu.user + cpu.system,
                        uptimeSec: Math.floor((Date.now() - API_START_TIME) / 1000),
                        pid: process.pid,
                        node: process.version,
                        version: APP_VERSION,
                        platform: process.platform + ' ' + process.arch
                    },
                    disk,
                    history: S.perfHistory
                }
            });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3450-3450 ── */
    /* 重启服务（插件/调试工具触发，优雅重启） */

    /* ── 原 server.js L3451-3459 ── */
    app.post('/api/admin/restart', checkAdmin, async (req, res) => {
        try {
            const { delay } = req.body || {};
            res.json({ code: 0, msg: '服务即将重启...' });
            setTimeout(() => { restartServer({ delay: delay ? Math.max(0, Math.min(60000, parseInt(delay) || 0)) : 1500 }).catch(() => {}); }, 300);
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3484-3484 ── */
    /* 保存更新/安装配置（npm 镜像源 + 插件市场源），立即生效无需重启 */

    /* ── 原 server.js L3485-3506 ── */
    app.post('/api/admin/update/config', checkAdmin, (req, res) => {
        try {
            const { npmRegistry, pluginRegistry } = req.body || {};
            const config = readConfig();
            if (!config.plugin) config.plugin = {};
            if (npmRegistry !== undefined) {
                const r = String(npmRegistry).trim().replace(/\/+$/, '');
                config.plugin.npmRegistry = r && /^https?:\/\//i.test(r) ? r : '';
            }
            if (pluginRegistry !== undefined) {
                const r2 = String(pluginRegistry).trim();
                /* 市场源支持 http(s) 与本地 file:// 清单（开发环境用） */
                config.plugin.registry = r2 && /^(https?:\/\/|file:\/\/)/i.test(r2) ? r2 : '';
            }
            writeConfig(config);
            S.marketCache = null; /* 源变化后清除市场缓存 */
            S.depsCache = null;   /* 依赖版本检查也基于 registry，一并失效 */
            res.json({ code: 0, msg: '更新/安装配置已保存', data: { npmRegistry: getNpmRegistry(), registry: getPluginConfig().registry } });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });
    },
};
