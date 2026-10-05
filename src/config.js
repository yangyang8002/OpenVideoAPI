/* 配置加载 / 合并 / 校验（含数据目录与文件路径常量）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');

module.exports = {
    define(ctx) {
        const { ROOT_DIR, app, S } = ctx;

    /* ── 原 server.js L44-52 ── */
    const DEFAULT_API_RULES = {
        '/api/config/public': { enabled: true, rps: 0, bandwidth: 0 },
        '/api/danmu/': { enabled: true, rps: 0, bandwidth: 0 },
        '/api/danmu/v3/': { enabled: true, rps: 0, bandwidth: 0 },
        '/api/video/map': { enabled: true, rps: 0, bandwidth: 0 },
        '/api/video/resolve': { enabled: true, rps: 0, bandwidth: 0 },
        '/api/subtitle/detect': { enabled: true, rps: 0, bandwidth: 0 },
        '/api/pow/verify': { enabled: true, rps: 0, bandwidth: 0 }
    };

    /* ── 原 server.js L363-363 ── */
    const DATA_DIR = process.env.OPENVIDEO_DATA_DIR ? path.resolve(process.env.OPENVIDEO_DATA_DIR) : path.join(ROOT_DIR, 'data');

    /* ── 原 server.js L364-364 ── */
    const DANMU_FILE = path.join(DATA_DIR, 'danmu.json');

    /* ── 原 server.js L365-365 ── */
    const BANNED_WORDS_FILE = path.join(DATA_DIR, 'banned_words.json');

    /* ── 原 server.js L366-366 ── */
    const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

    /* ── 原 server.js L367-367 ── */
    const VIDEOS_FILE = path.join(DATA_DIR, 'videos.json');

    /* ── 原 server.js L369-374 ── */
    function readJsonFile(file, fallback) {
        try {
            const d = JSON.parse(fs.readFileSync(file, 'utf8'));
            return d === undefined || d === null ? fallback : d;
        } catch { return fallback; }
    }

    /* ── 原 server.js L376-376 ── */
    // API 统计持久化（60s 定时 + 退出时），重启不丢

    /* ── 原 server.js L377-377 ── */
    const API_STATS_FILE = path.join(DATA_DIR, 'api-stats.json');

    /* ── 原 server.js L467-469 ── */
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    /* ── 原 server.js L473-477 ── */
    function initDataFile(filePath, defaultData) {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
        }
    }

    /* ── 原 server.js L479-479 ── */
    initDataFile(DANMU_FILE, []);

    /* ── 原 server.js L480-480 ── */
    initDataFile(BANNED_WORDS_FILE, ['广告', '刷屏', '垃圾']);

    /* ── 原 server.js L482-482 ── */
    // ==================== 服务器配置 ====================

    /* ── 原 server.js L483-483 ── */
    const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

    /* ── 原 server.js L484-499 ── */
    const DEFAULT_CONFIG = {
        pow: { enabled: false, difficulty: 4 },
        rateLimit: { enabled: false, windowMs: 60000, max: 60 },
        danmakuLimit: { enabled: false, maxPerMinute: 10 },
        danmaku: { maxLength: 500, authorMaxLength: 50 },
        upload: { maxMB: 200, previewKB: 200 },
        render: { maxPerSecond: 250, speedJitter: 10 },
        api: { apis: DEFAULT_API_RULES, retentionDays: 1 },
        bannedWords: { subscriptions: [] },
        security: { sessionMinutes: 120, adminPath: '', trustProxy: true, firstRun: false, autoBan: true, anomaly: { reqPerMin: 60, mbPerMin: 20, reqPerHour: 2000, mbPerHour: 1024 }, loginLimit: { maxFail: 5, windowMin: 10, lockMin: 15 }, advanced: { hidePoweredBy: true, hsts: true, noSniff: true, referrer: 'no-referrer', cors: true, corsOrigin: '*', debug: false } },
        theme: 'bili',
        adminTheme: 'md3',
        cdn: { enabled: false, baseUrl: '' },
        timezone: 'Asia/Shanghai',
        language: 'zh'
    };

    /* ── 原 server.js L501-501 ── */
    /* 常用时区白名单（初始化向导可选） */

    /* ── 原 server.js L502-508 ── */
    const TIMEZONES = [
        'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo', 'Asia/Seoul',
        'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Bangkok', 'Asia/Jakarta',
        'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
        'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Sao_Paulo',
        'Australia/Sydney', 'Pacific/Auckland', 'UTC'
    ];

    /* ── 原 server.js L510-510 ── */
    /* 按配置时区格式化服务器时间（备份文件名等） */

    /* ── 原 server.js L511-521 ── */
    function fmtServerTime(d) {
        const tz = TIMEZONES.includes((readConfig().timezone || 'Asia/Shanghai')) ? readConfig().timezone : 'Asia/Shanghai';
        try {
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
            const get = (t) => (parts.find(p => p.type === t) || {}).value || '00';
            return `${get('year')}${get('month')}${get('day')}-${get('hour')}${get('minute')}${get('second')}`;
        } catch { 
            const p = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
        }
    }

    /* ── 原 server.js L523-528 ── */
    if (!fs.existsSync(CONFIG_FILE)) {
        /* 全新安装：标记未初始化，首次登录强制修改密码与安全入口 */
        const fresh = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        fresh.security = { ...DEFAULT_CONFIG.security, firstRun: true };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(fresh, null, 2));
    }

    /* ── 原 server.js L530-543 ── */
    function readConfig() {
        try {
            const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            const merged = { ...DEFAULT_CONFIG, ...raw };
            merged.security = { ...DEFAULT_CONFIG.security, ...(raw.security || {}) };
            merged.security.loginLimit = { ...DEFAULT_CONFIG.security.loginLimit, ...((raw.security && raw.security.loginLimit) || {}) };
            merged.security.anomaly = { ...DEFAULT_CONFIG.security.anomaly, ...((raw.security && raw.security.anomaly) || {}) };
            merged.security.advanced = { ...DEFAULT_CONFIG.security.advanced, ...((raw.security && raw.security.advanced) || {}) };
            merged.security.autoBan = (raw.security && raw.security.autoBan !== false);
            return merged;
        } catch {
            return { ...DEFAULT_CONFIG };
        }
    }

    /* ── 原 server.js L545-547 ── */
    function writeConfig(config) {
        /* 原子写：先写 tmp 再 rename，避免写入中断产生残缺 config.json */
        const tmpFile = CONFIG_FILE + '.tmp';
        fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2));
        fs.renameSync(tmpFile, CONFIG_FILE);
    }

    /* ── 原 server.js L549-549 ── */
    /* 弹幕参数（可配置） */

    /* ── 原 server.js L550-556 ── */
    function getDanmakuLimits() {
        const c = readConfig().danmaku || {};
        return {
            maxLength: Math.max(1, Math.min(2000, parseInt(c.maxLength) || 500)),
            authorMaxLength: Math.max(1, Math.min(200, parseInt(c.authorMaxLength) || 50))
        };
    }

    /* ── 原 server.js L557-557 ── */
    /* 上传/预览限制（可配置） */

    /* ── 原 server.js L558-564 ── */
    function getUploadLimits() {
        const c = readConfig().upload || {};
        return {
            maxMB: Math.max(1, Math.min(2048, parseInt(c.maxMB) || 200)),
            previewKB: Math.max(1, Math.min(10240, parseInt(c.previewKB) || 200))
        };
    }

    /* ── 原 server.js L566-569 ── */
    /* 信任反向代理头（X-Forwarded-For 等），默认开启；
       安全加固：仅信任回环来源（本机 nginx），局域网/公网直连一律忽略 XFF，
       防止任意来源伪造 X-Forwarded-For 绕过限流/锁定/封禁/白名单。
       Docker + nginx 场景请将 trustProxy 关闭或确保反代与应用同主机回环。 */

    /* ── 原 server.js L570-573 ── */
    function applyTrustProxy(config) {
        const trust = !(config.security && config.security.trustProxy === false);
        app.set('trust proxy', trust ? 'loopback' : false);
    }

    /* ── 原 server.js L574-574 ── */
    applyTrustProxy(readConfig());

    /* ── 原 server.js L576-578 ── */
    function readData(filePath) {
        return readJsonFile(filePath, []);
    }

    /* ── 原 server.js L580-584 ── */
    async function containsBannedWord(text) {
        const bannedWords = await S.store.bannedAll();
        const lowerText = text.toLowerCase();
        return bannedWords.some(word => lowerText.includes(word.toLowerCase()));
    }

    /* ── 原 server.js L2212-2212 ── */
    const APP_VERSION = require('../package.json').version;

        Object.assign(ctx, { DEFAULT_API_RULES, DEFAULT_API_RULES, DATA_DIR, DATA_DIR, DANMU_FILE, DANMU_FILE, BANNED_WORDS_FILE, BANNED_WORDS_FILE, ACCOUNTS_FILE, ACCOUNTS_FILE, VIDEOS_FILE, VIDEOS_FILE, readJsonFile, readJsonFile, API_STATS_FILE, API_STATS_FILE, initDataFile, initDataFile, CONFIG_FILE, CONFIG_FILE, DEFAULT_CONFIG, DEFAULT_CONFIG, TIMEZONES, TIMEZONES, fmtServerTime, fmtServerTime, readConfig, readConfig, writeConfig, writeConfig, getDanmakuLimits, getDanmakuLimits, getUploadLimits, getUploadLimits, applyTrustProxy, applyTrustProxy, readData, readData, containsBannedWord, containsBannedWord, APP_VERSION });
    },
};
