/* 数据库路由：信息/测试/切换（迁移前自动备份）/浏览/导出
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const { createStore, collectAll, restoreAll, summarizeData } = require('../../lib/store');

module.exports = {
    mount(ctx) {
        const { app, checkAdmin, readConfig, S, maskSecret, safeErrMsg, DB_TYPES, buildDbCfg, dbHostError, runBackup, writeConfig, DB_BROWSE_TABLES } = ctx;

    /* ── 原 server.js L2097-2120 ── */
    app.get('/api/admin/db/info', checkAdmin, async (req, res) => {
        try {
            const cfg = readConfig().db || {};
            const tables = await S.store.tables();
            res.json({
                code: 0,
                data: {
                    type: S.store.type,
                    label: S.store.label,
                    migrating: S.dbMigrating,
                    config: {
                        type: cfg.type || 'json',
                        sqlite: cfg.sqlite || { file: 'data/app.db' },
                        mysql: maskSecret(cfg.mysql),
                        postgres: maskSecret(cfg.postgres),
                        mongodb: maskSecret(cfg.mongodb)
                    },
                    tables
                }
            });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2122-2122 ── */
    /* 测试目标连接（不写入配置） */

    /* ── 原 server.js L2123-2141 ── */
    app.post('/api/admin/db/test', checkAdmin, async (req, res) => {
        const { type, sqlite, mysql, postgres, mongodb } = req.body || {};
        if (!DB_TYPES.includes(type)) return res.status(400).json({ code: 1, msg: '无效的存储类型' });
        if (type === 'json') return res.json({ code: 0, msg: 'JSON 文件存储无需连接测试' });
        const cfg = buildDbCfg(type, sqlite || {}, mysql || {}, postgres || {}, mongodb || {}, readConfig().db || {});
        const hostErr = dbHostError(cfg, type);
        if (hostErr) return res.status(400).json({ code: 1, msg: hostErr });
        let s = null;
        try {
            const t0 = Date.now();
            s = await createStore(type, cfg);
            const tables = await s.tables();
            await s.close(); s = null;
            res.json({ code: 0, msg: '连接成功（' + (Date.now() - t0) + 'ms）', data: { tables } });
        } catch (e) {
            if (s) { try { await s.close(); } catch (x) {} }
            res.json({ code: 1, msg: '连接失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2143-2143 ── */
    /* 切换存储并自动迁移全部数据（弹幕/视频/屏蔽词/账号/IP 封禁白名单/登录记录/统计），无需重启 */

    /* ── 原 server.js L2144-2173 ── */
    app.post('/api/admin/db/switch', checkAdmin, async (req, res) => {
        const { type, sqlite, mysql, postgres, mongodb } = req.body || {};
        if (!DB_TYPES.includes(type)) return res.status(400).json({ code: 1, msg: '无效的存储类型' });
        if (type === S.store.type) return res.status(400).json({ code: 1, msg: '当前已是该存储，无需切换' });
        const cfg = buildDbCfg(type, sqlite || {}, mysql || {}, postgres || {}, mongodb || {}, readConfig().db || {});
        const hostErr = dbHostError(cfg, type);
        if (hostErr) return res.status(400).json({ code: 1, msg: hostErr });
        let next = null;
        S.dbMigrating = true;
                /* 迁移前自动备份（沿用现有备份机制；失败仅记录，不阻塞切换） */
                try { await runBackup(undefined, { autoSync: true }); } catch (e) { console.error('[备份] 迁移前自动备份失败:', (e && e.message ? e.message : e)); }
        try {
            next = await createStore(type, cfg);
            const data = await collectAll(S.store);
            const summary = summarizeData(data);
            await restoreAll(next, data);
            const old = S.store;
            S.store = next; next = null;
            const config = readConfig();
            config.db = { type, ...cfg };
            writeConfig(config);
            try { await old.close(); } catch (e) { console.error('[数据库] 关闭旧存储失败:', e.message); }
            if (S.pluginManager) S.pluginManager.rebindStore(S.store, S.pluginModel);
            console.log('[数据库] 已切换 ' + old.label + ' → ' + S.store.label + '，迁移数据: ' + JSON.stringify(summary));
            res.json({ code: 0, msg: '已切换 ' + old.label + ' → ' + S.store.label + '，数据迁移完成', data: summary });
        } catch (e) {
            if (next) { try { await next.close(); } catch (x) {} }
            res.status(500).json({ code: 1, msg: '切换失败: ' + safeErrMsg(e) });
        } finally {
            S.dbMigrating = false;
        }
    });

    /* ── 原 server.js L2175-2175 ── */
    /* 表数据浏览（表名显式白名单，防注入与越权读取） */

    /* ── 原 server.js L2176-2188 ── */
    app.get('/api/admin/db/data', checkAdmin, async (req, res) => {
        const table = String(req.query.table || '');
        if (!DB_BROWSE_TABLES.includes(table)) return res.status(400).json({ code: 1, msg: '无效的数据表' });
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const search = String(req.query.search || '').slice(0, 200);
        try {
            const d = await S.store.browse(table, { page, limit, search });
            res.json({ code: 0, data: { list: d.list, total: d.total, page, limit } });
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2190-2190 ── */
    /* 导出全部数据备份（JSON） */

    /* ── 原 server.js L2191-2201 ── */
    app.get('/api/admin/db/export', checkAdmin, async (req, res) => {
        try {
            const data = await collectAll(S.store);
            data.exportedAt = Date.now();
            data.storage = { type: S.store.type, label: S.store.label };
            res.setHeader('Content-Disposition', 'attachment; filename="openvideo-backup-' + new Date().toISOString().slice(0, 10) + '.json"');
            res.json(data);
        } catch (e) {
            res.status(500).json({ code: 1, msg: safeErrMsg(e) });
        }
    });
    },
};
