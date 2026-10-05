/* 字幕库核心：SSRF 防护/语言解析/ASS→SRT/OpenList 字幕检测
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');
const { createCloud } = require('../../lib/cloud');

module.exports = {
    define(ctx) {
        const { DATA_DIR, S, getAllCloudCfgs } = ctx;

    /* ── 原 server.js L2762-2762 ── */
    // ==================== 字幕库（字幕管理） ====================

    /* ── 原 server.js L2764-2764 ── */
    const SUB_CHARS = '23456789abcdefghijkmnpqrstuvwxyz'; // 与视频 ID 同字符集

    /* ── 原 server.js L2765-2765 ── */
    const SUB_DIR = path.join(DATA_DIR, 'subtitles'); /* 本地化/上传字幕文件存储 */

    /* ── 原 server.js L2767-2767 ── */
    /* 内网/保留/元数据 IP 段（防 SSRF：字幕 URL 不允许指向这些地址） */

    /* ── 原 server.js L2768-2783 ── */
    function isPrivateIp(ip) {
        const s = String(ip || '');
        if (s.includes(':')) {
            const lower = s.toLowerCase();
            if (lower === '::1' || lower === '::' || lower === '[::1]' || lower === '[::]') return true;
            if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff') || lower.startsWith('fe')) return true;
            return false; /* 其余 IPv6 视为公网 */
        }
        const parts = s.split('.');
        if (parts.length !== 4) return true;
        const n = parts.map(Number);
        if (n.some(x => isNaN(x) || x < 0 || x > 255)) return true;
        const a = n[0], b = n[1];
        return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 ||
            a === 172 && b >= 16 && b <= 31 || a >= 224; /* 组播/保留 */
    }

    /* ── 原 server.js L2785-2785 ── */
    /* 字幕 URL 安全校验：拒绝内网/保留/元数据地址（DNS 解析后再次校验，防 DNS rebinding） */

    /* ── 原 server.js L2786-2802 ── */
    async function isSafeSubtitleUrl(url) {
        let parsed;
        try { parsed = new URL(url); } catch { return false; }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
        const host = parsed.hostname;
        if (/^\[|:/ .test(host)) { /* IPv6：拒绝回环/链路本地/未指定 */ if (host === '[::1]' || host === '::1' || host === '[::]' || host === '::') return false; return true; }
        const looksIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
        if (looksIp) return !isPrivateIp(host);
        if (host === 'localhost') return false;
        /* 域名：DNS 解析校验 */
        try {
            const dns = require('dns');
            const addrs = await new Promise((resolve) => dns.lookup(host, { all: true }, (err, a) => err ? resolve([]) : resolve(a || [])));
            if (!addrs.length) return true; /* 解析失败放行，fetch 阶段会失败 */
            return addrs.every(a => !isPrivateIp(a.address.replace(/^::ffff:/, '')));
        } catch { return true; }
    }

    /* ── 原 server.js L2804-2812 ── */
    async function genSubId() {
        const existing = new Set((await S.store.subtitleAll()).map(s => s.id));
        for (let i = 0; i < 100; i++) {
            let s = 's';
            for (let j = 0; j < 7; j++) s += SUB_CHARS[Math.floor(Math.random() * SUB_CHARS.length)];
            if (!existing.has(s)) return s;
        }
        return 's' + Date.now().toString(36);
    }

    /* ── 原 server.js L2813-2813 ── */
    const SUB_EXT_RE = /\.(srt|vtt|ass|ssa|webvtt)$/i;

    /* ── 原 server.js L2814-2814 ── */
    const SUB_FETCH_LIMIT = 5 * 1024 * 1024; /* 远程字幕内容上限 5MB */

    /* ── 原 server.js L2816-2827 ── */
    function subLangName(lang) {
        const map = {
            'sc': '简体中文', 'chs': '简体中文', 'zh-cn': '简体中文', 'zh-hans': '简体中文', 'zh': '简体中文',
            'tc': '繁體中文', 'cht': '繁體中文', 'zh-tw': '繁體中文', 'zh-hk': '繁體中文', 'zh-hant': '繁體中文',
            'en': 'English', 'eng': 'English',
            'ja': '日本語', 'jpn': '日本語',
            'ko': '한국어', 'kor': '한국어',
            'fr': 'Français', 'de': 'Deutsch', 'es': 'Español', 'pt': 'Português',
            'it': 'Italiano', 'ru': 'Русский', 'ar': 'العربية', 'th': 'ไทย', 'vi': 'Tiếng Việt'
        };
        return map[String(lang || '').toLowerCase()] || String(lang || '');
    }

    /* ── 原 server.js L2828-2828 ── */
    /* 解析语言：支持数组或 "zh,ja" / "zh+ja" / "zh  ja"（双语字幕） */

    /* ── 原 server.js L2829-2834 ── */
    function parseLangs(input) {
        let arr = [];
        if (Array.isArray(input)) arr = input.map(x => String(x).trim().toLowerCase()).filter(Boolean);
        else if (typeof input === 'string') arr = input.split(/[,，+、\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
        return arr.slice(0, 8);
    }

    /* ── 原 server.js L2835-2839 ── */
    function langsName(langs) {
        if (!langs || !langs.length) return '';
        if (langs.length === 1) return subLangName(langs[0]);
        return langs.map(l => subLangName(l)).join(' + ');
    }

    /* ── 原 server.js L2841-2841 ── */
    /* 字幕内容获取：url 类型可远程拉取（限 5MB + 内网防护），file 类型读本地，text 类型直接返回 */

    /* ── 原 server.js L2842-2843 ── */
    /* ASS/SSA → SRT 转换（ArtPlayer 仅支持 vtt/srt；提取的 ass 字幕经此统一为 srt 输出）
       Dialogue: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text */

    /* ── 原 server.js L2844-2856 ── */
    function assToSrt(content) {
        const out = [];
        const re = /Dialogue:\s*(\d+),\s*(\d+):(\d+):(\d+)[.,](\d+),\s*(\d+):(\d+):(\d+)[.,](\d+),\s*[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,(.*)/g;
        const fmt = (h, mi, s, ms) => String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
        let m, n = 0;
        while ((m = re.exec(content))) {
            const text = String(m[10] || '').replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\n+$/, '').trim();
            if (!text) continue;
            n++;
            out.push(n + '\n' + fmt(m[2], m[3], m[4], m[5]) + ' --> ' + fmt(m[6], m[7], m[8], m[9]) + '\n' + text + '\n');
        }
        return out.length ? out.join('\n') : content;
    }

    /* ── 原 server.js L2857-2890 ── */
    async function subtitleContent(sub) {
        if (!sub) return null;
        let content = null;
        if (sub.type === 'text') content = sub.content || null;
        else if (sub.type === 'local' || sub.file) {
            const file = path.isAbsolute(sub.file) ? sub.file : path.join(SUB_DIR, sub.file);
            if (fs.existsSync(file)) {
                const st = fs.statSync(file);
                if (st.size > SUB_FETCH_LIMIT) return null;
                content = fs.readFileSync(file, 'utf8');
            }
        } else if (sub.type === 'url' && sub.url) {
            if (!(await isSafeSubtitleUrl(sub.url))) return null;
            try {
                const resp = await fetch(sub.url, { signal: AbortSignal.timeout(20000) });
                if (!resp.ok) return null;
                const reader = resp.body.getReader();
                let chunks = [], total = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    total += value.length;
                    if (total > SUB_FETCH_LIMIT) { await reader.cancel(); return null; }
                    chunks.push(value);
                }
                content = Buffer.concat(chunks).toString('utf8');
            } catch { return null; }
        }
        if (content == null) return null;
        /* ass/ssa 内容转 srt，保证播放器可播 */
        const fileExt = String(sub.file || sub.url || '').toLowerCase();
        if (/\.(ass|ssa)$/.test(fileExt)) content = assToSrt(content);
        return content;
    }

    /* ── 原 server.js L2892-2893 ── */
    /* 匹配 OpenList/AList 实例：仅对已启用且同源的 openlist 云端配置生效（避免凭据被外部触发利用）
       支持带签名参数的链接（/d/xxx.mp4?sign=...）：剥离 query/hash 后再取云盘路径 */

    /* ── 原 server.js L2894-2910 ── */
    function matchOpenlistCfg(videoUrl) {
        const url = String(videoUrl || '');
        if (!url) return null;
        const cfgs = getAllCloudCfgs();
        for (const cfg of cfgs) {
            if (!cfg.enabled || cfg.type !== 'openlist' || !cfg.baseUrl || !cfg.user) continue;
            const base = String(cfg.baseUrl).replace(/\/+$/, '');
            if (!url.startsWith(base)) continue;
            /* 剥离签名等 query 参数：/d/xxx/yyy.mp4?sign=... → 云盘路径 /xxx/yyy.mp4 */
            const clean = url.split('?')[0].split('#')[0];
            const m = clean.match(/\/d\/(.+)$/);
            if (!m) continue;
            const rel = decodeURIComponent(m[1]);
            return { cfg, rel, base, cleanUrl: clean };
        }
        return null;
    }

    /* ── 原 server.js L2912-2912 ── */
    /* OpenList 链接归一化：匹配实例的链接剥掉签名参数（vid 键 / 映射键 / 字幕检测统一用它，签名变化不影响弹幕与字幕） */

    /* ── 原 server.js L2913-2916 ── */
    function normalizeOpenlistUrl(url) {
        const hit = matchOpenlistCfg(url);
        return hit ? hit.cleanUrl : url;
    }

    /* ── 原 server.js L2918-2918 ── */
    /* OpenList/AList 同目录字幕检测 */

    /* ── 原 server.js L2919-2936 ── */
    async function detectOpenlistSubs(videoUrl) {
        const hit = matchOpenlistCfg(videoUrl);
        if (!hit) return [];
        const { cfg, rel, base } = hit;
        const dirPath = '/' + rel.split('/').slice(0, -1).join('/');
        const baseName = rel.split('/').pop().replace(/\.[^.]+$/, '');
        try {
            const cfg2 = { ...cfg, path: dirPath };
            const cloud2 = createCloud(cfg2);
            const items = await cloud2.list();
            const subs = items.filter(it => SUB_EXT_RE.test(it.name) && (it.name === baseName + '.srt' || it.name.startsWith(baseName + '.')));
            return subs.map(it => {
                const langPart = it.name.slice(baseName.length + 1).replace(/\.[^.]+$/, '');
                return { title: subLangName(langPart), lang: langPart.toLowerCase(), url: base + '/d/' + encodeURIComponent((dirPath + '/' + it.name).replace(/^\//, '')) };
            });
        } catch (e) { /* 检测失败忽略 */ }
        return [];
    }

        Object.assign(ctx, { SUB_CHARS, SUB_CHARS, SUB_DIR, SUB_DIR, isPrivateIp, isPrivateIp, isSafeSubtitleUrl, isSafeSubtitleUrl, genSubId, genSubId, SUB_EXT_RE, SUB_EXT_RE, SUB_FETCH_LIMIT, SUB_FETCH_LIMIT, subLangName, subLangName, parseLangs, parseLangs, langsName, langsName, assToSrt, assToSrt, subtitleContent, subtitleContent, matchOpenlistCfg, matchOpenlistCfg, normalizeOpenlistUrl, normalizeOpenlistUrl, detectOpenlistSubs, detectOpenlistSubs });
    },
};
