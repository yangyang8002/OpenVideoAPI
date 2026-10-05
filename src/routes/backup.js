/* 备份路由：本地备份 CRUD / 恢复（含批量）/ 云端配置与同步
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');
const { restoreAll } = require('../../lib/store');
const { createCloud, TYPES: CLOUD_TYPES } = require('../../lib/cloud');

module.exports = {
    mount(ctx) {
        const { app, DEFAULT_CONFIG, checkAdmin, getAllCloudCfgs, cloudCfgFromBody, saveAllCloudCfgs, safeErrMsg, cloudSyncOne, BACKUP_NAME_RE, BACKUP_DIR, getBackupCfg, listBackups, saveBackupCfg, checkBackupSchedule, runBackup, cloudUploadFile, S, readConfig, writeConfig, applyTrustProxy } = ctx;

    /* ── 原 server.js L2401-2404 ── */
    app.get('/api/admin/cloud/config', checkAdmin, (req, res) => {
        const cfgs = getAllCloudCfgs();
        res.json({ code: 0, data: cfgs.map(c => ({ ...c, password: c.password ? '******' : '' })) });
    });

    /* ── 原 server.js L2406-2424 ── */
    app.post('/api/admin/cloud/config', checkAdmin, (req, res) => {
        const body = req.body || {};
        if (!body.type || !CLOUD_TYPES.includes(body.type)) return res.status(400).json({ code: 1, msg: '无效的同步类型' });
        const cfgs = getAllCloudCfgs();
        if (body.id) {
            /* 更新已有配置 */
            const idx = cfgs.findIndex(c => c.id === body.id);
            if (idx === -1) return res.status(404).json({ code: 1, msg: '云端配置不存在' });
            const updated = { ...cloudCfgFromBody(body.type, body), id: body.id, lastSyncAt: cfgs[idx].lastSyncAt, lastSyncOk: cfgs[idx].lastSyncOk, lastSyncMsg: cfgs[idx].lastSyncMsg };
            cfgs[idx] = updated;
        } else {
            /* 新增配置 */
            const c = cloudCfgFromBody(body.type, body);
            c.id = 'c' + Date.now().toString(36);
            cfgs.push(c);
        }
        saveAllCloudCfgs(cfgs);
        res.json({ code: 0, msg: '云端配置已保存' });
    });

    /* ── 原 server.js L2426-2433 ── */
    app.post('/api/admin/cloud/delete', checkAdmin, (req, res) => {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ code: 1, msg: '缺少配置 ID' });
        const cfgs = getAllCloudCfgs().filter(c => c.id !== id);
        if (cfgs.length === getAllCloudCfgs().length) return res.status(404).json({ code: 1, msg: '配置不存在' });
        saveAllCloudCfgs(cfgs);
        res.json({ code: 0, msg: '已删除云端配置' });
    });

    /* ── 原 server.js L2435-2447 ── */
    app.post('/api/admin/cloud/test', checkAdmin, async (req, res) => {
        const body = req.body || {};
        if (!CLOUD_TYPES.includes(body.type)) return res.status(400).json({ code: 1, msg: '无效的同步类型' });
        const c = cloudCfgFromBody(body.type, body);
        try {
            const t0 = Date.now();
            const cloud = createCloud(c);
            await cloud.test();
            res.json({ code: 0, msg: '连接成功（' + (Date.now() - t0) + 'ms）' });
        } catch (e) {
            res.json({ code: 1, msg: '连接失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2449-2468 ── */
    app.post('/api/admin/cloud/sync', checkAdmin, async (req, res) => {
        try {
            const { id } = req.body || {};
            const cfgs = getAllCloudCfgs();
            const targets = id ? cfgs.filter(c => c.id === id) : cfgs.filter(c => c.enabled && c.type);
            if (!targets.length) return res.status(400).json({ code: 1, msg: '没有可同步的云端配置' });
            let total = 0;
            for (const cfg of targets) {
                await cloudSyncOne(cfg);
                total++;
                cfg.lastSyncAt = Date.now();
                cfg.lastSyncOk = true;
                cfg.lastSyncMsg = '已同步';
            }
            saveAllCloudCfgs(cfgs);
            res.json({ code: 0, msg: '同步完成，共 ' + total + ' 个云端目标', data: { count: total } });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '同步失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2470-2486 ── */
    app.get('/api/admin/cloud/list', checkAdmin, async (req, res) => {
        try {
            const { id } = req.query || {};
            const cfgs = getAllCloudCfgs();
            const target = id ? cfgs.find(c => c.id === id) : cfgs.find(c => c.enabled && c.type);
            if (!target) {
                res.json({ code: 0, data: [] });
                return;
            }
            const cloud = createCloud(target);
            const rows = await cloud.list();
            rows.sort((a, b) => (b.modified || 0) - (a.modified || 0));
            res.json({ code: 0, data: rows.filter(r => BACKUP_NAME_RE.test(r.name)), targetId: target.id });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '获取云端列表失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2488-2488 ── */
    /* 云端备份 → 本地，下载/删除 需传 cloudId 指定云端配置 */

    /* ── 原 server.js L2489-2503 ── */
    app.post('/api/admin/cloud/download', checkAdmin, async (req, res) => {
        const { id: cloudId, name } = req.body || {};
        if (!BACKUP_NAME_RE.test(name)) return res.status(400).json({ code: 1, msg: '无效的备份文件名' });
        try {
            const cfgs = getAllCloudCfgs();
            const target = cfgs.find(c => c.id === cloudId) || cfgs.find(c => c.enabled && c.type);
            if (!target) return res.status(400).json({ code: 1, msg: '云端未配置' });
            const cloud = createCloud(target);
            const dest = path.join(BACKUP_DIR, name);
            await cloud.download(name, dest);
            res.json({ code: 0, msg: '已下载到本地: ' + name });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '下载失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2505-2518 ── */
    app.post('/api/admin/cloud/delete', checkAdmin, async (req, res) => {
        const { id: cloudId, name } = req.body || {};
        if (!BACKUP_NAME_RE.test(name)) return res.status(400).json({ code: 1, msg: '无效的备份文件名' });
        try {
            const cfgs = getAllCloudCfgs();
            const target = cfgs.find(c => c.id === cloudId) || cfgs.find(c => c.enabled && c.type);
            if (!target) return res.status(400).json({ code: 1, msg: '云端未配置' });
            const cloud = createCloud(target);
            await cloud.remove(name);
            res.json({ code: 0, msg: '已删除云端备份 ' + name });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '删除失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2520-2522 ── */
    app.get('/api/admin/backup/list', checkAdmin, (req, res) => {
        res.json({ code: 0, data: { config: getBackupCfg(), backups: listBackups().reverse() } });
    });

    /* ── 原 server.js L2524-2536 ── */
    app.post('/api/admin/backup/config', checkAdmin, (req, res) => {
        const { enabled, intervalHours, maxKeep, contents } = req.body || {};
        const cfg = getBackupCfg();
        if (enabled !== undefined) cfg.enabled = !!enabled;
        if (intervalHours) cfg.intervalHours = Math.max(1, Math.min(720, parseInt(intervalHours) || 24));
        if (maxKeep) cfg.maxKeep = Math.max(1, Math.min(100, parseInt(maxKeep) || 10));
        if (contents) cfg.contents = Array.isArray(contents) ? contents.filter(x => x === 'data' || x === 'config') : cfg.contents;
        /* 保存配置即重置计时：立即开始按新间隔运行（首次启用时 nextRunAt=0 → 立即备份一次） */
        cfg.nextRunAt = 0;
        saveBackupCfg(cfg);
        if (cfg.enabled) checkBackupSchedule();
        res.json({ code: 0, msg: '备份配置已保存', data: cfg });
    });

    /* ── 原 server.js L2538-2545 ── */
    app.post('/api/admin/backup/run', checkAdmin, async (req, res) => {
        try {
            const r = await runBackup();
            res.json({ code: 0, msg: '备份完成: ' + r.name, data: r });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '备份失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2547-2547 ── */
    /* 添加备份流程：选择备份内容 + 目标（local=本地 / cloud=云端 / 二者都要），可一次生成多份备份 */

    /* ── 原 server.js L2548-2584 ── */
    app.post('/api/admin/backup/create', checkAdmin, async (req, res) => {
        const { contents, targets } = req.body || {};
        const t = Array.isArray(targets) ? targets.filter(x => x === 'local' || x === 'cloud') : ['local'];
        if (!t.length) return res.status(400).json({ code: 1, msg: '请选择备份目标' });
        try {
            const r = await runBackup(contents, { autoSync: false });
            const result = { name: r.name, size: r.size, contents: r.contents, targets: t, local: t.includes('local'), cloud: false };
            if (t.includes('cloud')) {
                const cfgs = getAllCloudCfgs();
                const enabled = cfgs.filter(c => c.enabled && c.type);
                if (!enabled.length) return res.status(400).json({ code: 1, msg: '云端未配置，请先在「管理配置 → 云端同步」中保存连接配置' });
                for (const cfg of enabled) {
                    try { await cloudUploadFile(cfg, r.name); } catch (e) { console.error('[云端] 创建备份同步失败:', safeErrMsg(e)); }
                }
                result.cloud = true;
                if (!t.includes('local')) {
                    try { fs.rmSync(path.join(BACKUP_DIR, r.name)); result.localRemoved = true; } catch (e) {}
                }
                /* 更新所有使用过的云端配置的同步状态 */
                const allCfgs = getAllCloudCfgs();
                for (const c of allCfgs) {
                    if (enabled.some(e => e.id === c.id)) {
                        c.lastSyncAt = Date.now();
                        c.lastSyncOk = true;
                        c.lastSyncMsg = '已同步 ' + r.name;
                    }
                }
                saveAllCloudCfgs(allCfgs);
            }
            const parts = [];
            if (result.local) parts.push('本地');
            if (result.cloud) parts.push('云端');
            res.json({ code: 0, msg: '备份完成（' + parts.join(' + ') + '）', data: result });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '备份失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L2586-2593 ── */
    app.get('/api/admin/backup/download', checkAdmin, (req, res) => {
        const name = String(req.query.name || '');
        if (!BACKUP_NAME_RE.test(name)) return res.status(400).json({ code: 1, msg: '无效的备份文件名' });
        const file = path.join(BACKUP_DIR, name);
        if (!fs.existsSync(file)) return res.status(404).json({ code: 1, msg: '备份不存在' });
        res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
        res.sendFile(file);
    });

    /* ── 原 server.js L2595-2602 ── */
    app.post('/api/admin/backup/delete', checkAdmin, (req, res) => {
        const { name } = req.body || {};
        if (!BACKUP_NAME_RE.test(name)) return res.status(400).json({ code: 1, msg: '无效的备份文件名' });
        const file = path.join(BACKUP_DIR, name);
        if (!fs.existsSync(file)) return res.status(404).json({ code: 1, msg: '备份不存在' });
        fs.rmSync(file);
        res.json({ code: 0, msg: '已删除备份 ' + name });
    });

    /* ── 原 server.js L2604-2604 ── */
    /* 从备份恢复：数据覆盖当前存储；配置合并恢复但保留当前数据库连接，避免恢复后连错库 */

    /* ── 原 server.js L2605-2630 ── */
    app.post('/api/admin/backup/restore', checkAdmin, async (req, res) => {
        const { name } = req.body || {};
        if (!BACKUP_NAME_RE.test(name)) return res.status(400).json({ code: 1, msg: '无效的备份文件名' });
        const file = path.join(BACKUP_DIR, name);
        if (!fs.existsSync(file)) return res.status(404).json({ code: 1, msg: '备份不存在' });
        S.dbMigrating = true;
        try {
            const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (!payload || !payload.backup) return res.status(400).json({ code: 1, msg: '备份文件损坏' });
            if (payload.data) await restoreAll(S.store, payload.data);
            if (payload.config) {
                const config = readConfig();
                const merged = { ...DEFAULT_CONFIG, ...payload.config };
                merged.security = { ...DEFAULT_CONFIG.security, ...(payload.config.security || {}) };
                merged.db = config.db; /* 保留当前数据库连接配置 */
                merged.backup = config.backup; /* 保留当前备份配置 */
                writeConfig(merged);
                applyTrustProxy(merged);
            }
            res.json({ code: 0, msg: '已从备份恢复' + (payload.data ? '（数据）' : '') + (payload.config ? '（配置）' : '') });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '恢复失败: ' + safeErrMsg(e) });
        } finally {
            S.dbMigrating = false;
        }
    });

    /* ── 原 server.js L2632-2632 ── */
    /* 批量恢复：按时间从旧到新依次恢复所选备份（数据/配置同步协调，全程暂停写入） */

    /* ── 原 server.js L2633-2670 ── */
    app.post('/api/admin/backup/restore-batch', checkAdmin, async (req, res) => {
        const { names } = req.body || {};
        if (!Array.isArray(names) || !names.length) return res.status(400).json({ code: 1, msg: '未选择备份' });
        if (names.length > 20) return res.status(400).json({ code: 1, msg: '单次最多恢复 20 个备份' });
        const all = listBackups();
        const byName = {};
        for (const b of all) byName[b.name] = b;
        const ordered = [];
        for (const n of names) {
            if (!BACKUP_NAME_RE.test(n) || !byName[n]) return res.status(400).json({ code: 1, msg: '无效的备份: ' + n });
            ordered.push(byName[n]);
        }
        ordered.sort((a, b) => a.mtime - b.mtime); /* 旧 → 新 */
        S.dbMigrating = true;
        let restored = 0;
        try {
            for (const b of ordered) {
                const payload = JSON.parse(fs.readFileSync(b.path ? b.path : path.join(BACKUP_DIR, b.name), 'utf8'));
                if (!payload || !payload.backup) continue;
                if (payload.data) await restoreAll(S.store, payload.data);
                if (payload.config) {
                    const config = readConfig();
                    const merged = { ...DEFAULT_CONFIG, ...payload.config };
                    merged.security = { ...DEFAULT_CONFIG.security, ...(payload.config.security || {}) };
                    merged.db = config.db;
                    merged.backup = config.backup;
                    writeConfig(merged);
                    applyTrustProxy(merged);
                }
                restored++;
            }
            res.json({ code: 0, msg: '已依次恢复 ' + restored + ' 个备份' });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '恢复失败（已恢复 ' + restored + ' 个）: ' + safeErrMsg(e) });
        } finally {
            S.dbMigrating = false;
        }
    });
    },
};
