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
 *   file 为服务器本地路径（相对项目根，如 public/videos/demo.mkv，或绝对路径），
 *   或 http(s) 视频链接（自动扫描链接视频的内封字幕；拒绝内网/保留地址，防 SSRF）。
 *
 * 前置：服务器需安装 ffmpeg（含 ffprobe），可在插件配置中指定路径。
 * 安全：本地路径仅允许项目根目录内；URL 拒绝内网/保留/元数据地址（DNS 解析后二次校验）；
 *       ffprobe/ffmpeg 子进程带超时与强制终止。
 * v1.4.0：自动扫描改并发受控队列（autoConcurrency，默认 2）——无上限的并发远程探测/提取
 *       会打满网盘出口带宽，反噬扫描注册与字幕下载；单次 ffprobe 合并字幕轨+指纹元数据
 *       （远程读减半）；clean 结果持久化（kv embedsub_clean），重启/重扫不再全量重探测。
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
    return path.resolve(__dirname, '..');
}
const ROOT = findRoot();
const SUB_DIR = path.join(ROOT, 'data', 'subtitles');
const BIN_DIR = path.join(ROOT, 'data', 'bin'); /* 懒下载的 ffmpeg 二进制缓存 */

/* ---------- ffmpeg 二进制懒下载（optionalDependencies 安装失败时自动补齐，镜像优先） ----------
 * ffmpeg-static 的 postinstall 从 GitHub 下载约 30MB gz，国内网络常挂起导致 npm 安装失败，
 * 因此改为可选依赖 + 首次使用时从 npmmirror 镜像（GitHub 回退）下载到 data/bin/。 */
const FFMPEG_STATIC_TAG = 'b6.1.1'; /* 与 ffmpeg-static 内置版本一致 */
const FFMPEG_MIRROR = 'https://registry.npmmirror.com/-/binary/ffmpeg-static';
const FFMPEG_GITHUB = 'https://github.com/eugeneware/ffmpeg-static/releases/download';
const ffmpegAssetName = () => 'ffmpeg-' + process.platform + '-' + process.arch + '.gz';
const ffmpegLocalName = () => 'ffmpeg' + (process.platform === 'win32' ? '.exe' : '');
const MIN_FFMPEG_SIZE = 1024 * 1024; /* 下载解压后低于 1MB 视为损坏 */

function httpGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https:') ? require('https') : require('http');
        const req = lib.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'OpenVideoAPI/embed-subtitle' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                return resolve(httpGet(new URL(res.headers.location, url).href, timeoutMs));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            resolve(res);
        });
        req.on('timeout', () => req.destroy(new Error('下载超时')));
        req.on('error', reject);
    });
}

async function downloadFfmpegTo(localPath) {
    const zlib = require('zlib');
    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
    const urls = [
        FFMPEG_MIRROR + '/' + FFMPEG_STATIC_TAG + '/' + ffmpegAssetName(),
        FFMPEG_GITHUB + '/' + FFMPEG_STATIC_TAG + '/' + ffmpegAssetName()
    ];
    let lastErr = null;
    for (const u of urls) {
        try {
            const res = await httpGet(u, 60000);
            await new Promise((resolve, reject) => {
                const out = fs.createWriteStream(localPath);
                const gunzip = zlib.createGunzip();
                res.pipe(gunzip).pipe(out);
                out.on('finish', resolve);
                out.on('error', reject);
                gunzip.on('error', reject);
                res.on('error', reject);
            });
            if (fs.existsSync(localPath) && fs.statSync(localPath).size > MIN_FFMPEG_SIZE) {
                try { fs.chmodSync(localPath, 0o755); } catch (e) {}
                return localPath;
            }
            throw new Error('解压产物异常（' + (fs.existsSync(localPath) ? fs.statSync(localPath).size : 0) + ' bytes）');
        } catch (e) {
            lastErr = e;
            try { fs.unlinkSync(localPath); } catch (x) {}
        }
    }
    throw new Error(lastErr ? ('下载失败: ' + lastErr.message) : '下载失败');
}

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

/* ---------- 输入源解析：本地文件路径 或 http(s) 视频链接 ---------- */
function parseSource(input) {
    if (typeof input !== 'string' || !input) return null;
    const t = input.trim();
    if (/^https?:\/\//i.test(t)) {
        try { new URL(t); } catch (e) { return null; }
        return { type: 'url', url: t };
    }
    const p = resolveFile(t);
    if (!p) return null;
    return { type: 'file', path: p };
}

/* ---------- SSRF 防护：内网/保留/元数据 IP 段（与主项目同策略） ---------- */
function isPrivateIp(ip) {
    const s = String(ip || '');
    if (s.includes(':')) {
        const lower = s.toLowerCase();
        if (lower === '::1' || lower === '::' || lower === '[::1]' || lower === '[::]') return true;
        if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('ff') || lower.startsWith('fe')) return true;
        return false;
    }
    const parts = s.split('.');
    if (parts.length !== 4) return true;
    const n = parts.map(Number);
    if (n.some(x => isNaN(x) || x < 0 || x > 255)) return true;
    const a = n[0], b = n[1];
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 192 && b === 168 ||
        a === 172 && b >= 16 && b <= 31 || a >= 224;
}

/* 链接安全校验：拒绝内网/保留/元数据地址（DNS 解析后再次校验，防 DNS rebinding） */
async function isSafeUrl(url) {
    let parsed;
    try { parsed = new URL(url); } catch (e) { return false; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    if (/^\[|:/.test(host)) {
        if (host === '[::1]' || host === '::1' || host === '[::]' || host === '::') return false;
        return true;
    }
    const looksIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    if (looksIp) return !isPrivateIp(host);
    if (host === 'localhost') return false;
    try {
        const dns = require('dns');
        const addrs = await new Promise((resolve) => dns.lookup(host, { all: true }, (err, a) => err ? resolve([]) : resolve(a || [])));
        if (!addrs.length) return true;
        return addrs.every(a => !isPrivateIp(a.address.replace(/^::ffff:/, '')));
    } catch (e) { return true; }
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
async function detectStreams(ffprobe, source) {
    const args = ['-v', 'error', '-select_streams', 's', '-show_entries',
        'stream=index,codec_name,codec_type:stream_tags=language,title:stream_disposition=default,forced',
        '-of', 'json'];
    if (source.type === 'url') args.push('-rw_timeout', '30000000');
    args.push(source.type === 'url' ? source.url : source.path);
    const r = await run(ffprobe, args, 30000);
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

/* ---------- v1.4.0：单次合并探测（字幕轨道 + 指纹元数据一次 ffprobe 出，远程读减半） ---------- */
async function probeAll(ffprobe, source) {
    const args = ['-v', 'error', '-show_entries',
        'stream=index,codec_name,codec_type,width,height,avg_frame_rate:stream_tags=language,title:stream_disposition=default,forced:format=size,duration',
        '-of', 'json'];
    if (source.type === 'url') args.push('-rw_timeout', '30000000');
    args.push(source.type === 'url' ? source.url : source.path);
    const r = await run(ffprobe, args, 30000);
    if (!r.ok) throw new Error('ffprobe 执行失败: ' + (r.err || r.out || 'code ' + r.code).slice(-300));
    let j;
    try { j = JSON.parse(r.out); } catch (e) { throw new Error('ffprobe 输出解析失败'); }
    const subs = (j.streams || []).filter(s => s.codec_type === 'subtitle').map(s => ({
        index: s.index,
        codec: s.codec_name || '',
        language: normLang(s.tags && s.tags.language),
        title: (s.tags && s.tags.title) || '',
        default: !!(s.disposition && s.disposition.default),
        forced: !!(s.disposition && s.disposition.forced),
        text: codecIsText(s.codec_name),
        image: codecIsImage(s.codec_name)
    }));
    let meta = null;
    const st = (j.streams || []).find(s => s.codec_type === 'video') || {};
    let fps = null;
    const m = String(st.avg_frame_rate || '').match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (m && Number(m[2]) > 0) fps = Number(m[1]) / Number(m[2]);
    const size = Number(j.format && j.format.size) || 0;
    const durationMs = Math.round((Number(j.format && j.format.duration) || 0) * 1000);
    if (size > 0 && durationMs > 0 && Number(st.width) > 0 && Number(st.height) > 0 && fps && fps > 0 && st.codec_name) {
        meta = { size, durationMs, w: Number(st.width) || 0, h: Number(st.height) || 0, vcodec: String(st.codec_name || ''), fps };
    }
    return { subs, meta };
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

/* 由输入源推导播放 URL：本地 public/ 下的文件可直接播放；URL 源直接返回自身 */
function playUrlOf(source) {
    if (source.type === 'url') return source.url;
    const rel = path.relative(ROOT, source.path).replace(/\\/g, '/');
    if (rel.startsWith('public/')) return '/' + rel.slice('public/'.length);
    return null;
}

/* 输入源显示名（URL 取路径最后一段并解码） */
function baseNameOf(source) {
    if (source.type === 'url') {
        try {
            const p = new URL(source.url).pathname.split('/').filter(Boolean).pop() || 'video';
            return path.basename(decodeURIComponent(p), path.extname(p));
        } catch (e) { return 'video'; }
    }
    return path.basename(source.path, path.extname(source.path));
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

/* ---------- ffmpeg / ffprobe 二进制解析：用户配置 > 内置 npm 模块（可选依赖，跨平台） > data/bin 懒下载 > PATH
   内置模块：ffmpeg-static（Linux x64/arm64 / macOS / Windows 静态构建）、
   @ffprobe-installer/ffprobe（同平台集）。安装时若 GitHub 下载失败（可选依赖）将自动懒下载补齐。 */
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
        } catch (e) { /* 依赖未安装（可选依赖失败/本地目录模式），继续回退 */ }
        if (typeof p === 'string' && p && fs.existsSync(p)) {
            cache[kind] = p;
            return p;
        }
        if (kind === 'ffmpeg') {
            const local = path.join(BIN_DIR, ffmpegLocalName());
            if (fs.existsSync(local) && fs.statSync(local).size > MIN_FFMPEG_SIZE) {
                cache[kind] = local;
                return local;
            }
        }
        return kind === 'ffprobe' ? 'ffprobe' : 'ffmpeg';
    };
}

module.exports = {
    apply(ctx, config) {
        const resolveBinary = makeBinResolver(config);
        const timeoutMs = Math.max(15, parseInt(config.timeoutSec) || 120) * 1000;

        /* ffmpeg 可用性保障：内置/data/bin 缺失时自动懒下载（并发共享同一次下载，失败仅本次进程内生效） */
        function binExists(bin) { return !!bin && (/[/\\]/.test(bin) ? fs.existsSync(bin) : true); } /* 纯命令名视为 PATH 命令 */
        let ffmpegReady = null;
        function ensureFfmpeg() {
            const bin = resolveBinary('ffmpeg');
            if (binExists(bin)) return Promise.resolve({ ok: true, bin });
            if (!ffmpegReady) {
                ctx.logger.info('embed-sub', '未找到 ffmpeg 二进制，开始自动下载（镜像 ' + FFMPEG_MIRROR + '）...');
                ffmpegReady = downloadFfmpegTo(path.join(BIN_DIR, ffmpegLocalName()))
                    .then((b) => { ctx.logger.info('embed-sub', 'ffmpeg 自动下载完成: ' + b); return { ok: true, bin: b }; })
                    .catch((e) => { ctx.logger.error('embed-sub', 'ffmpeg 自动下载失败: ' + e.message); return { ok: false, err: e.message }; });
            }
            return ffmpegReady;
        }
        function ffprobeBin() {
            const b = resolveBinary('ffprobe');
            return { ok: binExists(b), bin: b };
        }
        function binErrMsg(kind, r) {
            return kind + ' 不可用' + (r && r.err ? '（' + r.err + '）' : '') +
                '：可在插件配置中指定 ' + (kind === 'ffmpeg' ? 'ffmpegPath' : 'ffprobePath') + '，或安装系统 ffmpeg';
        }

        const wrap = (fn) => async (req, res) => {
            try {
                await fn(req, res);
            } catch (e) {
                const status = e.status || 500;
                res.status(status).json({ code: status === 500 ? 1 : status, msg: e.message || '操作失败' });
            }
        };

        /* 检测：列出文件内封字幕轨道（支持本地路径或 http(s) 链接） */
        ctx.router.post('/api/plugin/embed-sub/detect', wrap(async (req, res) => {
            const file = String((req.body || {}).file || '');
            const source = parseSource(file);
            if (!source) { const e = new Error('文件不存在或路径非法'); e.status = 400; throw e; }
            if (source.type === 'url' && !(await isSafeUrl(source.url))) { const e = new Error('链接无效或指向内网/保留地址，已拒绝'); e.status = 400; throw e; }
            const fm = await ensureFfmpeg();
            if (!fm.ok) { const e = new Error(binErrMsg('ffmpeg', fm)); e.status = 503; throw e; }
            const fp = ffprobeBin();
            if (!fp.ok) { const e = new Error(binErrMsg('ffprobe', fp)); e.status = 503; throw e; }
            const streams = await detectStreams(fp.bin, source);
            res.json({ code: 0, data: { file, streams, ffprobe: fp.bin } });
        }));

        /* 提取单条轨道到字幕库 */
        ctx.router.post('/api/plugin/embed-sub/extract', wrap(async (req, res) => {
            const { file, index, lang, name, vid } = req.body || {};
            const source = parseSource(file);
            if (!source) { const e = new Error('文件不存在或路径非法'); e.status = 400; throw e; }
            if (source.type === 'url' && !(await isSafeUrl(source.url))) { const e = new Error('链接无效或指向内网/保留地址，已拒绝'); e.status = 400; throw e; }
            const fm = await ensureFfmpeg();
            if (!fm.ok) { const e = new Error(binErrMsg('ffmpeg', fm)); e.status = 503; throw e; }
            const fp = ffprobeBin();
            if (!fp.ok) { const e = new Error(binErrMsg('ffprobe', fp)); e.status = 503; throw e; }
            const streams = await detectStreams(fp.bin, source);
            const st = streams.find(s => s.index === parseInt(index));
            if (!st) { const e = new Error('字幕轨道不存在: ' + index); e.status = 400; throw e; }
            if (!st.text) { const e = new Error('轨道 ' + index + ' 为图形字幕（' + (st.codec || '?') + '），无法提取为文本'); e.status = 400; throw e; }
            const item = await extractOne(source, st, lang, name, vid, fm.bin);
            res.json({ code: 0, msg: '已提取并加入字幕库', data: item });
        }));

        /* 批量提取多条轨道 */
        ctx.router.post('/api/plugin/embed-sub/extract-all', wrap(async (req, res) => {
            const { file, indexes, vid } = req.body || {};
            const source = parseSource(file);
            if (!source) { const e = new Error('文件不存在或路径非法'); e.status = 400; throw e; }
            if (source.type === 'url' && !(await isSafeUrl(source.url))) { const e = new Error('链接无效或指向内网/保留地址，已拒绝'); e.status = 400; throw e; }
            const fm = await ensureFfmpeg();
            if (!fm.ok) { const e = new Error(binErrMsg('ffmpeg', fm)); e.status = 503; throw e; }
            const fp = ffprobeBin();
            if (!fp.ok) { const e = new Error(binErrMsg('ffprobe', fp)); e.status = 503; throw e; }
            const streams = await detectStreams(fp.bin, source);
            const want = Array.isArray(indexes) ? indexes.map(i => parseInt(i)) : [];
            const picked = streams.filter(s => want.includes(s.index) && s.text);
            if (!picked.length) { const e = new Error('未选择可提取的文本字幕轨道'); e.status = 400; throw e; }
            const items = [];
            for (const st of picked) items.push(await extractOne(source, st, '', '', vid, fm.bin));
            ctx.logger.info('embed-sub', '从 ' + baseNameOf(source) + ' 提取 ' + items.length + ' 条字幕');
            res.json({ code: 0, msg: '已提取 ' + items.length + ' 条字幕并加入字幕库', data: { items } });
        }));

        async function extractOne(source, st, langOverride, nameOverride, vid, ffmpegBin) {
            if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR, { recursive: true });
            /* 自动关联：未指定 vid 时推导播放 URL 并分配/复用映射，提取后播放器立即可见字幕 */
            if (!vid) {
                const pUrl = playUrlOf(source);
                if (pUrl) vid = await autoVid(ctx, pUrl);
            }
            const base = baseNameOf(source);
            const lang = langOverride || st.language || String(st.index);
            const ext = extFor(st.codec);
            const saveName = Date.now().toString(36) + '-' + base + '.' + lang + '.' + ext;
            const outPath = path.join(SUB_DIR, saveName);
            const args = ['-v', 'error'];
            if (source.type === 'url') args.push('-rw_timeout', '30000000');
            args.push('-i', source.type === 'url' ? source.url : source.path, '-map', '0:' + st.index, '-c:s', outCodec(ext), '-y', outPath);
            const r = await run(ffmpegBin, args, timeoutMs);
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
                item.playUrl = playUrlOf(source);
            }
            return item;
        }

        /* ===== 自动扫描：视频注册/解析时后台检测内封字幕并自动提取文本轨 =====
         * 去重两层：进程内 Set（同一 vid 的重复 video:created 事件）+ 持久检查（该 vid 已有 embed:* 来源字幕则跳过，重启后依然生效） */
        const autoScanned = new Set();
        async function alreadyHasEmbedSubs(vid) {
            try {
                const subsMap = await ctx.store.videoSubsAll();
                const ids = new Set(subsMap[vid] || []);
                if (!ids.size) return false;
                const all = await ctx.store.subtitleAll();
                return all.some(it => ids.has(it.id) && String(it.source || '').startsWith('embed:'));
            } catch (e) { return false; }
        }
        /* v1.4.0：clean 标记持久化（kv embedsub_clean）——已探测过无文本字幕的视频，
           重启/重扫直接跳过，不再远程重探测（全库重扫代价大） */
        async function isMarkedClean(vid) {
            try { const m = (await ctx.store.kvGet('embedsub_clean')) || {}; return !!m[vid]; } catch (e) { return false; }
        }
        async function markClean(vid) {
            try {
                const m = (await ctx.store.kvGet('embedsub_clean')) || {};
                if (!m[vid]) { m[vid] = Date.now(); await ctx.store.kvSet('embedsub_clean', m); }
            } catch (e) {}
        }
        async function scanOne(vid, url) {
            if (await alreadyHasEmbedSubs(vid)) return { skipped: true };
            if (await isMarkedClean(vid)) return { skipped: true };
            const fm = await ensureFfmpeg();
            if (!fm.ok) return { error: 'ffmpeg 不可用' };
            const fp = ffprobeBin();
            if (!fp.ok) return { error: 'ffprobe 不可用' };
            const source = parseSource(url);
            if (!source) return { skipped: true };
            if (source.type === 'url' && !(await isSafeUrl(source.url))) return { skipped: true };
            /* v1.4.0：单次 ffprobe 同时取字幕轨与指纹元数据；碰撞（同文件已有别的 vid）→
               宿主自动合并，后续提取挂到存活 vid，不再产生重复视频码 */
            let liveVid = vid;
            const pr = await probeAll(fp.bin, source);
            if (pr.meta && ctx.fingerprint) {
                try {
                    liveVid = await ctx.fingerprint.record(vid, { meta: pr.meta });
                    if (liveVid !== vid) ctx.logger.info('embed-sub', '指纹命中既有视频: vid ' + vid + ' → ' + liveVid + '（已合并）');
                } catch (e) { ctx.logger.warn('embed-sub', '指纹落档失败: vid=' + vid + ' — ' + (e.message || e)); }
            }
            const textStreams = pr.subs.filter(s => s.text);
            if (!textStreams.length) { await markClean(liveVid); return { clean: true }; }
            for (const st of textStreams) {
                await extractOne(source, st, '', '', liveVid, fm.bin);
            }
            return { extracted: textStreams.length };
        }
        /* v1.4.0：自动扫描并发受控队列（autoConcurrency，默认 2）——原先每事件并行 scanOne，
           全库重扫时十几个并发 ffprobe/ffmpeg 远程读打满网盘出口带宽，反噬扫描与字幕下载 */
        const autoQueue = [];
        let autoActive = 0;
        const qMax = () => { const n = Number(config && config.autoConcurrency); return Number.isFinite(n) && n >= 1 && n <= 8 ? Math.floor(n) : 2; };
        function pumpAuto() {
            while (autoActive < qMax() && autoQueue.length) {
                const job = autoQueue.shift();
                autoActive++;
                ctx.logger.info('embed-sub', '自动扫描开始: vid=' + job.vid + '（排队中 ' + autoQueue.length + '）');
                scanOne(job.vid, job.url)
                    .then((r) => {
                        if (r.extracted) ctx.logger.info('embed-sub', '自动扫描: ' + job.url + ' 提取 ' + r.extracted + ' 条内封字幕入字幕库（vid=' + job.vid + '）');
                        else if (r.clean) ctx.logger.info('embed-sub', '自动扫描: ' + job.url + ' 无内封文本字幕（vid=' + job.vid + '，已记忆跳过）');
                        else if (r.skipped) ctx.logger.info('embed-sub', '自动扫描跳过: vid=' + job.vid + '（已有内封字幕/已记忆/链接不安全）');
                        else if (r.error) { autoScanned.delete(job.vid); ctx.logger.error('embed-sub', '自动扫描失败(下次访问重试): ' + r.error); }
                    })
                    .catch((e) => { autoScanned.delete(job.vid); ctx.logger.error('embed-sub', '自动扫描异常(下次访问重试): ' + (e.message || e)); })
                    .finally(() => { autoActive--; pumpAuto(); });
            }
        }
        ctx.on('video:created', (p) => {
            if (!p || !p.vid || !p.url) return;
            if (autoScanned.has(p.vid)) return;
            autoScanned.add(p.vid); /* 先占位防重复入队；失败时释放，下次访问自动重试 */
            autoQueue.push({ vid: p.vid, url: p.url });
            pumpAuto();
        });

        /* 全量扫描：遍历已注册视频，逐个检测并自动提取（去重同上） */
        ctx.router.post('/api/plugin/embed-sub/scan-all', wrap(async (req, res) => {
            const fm = await ensureFfmpeg();
            if (!fm.ok) { const e = new Error(binErrMsg('ffmpeg', fm)); e.status = 503; throw e; }
            const fp = ffprobeBin();
            if (!fp.ok) { const e = new Error(binErrMsg('ffprobe', fp)); e.status = 503; throw e; }
            const videos = await ctx.store.videosAll();
            let scanned = 0, extracted = 0, skipped = 0, failed = 0;
            for (const [vid, url] of Object.entries(videos)) {
                try {
                    const r = await scanOne(vid, url);
                    scanned++;
                    if (r.extracted) extracted += r.extracted;
                    else if (r.skipped || r.clean) skipped++;
                } catch (e) { failed++; }
            }
            ctx.logger.info('embed-sub', '全量扫描完成: 检测 ' + scanned + ' · 提取 ' + extracted + ' · 无字幕/跳过 ' + skipped + ' · 失败 ' + failed);
            res.json({ code: 0, msg: '全量扫描完成', data: { scanned, extracted, skipped, failed } });
        }));

        /* 视频字幕分析面板：列出全部注册视频及其已关联字幕（供面板页使用） */
        ctx.router.get('/api/plugin/embed-sub/videos', wrap(async (req, res) => {
            const videos = await ctx.store.videosAll();
            const subsMap = await ctx.store.videoSubsAll();
            const all = await ctx.store.subtitleAll();
            const list = Object.entries(videos).map(([vid, url]) => {
                const ids = Array.isArray(subsMap[vid]) ? subsMap[vid] : [];
                const subs = ids.map(id => all.find(s => s.id === id)).filter(Boolean)
                    .map(s => ({ id: s.id, name: s.name || '', lang: s.lang || '', source: String(s.source || '') }));
                return { vid, url, subCount: subs.length, subs };
            });
            res.json({ code: 0, data: { videos: list } });
        }));

        /* 管理面板入口：视频字幕分析页（管理员鉴权，未登录 302 后台登录页） */
        ctx.pages.register({ route: '/plugin/embed-sub/panel', file: 'lib/client/panel.html', title: '内封字幕分析', auth: true });

        /* 后台预检：若 ffmpeg 缺失则立即启动懒下载（不阻塞服务，首次调用前完成即可） */
        if (!resolveBinary('ffmpeg') || !fs.existsSync(resolveBinary('ffmpeg'))) {
            ensureFfmpeg().catch(() => {});
        }
        ctx.logger.info('embed-sub', '内封字幕采集插件已加载（ffprobe: ' + resolveBinary('ffprobe') + '，ffmpeg: ' + resolveBinary('ffmpeg') + '）');
    }
};
