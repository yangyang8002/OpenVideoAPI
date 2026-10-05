/* 管理路由：配置/API管理/日志/控制台/重启/更新配置
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const fs = require('fs');

module.exports = {
    define(ctx) {
        const { readConfig, S, apiTotals, TIMEZONES } = ctx;

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

    /* ── T4 设置中心（additive）：分域 schema + 校验/取值/写值助手 ──
       纯新增，不改动既有 GET/POST /api/admin/config 的语义；
       schema 同时驱动前端渲染与服务端校验（validate/save 共用同一套规则）。 */
    const SETTINGS_SCHEMA = {
        general: {
            title: '常规',
            items: {
                'timezone': { label: '服务器时区', type: 'select', options: TIMEZONES, default: 'Asia/Shanghai', desc: '影响视频日期分组、日志与备份文件名中的时间显示' },
                'language': { label: '站点语言', type: 'select', options: ['zh', 'zhHant', 'wyw', 'en', 'ja', 'fr'], optionLabels: { zh: '简体中文', zhHant: '繁體中文', wyw: '文言文', en: 'English', ja: '日本語', fr: 'Français' }, default: 'zh', desc: '保存后管理面板将切换到所选语言', inputId: 'cfgLang', skip: true, afterSave: 'setAdminLang' }
            }
        },
        theme: {
            title: '播放器与主题',
            items: {
                'theme': { label: '播放器主题', type: 'select', options: [], default: 'bili', desc: '公开播放页面的外观主题，列表由已安装主题提供', inputId: 'cfgTheme' },
                'adminTheme': { label: '后台主题', type: 'select', options: [], default: 'md3', desc: '管理面板外观主题，切换后立即预览', inputId: 'cfgAdminTheme', onChange: 'setAdminTheme' },
                'cdn.enabled': { label: 'CDN 加速', type: 'bool', default: false, desc: '通过 CDN 分发静态资源，减轻源站带宽压力' },
                'cdn.baseUrl': { label: 'CDN 地址', type: 'text', default: '', pattern: '^https?://', desc: '静态资源的 CDN 前缀，需以 http(s):// 开头，关闭加速时可留空' }
            }
        },
        danmaku: {
            title: '弹幕',
            items: {
                'danmaku.maxLength': { label: '单条弹幕字数上限', type: 'int', min: 1, max: 2000, default: 500, desc: '超过该字数的弹幕在提交时被拒绝' },
                'danmaku.authorMaxLength': { label: '弹幕署名字数上限', type: 'int', min: 1, max: 100, default: 50, desc: '弹幕发送者昵称的最大长度' },
                'danmakuLimit.enabled': { label: '发送频率限制', type: 'bool', default: false, desc: '开启后限制单用户每分钟可发送的弹幕数量' },
                'danmakuLimit.maxPerMinute': { label: '每分钟弹幕上限', type: 'int', min: 1, max: 10000, default: 10, desc: '频率限制开启时，单用户每分钟最多发送的弹幕数' },
                'render.maxPerSecond': { label: '渲染弹幕上限', type: 'int', min: 1, max: 2000, default: 250, desc: '渲染层每秒最多同时渲染的弹幕条数，超出的直接丢弃' },
                'render.speedJitter': { label: '速度抖动', type: 'int', min: 0, max: 100, default: 10, desc: '弹幕滚动速度的随机抖动百分比，让轨迹更自然' }
            }
        },
        video: {
            title: '字幕与视频',
            items: {
                'upload.maxMB': { label: '上传体积上限', type: 'int', min: 1, max: 4096, default: 200, desc: '单个视频文件允许上传的最大体积（MB）' },
                'upload.previewKB': { label: '预览体积上限', type: 'int', min: 0, max: 10240, default: 200, desc: '上传预览允许的最大体积（KB）' }
            }
        },
        security: {
            title: '安全与登录',
            items: {
                'security.sessionMinutes': { label: '会话时长', type: 'int', min: 5, max: 1440, default: 120, unit: '分钟', desc: '登录会话的有效时长，过期后需重新登录' },
                'security.adminPath': { label: '安全入口路径', type: 'text', default: '', pattern: '^[a-zA-Z0-9_-]*$', desc: '设置后需从 /<路径> 访问后台；留空使用默认入口，仅允许字母数字与下划线短横线' },
                'security.trustProxy': { label: '信任反向代理', type: 'bool', default: true, desc: '开启时从 X-Forwarded-For 等请求头解析真实 IP；直连部署时应关闭' },
                'security.autoBan': { label: '异常自动封禁', type: 'bool', default: true, desc: '触发下方任一异常阈值后自动封禁该 IP' },
                'security.anomaly.reqPerMin': { label: '每分钟请求阈值', type: 'int', min: 1, max: 100000, default: 60, desc: '单 IP 每分钟请求数超过该值判定为异常' },
                'security.anomaly.mbPerMin': { label: '每分钟流量阈值', type: 'int', min: 1, max: 100000, default: 20, unit: 'MB', desc: '单 IP 每分钟流量超过该值判定为异常' },
                'security.anomaly.reqPerHour': { label: '每小时请求阈值', type: 'int', min: 1, max: 1000000, default: 2000, desc: '单 IP 每小时请求数超过该值判定为异常' },
                'security.anomaly.mbPerHour': { label: '每小时流量阈值', type: 'int', min: 1, max: 1000000, default: 1024, unit: 'MB', desc: '单 IP 每小时流量超过该值判定为异常' },
                'security.loginLimit.maxFail': { label: '失败锁定阈值', type: 'int', min: 1, max: 100, default: 5, desc: '连续登录失败达到该次数后锁定该 IP' },
                'security.loginLimit.windowMin': { label: '失败统计窗口', type: 'int', min: 1, max: 1440, default: 10, unit: '分钟', desc: '统计连续登录失败的窗口时长' },
                'security.loginLimit.lockMin': { label: '锁定时长', type: 'int', min: 1, max: 1440, default: 15, unit: '分钟', desc: '触发登录锁定后的封禁时长' },
                'security.advanced.hidePoweredBy': { label: '隐藏 Powered-By', type: 'bool', default: true, desc: '隐藏 X-Powered-By 响应头，减少指纹暴露' },
                'security.advanced.hsts': { label: 'HSTS', type: 'bool', default: true, desc: '启用严格传输安全（仅 HTTPS 部署生效）' },
                'security.advanced.noSniff': { label: '禁止 MIME 嗅探', type: 'bool', default: true, desc: '设置 X-Content-Type-Options: nosniff 响应头' },
                'security.advanced.referrer': { label: 'Referrer 策略', type: 'select', options: ['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url'], default: 'no-referrer', desc: 'Referrer-Policy 响应头策略' },
                'security.advanced.cors': { label: '允许跨域', type: 'bool', default: true, desc: '允许跨域调用 API（播放器嵌入第三方站点时需要）' },
                'security.advanced.corsOrigin': { label: '跨域来源', type: 'text', default: '*', desc: 'Access-Control-Allow-Origin 的值，* 表示任意来源，也可填具体域名' },
                'security.advanced.debug': { label: '调试模式', type: 'bool', default: false, desc: '开启后输出更详细的调试日志，生产环境建议关闭' }
            }
        },
        api: {
            title: 'API 与限流',
            items: {
                'pow.enabled': { label: '工作量证明', type: 'bool', default: false, desc: '开启后调用 API 前需完成工作量证明，防止轻量刷量' },
                'pow.difficulty': { label: '证明难度', type: 'int', min: 1, max: 6, default: 4, desc: '工作量证明的难度等级，越高越难刷但客户端更耗时' },
                'rateLimit.enabled': { label: '速率限制', type: 'bool', default: false, desc: '开启后按窗口限制单 IP 的 API 请求频率' },
                'rateLimit.windowMs': { label: '统计窗口', type: 'int', min: 10000, max: 3600000, default: 60000, unit: '秒', convert: true, desc: '速率统计的窗口时长，界面以秒填写' },
                'rateLimit.max': { label: '窗口请求上限', type: 'int', min: 10, max: 100000, default: 60, desc: '窗口内单 IP 允许的最大请求数' },
                'api.retentionDays': { label: '统计保留天数', type: 'int', min: 1, max: 90, default: 1, desc: 'API 调用统计的保留天数', inputId: 'apiRetention' }
            }
        },
        db: { title: '数据库', items: {} },
        backup: {
            title: '备份与更新',
            items: {
                'backup.enabled': { label: '定时备份', type: 'bool', default: false, desc: '开启后按间隔自动执行备份' },
                'backup.intervalHours': { label: '备份间隔', type: 'int', min: 1, max: 720, default: 24, unit: '小时', desc: '自动备份的执行间隔' },
                'backup.maxKeep': { label: '备份保留份数', type: 'int', min: 1, max: 100, default: 10, desc: '最多保留的备份份数，超出后轮换删除' },
                'backup.contents': { label: '备份内容', type: 'checks', options: ['data', 'config'], optionLabels: { data: '数据', config: '配置文件' }, default: ['data', 'config'], desc: '自动备份包含的内容，至少选择一项' }
            }
        },
        plugins: {
            title: '插件',
            items: {
                'plugin.npmRegistry': { label: 'npm 镜像源', type: 'text', default: '', pattern: '^https?://', desc: '安装依赖使用的 npm 镜像，留空使用官方源或环境变量 OPENVIDEO_NPM_REGISTRY' },
                'plugin.registry': { label: '插件市场源', type: 'text', default: '', pattern: '^(https?://|file://)', desc: '插件市场清单地址，支持 http(s) 与本地 file://，留空使用官方源' }
            }
        }
    };

    const SETTINGS_DOMAIN_ORDER = ['general', 'theme', 'danmaku', 'video', 'security', 'api', 'db', 'backup', 'plugins'];

    /* T4 修复：item 键与所属域键的前缀不总一致（plugins 域含 plugin.*、theme 域含
       cdn.*、general 域含叶子名键），按域前缀查找会漏掉大半规则导致校验/保存静默跳过；
       改为扁平全量规则表，任何 item 键（即完整 config 点路径）都能解析。 */
    const SETTINGS_RULES = {};
    for (const dom of Object.keys(SETTINGS_SCHEMA)) {
        const items = SETTINGS_SCHEMA[dom].items || {};
        for (const p of Object.keys(items)) SETTINGS_RULES[p] = items[p];
    }

    function settingsResolve(path) {
        return SETTINGS_RULES[path] || null;
    }

    /* 从 config 逐项取值（嵌套点路径），缺失时回退 schema 默认值 */
    function settingsValuesFromConfig(config) {
        const out = {};
        for (const dom of Object.keys(SETTINGS_SCHEMA)) {
            const items = SETTINGS_SCHEMA[dom].items || {};
            for (const path of Object.keys(items)) {
                let v = config;
                for (const p of path.split('.')) v = v == null ? undefined : v[p];
                out[path] = v === undefined ? items[path].default : v;
            }
        }
        return out;
    }

    /* 校验：与前端同规则；返回 { path: 错误消息 } */
    function validateSettingsValues(values) {
        const errors = {};
        for (const path of Object.keys(values)) {
            const rule = settingsResolve(path);
            if (!rule) continue;
            const v = values[path];
            if (rule.type === 'bool') continue;
            if (rule.type === 'int') {
                const n = typeof v === 'number' ? v : Number(v);
                if (v === '' || v == null || !Number.isInteger(n)) { errors[path] = '必须是整数'; continue; }
                if (rule.min != null && n < rule.min) { errors[path] = '不能小于 ' + rule.min; continue; }
                if (rule.max != null && n > rule.max) { errors[path] = '不能大于 ' + rule.max; continue; }
                continue;
            }
            if (rule.type === 'select') {
                if (rule.options && rule.options.length && !rule.options.includes(String(v))) { errors[path] = '不支持的取值'; continue; }
                continue;
            }
            if (rule.type === 'checks') {
                if (!Array.isArray(v) || !v.length) { errors[path] = '至少选择一项'; continue; }
                if (rule.options && v.some(x => !rule.options.includes(x))) { errors[path] = '不支持的取值'; continue; }
                continue;
            }
            const s = String(v == null ? '' : v).trim();
            if (rule.pattern && s && !new RegExp(rule.pattern).test(s)) errors[path] = '格式不正确';
        }
        return errors;
    }

    function settingsDeepSet(obj, path, value) {
        const parts = path.split('.');
        let cur = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
            cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
    }

    function settingsCoerce(rule, v) {
        if (rule.type === 'bool') return v === true || v === 'true' || v === 'on' || v === 1;
        if (rule.type === 'int') return typeof v === 'number' ? v : Number(v);
        if (rule.type === 'checks') return Array.isArray(v) ? v : [];
        return String(v == null ? '' : v).trim();
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

        Object.assign(ctx, { DEFAULT_NAV, DEFAULT_NAV, getNavConfig, getNavConfig, samplePerf, samplePerf, SETTINGS_SCHEMA, SETTINGS_DOMAIN_ORDER, settingsResolve, settingsValuesFromConfig, validateSettingsValues, settingsDeepSet, settingsCoerce });
    },

    mount(ctx) {
        const { app, checkAdmin, readConfig, DEFAULT_API_RULES, apiLayers, API_START_TIME, apiTotals, getRetentionDays, writeConfig, invalidateApiConfig, appLogs, debugLogs, DEFAULT_NAV, applyTrustProxy, S, ipTotals, listBackups, ROOT_DIR, APP_VERSION, safeErrMsg, restartServer, getNpmRegistry, getPluginConfig, SETTINGS_SCHEMA, SETTINGS_DOMAIN_ORDER, settingsResolve, settingsValuesFromConfig, validateSettingsValues, settingsDeepSet, settingsCoerce, getBackupCfg, checkBackupSchedule } = ctx;

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

    /* Debug 日志：每个插件与本体的请求记录（含来源分类） */
    app.get('/api/admin/debug-logs', checkAdmin, (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        res.json({ code: 0, data: debugLogs.slice(-limit).reverse() });
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

    /* ── T4 设置中心（additive）：分域读取 / 校验 / 保存 ──
       与既有 GET/POST /api/admin/config 并存，旧端点保持不变；
       firstRunGuard 挂在 /api/admin 前缀上，新端点自动受初始化守卫保护。 */
    app.get('/api/admin/settings', checkAdmin, (req, res) => {
        try {
            const config = readConfig();
            res.json({ code: 0, data: { schema: SETTINGS_SCHEMA, order: SETTINGS_DOMAIN_ORDER, values: settingsValuesFromConfig(config) } });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    app.post('/api/admin/settings/validate', checkAdmin, (req, res) => {
        try {
            const values = (req.body || {}).values || {};
            res.json({ code: 0, data: { errors: validateSettingsValues(values) } });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    app.post('/api/admin/settings/save', checkAdmin, (req, res) => {
        try {
            const values = (req.body || {}).values || {};
            const errors = validateSettingsValues(values);
            if (Object.keys(errors).length) { res.status(400).json({ code: 2, msg: '部分设置项校验未通过', errors }); return; }
            const config = readConfig();
            let securityTouched = false, apiTouched = false, pluginTouched = false, backupCfg = null;
            for (const path of Object.keys(values)) {
                const rule = settingsResolve(path);
                if (!rule) continue;
                const v = settingsCoerce(rule, values[path]);
                if (path.indexOf('backup.') === 0) {
                    if (!backupCfg) backupCfg = getBackupCfg();
                    if (path === 'backup.enabled') backupCfg.enabled = v;
                    else if (path === 'backup.intervalHours') backupCfg.intervalHours = v;
                    else if (path === 'backup.maxKeep') backupCfg.maxKeep = v;
                    else if (path === 'backup.contents') backupCfg.contents = v;
                    continue;
                }
                if (path === 'plugin.npmRegistry') {
                    if (!config.plugin) config.plugin = {};
                    config.plugin.npmRegistry = v && /^https?:\/\//i.test(v) ? v : '';
                    pluginTouched = true; continue;
                }
                if (path === 'plugin.registry') {
                    if (!config.plugin) config.plugin = {};
                    config.plugin.registry = v && /^(https?:\/\/|file:\/\/)/i.test(v) ? v : '';
                    pluginTouched = true; continue;
                }
                settingsDeepSet(config, path, v);
                const dom = path.split('.')[0];
                if (dom === 'security') securityTouched = true;
                if (['api', 'pow', 'rateLimit', 'danmakuLimit', 'danmaku', 'upload', 'render'].indexOf(dom) >= 0) apiTouched = true;
            }
            if (backupCfg) { backupCfg.nextRunAt = 0; config.backup = backupCfg; } /* 与 backup/config 一致：改配置即重置计时 */
            writeConfig(config);
            if (securityTouched) applyTrustProxy(config);
            if (apiTouched) invalidateApiConfig();
            if (pluginTouched) { S.marketCache = null; S.depsCache = null; }
            if (backupCfg && backupCfg.enabled) checkBackupSchedule();
            res.json({ code: 0, msg: '设置已保存', data: config });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });
    },
};
