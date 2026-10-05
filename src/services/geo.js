/* IP 归属地：ip2region xdb 自动更新 + 坐标映射
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');
const https = require('https');
const IP2Region = require('ip2region').default;
const ip2rJs = require('ip2region.js');

module.exports = {
    define(ctx) {
        const { DATA_DIR, S } = ctx;

    /* ── 原 server.js L725-725 ── */
    // --- 归属地：ip2region 官方最新 xdb（自动更新）+ 内置旧库兜底 ---

    /* ── 原 server.js L726-726 ── */
    const GEO_V4_FILE = path.join(DATA_DIR, 'ip2region_v4.xdb');

    /* ── 原 server.js L727-727 ── */
    const GEO_V6_FILE = path.join(DATA_DIR, 'ip2region_v6.xdb');

    /* ── 原 server.js L728-728 ── */
    const GEO_SOURCE_BASE = 'https://github.com/lionsoul2014/ip2region/raw/master/data/';

    /* ── 原 server.js L731-731 ── */
    try { S.ipGeo = new IP2Region(); } catch (e) { console.error('[geo] 内置地址库初始化失败:', e.message); }

    /* ── 原 server.js L733-738 ── */
    function geoDbInfo(file) {
        try {
            const st = fs.statSync(file);
            return { file: path.basename(file), size: st.size, mtime: st.mtimeMs };
        } catch { return null; }
    }

    /* ── 原 server.js L740-762 ── */
    function downloadFile(url, dest) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const req = https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    return downloadFile(new URL(res.headers.location, url).toString(), dest).then(resolve, reject);
                }
                if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
                const tmp = dest + '.tmp';
                const out = fs.createWriteStream(tmp);
                res.pipe(out);
                out.on('finish', () => {
                    out.close(() => {
                        try { fs.renameSync(tmp, dest); resolve(); } catch (e) { reject(e); }
                    });
                });
                out.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (x) {} reject(e); });
            });
            req.on('error', reject);
            req.setTimeout(120000, () => { req.destroy(new Error('timeout')); });
        });
    }

    /* ── 原 server.js L764-771 ── */
    async function reloadSearchers() {
        if (fs.existsSync(GEO_V4_FILE)) {
            try { S.ipSearcher4 = ip2rJs.newWithFileOnly(ip2rJs.IPv4, GEO_V4_FILE); } catch (e) { console.error('[geo] v4 xdb 加载失败:', e.message); S.ipSearcher4 = null; }
        }
        if (fs.existsSync(GEO_V6_FILE)) {
            try { S.ipSearcher6 = ip2rJs.newWithFileOnly(ip2rJs.IPv6, GEO_V6_FILE); } catch (e) { console.error('[geo] v6 xdb 加载失败:', e.message); S.ipSearcher6 = null; }
        }
    }

    /* ── 原 server.js L773-773 ── */
    /* 下载/更新地址库：缺失或超过 7 天则重新下载（动态更新） */

    /* ── 原 server.js L774-789 ── */
    async function ensureGeoDb(force) {
        const week = 7 * 86400000;
        for (const name of ['ip2region_v4.xdb', 'ip2region_v6.xdb']) {
            const file = path.join(DATA_DIR, name);
            const info = geoDbInfo(file);
            if (!force && info && Date.now() - info.mtime < week) continue;
            try {
                console.log('[geo] 下载地址库 ' + name + ' ...');
                await downloadFile(GEO_SOURCE_BASE + name, file);
                console.log('[geo] ' + name + ' 更新完成');
            } catch (e) {
                console.error('[geo] ' + name + ' 下载失败（使用兜底库）:', e.message);
            }
        }
        await reloadSearchers();
    }

    /* ── 原 server.js L790-790 ── */
    ensureGeoDb(false);

    /* ── 原 server.js L791-791 ── */
    setInterval(() => ensureGeoDb(false), 3600000); // 每小时检查一次是否需要更新

    /* ── 原 server.js L793-793 ── */
    const geoCache = new Map();

    /* ── 原 server.js L794-799 ── */
    function parseRegion(str) {
        const p = String(str || '').split('|');
        if (p.length >= 5 && p[0]) return { country: p[0], province: p[1] || '', city: p[2] === '0' ? '' : (p[2] || ''), isp: p[3] || '', code: p[4] || '' };
        if (p.length === 1 && p[0]) return { country: p[0], province: '', city: '', isp: '', code: '' };
        return null;
    }

    /* ── 原 server.js L800-826 ── */
    async function geoLookup(ip) {
        const clean = String(ip || '').replace(/^::ffff:/, '');
        if (!clean) return null;
        if (geoCache.has(clean)) return geoCache.get(clean);
        let res = null;
        try {
            if (clean.includes(':') && S.ipSearcher6) {
                const region = await S.ipSearcher6.search(clean);
                if (region) res = parseRegion(region);
            } else if (S.ipSearcher4) {
                const region = await S.ipSearcher4.search(clean);
                if (region) res = parseRegion(region);
            }
        } catch (e) { /* 单次失败忽略 */ }
        if (!res && S.ipGeo) {
            try {
                const r = S.ipGeo.search(clean);
                if (r && (r.country || r.province || r.city)) res = { country: r.country, province: r.province, city: r.city, isp: r.isp, code: '' };
            } catch (e) { /* 忽略 */ }
        }
        geoCache.set(clean, res);
        if (geoCache.size > 5000) {
            const first = geoCache.keys().next().value;
            if (first !== undefined) geoCache.delete(first);
        }
        return res;
    }

    /* ── 原 server.js L828-828 ── */
    /* 中国省份 / 国家（中英文名 + ISO 国家码）→ 经纬度（地图标记用） */

    /* ── 原 server.js L829-839 ── */
    const PROVINCE_COORDS = {
        '北京': [116.40, 39.90], '天津': [117.20, 39.13], '上海': [121.47, 31.23], '重庆': [106.55, 29.56],
        '河北': [114.50, 38.04], '山西': [112.55, 37.87], '辽宁': [123.43, 41.80], '吉林': [125.32, 43.90],
        '黑龙江': [126.63, 45.75], '江苏': [118.78, 32.04], '浙江': [120.15, 30.28], '安徽': [117.28, 31.86],
        '福建': [119.30, 26.08], '江西': [115.89, 28.68], '山东': [117.00, 36.65], '河南': [113.65, 34.76],
        '湖北': [114.30, 30.59], '湖南': [112.98, 28.19], '广东': [113.28, 23.13], '海南': [110.35, 20.02],
        '四川': [104.07, 30.67], '贵州': [106.71, 26.57], '云南': [102.71, 25.04], '陕西': [108.95, 34.27],
        '甘肃': [103.82, 36.06], '青海': [101.78, 36.62], '台湾': [121.50, 25.03], '内蒙古': [111.75, 40.84],
        '广西': [108.32, 22.82], '西藏': [91.13, 29.65], '宁夏': [106.28, 38.47], '新疆': [87.62, 43.83],
        '香港': [114.17, 22.28], '澳门': [113.55, 22.20]
    };

    /* ── 原 server.js L840-882 ── */
    const COUNTRY_COORDS = {
        '美国': [-98.58, 39.83], 'United States': [-98.58, 39.83], 'US': [-98.58, 39.83],
        '日本': [138.25, 36.20], 'Japan': [138.25, 36.20], 'JP': [138.25, 36.20],
        '韩国': [127.77, 35.90], 'South Korea': [127.77, 35.90], 'KR': [127.77, 35.90],
        '英国': [-0.13, 51.50], 'United Kingdom': [-0.13, 51.50], 'GB': [-0.13, 51.50],
        '德国': [10.45, 51.17], 'Germany': [10.45, 51.17], 'DE': [10.45, 51.17],
        '法国': [2.35, 48.86], 'France': [2.35, 48.86], 'FR': [2.35, 48.86],
        '俄罗斯': [37.62, 55.75], 'Russia': [37.62, 55.75], 'RU': [37.62, 55.75],
        '加拿大': [-106.35, 56.13], 'Canada': [-106.35, 56.13], 'CA': [-106.35, 56.13],
        '澳大利亚': [133.78, -25.27], 'Australia': [133.78, -25.27], 'AU': [133.78, -25.27],
        '印度': [78.96, 20.59], 'India': [78.96, 20.59], 'IN': [78.96, 20.59],
        '新加坡': [103.82, 1.35], 'Singapore': [103.82, 1.35], 'SG': [103.82, 1.35],
        '马来西亚': [101.98, 3.14], 'Malaysia': [101.98, 3.14], 'MY': [101.98, 3.14],
        '泰国': [100.50, 13.75], 'Thailand': [100.50, 13.75], 'TH': [100.50, 13.75],
        '越南': [105.85, 21.03], 'Vietnam': [105.85, 21.03], 'VN': [105.85, 21.03],
        '印度尼西亚': [106.85, -6.21], 'Indonesia': [106.85, -6.21], 'ID': [106.85, -6.21],
        '菲律宾': [121.00, 14.60], 'Philippines': [121.00, 14.60], 'PH': [121.00, 14.60],
        '荷兰': [4.90, 52.37], 'Netherlands': [4.90, 52.37], 'NL': [4.90, 52.37],
        '瑞士': [7.45, 46.95], 'Switzerland': [7.45, 46.95], 'CH': [7.45, 46.95],
        '瑞典': [18.07, 59.33], 'Sweden': [18.07, 59.33], 'SE': [18.07, 59.33],
        '意大利': [12.50, 41.90], 'Italy': [12.50, 41.90], 'IT': [12.50, 41.90],
        '西班牙': [-3.70, 40.42], 'Spain': [-3.70, 40.42], 'ES': [-3.70, 40.42],
        '波兰': [21.01, 52.23], 'Poland': [21.01, 52.23], 'PL': [21.01, 52.23],
        '土耳其': [32.85, 39.93], 'Turkey': [32.85, 39.93], 'TR': [32.85, 39.93],
        '以色列': [35.21, 31.78], 'Israel': [35.21, 31.78], 'IL': [35.21, 31.78],
        '阿联酋': [54.37, 24.45], 'United Arab Emirates': [54.37, 24.45], 'AE': [54.37, 24.45],
        '沙特阿拉伯': [46.68, 24.69], 'Saudi Arabia': [46.68, 24.69], 'SA': [46.68, 24.69],
        '巴基斯坦': [73.05, 33.68], 'Pakistan': [73.05, 33.68], 'PK': [73.05, 33.68],
        '哈萨克斯坦': [71.47, 51.17], 'Kazakhstan': [71.47, 51.17], 'KZ': [71.47, 51.17],
        '蒙古': [106.92, 47.91], 'Mongolia': [106.92, 47.91], 'MN': [106.92, 47.91],
        '缅甸': [96.16, 16.87], 'Myanmar': [96.16, 16.87], 'MM': [96.16, 16.87],
        '巴西': [-47.93, -15.79], 'Brazil': [-47.93, -15.79], 'BR': [-47.93, -15.79],
        '阿根廷': [-58.38, -34.60], 'Argentina': [-58.38, -34.60], 'AR': [-58.38, -34.60],
        '智利': [-70.65, -33.45], 'Chile': [-70.65, -33.45], 'CL': [-70.65, -33.45],
        '墨西哥': [-99.13, 19.43], 'Mexico': [-99.13, 19.43], 'MX': [-99.13, 19.43],
        '南非': [28.05, -26.20], 'South Africa': [28.05, -26.20], 'ZA': [28.05, -26.20],
        '埃及': [31.24, 30.04], 'Egypt': [31.24, 30.04], 'EG': [31.24, 30.04],
        '新西兰': [174.78, -41.29], 'New Zealand': [174.78, -41.29], 'NZ': [174.78, -41.29],
        '中国': [104.20, 35.90], 'China': [104.20, 35.90], 'CN': [104.20, 35.90],
        '香港': [114.17, 22.28], 'Hong Kong': [114.17, 22.28], 'HK': [114.17, 22.28],
        '台湾': [121.50, 25.03], 'Taiwan': [121.50, 25.03], 'TW': [121.50, 25.03],
        '澳门': [113.55, 22.20], 'Macau': [113.55, 22.20], 'MO': [113.55, 22.20]
    };

    /* ── 原 server.js L884-888 ── */
    async function geoRegionText(ip) {
        const g = await geoLookup(ip);
        if (!g) return '未知';
        return [g.country, g.province, g.city].filter(Boolean).join('·') || '未知';
    }

    /* ── 原 server.js L889-891 ── */
    function normProvince(p) {
        return String(p || '').replace(/壮族自治区$|回族自治区$|维吾尔自治区$|自治区$|特别行政区$|省$|市$/, '');
    }

    /* ── 原 server.js L892-906 ── */
    async function geoCoords(ip) {
        const g = await geoLookup(ip);
        if (!g) return null;
        const prov = normProvince(g.province);
        if (g.country === '中国' || g.country === 'China' || g.code === 'CN' || PROVINCE_COORDS[prov]) {
            if (PROVINCE_COORDS[prov]) return PROVINCE_COORDS[prov];
            if (g.city) {
                for (const [k, v] of Object.entries(PROVINCE_COORDS)) if (g.city.includes(k)) return v;
            }
        }
        if (g.code && COUNTRY_COORDS[g.code]) return COUNTRY_COORDS[g.code];
        if (g.country && COUNTRY_COORDS[g.country]) return COUNTRY_COORDS[g.country];
        if (prov && COUNTRY_COORDS[prov]) return COUNTRY_COORDS[prov];
        return null;
    }

    /* ── 原 server.js L2709-2709 ── */
    /* 地图区域聚合：world = 按国家（名称对齐 echarts world.json），china = 按省份（短名） */

    /* ── 原 server.js L2710-2720 ── */
    const WORLD_CODE_NAMES = {
        'CN': 'China', 'US': 'United States', 'JP': 'Japan', 'KR': 'Korea',
        'GB': 'United Kingdom', 'DE': 'Germany', 'FR': 'France', 'RU': 'Russia', 'CA': 'Canada',
        'AU': 'Australia', 'IN': 'India', 'SG': 'Singapore', 'MY': 'Malaysia', 'TH': 'Thailand',
        'VN': 'Vietnam', 'ID': 'Indonesia', 'PH': 'Philippines', 'NL': 'Netherlands',
        'CH': 'Switzerland', 'SE': 'Sweden', 'IT': 'Italy', 'ES': 'Spain', 'PL': 'Poland',
        'TR': 'Turkey', 'IL': 'Israel', 'AE': 'United Arab Emirates', 'SA': 'Saudi Arabia',
        'PK': 'Pakistan', 'KZ': 'Kazakhstan', 'MN': 'Mongolia', 'MM': 'Myanmar', 'BR': 'Brazil',
        'AR': 'Argentina', 'CL': 'Chile', 'MX': 'Mexico', 'ZA': 'South Africa', 'EG': 'Egypt',
        'NZ': 'New Zealand'
    };

        Object.assign(ctx, { GEO_V4_FILE, GEO_V4_FILE, GEO_V6_FILE, GEO_V6_FILE, GEO_SOURCE_BASE, GEO_SOURCE_BASE, geoDbInfo, geoDbInfo, downloadFile, downloadFile, reloadSearchers, reloadSearchers, ensureGeoDb, ensureGeoDb, geoCache, geoCache, parseRegion, parseRegion, geoLookup, geoLookup, PROVINCE_COORDS, PROVINCE_COORDS, COUNTRY_COORDS, COUNTRY_COORDS, geoRegionText, geoRegionText, normProvince, normProvince, geoCoords, geoCoords, WORLD_CODE_NAMES, WORLD_CODE_NAMES });
    },
};
