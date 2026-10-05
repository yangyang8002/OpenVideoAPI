/* 备份核心：定时备份 + 云端同步（FTP/SFTP/WebDAV/OpenList）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');
const { collectAll } = require('../../lib/store');
const { createCloud, TYPES: CLOUD_TYPES } = require('../../lib/cloud');

module.exports = {
    define(ctx) {
        const { DATA_DIR, readConfig, writeConfig, fmtServerTime, APP_VERSION, S, safeErrMsg } = ctx;

    /* ── 原 server.js L2210-2210 ── */
    // ==================== 定时备份 ====================

    /* ── 原 server.js L2213-2213 ── */
    const BACKUP_DIR = path.join(DATA_DIR, 'backups');

    /* ── 原 server.js L2214-2214 ── */
    const BACKUP_NAME_RE = /^backup-\d{8}-\d{6}(?:-\d+)?\.json$/;

    /* ── 原 server.js L2216-2226 ── */
    function getBackupCfg() {
        const c = readConfig().backup || {};
        return {
            enabled: !!c.enabled,
            intervalHours: Math.max(1, Math.min(720, parseInt(c.intervalHours) || 24)),
            maxKeep: Math.max(1, Math.min(100, parseInt(c.maxKeep) || 10)),
            contents: Array.isArray(c.contents) ? c.contents.filter(x => x === 'data' || x === 'config') : ['data', 'config'],
            lastRunAt: c.lastRunAt || 0,
            nextRunAt: c.nextRunAt || 0
        };
    }

    /* ── 原 server.js L2227-2231 ── */
    function saveBackupCfg(c) {
        const config = readConfig();
        config.backup = c;
        writeConfig(config);
    }

    /* ── 原 server.js L2232-2241 ── */
    function listBackups() {
        if (!fs.existsSync(BACKUP_DIR)) return [];
        return fs.readdirSync(BACKUP_DIR)
            .filter(n => BACKUP_NAME_RE.test(n))
            .map(n => {
                const st = fs.statSync(path.join(BACKUP_DIR, n));
                return { name: n, size: st.size, mtime: st.mtimeMs };
            })
            .sort((a, b) => a.mtime - b.mtime);
    }

    /* ── 原 server.js L2242-2244 ── */
    function backupTsName(d) {
        return fmtServerTime(d);
    }

    /* ── 原 server.js L2246-2247 ── */
    /* 执行一次备份：内容可选（data=数据库数据 / config=服务器配置），数量超限自动清理最旧；
       opts.autoSync 控制是否触发云端自动同步（添加备份流程手动管理同步） */

    /* ── 原 server.js L2248-2284 ── */
    async function runBackup(contentsOverride, opts) {
        const cfg = getBackupCfg();
        const contents = (Array.isArray(contentsOverride) && contentsOverride.length)
            ? contentsOverride.filter(x => x === 'data' || x === 'config')
            : cfg.contents;
        if (!contents.length) throw new Error('备份内容不能为空');
        if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
        const payload = {
            backup: {
                createdAt: Date.now(),
                version: APP_VERSION,
                storage: { type: S.store.type, label: S.store.label },
                contents
            }
        };
        if (contents.includes('data')) payload.data = await collectAll(S.store);
        if (contents.includes('config')) payload.config = readConfig();

        let name = 'backup-' + backupTsName(new Date()) + '.json';
        let i = 2;
        while (fs.existsSync(path.join(BACKUP_DIR, name))) name = 'backup-' + backupTsName(new Date()) + '-' + (i++) + '.json';
        fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(payload, null, 2));

        /* 保留份数清理 */
        const files = listBackups();
        while (files.length > cfg.maxKeep) {
            try { fs.rmSync(path.join(BACKUP_DIR, files[0].name)); } catch (e) {}
            files.shift();
        }

        cfg.lastRunAt = Date.now();
        cfg.nextRunAt = Date.now() + cfg.intervalHours * 3600000;
        saveBackupCfg(cfg);
        console.log(`[备份] 完成: ${name}（内容: ${contents.join('/')}，保留 ${cfg.maxKeep} 份）`);
        if (!opts || opts.autoSync !== false) syncAfterBackup(name); /* 云端自动同步（异步，失败仅记录） */
        return { name, createdAt: Date.now(), size: fs.statSync(path.join(BACKUP_DIR, name)).size, contents };
    }

    /* ── 原 server.js L2286-2286 ── */
    /* 定时检查：每分钟一次，到点即备份；失败也顺延到下个周期，避免反复重试 */

    /* ── 原 server.js L2287-2298 ── */
    function checkBackupSchedule() {
        const cfg = getBackupCfg();
        if (!cfg.enabled) return;
        if (cfg.nextRunAt && Date.now() < cfg.nextRunAt) return;
        runBackup().catch(e => {
            console.error('[备份] 失败:', e.message);
            const c = getBackupCfg();
            c.lastRunAt = Date.now();
            c.nextRunAt = Date.now() + c.intervalHours * 3600000;
            saveBackupCfg(c);
        });
    }

    /* ── 原 server.js L2299-2299 ── */
    setInterval(checkBackupSchedule, 60000);

    /* ── 原 server.js L2300-2300 ── */
    checkBackupSchedule();

    /* ── 原 server.js L2302-2302 ── */
    // ==================== 云端备份同步（FTP/SFTP/WebDAV/OpenList） ====================

    /* ── 原 server.js L2304-2304 ── */
    function cloudDefaultSecure(type) { return type === 'ftp' ? false : true; }

    /* ── 原 server.js L2306-2323 ── */
    function normalizeCloudItem(c, i) {
        const type = CLOUD_TYPES.includes(c.type) ? c.type : 'webdav';
        return {
            id: c.id || 'c' + i,
            enabled: !!c.enabled,
            type: type,
            host: c.host || '',
            port: parseInt(c.port) || 0,
            user: c.user || '',
            password: c.password || '',
            path: c.path || '/backups',
            baseUrl: c.baseUrl || '',
            secure: c.secure === undefined ? cloudDefaultSecure(type) : !!c.secure,
            lastSyncAt: c.lastSyncAt || 0,
            lastSyncOk: c.lastSyncOk === undefined ? null : !!c.lastSyncOk,
            lastSyncMsg: c.lastSyncMsg || ''
        };
    }

    /* ── 原 server.js L2325-2336 ── */
    function getAllCloudCfgs() {
        const config = readConfig();
        const arr = Array.isArray(config.clouds) ? config.clouds : [];
        if (arr.length === 0) {
            /* 兼容旧版单 cloud 字段 */
            const legacy = config.cloud;
            if (legacy && legacy.type && (legacy.host || legacy.baseUrl)) {
                arr.push({ ...legacy, id: 'default' });
            }
        }
        return arr.map((c, i) => normalizeCloudItem(c, i));
    }

    /* ── 原 server.js L2338-2343 ── */
    function saveAllCloudCfgs(arr) {
        const config = readConfig();
        config.clouds = arr.map(c => ({ ...c, password: c.password || '' }));
        delete config.cloud;
        writeConfig(config);
    }

    /* ── 原 server.js L2345-2345 ── */
    /* 辅助：body 构造单条云端配置 */

    /* ── 原 server.js L2346-2361 ── */
    function cloudCfgFromBody(type, body) {
        let secure;
        if (body.secure !== undefined) secure = !!body.secure;
        else secure = cloudDefaultSecure(type);
        return {
            enabled: !!body.enabled,
            type: type,
            host: body.host || '',
            port: parseInt(body.port) || 0,
            user: body.user || '',
            password: body.password || '',
            path: body.path || '/backups',
            baseUrl: body.baseUrl || '',
            secure: secure
        };
    }

    /* ── 原 server.js L2363-2363 ── */
    /* 上传单个本地备份到云端（幂等：同名覆盖） */

    /* ── 原 server.js L2364-2369 ── */
    async function cloudUploadFile(cfg, name) {
        const cloud = createCloud(cfg);
        const local = path.join(BACKUP_DIR, name);
        if (!fs.existsSync(local)) throw new Error('本地备份不存在: ' + name);
        await cloud.upload(local, name);
    }

    /* ── 原 server.js L2371-2371 ── */
    /* 把全部本地备份同步到指定云端配置 */

    /* ── 原 server.js L2372-2379 ── */
    async function cloudSyncOne(cfg) {
        const cloud = createCloud(cfg);
        await cloud.test();
        const files = listBackups();
        for (const f of files) {
            try { await cloud.upload(path.join(BACKUP_DIR, f.name), f.name); } catch (e) {}
        }
    }

    /* ── 原 server.js L2381-2381 ── */
    /* 本地备份完成后自动同步到所有启用的云端（异步，失败仅记录） */

    /* ── 原 server.js L2382-2399 ── */
    async function syncAfterBackup(name) {
        const cfgs = getAllCloudCfgs();
        for (const cfg of cfgs) {
            if (!cfg.enabled) continue;
            try {
                await cloudUploadFile(cfg, name);
                cfg.lastSyncAt = Date.now();
                cfg.lastSyncOk = true;
                cfg.lastSyncMsg = '已同步 ' + name;
                console.log('[云端] 已同步备份到 ' + cfg.type + ': ' + name);
            } catch (e) {
                cfg.lastSyncOk = false;
                cfg.lastSyncMsg = safeErrMsg(e);
                console.error('[云端] 同步失败 (' + cfg.type + '): ' + safeErrMsg(e));
            }
        }
        saveAllCloudCfgs(cfgs);
    }

        Object.assign(ctx, { BACKUP_DIR, BACKUP_DIR, BACKUP_NAME_RE, BACKUP_NAME_RE, getBackupCfg, getBackupCfg, saveBackupCfg, saveBackupCfg, listBackups, listBackups, backupTsName, backupTsName, runBackup, runBackup, checkBackupSchedule, checkBackupSchedule, cloudDefaultSecure, cloudDefaultSecure, normalizeCloudItem, normalizeCloudItem, getAllCloudCfgs, getAllCloudCfgs, saveAllCloudCfgs, saveAllCloudCfgs, cloudCfgFromBody, cloudCfgFromBody, cloudUploadFile, cloudUploadFile, cloudSyncOne, cloudSyncOne, syncAfterBackup, syncAfterBackup });
    },
};
