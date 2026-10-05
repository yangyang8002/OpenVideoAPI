/* 安全中心路由：总览/IP列表/封禁白名单/登录记录/地图聚合
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    mount(ctx) {
        const { app, checkAdmin, readSecurity, ipTotals, computeAnomalies, ipWindowCounts, geoLookup, geoCoords, writeSecurity, readConfig, writeConfig, readLoginLogs, geoRegionText, readLoginFails, geoDbInfo, GEO_V4_FILE, GEO_V6_FILE, S, PROVINCE_COORDS, normProvince, WORLD_CODE_NAMES, ensureGeoDb } = ctx;

    /* ── 原 server.js L1904-1904 ── */
    // ==================== 安全中心 API ====================

    /* ── 原 server.js L1906-1908 ── */
    function isValidIp(ip) {
        return typeof ip === 'string' && /^[\d.]+$/.test(ip) && ip.split('.').length === 4;
    }

    /* ── 原 server.js L1910-1926 ── */
    app.get('/api/admin/security/overview', checkAdmin, async (req, res) => {
        const sec = await readSecurity();
        const dayAgo = Date.now() - 86400000;
        let active = 0;
        for (const t of Object.values(ipTotals.last)) if (t > dayAgo) active++;
        res.json({
            code: 0, data: {
                totalCalls: Object.values(ipTotals.calls).reduce((a, b) => a + b, 0),
                totalBytes: Object.values(ipTotals.bytes).reduce((a, b) => a + b, 0),
                activeIps: active,
                allIps: Object.keys(ipTotals.calls).length,
                banned: Object.keys(sec.banned).length,
                whitelist: Object.keys(sec.whitelist).length,
                anomalies: (await computeAnomalies()).length
            }
        });
    });

    /* ── 原 server.js L1928-1968 ── */
    app.get('/api/admin/security/ips', checkAdmin, async (req, res) => {
        const sec = await readSecurity();
        const window = req.query.window || 'm';
        const sort = req.query.sort || 'calls';
        const search = (req.query.search || '').toLowerCase();
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const win = ipWindowCounts(window === 'h' ? 3600 : 60, window === 'h' ? 6 : 5);
        const rows = [];
        for (const ip of Object.keys(ipTotals.calls)) {
            const w = win[ip] || { c: 0, b: 0 };
            const g = await geoLookup(ip);
            const region = g ? [g.country, g.province, g.city].filter(Boolean).join('·') || '未知' : '未知';
            rows.push({
                ip,
                region,
                isp: (g && g.isp) || '',
                coords: await geoCoords(ip),
                winCalls: w.c, winBytes: w.b,
                totalCalls: ipTotals.calls[ip] || 0,
                totalBytes: ipTotals.bytes[ip] || 0,
                last: ipTotals.last[ip] || 0,
                status: sec.banned[ip] ? 'banned' : (sec.whitelist[ip] ? 'whitelist' : 'normal'),
                bannedReason: (sec.banned[ip] && sec.banned[ip].reason) || ''
            });
        }
        if (search) {
            const f = rows.filter(r => r.ip.includes(search) || r.region.toLowerCase().includes(search));
            rows.length = 0; rows.push(...f);
        }
        rows.sort((a, b) => {
            if (sort === 'bytes') return b.totalBytes - a.totalBytes;
            if (sort === 'last') return b.last - a.last;
            if (sort === 'winBytes') return b.winBytes - a.winBytes;
            if (sort === 'winCalls') return b.winCalls - a.winCalls;
            return b.totalCalls - a.totalCalls;
        });
        const total = rows.length;
        const start = (page - 1) * limit;
        res.json({ code: 0, data: { list: rows.slice(start, start + limit), total, page, limit } });
    });

    /* ── 原 server.js L1970-1972 ── */
    app.get('/api/admin/security/anomalies', checkAdmin, async (req, res) => {
        res.json({ code: 0, data: await computeAnomalies() });
    });

    /* ── 原 server.js L1974-1983 ── */
    app.get('/api/admin/security/lists', checkAdmin, async (req, res) => {
        const sec = await readSecurity();
        res.json({
            code: 0,
            data: {
                banned: Object.entries(sec.banned).map(([ip, v]) => ({ ip, reason: (v && v.reason) || '', at: (v && v.at) || 0 })),
                whitelist: Object.entries(sec.whitelist).map(([ip, v]) => ({ ip, at: (v && v.at) || 0 }))
            }
        });
    });

    /* ── 原 server.js L1985-1993 ── */
    app.post('/api/admin/security/ban', checkAdmin, async (req, res) => {
        const { ip, reason } = req.body;
        if (!isValidIp(ip)) return res.status(400).json({ code: 1, msg: '无效 IP' });
        const sec = await readSecurity();
        sec.banned[ip] = { reason: String(reason || '').slice(0, 200), at: Date.now() };
        delete sec.whitelist[ip];
        await writeSecurity(sec);
        res.json({ code: 0, msg: '已封禁 ' + ip });
    });

    /* ── 原 server.js L1995-2002 ── */
    app.post('/api/admin/security/unban', checkAdmin, async (req, res) => {
        const { ip } = req.body;
        if (!isValidIp(ip)) return res.status(400).json({ code: 1, msg: '无效 IP' });
        const sec = await readSecurity();
        delete sec.banned[ip];
        await writeSecurity(sec);
        res.json({ code: 0, msg: '已解除封禁 ' + ip });
    });

    /* ── 原 server.js L2004-2012 ── */
    app.post('/api/admin/security/whitelist', checkAdmin, async (req, res) => {
        const { ip } = req.body;
        if (!isValidIp(ip)) return res.status(400).json({ code: 1, msg: '无效 IP' });
        const sec = await readSecurity();
        if (!sec.whitelist[ip]) sec.whitelist[ip] = { at: Date.now() };
        delete sec.banned[ip];
        await writeSecurity(sec);
        res.json({ code: 0, msg: '已加入白名单 ' + ip });
    });

    /* ── 原 server.js L2014-2021 ── */
    app.post('/api/admin/security/unwhitelist', checkAdmin, async (req, res) => {
        const { ip } = req.body;
        if (!isValidIp(ip)) return res.status(400).json({ code: 1, msg: '无效 IP' });
        const sec = await readSecurity();
        delete sec.whitelist[ip];
        await writeSecurity(sec);
        res.json({ code: 0, msg: '已移出白名单 ' + ip });
    });

    /* ── 原 server.js L2023-2038 ── */
    app.post('/api/admin/security/config', checkAdmin, (req, res) => {
        const { reqPerMin, mbPerMin, reqPerHour, mbPerHour, autoBan } = req.body;
        const config = readConfig();
        config.security = {
            ...config.security,
            anomaly: {
                reqPerMin: Math.max(1, parseInt(reqPerMin) || 60),
                mbPerMin: Math.max(1, parseInt(mbPerMin) || 20),
                reqPerHour: Math.max(1, parseInt(reqPerHour) || 2000),
                mbPerHour: Math.max(1, parseInt(mbPerHour) || 1024)
            }
        };
        if (autoBan !== undefined) config.security.autoBan = !!autoBan;
        writeConfig(config);
        res.json({ code: 0, msg: '阈值已保存' });
    });

    /* ── 原 server.js L2040-2059 ── */
    app.get('/api/admin/security/logins', checkAdmin, async (req, res) => {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const search = (req.query.search || '').toLowerCase();
        let list = (await readLoginLogs()).slice().reverse();
        if (search) {
            list = list.filter(x => x.ip.includes(search) || String(x.u || '').toLowerCase().includes(search));
        }
        const total = list.length;
        const rows = await Promise.all(list.slice((page - 1) * limit, page * limit).map(async x => ({
            ...x,
            region: await geoRegionText(x.ip)
        })));
        const fails = await readLoginFails();
        const now = Date.now();
        const locked = Object.entries(fails)
            .filter(([, v]) => v.lockedUntil > now)
            .map(([ip, v]) => ({ ip, until: v.lockedUntil }));
        res.json({ code: 0, data: { list: rows, total, page, limit, locked } });
    });

    /* ── 原 server.js L2061-2074 ── */
    app.post('/api/admin/security/login-limit', checkAdmin, (req, res) => {
        const { maxFail, windowMin, lockMin } = req.body;
        const config = readConfig();
        config.security = {
            ...config.security,
            loginLimit: {
                maxFail: Math.max(1, parseInt(maxFail) || 5),
                windowMin: Math.max(1, parseInt(windowMin) || 10),
                lockMin: Math.max(1, parseInt(lockMin) || 15)
            }
        };
        writeConfig(config);
        res.json({ code: 0, msg: '登录防护设置已保存' });
    });

    /* ── 原 server.js L2705-2707 ── */
    app.get('/api/admin/security/geo/info', checkAdmin, (req, res) => {
        res.json({ code: 0, data: { v4: geoDbInfo(GEO_V4_FILE), v6: geoDbInfo(GEO_V6_FILE), inUse: !!(S.ipSearcher4 || S.ipSearcher6) } });
    });

    /* ── 原 server.js L2721-2742 ── */
    app.get('/api/admin/security/geo/regions', checkAdmin, async (req, res) => {
        const scope = req.query.scope === 'china' ? 'china' : 'world';
        const agg = {};
        for (const ip of Object.keys(ipTotals.calls)) {
            const g = await geoLookup(ip);
            if (!g) continue;
            const v = ipTotals.calls[ip], b = ipTotals.bytes[ip] || 0;
            if (scope === 'china') {
                const isCN = g.code === 'CN' || g.country === '中国' || g.country === 'China' || PROVINCE_COORDS[normProvince(g.province)];
                const name = isCN ? (normProvince(g.province) || '中国') : '海外';
                const e = agg[name] || (agg[name] = { code: '', calls: 0, bytes: 0, ips: 0 });
                e.calls += v; e.bytes += b; e.ips++;
            } else {
                if (!g.country || g.country === '0' || g.country === 'Reserved' || g.country === '保留' || g.country === '内网IP' || g.country === '保留地址' || g.country === '本机地址' || g.country === '局域网' || g.country === '未知' || g.country === 'Unknown') continue;
                const name = WORLD_CODE_NAMES[g.code] || (g.country === '中国' ? 'China' : g.country) || g.country;
                const e = agg[name] || (agg[name] = { code: g.code || '', calls: 0, bytes: 0, ips: 0 });
                e.calls += v; e.bytes += b; e.ips++;
            }
        }
        const list = Object.entries(agg).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.calls - a.calls);
        res.json({ code: 0, data: list });
    });

    /* ── 原 server.js L2744-2751 ── */
    app.post('/api/admin/security/geo/update', checkAdmin, async (req, res) => {
        try {
            await ensureGeoDb(true);
            res.json({ code: 0, msg: '地址库已更新', data: { v4: geoDbInfo(GEO_V4_FILE), v6: geoDbInfo(GEO_V6_FILE) } });
        } catch (e) {
            res.json({ code: 1, msg: '更新失败: ' + e.message });
        }
    });
    },
};
