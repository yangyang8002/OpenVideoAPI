'use strict';
/* ==========================================================================
 * OpenVideoAPI 插件：内封字幕采集（ffprobe + ffmpeg）
 *
 * 能力：
 *   1. 检测：ffprobe 列出视频文件内嵌的全部字幕轨道
 *      （index / 编码 / 语言 / 标题 / 默认与强制标记 / 是否图形字幕）
 *   2. 提取：ffmpeg 将选中轨道导出为独立字幕文件（srt / ass），
 *      写入 data/subtitles/ 并登记到字幕库（type=local），可关联视频
 *   3. 多轨批量：detect 返回全部轨道；extract-all 一次提取多条
 *
 * 用法：
 *   POST /api/plugin/embed-sub/detect      { file }
 *   POST /api/plugin/embed-sub/extract     { file, index, lang?, name?, vid? }
 *   POST /api/plugin/embed-sub/extract-all { file, indexes: [], vid? }
 *   file 为服务器本地路径（相对项目根，如 public/videos/demo.mkv，或绝对路径）
 *
 * 前置：服务器需安装 ffmpeg（含 ffprobe），可在插件配置中指定路径。
 * 安全：文件路径仅允许项目根目录内；ffprobe/ffmpeg 子进程带超时与强制终止。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/* ---------- 项目根定位（兼容本地目录与 npm 安装的 plugins/node_modules 布局） ---------- */
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
const SUB_DIR = path.join(ROOT, 'data', 'subtitles');

/* ---------- 路径安全解析：仅允许项目根内的文件 ---------- */
function resolveFile(file) {
    if (typeof file !== 'string' || !file) return null;
    let p;
    if (path.isAbsolute(file)) p = path.resolve(file);
    else p = path.resolve(ROOT, file.replace(/\\/g, '/').replace(/^\/+/, ''));
    if (p !== ROOT && !p.startsWith(ROOT + path.sep)) return null;
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    return p;
}

/* ---------- 子进程执行（超时强制终止） ---------- */
function run(bin, args, timeoutMs) {
    return new Promise((resolve) => {
        let out = '', err = '';
        const child = execFile(bin, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (e) => {
            resolve({ ok: !e, code: e ? e.code : 0, out, err });
        });
        child.stdout && child.stdout.on('data', (d) => { out += d; });
        child.stderr && child.stderr.on('data', (d) => { err += d; });
        child.on('error', () => resolve({ ok: false, code: 'spawn', out, err }));
    });
}

/* ---------- 语言：ffprobe 三字母标签 → 字幕库语言代码 ---------- */
const LANG_MAP = {
    zho: 'zh', chi: 'zh', cmn: 'zh', jpn: 'ja', eng: 'en', kor: 'ko', fre: 'fr', fra: 'fr',
    spa: 'es', rus: 'ru', deu: 'de', ger: 'de', ita: 'it', tha: 'th', vie: 'vi', ara: 'ar',
    por: 'pt', nld: 'nl', pol: 'pl', tur: 'tr', ind: 'id', hin: 'hi', ukr: 'uk', cze: 'cs',
    swe: 'sv', dan: 'da', fin: 'fi', nor: 'no', heb: 'he', fas: 'fa', tha2: 'th'
};
function normLang(raw) {
    if (!raw) return '';
    const l = String(raw).toLowerCase();
    if (/^[a-z]{2,3}$/.test(l)) return l.length === 2 ? l : (LANG_MAP[l] || l.slice(0, 2));
    return l.slice(0, 2);
}
const TEXT_CODECS = ['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'subtitle'];
const IMAGE_CODECS = ['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'];
function codecIsText(codec) { return TEXT_CODECS.includes(String(codec || '').toLowerCase()); }
function codecIsImage(codec) { return IMAGE_CODECS.includes(String(codec || '').toLowerCase()); }

/* ---------- 检测 ---------- */
async function detectStreams(ffprobe, filePath) {
    const r = await run(ffprobe, ['-v', 'error', '-select_streams', 's', '-show_entries',
        'stream=index,codec_name,codec_type:stream_tags=language,title:stream_disposition=default,forced',
        '-of', 'json', filePath], 20000);
    if (!r.ok) throw new Error('ffprobe 执行失败: ' + (r.err || r.out || 'code ' + r.code).slice(-300));
    let j;
    try { j = JSON.parse(r.out); } catch (e) { throw new Error('ffprobe 输出解析失败'); }
    const streams = (j.streams || []).map(s => {
        const lang = normLang(s.tags && s.tags.language);
        return {
            index: s.index,
            codec: s.codec_name || '',
            language: lang,
            title: (s.tags && s.tags.title) || '',
            default: !!(s.disposition && s.disposition.default),
            forced: !!(s.disposition && s.disposition.forced),
            text: codecIsText(s.codec_name),
            image: codecIsImage(s.codec_name)
        };
    });
    return streams;
}

/* ---------- 提取 ---------- */
function extFor(codec) {
    const c = String(codec || '').toLowerCase();
    return (c === 'ass' || c === 'ssa') ? 'ass' : 'srt';
}
function outCodec(ext) { return ext === 'ass' ? 'ass' : 'srt'; }

function genSubId() {
    let s = 's';
    const chars = '23456789abcdefghijkmnpqrstuvwxyz';
    for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

const VID_CHARS = '23456789abcdefghijkmnpqrstuvwxyz'; /* 与 server.js 同字符集 */

/* 由文件路径推导播放 URL：public/ 下的文件可直接播放（如 public/test_embed/a.mkv → /test_embed/a.mkv） */
function playUrlOf(filePath) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
    if (rel.startsWith('public/')) return '/' + rel.slice('public/'.length);
    return null;
}

/* 自动关联：查已有映射，否则分配 8 位 vid 并写入（提取后播放器立即可见字幕） */
async function autoVid(ctx, url) {
    const videos = await ctx.store.videosAll();
    for (const [v, u] of Object.entries(videos)) if (u === url) return v;
    const used = new Set(Object.keys(videos));
    try { (await ctx.store.danmuAllVids()).forEach(v => used.add(v)); } catch (e) {}
    for (let i = 0; i < 50; i++) {
        let s = '';
        for (let j = 0; j < 8; j++) s += VID_CHARS[Math.floor(Math.random() * VID_CHARS.length)];
        if (!used.has(s)) { await ctx.store.videoSet(s, url); return s; }
    }
    return null;
}

/* ---------- ffmpeg / ffprobe 二进制解析：用户配置 > 内置 npm 模块（跨平台） > PATH ----------
   内置模块：ffmpeg-static（Linux x64/arm64 / macOS / Windows 静态构建）、
   @ffprobe-installer/ffprobe（同平台集）。Linux/Docker 无需安装系统 ffmpeg。 */
function makeBinResolver(config) {
    const cache = {};
    return function resolveBinary(kind) {
        const cfgKey = kind === 'ffprobe' ? 'ffprobePath' : 'ffmpegPath';
        const cfg = String((config && config[cfgKey]) || '').trim();
        if (cfg) return cfg;
        if (cache[kind]) return cache[kind];
        let p = '';
        try {
            p = kind === 'ffprobe'
                ? require('@ffprobe-installer/ffprobe').path
                : require('ffmpeg-static');
        } catch (e) { /* 依赖未安装（本地目录模式），回退 PATH */ }
        if (typeof p === 'string' && p && fs.existsSync(p)) {
            cache[kind] = p;
            return p;
        }
        return kind === 'ffprobe' ? 'ffprobe' : 'ffmpeg';
    };
}

module.exports = {
    apply(ctx, config) {
        const resolveBinary = makeBinResolver(config);
        const ffprobe = resolveBinary('ffprobe');
        const ffmpeg = resolveBinary('ffmpeg');
        const timeoutMs = Math.max(15, parseInt(config.timeoutSec) || 120) * 1000;

        const wrap = (fn) => async (req, res) => {
            try {
                await fn(req, res);
            } catch (e) {
                const status = e.status || 500;
                res.status(status).json({ code: status === 500 ? 1 : status, msg: e.message || '操作失败' });
            }
        };

        /* 检测：列出文件内封字幕轨道 */
        ctx.router.post('/api/plugin/embed-sub/detect', wrap(async (req, res) => {
            const file = String((req.body || {}).file || '');
            const filePath = resolveFile(file);
            if (!filePath) { const e = new Error('文件不存在或路径非法'); e.status = 400; throw e; }
            const streams = await detectStreams(ffprobe, filePath);
            res.json({ code: 0, data: { file, streams, ffprobe } });
        }));

        /* 提取单条轨道到字幕库 */
        ctx.router.post('/api/plugin/embed-sub/extract', wrap(async (req, res) => {
            const { file, index, lang, name, vid } = req.body || {};
            const filePath = resolveFile(file);
            if (!filePath) { const e = new Error('文件不存在或路径非法'); e.status = 400; throw e; }
            const streams = await detectStreams(ffprobe, filePath);
            const st = streams.find(s => s.index === parseInt(index));
            if (!st) { const e = new Error('字幕轨道不存在: ' + index); e.status = 400; throw e; }
            if (!st.text) { const e = new Error('轨道 ' + index + ' 为图形字幕（' + (st.codec || '?') + '），无法提取为文本'); e.status = 400; throw e; }
            const item = await extractOne(filePath, st, lang, name, vid);
            res.json({ code: 0, msg: '已提取并加入字幕库', data: item });
        }));

        /* 批量提取多条轨道 */
        ctx.router.post('/api/plugin/embed-sub/extract-all', wrap(async (req, res) => {
            const { file, indexes, vid } = req.body || {};
            const filePath = resolveFile(file);
            if (!filePath) { const e = new Error('文件不存在或路径非法'); e.status = 400; throw e; }
            const streams = await detectStreams(ffprobe, filePath);
            const want = Array.isArray(indexes) ? indexes.map(i => parseInt(i)) : [];
            const picked = streams.filter(s => want.includes(s.index) && s.text);
            if (!picked.length) { const e = new Error('未选择可提取的文本字幕轨道'); e.status = 400; throw e; }
            const items = [];
            for (const st of picked) items.push(await extractOne(filePath, st, '', '', vid));
            ctx.logger.info('embed-sub', '从 ' + path.basename(filePath) + ' 提取 ' + items.length + ' 条字幕');
            res.json({ code: 0, msg: '已提取 ' + items.length + ' 条字幕并加入字幕库', data: { items } });
        }));

        async function extractOne(filePath, st, langOverride, nameOverride, vid) {
            if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR, { recursive: true });
            /* 自动关联：未指定 vid 时推导播放 URL 并分配/复用映射，提取后播放器立即可见字幕 */
            if (!vid) {
                const pUrl = playUrlOf(filePath);
                if (pUrl) vid = await autoVid(ctx, pUrl);
            }
            const base = path.basename(filePath, path.extname(filePath));
            const lang = langOverride || st.language || String(st.index);
            const ext = extFor(st.codec);
            const saveName = Date.now().toString(36) + '-' + base + '.' + lang + '.' + ext;
            const outPath = path.join(SUB_DIR, saveName);
            const r = await run(ffmpeg, ['-v', 'error', '-i', filePath, '-map', '0:' + st.index, '-c:s', outCodec(ext), '-y', outPath], timeoutMs);
            if (!r.ok || !fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
                try { fs.unlinkSync(outPath); } catch (e) {}
                throw new Error('ffmpeg 提取失败: ' + (r.err || r.out || 'code ' + r.code).slice(-300));
            }
            const item = {
                id: genSubId(),
                name: String(nameOverride || (base + '.' + lang)).slice(0, 100),
                lang,
                langs: lang ? [lang] : [],
                langName: '',
                type: 'local',
                url: '',
                content: '',
                file: saveName,
                localized: true,
                createdAt: Date.now(),
                source: 'embed:' + st.index
            };
            await ctx.store.subtitleAdd(item);
            if (vid) {
                const subsMap = await ctx.store.videoSubsAll();
                if (!Array.isArray(subsMap[vid])) subsMap[vid] = [];
                if (!subsMap[vid].includes(item.id)) subsMap[vid].push(item.id);
                await ctx.store.videoSubsWrite(subsMap);
                item.vid = vid;
                item.playUrl = playUrlOf(filePath);
            }
            return item;
        }

        ctx.logger.info('embed-sub', '内封字幕采集插件已加载（ffprobe: ' + ffprobe + '，ffmpeg: ' + ffmpeg + '）');
    }
};
