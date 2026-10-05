/* ==========================================================================
 * OpenVideoAPI 示例插件 v1.1.0
 *
 * v1 契约（全部保留，验证向后兼容）：
 *   1. 服务层：ctx.provide('stats')；inject 声明依赖（store/model/app/logger/http）
 *   2. 动态表：ctx.model.define('demo_notes', schema)
 *   3. 事件总线：ctx.on('danmu:send') / ctx.on('dispose')
 *   4. ctx.app / ctx.logger / ctx.router（/api/plugin/demo/*）
 *   5. 前端扩展：后台调试 tab + 播放器浮层（不变）
 *
 * v2 新能力（config.featuresV2 !== false 时启用）：
 *   7.  存储命名空间：ctx.model.namespace('demo').define('kv')
 *   8.  私有设置：ctx.settings（get/set/del/all，按插件名 kv 隔离）
 *   9.  定时任务：ctx.cron.every / ctx.cron.at（dispose 自动清理）
 *   10. 事件总线扩展：ctx.bus.on/once/off/emit/emitTo/events
 *   11. i18n 词条注入：ctx.i18n.add/locales/t
 *   12. 静态资源目录：ctx.static('/plugins/demo-assets', 'lib/client/assets')
 *   13. 自定义页面：ctx.pages.register（公开页 + 管理员鉴权页）
 *   14. HTTP 客户端：ctx.http.request / text（超时可控）
 *   15. 错误隔离演示：GET /api/plugin/demo/boom 抛异常 -> 500，主进程不受影响
 *   16. 生命周期钩子：onInstall/onEnable/onDisable/onUninstall/onUpdate
 *   17. 依赖声明：manifest.deps.openvideo = '>=26.0.0'
 * ========================================================================== */
'use strict';

module.exports = {
    apply(ctx, config) {
        const stats = { danmuCount: 0, startedAt: Date.now(), notesCount: 0 };
        /* 1. 提供服务（其他插件可在 manifest.inject 声明 'stats' 来使用） */
        ctx.provide('stats', {
            get: () => ({ ...stats }),
            addNote: async (text) => {
                const row = await notes.create({ text });
                stats.notesCount = await notes.count();
                return row;
            }
        });

        /* 2. 动态表 */
        const notes = ctx.model.define('demo_notes', {
            primary: 'id',
            fields: { id: { type: 'string' }, text: { type: 'string' }, createdAt: { type: 'number' } }
        });
        notes.count().then(n => { stats.notesCount = n; }).catch(() => {});

        /* 3. 事件总线：监听弹幕发送 */
        ctx.on('danmu:send', (danmu) => {
            stats.danmuCount++;
            if (config.logDanmu !== false) {
                ctx.logger.debug('danmu', '[' + danmu.vid + '] ' + danmu.text);
            }
        });

        /* 4. 插件路由（v1 端点，保留不变） */
        ctx.router.get('/api/plugin/demo/stats', async (req, res) => {
            res.json({ code: 0, data: {
                ...stats,
                version: ctx.version,
                uptime: ctx.app.uptime(),
                config: config
            } });
        });
        ctx.router.post('/api/plugin/demo/note', async (req, res) => {
            const text = String((req.body || {}).text || '').slice(0, 200);
            if (!text) return res.status(400).json({ code: 1, msg: '缺少内容' });
            const row = await notes.create({ text });
            res.json({ code: 0, data: row });
        });
        ctx.router.get('/api/plugin/demo/notes', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const search = String(req.query.search || '');
            const d = await notes.list({ page, limit: 20, search, searchKey: 'text' });
            res.json({ code: 0, data: d });
        });
        ctx.router.delete('/api/plugin/demo/note', async (req, res) => {
            const { id } = req.body || {};
            const ok = await notes.remove(id);
            res.json({ code: ok ? 0 : 1, msg: ok ? '已删除' : '不存在' });
        });

        /* ===================== v2 新能力演示 ===================== */
        const v2 = config.featuresV2 !== false;
        const caps = {
            v2, cronTicks: 0, onceTimerFired: false, busTicks: 0, onceFired: false,
            namespaces: [], bootCount: 0, i18nLocales: []
        };
        if (v2) {
            /* 7. 存储命名空间：表名实际为 demo__kv，与其他插件隔离 */
            const ns = ctx.model.namespace('demo');
            const nsKv = ns.define('kv', {
                primary: 'key',
                fields: { key: { type: 'string' }, value: { type: 'any' }, updatedAt: { type: 'number' } }
            });
            caps.namespaces = ns.list().map(t => t.name);
            nsKv.get('boot').then(row => {
                const next = ((row && row.value) || 0) + 1;
                caps.bootCount = next;
                return nsKv.create({ key: 'boot', value: next, updatedAt: Date.now() });
            }).catch(() => {});

            /* 9. 定时任务：周期 5s + 60s 后的一次性任务（dispose 自动清理） */
            ctx.cron.every(5000, () => {
                caps.cronTicks++;
                ctx.emit('demo:tick', { ticks: caps.cronTicks, at: Date.now() });
            });
            ctx.cron.at(Date.now() + 60000, () => {
                caps.onceTimerFired = true;
                ctx.logs.info('一次性定时任务（cron.at）触发');
            });

            /* 10. 事件总线扩展：插件内自收发（ctx.emit -> ctx.bus.on/once） */
            ctx.bus.on('demo:tick', (p) => {
                if (p && p.ticks) caps.busTicks = p.ticks;
            });
            ctx.bus.once('demo:tick', () => { caps.onceFired = true; });

            /* 11. i18n 词条注入：经 /api/plugins/i18n?locale=zh&plugin=demo 对外可查 */
            ctx.i18n.add('zh', { 'demo.hello': '你好，来自 demo 插件', 'demo.page': '插件自定义页面' });
            ctx.i18n.add('en', { 'demo.hello': 'Hello from demo plugin', 'demo.page': 'Plugin custom page' });
            caps.i18nLocales = ctx.i18n.locales();

            /* 12. 静态资源目录：/plugins/demo-assets/logo.txt */
            ctx.static('/plugins/demo-assets', 'lib/client/assets');

            /* 13. 自定义页面：公开页 + 需管理员登录的鉴权页（未登录 302 跳后台） */
            ctx.pages.register({ route: '/plugin/demo/hello', file: 'lib/client/page.html', title: 'Demo 插件页面', auth: false });
            ctx.pages.register({ route: '/plugin/demo/secure', file: 'lib/client/secure.html', title: 'Demo 鉴权页面', auth: true });

            /* 14/15. v2 演示端点 */
            ctx.router.get('/api/plugin/demo/capabilities', async (req, res) => {
                res.json({ code: 0, data: {
                    v2: caps.v2,
                    version: ctx.version,
                    cronTicks: caps.cronTicks,
                    onceTimerFired: caps.onceTimerFired,
                    busTicks: caps.busTicks,
                    onceFired: caps.onceFired,
                    namespaces: caps.namespaces,
                    bootCount: caps.bootCount,
                    i18n: { locales: ctx.i18n.locales(), hello: ctx.i18n.t('demo.hello', 'zh'), helloEn: ctx.i18n.t('demo.hello', 'en') },
                    busEvents: ctx.bus.events(),
                    settings: await ctx.settings.all()
                } });
            });
            ctx.router.get('/api/plugin/demo/settings', async (req, res) => {
                res.json({ code: 0, data: await ctx.settings.all() });
            });
            ctx.router.post('/api/plugin/demo/settings', async (req, res) => {
                const { key, value } = req.body || {};
                if (!key) return res.status(400).json({ code: 1, msg: '缺少 key' });
                await ctx.settings.set(String(key).slice(0, 64), value === undefined ? null : value);
                res.json({ code: 0, data: await ctx.settings.all() });
            });
            ctx.router.get('/api/plugin/demo/i18n', async (req, res) => {
                const locale = String(req.query.locale || 'zh');
                res.json({ code: 0, data: { locales: ctx.i18n.locales(), locale, t: ctx.i18n.t('demo.hello', locale) } });
            });
            ctx.router.get('/api/plugin/demo/http-check', async (req, res) => {
                const url = String(req.query.url || '');
                if (!/^https?:\/\//i.test(url)) return res.status(400).json({ code: 1, msg: '仅支持 http(s) URL' });
                try {
                    const text = await ctx.http.text(url, { timeout: 8000 });
                    res.json({ code: 0, data: { url, ok: text != null, sample: text ? text.slice(0, 500) : null } });
                } catch (e2) {
                    res.json({ code: 0, data: { url, ok: false, error: String((e2 && e2.message) || e2).slice(0, 200) } });
                }
            });
            /* 15. 错误隔离演示：抛异常 -> 插件路由级 500，主进程不受影响 */
            ctx.router.get('/api/plugin/demo/boom', async () => {
                throw new Error('演示：插件路由异常不应影响主进程');
            });
            ctx.logs.info('v2 能力已启用（命名空间表 / 私有设置 / 定时任务 / 事件总线扩展 / i18n / 静态资源 / 自定义页面 / 错误隔离演示端点）');
        } else {
            ctx.logs.warn('v2 能力未启用（featuresV2 = false）');
        }

        /* 5. 日志 + 服务信息 */
        ctx.logger.info('demo', '插件已加载，服务端版本 ' + ctx.version + '，PID ' + ctx.app.pid);

        /* 心跳定时器（v1 保留） */
        const interval = Math.max(5, parseInt(config.interval) || 60);
        const timer = setInterval(() => {
            ctx.logger.debug('demo', '心跳: 运行 ' + ctx.app.uptime() + 's，累计弹幕 ' + stats.danmuCount + '，cron ' + caps.cronTicks);
        }, interval * 1000);

        /* 卸载清理（v1 保留；v2 的 cron/pages/i18n/事件由管理器 dispose 自动清理） */
        ctx.on('dispose', () => {
            clearInterval(timer);
            ctx.logger.info('demo', '插件已卸载');
        });
    },

    /* ---- v2 生命周期钩子（manifest.hooks 声明；临时 ctx 执行，异常/超时只记日志） ---- */
    async onInstall(ctx) {
        await ctx.settings.set('installedAt', Date.now());
        ctx.logs.info('生命周期 install：已写入设置 installedAt');
    },
    async onEnable(ctx) {
        ctx.logs.info('生命周期 enable：插件被启用');
    },
    async onDisable(ctx) {
        ctx.logs.info('生命周期 disable：插件被禁用');
    },
    async onUninstall(ctx) {
        try { await ctx.settings.del('installedAt'); } catch (e) {}
        ctx.logs.info('生命周期 uninstall：已清理设置 installedAt');
    },
    async onUpdate(ctx) {
        ctx.logs.info('生命周期 update：插件被更新');
    }
};
