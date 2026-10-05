/* 安全中心核心：IP 封禁/白名单/统计/异常检测/自动封禁 + 登录记录
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');

module.exports = {
    define(ctx) {
        const { DATA_DIR, initDataFile, S, readJsonFile, readConfig, geoRegionText, geoLookup } = ctx;

    /* ── 原 server.js L586-586 ── */
    // ==================== 安全中心：IP 统计 / 归属地 / 封禁 / 白名单 / 异常检测 ====================

    /* ── 原 server.js L588-588 ── */
    const SECURITY_FILE = path.join(DATA_DIR, 'security.json');

    /* ── 原 server.js L589-589 ── */
    initDataFile(SECURITY_FILE, { banned: {}, whitelist: {} });

    /* ── 原 server.js L591-599 ── */
    function readSecurity() {
        return S.store ? Promise.resolve(S.store.securityGet()) : Promise.resolve((() => {
            const d = readJsonFile(SECURITY_FILE, {});
            return {
                banned: (d && d.banned && typeof d.banned === 'object') ? d.banned : {},
                whitelist: (d && d.whitelist && typeof d.whitelist === 'object') ? d.whitelist : {}
            };
        })());
    }

    /* ── 原 server.js L600-603 ── */
    function writeSecurity(s) {
        if (!S.store) { fs.writeFileSync(SECURITY_FILE, JSON.stringify(s, null, 2)); return Promise.resolve(); }
        return S.store.securityWrite(s);
    }

    /* ── 原 server.js L605-605 ── */
    // --- 登录记录与失败锁定（持久化，重启恢复） ---

    /* ── 原 server.js L606-606 ── */
    const LOGIN_LOG_FILE = path.join(DATA_DIR, 'login-logs.json');

    /* ── 原 server.js L607-607 ── */
    const LOGIN_FAIL_FILE = path.join(DATA_DIR, 'login-fails.json');

    /* ── 原 server.js L608-608 ── */
    initDataFile(LOGIN_LOG_FILE, []);

    /* ── 原 server.js L609-609 ── */
    initDataFile(LOGIN_FAIL_FILE, {});

    /* ── 原 server.js L611-615 ── */
    function readLoginLogs() {
        if (S.store) return S.store.loginLogs();
        const d = readJsonFile(LOGIN_LOG_FILE, []);
        return Promise.resolve(Array.isArray(d) ? d : []);
    }

    /* ── 原 server.js L616-626 ── */
    function writeLoginLogs(list) {
        if (!S.store) {
            try {
                if (list.length > 500) list = list.slice(-500);
                fs.writeFileSync(LOGIN_LOG_FILE, JSON.stringify(list));
            } catch (e) { console.error('[login-log] save failed:', e.message); }
            return Promise.resolve();
        }
        if (list.length > 500) list = list.slice(-500);
        return S.store.loginLogsWrite(list);
    }

    /* ── 原 server.js L627-631 ── */
    function readLoginFails() {
        if (S.store) return S.store.loginFails();
        const d = readJsonFile(LOGIN_FAIL_FILE, {});
        return Promise.resolve((d && typeof d === 'object' && !Array.isArray(d)) ? d : {});
    }

    /* ── 原 server.js L632-638 ── */
    function writeLoginFails(d) {
        if (!S.store) {
            try { fs.writeFileSync(LOGIN_FAIL_FILE, JSON.stringify(d)); } catch (e) { console.error('[login-fail] save failed:', e.message); }
            return Promise.resolve();
        }
        return S.store.loginFailsWrite(d);
    }

    /* ── 原 server.js L639-643 ── */
    async function logLogin(ip, username, ok, reason) {
        const list = await readLoginLogs();
        list.push({ ip: String(ip || ''), u: String(username || '').slice(0, 50), ok: !!ok, t: Date.now(), r: String(reason || '') });
        await writeLoginLogs(list);
    }

    /* ── 原 server.js L645-645 ── */
    // --- 每 IP 请求/流量统计（60s 与 3600s 时间桶，模式同 api-stats） ---

    /* ── 原 server.js L646-649 ── */
    const IP_LAYER_DEFS = [
        { name: 'm', unit: 60, keep: 30 * 24 * 60 },
        { name: 'h', unit: 3600, keep: 90 * 24 }
    ];

    /* ── 原 server.js L650-653 ── */
    const ipLayers = {
        m: { buckets: [], lastTs: -1 },
        h: { buckets: [], lastTs: -1 }
    };

    /* ── 原 server.js L654-654 ── */
    const ipTotals = { calls: {}, bytes: {}, last: {} };

    /* ── 原 server.js L655-655 ── */
    const IP_STATS_FILE = path.join(DATA_DIR, 'ip-stats.json');

    /* ── 原 server.js L657-674 ── */
    function trackIp(ip, bytes) {
        ipTotals.calls[ip] = (ipTotals.calls[ip] || 0) + 1;
        ipTotals.bytes[ip] = (ipTotals.bytes[ip] || 0) + (bytes || 0);
        ipTotals.last[ip] = Date.now();
        const now = Math.floor(Date.now() / 1000);
        for (const def of IP_LAYER_DEFS) {
            const layer = ipLayers[def.name];
            const ts = Math.floor(now / def.unit);
            if (ts !== layer.lastTs) {
                layer.lastTs = ts;
                layer.buckets.push({ ts, ips: {} });
                while (layer.buckets.length > def.keep) layer.buckets.shift();
            }
            const b = layer.buckets[layer.buckets.length - 1];
            const e = b.ips[ip] || (b.ips[ip] = { c: 0, b: 0 });
            e.c++; e.b += (bytes || 0);
        }
    }

    /* ── 原 server.js L676-676 ── */
    /* 汇总最近 maxBuckets 个桶的每 IP 统计 */

    /* ── 原 server.js L677-690 ── */
    function ipWindowCounts(unitSec, maxBuckets) {
        const name = unitSec === 3600 ? 'h' : 'm';
        const layer = ipLayers[name];
        const out = {};
        const now = Math.floor(Date.now() / 1000);
        for (const b of layer.buckets) {
            if (now - b.ts * unitSec > maxBuckets * unitSec) continue;
            for (const [ip, e] of Object.entries(b.ips)) {
                const o = out[ip] || (out[ip] = { c: 0, b: 0 });
                o.c += e.c; o.b += e.b;
            }
        }
        return out;
    }

    /* ── 原 server.js L692-704 ── */
    function saveIpStats() {
        try {
            const payload = {
                savedAt: Date.now(),
                totals: ipTotals,
                layers: Object.fromEntries(Object.entries(ipLayers).map(([k, v]) => [k, { lastTs: v.lastTs, buckets: v.buckets }]))
            };
            const tmp = IP_STATS_FILE + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(payload));
            fs.renameSync(tmp, IP_STATS_FILE);
        } catch (e) { console.error('[ip-stats] save failed:', e.message); }
        if (S.store && S.store.type !== 'json') S.store.kvSet('ip_stats', payload).catch(() => {});
    }

    /* ── 原 server.js L705-718 ── */
    function loadIpStats() {
        try {
            const d = JSON.parse(fs.readFileSync(IP_STATS_FILE, 'utf8'));
            if (d.totals) Object.assign(ipTotals, d.totals);
            if (d.layers) {
                for (const [name, v] of Object.entries(d.layers)) {
                    if (ipLayers[name] && Array.isArray(v.buckets)) {
                        ipLayers[name].buckets = v.buckets;
                        ipLayers[name].lastTs = v.lastTs || -1;
                    }
                }
            }
        } catch { /* 忽略 */ }
    }

    /* ── 原 server.js L719-719 ── */
    loadIpStats();

    /* ── 原 server.js L720-720 ── */
    setInterval(saveIpStats, 60000);

    /* ── 原 server.js L721-721 ── */
    process.on('exit', saveIpStats);

    /* ── 原 server.js L908-908 ── */
    // --- 安全中间件：封禁拦截 + 每 IP 统计 + 白名单标记 ---

    /* ── 原 server.js L909-931 ── */
    async function securityMiddleware(req, res, next) {
        const ip = String(req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
        req.clientIp = ip;
        const sec = await readSecurity();
        /* 封禁不拦截管理后台（/api/admin/*）：防止管理员被误封后无法登录自救 */
        if (sec.banned[ip] && !req.path.startsWith('/api/admin/')) {
            return res.status(403).json({ code: 403, msg: 'IP 已被封禁' });
        }
        req.ipWhitelisted = !!sec.whitelist[ip];
        let n = 0;
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);
        res.write = function (chunk, ...rest) {
            if (chunk) n += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            return origWrite(chunk, ...rest);
        };
        res.end = function (chunk, ...rest) {
            if (chunk) n += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            trackIp(ip, n);
            return origEnd(chunk, ...rest);
        };
        next();
    }

    /* ── 原 server.js L933-933 ── */
    // --- 异常检测（白名单跳过，阈值可配置） ---

    /* ── 原 server.js L934-942 ── */
    function getAnomalyThresholds() {
        const a = (readConfig().security || {}).anomaly || {};
        return {
            reqPerMin: a.reqPerMin || 60,
            mbPerMin: a.mbPerMin || 20,
            reqPerHour: a.reqPerHour || 2000,
            mbPerHour: a.mbPerHour || 1024
        };
    }

    /* ── 原 server.js L943-965 ── */
    async function computeAnomalies() {
        const t = getAnomalyThresholds();
        const sec = await readSecurity();
        const m5 = ipWindowCounts(60, 5);   // 最近 5 分钟
        const h6 = ipWindowCounts(3600, 6); // 最近 6 小时
        const ips = new Set([...Object.keys(m5), ...Object.keys(h6)]);
        const out = [];
        for (const ip of ips) {
            if (sec.whitelist[ip]) continue;
            const reasons = [];
            const mc = m5[ip] || { c: 0, b: 0 };
            const hc = h6[ip] || { c: 0, b: 0 };
            const rpm = mc.c / 5, mbpm = mc.b / 1024 / 1024 / 5;
            const rph = hc.c / 6, mbph = hc.b / 1024 / 1024 / 6;
            if (rpm > t.reqPerMin) reasons.push(`请求频率 ${rpm.toFixed(1)} 次/分 > ${t.reqPerMin}`);
            if (mbpm > t.mbPerMin) reasons.push(`流量 ${mbpm.toFixed(1)} MB/分 > ${t.mbPerMin}`);
            if (rph > t.reqPerHour) reasons.push(`请求 ${rph.toFixed(1)} 次/时 > ${t.reqPerHour}`);
            if (mbph > t.mbPerHour) reasons.push(`流量 ${mbph.toFixed(1)} MB/时 > ${t.mbPerHour}`);
            if (reasons.length) out.push({ ip, reasons, m5: mc, h6: hc, region: await geoRegionText(ip), isp: (await geoLookup(ip) || {}).isp || '' });
        }
        out.sort((a, b) => (b.m5.c + b.h6.c) - (a.m5.c + a.h6.c));
        return out;
    }

    /* ── 原 server.js L967-967 ── */
    /* 自动封禁：持续异常（6 小时窗口超阈值）的 IP 自动加入封禁列表，白名单除外 */

    /* ── 原 server.js L968-987 ── */
    async function autoBanAnomalies() {
        try {
            const config = readConfig();
            if (!(config.security && config.security.autoBan !== false)) return;
            const t = getAnomalyThresholds();
            const sec = await readSecurity();
            const list = await computeAnomalies();
            let changed = false;
            for (const a of list) {
                const rph = a.h6.c / 6, mbph = a.h6.b / 1024 / 1024 / 6;
                if (rph > t.reqPerHour || mbph > t.mbPerHour) {
                    if (!sec.banned[a.ip]) {
                        sec.banned[a.ip] = { reason: '自动封禁（持续异常请求/流量）', at: Date.now() };
                        changed = true;
                    }
                }
            }
            if (changed) await writeSecurity(sec);
        } catch (e) { console.error('[auto-ban] failed:', e.message); }
    }

    /* ── 原 server.js L988-988 ── */
    setInterval(() => { autoBanAnomalies(); }, 60000);

    /* ── 原 server.js L989-989 ── */
    autoBanAnomalies();

        Object.assign(ctx, { SECURITY_FILE, SECURITY_FILE, readSecurity, readSecurity, writeSecurity, writeSecurity, LOGIN_LOG_FILE, LOGIN_LOG_FILE, LOGIN_FAIL_FILE, LOGIN_FAIL_FILE, readLoginLogs, readLoginLogs, writeLoginLogs, writeLoginLogs, readLoginFails, readLoginFails, writeLoginFails, writeLoginFails, logLogin, logLogin, IP_LAYER_DEFS, IP_LAYER_DEFS, ipLayers, ipLayers, ipTotals, ipTotals, IP_STATS_FILE, IP_STATS_FILE, trackIp, trackIp, ipWindowCounts, ipWindowCounts, saveIpStats, saveIpStats, loadIpStats, loadIpStats, securityMiddleware, securityMiddleware, getAnomalyThresholds, getAnomalyThresholds, computeAnomalies, computeAnomalies, autoBanAnomalies, autoBanAnomalies });
    },
};
