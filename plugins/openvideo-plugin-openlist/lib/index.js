'use strict';
/* OpenList 网盘接入插件：服务端代理 /api/fs/list 与 /api/fs/get（避免浏览器跨域与令牌泄露），
 * 面板浏览网盘目录树；「注册到库」走主项目 /api/video/resolve（联动内封字幕自动扫描）；
 * 「复制播放链接」生成 /player/?url=<OpenList /d/ 链接> 直达播放页 */
/* 1.4 扫描增强：上限可在插件设置调整（scanCap，默认 5000）；扫描时把目录下同名外挂字幕文件
 * （Movie.srt / Movie.zh.srt / Movie.zh-CN.ass…多语言可多份）下载进本地字幕库并挂载到视频 */
/* 1.7 失败重试：扫描失败项留存清单（路径+原因），面板「重试失败项」一键只重扫失败文件 */
/* 1.8 字幕挂载修复：fileLink 自 1.6 起返回 {link,hashes}，mountSubs 曾仍把返回对象当 URL 用，
 *     导致外挂字幕全部下载失败；改为取 link 字段，且逐字幕并行下载、单个失败不再中断其余 */

const fs = require('fs');
const path = require('path');

/* 定位应用根（含 data/ 与 server.js 的目录），兼容 plugins/<name>/lib 与 node_modules 布局 */
function findRoot() {
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        if (fs.existsSync(path.join(dir, 'data')) && fs.existsSync(path.join(dir, 'server.js'))) return dir;
        const next = path.dirname(dir);
        if (next === dir) break;
        dir = next;
    }
    return path.resolve(__dirname, '..', '..');
}
const ROOT = findRoot();
const SUB_DIR = path.join(ROOT, 'data', 'subtitles');
function genSubId() {
    let s = 's';
    const chars = '23456789abcdefghijkmnpqrstuvwxyz';
    for (let i = 0; i < 7; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

module.exports = {
    apply(ctx, config) {
        const wrap = (fn) => async (req, res) => {
            try { await fn(req, res); }
            catch (e) {
                const status = e.status || 500;
                res.status(status).json({ code: status === 500 ? 1 : status, msg: e.message || '操作失败' });
            }
        };
        const cfg = () => ({
            base: String((config && config.baseUrl) || '').replace(/\/+$/, ''),
            token: String((config && config.token) || '')
        });
        /* OpenList API 调用：code!==200 视为失败（AList 系约定） */
        const api = async (p, body) => {
            const { base, token } = cfg();
            if (!base) { const e = new Error('未配置 OpenList 地址（请在插件设置中填写 baseUrl）'); e.status = 503; throw e; }
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers.Authorization = token;
            const r = await ctx.http.post(base + p, body, { headers, timeout: 20000 });
            const j = await r.json().catch(() => null);
            if (!j) throw new Error('OpenList 响应解析失败');
            if (j.code !== 200) throw new Error('OpenList: ' + (j.message || ('code ' + j.code)));
            return j.data;
        };

        /* 配置状态（面板判断可用性） */
        ctx.router.get('/api/plugin/openlist/status', wrap(async (req, res) => {
            const { base } = cfg();
            res.json({ code: 0, data: { configured: !!base, base } });
        }));

        /* 列目录：POST /api/fs/list（per_page:0 = 全量），目录在前按名称排序 */
        ctx.router.post('/api/plugin/openlist/list', wrap(async (req, res) => {
            const p = String((req.body || {}).path || '/');
            const data = await api('/api/fs/list', { path: p, page: 1, per_page: 0, refresh: false });
            const dirs = [], files = [];
            for (const it of (data.content || [])) {
                (it.is_dir ? dirs : files).push({ name: it.name, size: it.is_dir ? 0 : (it.size || 0) });
            }
            const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh');
            dirs.sort(byName); files.sort(byName);
            res.json({ code: 0, data: { path: p, dirs, files } });
        }));

        /* 取文件链接：POST /api/fs/get → /d/<path>?sign=（主项目 resolve-link 原生支持该形态） */
        ctx.router.post('/api/plugin/openlist/link', wrap(async (req, res) => {
            const p = String((req.body || {}).path || '');
            if (!p || p === '/') { const e = new Error('缺少 path'); e.status = 400; throw e; }
            const data = await api('/api/fs/get', { path: p });
            const sign = data.sign || '';
            const { base } = cfg();
            const enc = p.split('/').map(x => encodeURIComponent(x)).join('/').replace(/^\/+/, '');
            const link = base + '/d/' + enc + (sign ? '?sign=' + sign : '');
            res.json({ code: 0, data: { name: data.name || '', size: data.size || 0, link } });
        }));

        /* ── 整个文件夹扫描（含子目录）：后台注册全部视频，进度进顶栏任务列表 ── */
        const VEXT = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'ts', 'm3u8', 'wmv', 'mpg', 'mpeg'];
        const SEXT = ['srt', 'ass', 'ssa', 'vtt']; /* 同名外挂字幕扩展名 */
        /* 单次扫描视频文件上限：插件设置 scanCap（默认 5000；外挂字幕文件不计入上限） */
        const scanCap = () => { const n = Number(config && config.scanCap); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000; };
        const TICK = 400;          /* 暂停等待的轮询切片 ms */
        const scan = { scanning: false, paused: false, stopRequested: false, taskId: 0, path: '', mode: 'scan', total: 0, done: 0, ok: 0, fail: 0, subs: 0, failed: [], lastFile: '', lastSummary: '' };
        let lastSubMap = new Map();   /* 最近一次扫描的外挂字幕映射，失败重试复用 */
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const isVideo = (n) => VEXT.some(x => String(n).toLowerCase().endsWith('.' + x));
        const shortName = (p) => String(p).split('/').pop() || p;

        const listDir = async (p) => {
            const data = await api('/api/fs/list', { path: p, page: 1, per_page: 0, refresh: false });
            return data.content || [];
        };
        /* 递归收集视频文件 + 目录内全部外挂字幕文件：文件在前、子目录深度优先，按名称排序，达上限即停 */
        const collect = async (p, out, seen, cap, subMap) => {
            if (out.length >= cap || scan.stopRequested) return;
            const items = await listDir(p);
            const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh');
            const dirs = items.filter(x => x.is_dir).sort(byName);
            const files = items.filter(x => !x.is_dir).sort(byName);
            const subs = files.filter(x => SEXT.some(e => String(x.name).toLowerCase().endsWith('.' + e)));
            if (subs.length) subMap.set(p, subs.map(x => ({ name: x.name, path: (p === '/' ? '' : p) + '/' + x.name })));
            for (const f of files) {
                if (!isVideo(f.name)) continue;
                if (out.length >= cap) return;
                const fp = (p === '/' ? '' : p) + '/' + f.name;
                if (!seen.has(fp)) { seen.add(fp); out.push(fp); }
            }
            for (const d of dirs) {
                if (out.length >= cap || scan.stopRequested) return;
                await collect((p === '/' ? '' : p) + '/' + d.name, out, seen, cap, subMap);
            }
        };
        const fileLink = async (p) => {
            const data = await api('/api/fs/get', { path: p });
            const { base } = cfg();
            const enc = p.split('/').map(x => encodeURIComponent(x)).join('/').replace(/^\/+/, '');
            const sign = data.sign || '';
            const link = base + '/d/' + enc + (sign ? '?sign=' + sign : '');
            /* v1.6.0：驱动全文件哈希（如 189CloudPC 免费提供 md5）→ 随注册传给 resolve 做指纹身份 */
            const hashes = [];
            try {
                const hi = data.hash_info || {};
                const src = (typeof hi === 'string') ? JSON.parse(hi) : hi;
                for (const alg of ['md5', 'sha1', 'sha256']) {
                    const v = String((src && src[alg]) || '').toLowerCase();
                    if (/^[0-9a-f]{8,64}$/.test(v)) hashes.push({ alg, value: v });
                }
            } catch (e) {}
            return { link, hashes };
        };

        /* ── 同名外挂字幕挂载：Movie.srt / Movie.zh.srt / Movie.zh-CN.ass 等（一个视频可挂多份多语言） ── */
        const LANG_ALIAS = { zh:'zh', chs:'zh', sc:'zh', cn:'zh', zho:'zh', chi:'zh', 'zh-hans':'zh', 'zh-cn':'zh', 'zh-sg':'zh', cht:'tc', tc:'tc', zht:'tc', 'zh-hant':'tc', 'zh-tw':'tc', 'zh-hk':'tc', 'zh-mo':'tc', ja:'ja', jp:'ja', jpn:'ja', ko:'ko', kr:'ko', kor:'ko', en:'en', eng:'en', de:'de', ger:'de', deu:'de', fr:'fr', fra:'fr', fre:'fr', ru:'ru', rus:'ru', es:'es', spa:'es', pt:'pt', por:'pt', it:'it', ita:'it', th:'th', tha:'th', vi:'vi', vie:'vi', id:'id', ind:'id', ar:'ar', ara:'ar', hi:'hi', hin:'hi' };
        const parseLangTag = (t) => {
            const k = String(t).toLowerCase();
            if (LANG_ALIAS[k]) return LANG_ALIAS[k];
            if (/^[a-z]{2}(-[a-z]{2,4})?$/.test(k)) return k; /* 未知但形如语言码 → 原样保留 */
            return '';
        };
        /* 文件名与视频basename匹配：无中缀（Movie.srt）或中缀是语言标记（Movie.zh.srt）才挂；
         * 中缀不是语言（如 chs&eng、default、注释名）→ 跳过，防误挂 */
        const subMatch = (base, ent) => {
            if (!ent.name.startsWith(base + '.')) return null;
            const rest = ent.name.slice(base.length + 1);
            const m = /^(?:([a-zA-Z][a-zA-Z0-9-]{0,7}).)?(srt|ass|ssa|vtt)$/i.exec(rest);
            if (!m) return null;
            if (!m[1]) return { lang: '', tag: '', ext: m[2].toLowerCase() };
            const lang = parseLangTag(m[1]);
            if (!lang) return null; /* 中缀不是语言标记（如 chs&eng、default）→ 跳过防误挂 */
            return { lang, tag: m[1], ext: m[2].toLowerCase() };
        };
        /* 下载字幕进本地字幕库（type=local，source=openlist:<网盘路径> 持久去重）并关联 vid；返回新下载数
         * v1.8：逐字幕并行下载，单个失败仅告警不中断其余（原先一个失败 throw → 该视频其余字幕全跳过） */
        const mountSubs = async (vid, fp, subMap) => {
            if (!vid || config.mountSubs === false) return 0;
            const dir = fp.slice(0, fp.lastIndexOf('/')) || '/';
            const base = shortName(fp).replace(/.[^.]+$/, '');
            const ents = subMap.get(dir) || [];
            const cands = [];
            for (const e of ents) {
                const mt = subMatch(base, e);
                if (mt) cands.push({ path: e.path, name: e.name, lang: mt.lang, tag: mt.tag, ext: mt.ext });
            }
            if (!cands.length) return 0;
            if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR, { recursive: true });
            const subsMap = await ctx.store.videoSubsAll();
            const all = await ctx.store.subtitleAll();
            const bySrc = new Map();
            for (const s of (all || [])) bySrc.set(String(s.source || ''), s);
            if (!Array.isArray(subsMap[vid])) subsMap[vid] = subsMap[vid] || [];
            let added = 0, linked = 0, failed = 0;
            await Promise.all(cands.map(async (c) => {
                const src = 'openlist:' + c.path;
                try {
                    let item = bySrc.get(src);
                    if (!item) {
                        const fl = await fileLink(c.path);
                        const r = await ctx.http.get(fl.link, { timeout: 30000 });
                        const text = await r.text();
                        if (!text || text.length > 20 * 1024 * 1024 || /^s*</.test(text)) throw new Error('字幕下载失败: ' + c.name);
                        const safe = base.replace(/[^\w.一-鿿-]+/g, '_').slice(0, 60);
                        const saveName = 'ol' + Date.now().toString(36) + '-' + safe + '.' + (c.lang || c.tag || 'sub') + '.' + c.ext;
                        fs.writeFileSync(path.join(SUB_DIR, saveName), text);
                        item = { id: genSubId(), name: (base + '.' + (c.tag || c.lang || c.ext)).slice(0, 100), lang: c.lang, langs: c.lang ? [c.lang] : [], langName: '', type: 'local', url: '', content: '', file: saveName, localized: true, createdAt: Date.now(), source: src };
                        await ctx.store.subtitleAdd(item);
                        added++;
                    }
                    if (!subsMap[vid].includes(item.id)) { subsMap[vid].push(item.id); linked++; }
                } catch (e) { failed++; ctx.logger.warn('openlist', '字幕挂载失败: ' + c.path + ' — ' + (e.message || e)); }
            }));
            if (linked) await ctx.store.videoSubsWrite(subsMap);
            return added;
        };

        /* 宿主 writeRateLimit 已对本机回环自调用放行限速（trust proxy='loopback' 下外部不可伪造回环），
         * resolve 全速直发，不再做滑动窗口节流；这里只处理暂停/停止（旧版宿主若仍限速，429 重试退避兜底）。
         * 返回 'go' 或 'stop'；暂停期间挂起并把「⏸ 已暂停」写进任务详情 */
        const waitTurn = async () => {
            let pauseMarked = false;
            while (true) {
                if (scan.stopRequested) return 'stop';
                if (scan.paused) {
                    if (!pauseMarked) {
                        pauseMarked = true;
                        ctx.tasks.finish(scan.taskId, 'running', '⏸ 已暂停 · ' + scan.done + '/' + scan.total + ' · 成功 ' + scan.ok + ' · 失败 ' + scan.fail);
                        ctx.logger.info('openlist', '文件夹扫描已暂停: ' + scan.done + '/' + scan.total);
                    }
                    await sleep(TICK);
                    continue;
                }
                if (pauseMarked) { pauseMarked = false; ctx.logger.info('openlist', '文件夹扫描已继续'); }
                return 'go';
            }
        };

        /* 注册单个文件（fileLink → resolve，携带驱动全文件哈希指纹）：失败内联重试一次（429 多退 5s）；
         * 返回 {ok, vid, why}，暂停窗口中被手动停止返回 {stop:true} */
        const registerOne = async (fp) => {
            const port = process.env.PORT || 1919;
            let ok = false, why = '', newVid = '';
            for (let i = 0; i < 2 && !ok; i++) {
                if (i > 0 && await waitTurn() === 'stop') return { stop: true };
                try {
                    const fl = await fileLink(fp);
                    /* v1.6.0：携带驱动全文件哈希做指纹身份（同文件改名/换盘实例复用旧 vid） */
                    const qs = '?url=' + encodeURIComponent(fl.link) + (fl.hashes.length ? '&fp=' + encodeURIComponent(JSON.stringify({ hashes: fl.hashes })) : '');
                    const r = await ctx.http.get('http://127.0.0.1:' + port + '/api/video/resolve' + qs, { timeout: 30000 });
                    const j = await r.json().catch(() => null);
                    if (j && j.code === 0 && j.data && j.data.vid) { ok = true; newVid = String(j.data.vid); }
                    else why = (j && j.msg) || ('resolve code ' + (j && j.code));
                } catch (e) { why = e.message; }
                if (!ok && i === 0) await sleep(/429|频繁/.test(String(why)) ? 5000 : 3000);
            }
            return { ok, vid: newVid, why };
        };
        /* 注册成功后的收尾：网盘目录写备注（m01421）+ 同名外挂字幕挂载；返回新挂载字幕数 */
        const afterOk = async (vid, fp, subMap) => {
            try {
                const ndir = fp.slice(0, fp.lastIndexOf('/')) || '/';
                const notes = (await ctx.store.kvGet('video_notes')) || {};
                if (notes[vid] !== ndir) { notes[vid] = ndir; await ctx.store.kvSet('video_notes', notes); }
            } catch (e) { ctx.logger.warn('openlist', '备注写入失败: ' + fp + ' — ' + (e.message || e)); }
            try { return (await mountSubs(vid, fp, subMap)) || 0; }
            catch (e) { ctx.logger.warn('openlist', '字幕挂载失败: ' + fp + ' — ' + (e.message || e)); return 0; }
        };

        const runScan = async (root) => {
            const t = ctx.tasks.add('plugin', 'OpenList 文件夹扫描', '正在收集文件清单…', 'openlist-scan-' + Date.now());
            scan.taskId = t.id;
            let manualStop = false;
            try {
                ctx.logger.info('openlist', '文件夹扫描开始: ' + root);
                const out = [], seen = new Set(), subMap = new Map();
                const CAP = scanCap();
                await collect(root, out, seen, CAP, subMap);
                lastSubMap = subMap;
                scan.total = out.length; scan.done = 0; scan.ok = 0; scan.fail = 0; scan.subs = 0; scan.failed = [];
                let subFiles = 0; for (const l of subMap.values()) subFiles += l.length;
                if (subFiles) ctx.logger.info('openlist', '发现外挂字幕候选 ' + subFiles + ' 个，将按同名规则挂载');
                if (!out.length) {
                    scan.lastSummary = '目录内未发现视频文件';
                    ctx.tasks.finish(t.id, 'done', scan.lastSummary);
                    ctx.logger.warn('openlist', '文件夹扫描: 未发现视频文件 (' + root + ')');
                    return;
                }
                for (const fp of out) {
                    if (await waitTurn() === 'stop') { manualStop = true; break; }
                    scan.lastFile = shortName(fp);
                    ctx.tasks.finish(t.id, 'running', (scan.done + 1) + '/' + scan.total + ' · 成功 ' + scan.ok + ' · 失败 ' + scan.fail + (scan.subs ? ' · 字幕 +' + scan.subs : '') + ' · ' + scan.lastFile);
                    const res = await registerOne(fp);
                    if (res.stop) { manualStop = true; break; }
                    if (res.ok) {
                        scan.ok++;
                        scan.subs += await afterOk(res.vid, fp, subMap);
                    } else {
                        scan.fail++;
                        scan.failed.push({ path: fp, why: res.why || '未知原因' });
                        ctx.logger.warn('openlist', '注册失败: ' + fp + ' — ' + res.why);
                    }
                    scan.done++;
                    ctx.tasks.finish(t.id, 'running', scan.done + '/' + scan.total + ' · 成功 ' + scan.ok + ' · 失败 ' + scan.fail + (scan.subs ? ' · 字幕 +' + scan.subs : '') + ' · ' + scan.lastFile);
                }
                if (manualStop) {
                    scan.lastSummary = '已手动停止：完成 ' + scan.done + '/' + scan.total + '，成功注册 ' + scan.ok + '，失败 ' + scan.fail + '，字幕挂载 ' + scan.subs;
                    ctx.tasks.finish(t.id, 'done', scan.lastSummary);
                    ctx.logger.info('openlist', '文件夹扫描被手动停止: ' + scan.lastSummary);
                } else {
                    const capped = scan.total >= CAP;
                    scan.lastSummary = '完成：共 ' + scan.total + ' 个视频' + (capped ? '（达 ' + CAP + ' 上限）' : '') + '，成功注册 ' + scan.ok + '，失败 ' + scan.fail + '，字幕挂载 ' + scan.subs + (scan.fail ? '（失败项可重试）' : '');
                    ctx.tasks.finish(t.id, (scan.fail && !scan.ok) ? 'fail' : 'done', scan.lastSummary);
                    ctx.logger.info('openlist', '文件夹扫描结束: ' + scan.lastSummary);
                }
            } catch (e) {
                scan.lastSummary = '扫描出错: ' + (e.message || e);
                ctx.tasks.finish(t.id, 'fail', scan.lastSummary);
                ctx.logger.error('openlist', '文件夹扫描异常: ' + (e.message || e));
            } finally {
                scan.scanning = false; scan.paused = false; scan.stopRequested = false;
            }
        };

        /* ── 失败重试（1.7）：只重扫上次扫描留存的失败清单；复用其外挂字幕映射，成功即移出清单 ── */
        const runRetry = async () => {
            const list = scan.failed.slice();
            const t = ctx.tasks.add('plugin', 'OpenList 失败重试', '准备重试 ' + list.length + ' 个失败文件…', 'openlist-retry-' + Date.now());
            scan.taskId = t.id;
            scan.mode = 'retry';
            let manualStop = false;
            const keep = [];
            try {
                ctx.logger.info('openlist', '失败重试开始: ' + list.length + ' 个文件');
                scan.total = list.length; scan.done = 0; scan.ok = 0; scan.fail = 0; scan.subs = 0; scan.lastFile = '';
                for (let i = 0; i < list.length; i++) {
                    const fp = list[i].path;
                    if (await waitTurn() === 'stop') { manualStop = true; for (const x of list.slice(i)) keep.push(x); break; }
                    scan.lastFile = shortName(fp);
                    ctx.tasks.finish(t.id, 'running', (scan.done + 1) + '/' + scan.total + ' · 恢复 ' + scan.ok + ' · 仍失败 ' + scan.fail + ' · ' + scan.lastFile);
                    const res = await registerOne(fp);
                    if (res.stop) { manualStop = true; for (const x of list.slice(i)) keep.push(x); break; }
                    if (res.ok) {
                        scan.ok++;
                        scan.subs += await afterOk(res.vid, fp, lastSubMap);
                        ctx.logger.info('openlist', '重试成功: ' + fp);
                    } else {
                        scan.fail++;
                        keep.push({ path: fp, why: res.why || list[i].why || '未知原因' });
                        ctx.logger.warn('openlist', '重试仍失败: ' + fp + ' — ' + res.why);
                    }
                    scan.done++;
                    ctx.tasks.finish(t.id, 'running', scan.done + '/' + scan.total + ' · 恢复 ' + scan.ok + ' · 仍失败 ' + scan.fail + ' · ' + scan.lastFile);
                }
                if (manualStop) scan.lastSummary = '重试已手动停止：恢复 ' + scan.ok + '，仍失败 ' + keep.length + '（可再次重试）';
                else scan.lastSummary = '重试完成：恢复 ' + scan.ok + ' 个' + (keep.length ? '，仍失败 ' + keep.length + ' 个（可再次重试）' : '，失败清单已清空');
                ctx.tasks.finish(t.id, (keep.length && !scan.ok) ? 'fail' : 'done', scan.lastSummary);
                ctx.logger.info('openlist', '失败重试结束: ' + scan.lastSummary);
            } catch (e) {
                scan.lastSummary = '重试出错: ' + (e.message || e);
                ctx.tasks.finish(t.id, 'fail', scan.lastSummary);
                ctx.logger.error('openlist', '失败重试异常: ' + (e.message || e));
            } finally {
                scan.failed = keep;
                scan.scanning = false; scan.paused = false; scan.stopRequested = false;
            }
        };

        /* 启动扫描：单并发守卫，立即返回后台执行（需管理员登录：header 或 dp_admin cookie） */
        const needAdmin = (req) => {
            if (!ctx.isAdmin || !ctx.isAdmin(req)) { const e = new Error('需要管理员登录'); e.status = 401; throw e; }
        };
        ctx.router.post('/api/plugin/openlist/scan', wrap(async (req, res) => {
            needAdmin(req);
            if (scan.scanning) { const e = new Error('已有文件夹扫描进行中，请稍候'); e.status = 409; throw e; }
            const p = String((req.body || {}).path || '/');
            const { base } = cfg();
            if (!base) { const e = new Error('未配置 OpenList 地址（请在插件设置中填写 baseUrl）'); e.status = 503; throw e; }
            scan.scanning = true; scan.paused = false; scan.stopRequested = false; scan.taskId = 0; scan.path = p; scan.mode = 'scan'; scan.total = 0; scan.done = 0; scan.ok = 0; scan.fail = 0; scan.subs = 0; scan.failed = []; scan.lastFile = ''; scan.lastSummary = ''; lastSubMap = new Map();
            runScan(p).catch(() => {});
            res.json({ code: 0, data: { started: true, path: p } });
        }));

        /* 扫描状态（面板轮询，需管理员） */
        ctx.router.get('/api/plugin/openlist/scan/status', wrap(async (req, res) => {
            needAdmin(req);
            res.json({ code: 0, data: Object.assign({}, scan) });
        }));

        /* 暂停 / 继续 / 停止扫描（需管理员；400ms 轮询切片内生效） */
        ctx.router.post('/api/plugin/openlist/scan/control', wrap(async (req, res) => {
            needAdmin(req);
            if (!scan.scanning) { const e = new Error('当前没有进行中的扫描'); e.status = 409; throw e; }
            const act = String((req.body || {}).action || '');
            if (act === 'pause') scan.paused = true;
            else if (act === 'resume') scan.paused = false;
            else if (act === 'stop') scan.stopRequested = true;
            else { const e = new Error('action 必须是 pause / resume / stop'); e.status = 400; throw e; }
            ctx.logger.info('openlist', '文件夹扫描控制: ' + act);
            res.json({ code: 0, data: { action: act, paused: scan.paused, stopRequested: scan.stopRequested } });
        }));

        /* 重试失败项（1.7，需管理员）：只重扫上次扫描留存的失败清单，暂停/停止同样可用 */
        ctx.router.post('/api/plugin/openlist/scan/retry', wrap(async (req, res) => {
            needAdmin(req);
            if (scan.scanning) { const e = new Error('已有文件夹扫描进行中，请稍候'); e.status = 409; throw e; }
            if (!scan.failed.length) { const e = new Error('当前没有可重试的失败记录'); e.status = 400; throw e; }
            const count = scan.failed.length;
            scan.scanning = true; scan.paused = false; scan.stopRequested = false;
            runRetry().catch(() => {});
            res.json({ code: 0, data: { started: true, count } });
        }));

        /* 管理面板：网盘文件浏览页（管理员鉴权） */
        ctx.pages.register({ route: '/plugin/openlist/panel', file: 'lib/client/panel.html', title: 'OpenList 文件浏览', auth: true });
    },
};
