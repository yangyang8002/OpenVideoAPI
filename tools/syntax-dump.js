/* 存储初始化（JSON 自动迁移 + 默认账号 + 插件装配）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const crypto = require('crypto');
const { createStore, collectAll, restoreAll, summarizeData } = require('../lib/store');
const { PluginManager } = require('../lib/plugin');

module.exports = {
    define(ctx) {
        const { readConfig, DB_TYPES, hashPassword, APP_VERSION, API_START_TIME, writeConfig, applyTrustProxy, restartServer, pluginLogPush, pluginLogs, app, getNpmRegistry } = ctx;

    /* ── 原 server.js L3938-3938 ── */
    /* ==================== 存储初始化（可热切换，见数据库管理） ==================== */

    /* ── 原 server.js L3939-4021 ── */
    async function initStore() {
        const config = readConfig();
        const dbCfg = config.db || {};
        const type = DB_TYPES.includes(dbCfg.type) ? dbCfg.type : 'json';
        S.store = await createStore(type, dbCfg);
        console.log(`[数据库] 当前存储: ${S.store.label} (${S.store.type})`);

        // 目标库为空且 JSON 有数据 → 自动迁移（老用户升级零操作）
        if (type !== 'json') {
            try {
                const tables = await S.store.tables();
                const danmuRows = (tables.find(t => t.name === 'danmu') || {}).count || 0;
                const kvRows = (tables.find(t => t.name === 'kv') || {}).count || 0;
                if (danmuRows === 0 && kvRows === 0) {
                    const src = await createStore('json', {});
                    const data = await collectAll(src);
                    const summary = summarizeData(data);
                    if (summary.danmu || summary.videos || summary.banned_words || summary.accounts || summary.banned || summary.whitelist || summary.login_logs || summary.login_fails || summary.api_stats || summary.ip_stats) {
                        console.log(`[数据库] 检测到 JSON 数据，自动迁移到 ${S.store.label} ...`);
                        await restoreAll(S.store, data);
                        console.log('[数据库] 自动迁移完成: ' + JSON.stringify(summary));
                    }
                }
            } catch (e) {
                console.error('[数据库] 自动迁移失败（可稍后在管理后台手动切换）:', e.message);
            }
        }

        // 全新环境兜底：确保存在默认账号
        try {
            const accounts = await S.store.accountsAll();
            if (!Object.keys(accounts).length) {
                const salt = crypto.randomBytes(16).toString('hex');
                await S.store.accountsWrite({ admin: { salt, hash: hashPassword('admin123', salt), name: '管理员', created: Date.now() } });
                console.log('[认证] 已在 ' + S.store.label + ' 创建默认账号 admin / admin123（请立即修改密码）');
            }
        } catch (e) {
            console.error('[数据库] 默认账号检查失败:', e.message);
        }

        /* 插件系统初始化（加载已启用插件） */
        try {
            S.pluginModel = new (require('../lib/model').PluginModel)(S.store);
            const appService = {
                version: APP_VERSION,
                platform: process.platform + ' ' + process.arch,
                pid: process.pid,
                uptime: () => Math.floor((Date.now() - API_START_TIME) / 1000),
                getConfig: () => readConfig(),
                async saveConfig(patch) {
                    const cfg = readConfig();
                    const merged = { ...DEFAULT_CONFIG, ...cfg, ...(patch || {}) };
                    merged.security = { ...DEFAULT_CONFIG.security, ...(cfg.security || {}), ...((patch && patch.security) || {}) };
                    writeConfig(merged);
                    applyTrustProxy(merged);
                    return merged;
                },
                restart: async (opts) => restartServer(opts)
            };
            const loggerService = {
                debug: (scope, msg) => pluginLogPush('debug', scope, msg),
                info: (scope, msg) => pluginLogPush('info', scope, msg),
                warn: (scope, msg) => pluginLogPush('warn', scope, msg),
                error: (scope, msg) => pluginLogPush('error', scope, msg),
                log: (level, scope, msg) => pluginLogPush(level, scope, msg),
                tail: (n) => pluginLogs.slice(-(n || 200))
            };
            S.pluginManager = new PluginManager({
                app, S.store, model: S.pluginModel,
                readConfig,
                saveConfig: async (patch) => { await appService.saveConfig(patch); },
                restartServer: async (opts) => { await restartServer(opts); },
                npmRegistry: getNpmRegistry,
                version: APP_VERSION,
                log: (m) => { console.log('[插件] ' + m); pluginLogPush('info', 'plugin', m); }
            });
            S.pluginManager._injectServices({ app: appService, logger: loggerService });
            S.pluginManager.loadState();
            await S.pluginManager.loadEnabled();
        } catch (e) {
            console.error('[插件] 初始化失败:', e.message);
        }
    }

        Object.assign(ctx, { initStore });
    },
};
