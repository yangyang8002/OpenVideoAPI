'use strict';
/* ==========================================================================
 * OpenVideoAPI 插件：自动封禁超限 IP（请求数 / 流量 / 地区）
 *
 * 能力：
 *   1. 定时扫描 IP 统计（store.kvGet('ip_stats') 的分层桶）：
 *      - 最近 60 秒请求数 / 流量、最近 1 小时请求数 / 流量 超阈值自动封禁（阈值可调，0=关闭）
 *   2. 安全中心「白名单 IP」除外（whitelistBypass，默认开启）
 *   3. 地区屏蔽：对活跃 IP 用 ip2region（data/ip2region_v4.xdb）查询归属地，
 *      命中配置的国家名（如 俄罗斯,美国）自动封禁
 *   4. 封禁写入安全中心（security.banned），与后台/中间件联动即时生效；
 *      可配置封禁时长（分钟，0=永久），到期自动解封
 *   5. 封禁历史记录于插件动态表 ipban_log；后台「IP 封禁」tab 可查看状态、
 *      立即扫描、手动封禁 / 解封
 *
 * 安全：
 *   - 仅扫描最近活跃（last 窗口内）的 IP，避免全量遍历历史数据
 *   - 已封禁 / 白名单 IP 直接跳过；多次误封可一键解封本插件产生的封禁
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

/* ---------- 项目根定位 ---------- */
function findRoot() {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, 'server.js'))) return dir;
        const next = path.dirname(dir);
        if (next === dir) break;
        dir = next;
    }
    return path.resolve(__dirname, '..', '..');
}
const ROOT = findRoot();
const GEO_V4 = path.join(ROOT, 'data', 'ip2region_v4.xdb');

module.exports = {
    apply(ctx, config) {
        let running = false, lastScan = 0, lastChecked = 0, lastBanned = 0, totalBanned = 0;
        const recent = []; /* 最近封禁记录 {ip, reason, at} */
        let searcher4 = null;

        /* ip2region 查询器（懒加载） */
        function getSearcher() {
            if (searcher4) return searcher4;
            try {
                const ip2rJs = require('ip2region.js');
                if (fs.existsSync(GEO_V4)) {
                    searcher4 = ip2rJs.newWithFileOnly(ip2rJs.IPv4, GEO_V4);
                }
            } catch (e) {}
            return searcher4;
        }
        /* 常见国家中英文映射（xdb 返回英文名，配置可填中文或英文） */
        const REGION_ALIAS = {
            '中国': '中国', 'china': '中国',
            '美国': '美国', 'united states': '美国', 'usa': '美国', 'america': '美国',
            '俄罗斯': '俄罗斯', 'russia': '俄罗斯',
            '韩国': '韩国', 'south korea': '韩国', 'korea': '韩国',
            '日本': '日本', 'japan': '日本',
            '印度': '印度', 'india': '印度',
            '越南': '越南', 'vietnam': '越南',
            '德国': '德国', 'germany': '德国',
            '英国': '英国', 'united kingdom': '英国', 'uk': '英国',
            '法国': '法国', 'france': '法国',
            '澳大利亚': '澳大利亚', 'australia': '澳大利亚',
            '巴西': '巴西', 'brazil': '巴西',
            '乌克兰': '乌克兰', 'ukraine': '乌克兰',
            '新加坡': '新加坡', 'singapore': '新加坡',
            '荷兰': '荷兰', 'netherlands': '荷兰',
            '加拿大': '加拿大', 'canada': '加拿大',
            '伊朗': '伊朗', 'iran': '伊朗',
            '印度尼西亚': '印度尼西亚', 'indonesia': '印度尼西亚',
            '泰国': '泰国', 'thailand': '泰国',
            '土耳其': '土耳其', 'turkey': '土耳其',
            '巴基斯坦': '巴基斯坦', 'pakistan': '巴基斯坦',
            '意大利': '意大利', 'italy': '意大利',
            '西班牙': '西班牙', 'spain': '西班牙',
            '埃及': '埃及', 'egypt': '埃及',
            '墨西哥': '墨西哥', 'mexico': '墨西哥',
            '菲律宾': '菲律宾', 'philippines': '菲律宾',
            '马来西亚': '马来西亚', 'malaysia': '马来西亚',
            '瑞典': '瑞典', 'sweden': '瑞典',
            '瑞士': '瑞士', 'switzerland': '瑞士',
            '波兰': '波兰', 'poland': '波兰',
            '以色列': '以色列', 'israel': '以色列',
            '哈萨克斯坦': '哈萨克斯坦', 'kazakhstan': '哈萨克斯坦',
            '蒙古': '蒙古', 'mongolia': '蒙古',
            '缅甸': '缅甸', 'myanmar': '缅甸',
            '柬埔寨': '柬埔寨', 'cambodia': '柬埔寨',
            '老挝': '老挝', 'laos': '老挝',
            '孟加拉国': '孟加拉国', 'bangladesh': '孟加拉国',
            '斯里兰卡': '斯里兰卡', 'sri lanka': '斯里兰卡',
            '尼泊尔': '尼泊尔', 'nepal': '尼泊尔',
            '阿富汗': '阿富汗', 'afghanistan': '阿富汗',
            '伊拉克': '伊拉克', 'iraq': '伊拉克',
            '沙特阿拉伯': '沙特阿拉伯', 'saudi arabia': '沙特阿拉伯',
            '阿联酋': '阿联酋', 'united arab emirates': '阿联酋', 'uae': '阿联酋'
        };
        function normRegion(name) {
            const k = String(name || '').trim().toLowerCase();
            return REGION_ALIAS[k] || String(name || '').trim();
        }
        /* 查询 IP 归属地（国家名，失败返回 ''） */
        async function ipRegion(ip) {
            try {
                const s = getSearcher();
                if (!s || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return '';
                const r = await s.search(ip);
                const region = typeof r === 'string' ? r : ((r && r.region) || '');
                const first = String(region).split('|')[0];
                return first && first !== '0' ? first : '';
            } catch (e) { return ''; }
        }

        const ipbanLog = ctx.model.define('ipban_log', {
            primary: 'id',
            fields: { id: { type: 'string' }, ip: { type: 'string' }, reason: { type: 'string' }, at: { type: 'number' }, until: { type: 'number' }, source: { type: 'string' } }
        });

        function pushRecent(ip, reason) {
            recent.unshift({ ip, reason, at: Date.now() });
            if (recent.length > 100) recent.pop();
        }

        /* 立即执行一次扫描 */
        async function scan() {
            if (running) return;
            running = true;
            lastScan = Date.now();
            let checked = 0, banned = 0;
            try {
                const payload = await ctx.store.kvGet('ip_stats');
                if (!payload || !payload.totals || !payload.layers) return;
                const now = Date.now();
                const activeWin = Math.max(1, parseInt(config.activeWindowMin) || 10) * 60000;
                const last = payload.totals.last || {};

                /* 窗口统计：m 层 / h 层各取最近 2 桶求平均（容忍 ip-stats 每 60s 落盘的滞后） */
                const windowCounts = (layerName, unitSec, buckets) => {
                    const out = {};
                    const layer = payload.layers[layerName];
                    if (!layer || !Array.isArray(layer.buckets)) return out;
                    const nowTs = Math.floor(now / 1000);
                    const picked = [];
                    for (const b of layer.buckets) {
                        if (nowTs - b.ts * unitSec >= unitSec * buckets) continue;
                        picked.push(b);
                        for (const [ip, e] of Object.entries(b.ips || {})) {
                            const o = out[ip] || (out[ip] = { c: 0, b: 0 });
                            o.c += e.c || 0; o.b += e.b || 0;
                        }
                    }
                    const n = Math.max(1, picked.length);
                    for (const ip of Object.keys(out)) { out[ip].c = Math.round(out[ip].c / n); out[ip].b = Math.round(out[ip].b / n); }
                    return out;
                };
                const m = windowCounts('m', 60, 2);
                const h = windowCounts('h', 3600, 2);

                const sec = await ctx.store.securityGet(true);
                const whitelist = sec.whitelist || {};
                const bannedMap = sec.banned || {};
                const bypassWl = config.whitelistBypass !== false;

                const regionList = String(config.regionList || '').split(/[,，\s]+/).map(x => normRegion(x)).filter(Boolean);
                const doRegion = !!config.regionBlock && regionList.length > 0;
                const regionCache = {};

                const checkedSet = new Set([...Object.keys(m), ...Object.keys(h)]);
                for (const ip of checkedSet) {
                    if (last[ip] && now - last[ip] > activeWin) continue; /* 非活跃跳过 */
                    if (bannedMap[ip]) continue;
                    if (bypassWl && whitelist[ip]) continue;
                    checked++;

                    let reason = '';
                    const mc = m[ip] ? m[ip].c : 0;
                    const mb = m[ip] ? m[ip].b : 0;
                    const hc = h[ip] ? h[ip].c : 0;
                    const hb = h[ip] ? h[ip].b : 0;
                    if (config.reqPerMin && mc > parseInt(config.reqPerMin)) reason = '每分钟请求超限 (' + mc + ' 次)';
                    else if (config.reqPerHour && hc > parseInt(config.reqPerHour)) reason = '每小时请求超限 (' + hc + ' 次)';
                    else if (config.mbPerMin && mb > parseInt(config.mbPerMin) * 1048576) reason = '每分钟流量超限 (' + (mb / 1048576).toFixed(1) + ' MB)';
                    else if (config.mbPerHour && hb > parseInt(config.mbPerHour) * 1048576) reason = '每小时流量超限 (' + (hb / 1048576).toFixed(1) + ' MB)';
                    else if (doRegion) {
                        let region = regionCache[ip];
                        if (region === undefined) { region = await ipRegion(ip); regionCache[ip] = region; }
                        if (region && regionList.includes(normRegion(region))) reason = '地区屏蔽 (' + region + ')';
                    }
                    if (reason) {
                        const banMin = parseInt(config.banMinutes) || 0;
                        const until = banMin ? now + banMin * 60000 : 0;
                        bannedMap[ip] = { reason: '自动封禁: ' + reason, at: now, until, source: 'plugin:ip-ban' };
                        await ctx.store.securityWrite({ ...sec, banned: bannedMap });
                        try { await ipbanLog.create({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ip, reason: '自动封禁: ' + reason, at: now, until, source: 'plugin:ip-ban' }); } catch (e) {}
                        pushRecent(ip, reason);
                        banned++;
                        totalBanned++;
                        ctx.logger.warn('ip-ban', '自动封禁 ' + ip + '（' + reason + '）' + (until ? '，' + banMin + ' 分钟后解封' : '，永久封禁'));
                    }
                }
            } catch (e) {
                ctx.logger.error('ip-ban', '扫描异常: ' + (e && e.message || e));
            } finally {
                lastChecked = checked;
                lastBanned = banned;
                running = false;
            }
        }

        /* 过期自动解封（扫描时顺带清理） */
        async function cleanupExpired() {
            try {
                const sec = await ctx.store.securityGet(true);
                const bannedMap = sec.banned || {};
                const now = Date.now();
                let changed = false;
                for (const [ip, v] of Object.entries(bannedMap)) {
                    if (v.source === 'plugin:ip-ban' && v.until && v.until > 0 && v.until <= now) {
                        delete bannedMap[ip];
                        changed = true;
                        ctx.logger.info('ip-ban', '封禁到期自动解封 ' + ip);
                    }
                }
                if (changed) await ctx.store.securityWrite({ ...sec, banned: bannedMap });
            } catch (e) {}
        }

        /* 定时扫描 */
        const interval = Math.max(10, parseInt(config.scanInterval) || 60) * 1000;
        const timer = setInterval(() => { cleanupExpired().then(() => scan()).catch(() => {}); }, interval);
        ctx.on('dispose', () => clearInterval(timer));

        const wrap = (fn) => async (req, res) => {
            try { await fn(req, res); }
            catch (e) { const st = e.status || 500; res.status(st).json({ code: st === 500 ? 1 : st, msg: e.message || '操作失败' }); }
        };

        /* API */
        ctx.router.get('/api/plugin/ip-ban/status', wrap(async (req, res) => {
            const sec = await ctx.store.securityGet(true);
            const pluginBans = Object.entries(sec.banned || {}).filter(([, v]) => v.source === 'plugin:ip-ban');
            res.json({ code: 0, data: {
                running, lastScan, lastChecked, lastBanned, totalBanned,
                recent,
                pluginBanCount: pluginBans.length,
                config: { reqPerMin: config.reqPerMin, reqPerHour: config.reqPerHour, mbPerMin: config.mbPerMin, mbPerHour: config.mbPerHour, banMinutes: config.banMinutes, regionBlock: !!config.regionBlock, regionList: config.regionList, whitelistBypass: config.whitelistBypass !== false, activeWindowMin: config.activeWindowMin }
            } });
        }));
        ctx.router.post('/api/plugin/ip-ban/scan', wrap(async (req, res) => {
            await cleanupExpired();
            await scan();
            res.json({ code: 0, msg: '扫描完成，检查 ' + lastChecked + ' 个 IP，封禁 ' + lastBanned + ' 个' });
        }));
        ctx.router.post('/api/plugin/ip-ban/ban', wrap(async (req, res) => {
            const { ip } = req.body || {};
            if (!ip || !/^[\d.:a-fA-F]+$/.test(ip)) { const e = new Error('无效 IP'); e.status = 400; throw e; }
            const sec = await ctx.store.securityGet(true);
            const until = (parseInt(config.banMinutes) || 0) ? Date.now() + parseInt(config.banMinutes) * 60000 : 0;
            sec.banned[ip] = { reason: '手动封禁（插件）', at: Date.now(), until, source: 'plugin:ip-ban' };
            await ctx.store.securityWrite(sec);
            try { await ipbanLog.create({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ip, reason: '手动封禁（插件）', at: Date.now(), until, source: 'plugin:ip-ban' }); } catch (e) {}
            pushRecent(ip, '手动封禁');
            totalBanned++;
            res.json({ code: 0, msg: '已封禁 ' + ip });
        }));
        ctx.router.post('/api/plugin/ip-ban/unban', wrap(async (req, res) => {
            const { ip } = req.body || {};
            const sec = await ctx.store.securityGet(true);
            if (sec.banned[ip]) { delete sec.banned[ip]; await ctx.store.securityWrite(sec); }
            res.json({ code: 0, msg: '已解封 ' + ip });
        }));
        ctx.router.post('/api/plugin/ip-ban/unban-all', wrap(async (req, res) => {
            const sec = await ctx.store.securityGet(true);
            let n = 0;
            for (const [ip, v] of Object.entries(sec.banned || {})) {
                if (v.source === 'plugin:ip-ban') { delete sec.banned[ip]; n++; }
            }
            if (n) await ctx.store.securityWrite(sec);
            res.json({ code: 0, msg: '已解封本插件产生的 ' + n + ' 个封禁' });
        }));

        ctx.logger.info('ip-ban', '自动封禁插件已加载（间隔 ' + (interval / 1000) + 's，阈值 req/min=' + config.reqPerMin + ' req/h=' + config.reqPerHour + ' MB/min=' + config.mbPerMin + ' MB/h=' + config.mbPerHour + '，地区屏蔽=' + (config.regionBlock ? config.regionList : '关') + '）');
    }
};
