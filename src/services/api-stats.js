/* API 统计：三层时间桶 + 开关/限速控制 + 持久化
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');

module.exports = {
    define(ctx) {
        const { S, readConfig, DEFAULT_API_RULES, API_STATS_FILE } = ctx;

    /* ── 原 server.js L42-42 ── */
    // ==================== API 统计（三层时间桶：1s/60s/3600s + 持久化） ====================

    /* ── 原 server.js L43-43 ── */
    const API_START_TIME = Date.now();

    /* ── 原 server.js L53-57 ── */
    const API_LAYER_DEFS = [
        { name: 's', unit: 1, keep: 24 * 60 * 60 },      // 1s  桶，保留 1 天
        { name: 'm', unit: 60, keep: 30 * 24 * 60 },     // 60s 桶，保留 30 天
        { name: 'h', unit: 3600, keep: 90 * 24 }         // 1h  桶，保留 90 天（受 retentionDays 限制）
    ];

    /* ── 原 server.js L58-62 ── */
    const apiLayers = {
        s: { buckets: [], lastTs: -1 },
        m: { buckets: [], lastTs: -1 },
        h: { buckets: [], lastTs: -1 }
    };

    /* ── 原 server.js L63-63 ── */
    const apiTotals = { calls: {}, bytes: {} };

    /* ── 原 server.js L68-74 ── */
    function getApiConfig() {
        if (!S.apiConfigCache || Date.now() - S.apiConfigCacheAt > 3000) {
            S.apiConfigCache = readConfig().api || {};
            S.apiConfigCacheAt = Date.now();
        }
        return S.apiConfigCache;
    }

    /* ── 原 server.js L75-75 ── */
    function invalidateApiConfig() { S.apiConfigCache = null; }

    /* ── 原 server.js L77-82 ── */
    function getRetentionDays(config) {
        const api = (config && config.api) || {};
        if (api.retentionDays) return Math.max(1, Math.min(90, parseInt(api.retentionDays) || 1));
        if (api.retentionMinutes) return Math.max(1, Math.min(90, Math.ceil((parseInt(api.retentionMinutes) || 60) / 1440)));
        return 1;
    }

    /* ── 原 server.js L84-92 ── */
    function apiRuleFor(path) {
        const rules = getApiConfig().apis || DEFAULT_API_RULES;
        // longest-prefix match
        let best = null, bestLen = -1;
        for (const key of Object.keys(rules)) {
            if (path === key || path.startsWith(key) && key.length > bestLen) { best = key; bestLen = key.length; }
        }
        return { rule: rules[best] || { enabled: true, rps: 0, bandwidth: 0 }, key: best };
    }

    /* ── 原 server.js L94-114 ── */
    function trackApi(path, bytes) {
        const fullPath = path.startsWith('/api/') ? path : '/api' + path;
        apiTotals.calls[fullPath] = (apiTotals.calls[fullPath] || 0) + 1;
        apiTotals.bytes[fullPath] = (apiTotals.bytes[fullPath] || 0) + (bytes || 0);
        const now = Math.floor(Date.now() / 1000);
        const config = readConfig();
        const retDays = getRetentionDays(config);
        for (const def of API_LAYER_DEFS) {
            const layer = apiLayers[def.name];
            const ts = Math.floor(now / def.unit);
            if (ts !== layer.lastTs) {
                layer.lastTs = ts;
                layer.buckets.push({ ts, t: ts * def.unit * 1000, calls: {}, bytes: {} });
                const maxKeep = def.name === 'h' ? retDays * 24 : def.keep;
                while (layer.buckets.length > maxKeep) layer.buckets.shift();
            }
            const b = layer.buckets[layer.buckets.length - 1];
            b.calls[fullPath] = (b.calls[fullPath] || 0) + 1;
            b.bytes[fullPath] = (b.bytes[fullPath] || 0) + (bytes || 0);
        }
    }

    /* ── 原 server.js L116-116 ── */
    // 持久化到磁盘（60s 定时 + 退出时），重启不丢；数据库模式下同步写入 kv 表

    /* ── 原 server.js L117-129 ── */
    function saveApiStats() {
        const payload = {
            savedAt: Date.now(),
            totals: apiTotals,
            layers: Object.fromEntries(Object.entries(apiLayers).map(([k, v]) => [k, { lastTs: v.lastTs, buckets: v.buckets }]))
        };
        const tmp = API_STATS_FILE + '.tmp';
        try {
            fs.writeFileSync(tmp, JSON.stringify(payload));
            fs.renameSync(tmp, API_STATS_FILE);
        } catch (e) { console.error('[stats] save failed:', e.message); }
        if (S.store && S.store.type !== 'json') S.store.kvSet('api_stats', payload).catch(() => {});
    }

    /* ── 原 server.js L130-143 ── */
    function loadApiStats() {
        try {
            const d = JSON.parse(fs.readFileSync(API_STATS_FILE, 'utf8'));
            if (d.totals) Object.assign(apiTotals, d.totals);
            if (d.layers) {
                for (const [name, v] of Object.entries(d.layers)) {
                    if (apiLayers[name] && Array.isArray(v.buckets)) {
                        apiLayers[name].buckets = v.buckets;
                        apiLayers[name].lastTs = v.lastTs || -1;
                    }
                }
            }
        } catch { /* 无文件或损坏则忽略 */ }
    }

    /* ── 原 server.js L144-144 ── */
    // API 控制中间件：开闭 + 限速 + 带宽

    /* ── 原 server.js L145-145 ── */
    const apiWindowCounters = new Map();

    /* ── 原 server.js L146-176 ── */
    function apiControl(req, res, next) {
        const path = req.path;
        const { rule } = apiRuleFor(path);
        if (!rule.enabled) {
            trackApi(path, 0);
            return res.status(403).json({ code: 403, msg: '该 API 已停用' });
        }
        // RPS limit (per-second sliding window, in-memory)
        if (rule.rps > 0) {
            const now = Date.now();
            const key = path;
            let arr = apiWindowCounters.get(key);
            if (!arr) { arr = []; apiWindowCounters.set(key, arr); }
            while (arr.length && arr[0] < now - 1000) arr.shift();
            if (arr.length >= rule.rps) {
                trackApi(path, 0);
                return res.status(429).json({ code: 429, msg: 'API 调用过快' });
            }
            arr.push(now);
        }
        // Bandwidth tracking: wrap res.end
        const origEnd = res.end.bind(res);
        res.end = function (chunk, ...rest) {
            let bytes = 0;
            if (chunk) bytes = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            // bandwidth limit check is post-hoc; simple: track and optionally throttle via delay
            trackApi(path, bytes);
            return origEnd(chunk, ...rest);
        };
        next();
    }

    /* ── 原 server.js L378-378 ── */
    setInterval(saveApiStats, 60000);

    /* ── 原 server.js L379-379 ── */
    process.on('exit', saveApiStats);

    /* ── 原 server.js L382-382 ── */
    loadApiStats();

        Object.assign(ctx, { API_START_TIME, API_START_TIME, API_LAYER_DEFS, API_LAYER_DEFS, apiLayers, apiLayers, apiTotals, apiTotals, getApiConfig, getApiConfig, invalidateApiConfig, invalidateApiConfig, getRetentionDays, getRetentionDays, apiRuleFor, apiRuleFor, trackApi, trackApi, saveApiStats, saveApiStats, loadApiStats, loadApiStats, apiWindowCounters, apiWindowCounters, apiControl, apiControl });
    },
};
