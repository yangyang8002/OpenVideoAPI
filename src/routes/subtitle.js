/* 字幕路由：外部链接 / 字幕库 CRUD / 上传 / 本地化 / 检测
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');

module.exports = {
    mount(ctx) {
        const { app, checkAdmin, S, isSafeSubtitleUrl, parseLangs, genSubId, langsName, subLangName, SUB_FETCH_LIMIT, SUB_DIR, safeErrMsg, upload, getUploadLimits, SUB_EXT_RE, ROOT_DIR, detectOpenlistSubs, subtitleContent } = ctx;

    /* ── 原 server.js L2753-2753 ── */
    // ==================== 字幕检测 ====================

    /* ── 原 server.js L2755-2755 ── */
    // 接受外部字幕 url

    /* ── 原 server.js L2756-2760 ── */
    app.post('/api/subtitle/external', (req, res) => {
        const { url } = req.body || {};
        if (!url || !/^https?:\/\//i.test(url)) return res.json({ code: 1, msg: '无效链接' });
        res.json({ code: 0, data: { url } });
    });

    /* ── 原 server.js L2954-2974 ── */
    app.get('/api/admin/subtitles', checkAdmin, async (req, res) => {
        const search = (req.query.search || '').toLowerCase();
        const vid = String(req.query.vid || '');
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        let list = await S.store.subtitleAll();
        /* 按视频过滤：仅返回已关联到该视频的字幕（视频→字幕 管理模式） */
        if (vid) {
            const subsMap = await S.store.videoSubsAll();
            const ids = Array.isArray(subsMap[vid]) ? subsMap[vid] : [];
            const byId = {};
            for (const s of list) byId[s.id] = s;
            list = ids.map(id => byId[id]).filter(Boolean);
        } else if (search) {
            list = list.filter(s => String(s.name || '').toLowerCase().includes(search) || String(s.id || '').includes(search) || String(s.lang || '').includes(search));
        }
        list.sort((a, b) => b.createdAt - a.createdAt);
        const total = list.length;
        const start = (page - 1) * limit;
        res.json({ code: 0, data: { list: list.slice(start, start + limit), total, page, limit, vid } });
    });

    /* ── 原 server.js L2976-2976 ── */
    /* 各视频的字幕数量（视频→字幕 管理模式的列表徽标） */

    /* ── 原 server.js L2977-2984 ── */
    app.get('/api/admin/subtitles/video-counts', checkAdmin, async (req, res) => {
        const subsMap = await S.store.videoSubsAll();
        const counts = {};
        for (const [vid, ids] of Object.entries(subsMap)) {
            if (Array.isArray(ids) && ids.length) counts[vid] = ids.length;
        }
        res.json({ code: 0, data: counts });
    });

    /* ── 原 server.js L2986-3044 ── */
    app.post('/api/admin/subtitles', checkAdmin, async (req, res) => {
        const { name, lang, langs, type, url, content, localize, vid } = req.body || {};
        if (type !== 'url' && type !== 'text') return res.status(400).json({ code: 1, msg: '字幕类型仅支持链接或文本' });
        if (!name || !String(name).trim()) return res.status(400).json({ code: 1, msg: '字幕名称不能为空' });
        if (type === 'url' && !/^https?:\/\//i.test(url)) return res.status(400).json({ code: 1, msg: '无效的字幕链接' });
        if (type === 'url' && !(await isSafeSubtitleUrl(url))) return res.status(400).json({ code: 1, msg: '字幕链接指向内网/保留地址，已拒绝' });
        if (type === 'text' && (!content || content.length > 1024 * 1024)) return res.status(400).json({ code: 1, msg: '字幕内容为空或过大' });
        /* 语言：支持双语（如 "zh,ja"），存 langs 数组，lang 取首个 */
        const langsArr = parseLangs(langs != null ? langs : lang);
        const sub = {
            id: await genSubId(),
            name: String(name).trim().slice(0, 100),
            lang: langsArr[0] || '',
            langs: langsArr,
            langName: langsName(langsArr) || (langsArr[0] ? subLangName(langsArr[0]) : ''),
            type,
            url: type === 'url' ? String(url).slice(0, 2048) : '',
            content: type === 'text' ? content : '',
            file: '',
            localized: false,
            createdAt: Date.now()
        };
        /* 链接类型可选「立即本地化」：创建时直接下载到服务器存储 */
        let localizeWarn = '';
        if (type === 'url' && localize) {
            try {
                const resp = await fetch(sub.url, { signal: AbortSignal.timeout(30000) });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const reader = resp.body.getReader();
                let chunks = [], total = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    total += value.length;
                    if (total > SUB_FETCH_LIMIT) { await reader.cancel(); throw new Error('内容超过 5MB 上限'); }
                    chunks.push(value);
                }
                if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR, { recursive: true });
                const saveName = sub.id + '-' + Date.now().toString(36) + '.vtt';
                fs.writeFileSync(path.join(SUB_DIR, saveName), Buffer.concat(chunks));
                sub.type = 'local';
                sub.file = saveName;
                sub.localized = true;
            } catch (e) {
                localizeWarn = '链接已保存，但本地化失败: ' + safeErrMsg(e);
            }
        }
        await S.store.subtitleAdd(sub);
        /* 关联到视频（视频→字幕 管理模式） */
        let linked = false;
        if (vid) {
            const subsMap = await S.store.videoSubsAll();
            if (!Array.isArray(subsMap[vid])) subsMap[vid] = [];
            if (!subsMap[vid].includes(sub.id)) subsMap[vid].push(sub.id);
            await S.store.videoSubsWrite(subsMap);
            linked = true;
        }
        res.json({ code: 0, msg: localizeWarn ? '字幕已添加（' + localizeWarn + '）' : '字幕已添加', data: sub, linked, warning: localizeWarn || null });
    });

    /* ── 原 server.js L3046-3046 ── */
    /* 上传字幕文件（存入 data/subtitles/，动态按配置校验大小）；可选 vid 直接关联视频 */

    /* ── 原 server.js L3047-3087 ── */
    app.post('/api/admin/subtitles/upload', checkAdmin, upload.array('files'), async (req, res) => {
        if (!req.files || !req.files.length) return res.status(400).json({ code: 1, msg: '未选择文件' });
        const maxMB = getUploadLimits().maxMB;
        const tooBig = req.files.find(f => f.size > maxMB * 1024 * 1024);
        if (tooBig) return res.status(413).json({ code: 1, msg: '文件超过上传上限 ' + maxMB + 'MB: ' + path.basename(tooBig.originalname) });
        if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR, { recursive: true });
        const vid = String(req.body.vid || '');
        const subs = [];
        for (const f of req.files) {
            const name = path.basename(f.originalname);
            if (!SUB_EXT_RE.test(name)) continue;
            const saveName = Date.now().toString(36) + '-' + name;
            const savePath = path.join(SUB_DIR, saveName);
            fs.writeFileSync(savePath, f.buffer);
            const langPart = name.replace(/\.[^.]+$/, '').split('.').pop();
            const lang = SUB_EXT_RE.test(langPart) ? '' : langPart.toLowerCase();
            subs.push({
                id: await genSubId(),
                name: name,
                lang,
                langs: lang ? [lang] : [],
                langName: subLangName(langPart),
                type: 'local',
                url: '',
                content: '',
                file: saveName,
                localized: true,
                createdAt: Date.now()
            });
        }
        if (!subs.length) return res.status(400).json({ code: 1, msg: '没有有效的字幕文件（支持 srt/vtt/ass/ssa/webvtt）' });
        for (const s of subs) await S.store.subtitleAdd(s);
        /* 关联到视频 */
        if (vid) {
            const subsMap = await S.store.videoSubsAll();
            if (!Array.isArray(subsMap[vid])) subsMap[vid] = [];
            for (const s of subs) if (!subsMap[vid].includes(s.id)) subsMap[vid].push(s.id);
            await S.store.videoSubsWrite(subsMap);
        }
        res.json({ code: 0, msg: '已上传 ' + subs.length + ' 个字幕' + (vid ? ' 并关联到视频' : ''), data: subs });
    });

    /* ── 原 server.js L3089-3089 ── */
    /* 本地化：把 url 类型字幕下载到本地存储（限 5MB + 内网防护） */

    /* ── 原 server.js L3090-3118 ── */
    app.post('/api/admin/subtitles/localize', checkAdmin, async (req, res) => {
        const { id } = req.body || {};
        const list = await S.store.subtitleAll();
        const sub = list.find(s => s.id === id);
        if (!sub) return res.status(404).json({ code: 1, msg: '字幕不存在' });
        if (sub.type !== 'url') return res.json({ code: 0, msg: '该字幕无需本地化' });
        if (!(await isSafeSubtitleUrl(sub.url))) return res.status(400).json({ code: 1, msg: '字幕链接指向内网/保留地址，已拒绝' });
        try {
            const resp = await fetch(sub.url, { signal: AbortSignal.timeout(30000) });
            if (!resp.ok) return res.status(502).json({ code: 1, msg: '拉取失败: HTTP ' + resp.status });
            const reader = resp.body.getReader();
            let chunks = [], total = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > SUB_FETCH_LIMIT) { await reader.cancel(); return res.status(413).json({ code: 1, msg: '字幕内容超过 5MB 上限' }); }
                chunks.push(value);
            }
            const buf = Buffer.concat(chunks);
            if (!fs.existsSync(SUB_DIR)) fs.mkdirSync(SUB_DIR, { recursive: true });
            const saveName = sub.id + '-' + Date.now().toString(36) + '.vtt';
            fs.writeFileSync(path.join(SUB_DIR, saveName), buf);
            await S.store.subtitleUpdate(id, { type: 'local', file: saveName, localized: true });
            res.json({ code: 0, msg: '已本地化' });
        } catch (e) {
            res.status(502).json({ code: 1, msg: '本地化失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3120-3144 ── */
    app.delete('/api/admin/subtitles', checkAdmin, async (req, res) => {
        const { id, vid, deleteLibrary } = req.body || {};
        if (!id) return res.status(400).json({ code: 1, msg: '参数不完整' });
        const subsMap = await S.store.videoSubsAll();
        if (vid) {
            /* 仅移除该视频的字幕关联 */
            if (Array.isArray(subsMap[vid])) {
                subsMap[vid] = subsMap[vid].filter(x => x !== id);
                await S.store.videoSubsWrite(subsMap);
            }
            if (!deleteLibrary) return res.json({ code: 0, msg: '已从该视频移除' });
        }
        /* 删除字幕库记录（并从所有视频移除关联） */
        const ok = await S.store.subtitleDelete(id);
        if (!ok) return res.status(404).json({ code: 1, msg: '字幕不存在' });
        let changed = false;
        for (const [v, ids] of Object.entries(subsMap)) {
            if (Array.isArray(ids) && ids.includes(id)) {
                subsMap[v] = ids.filter(x => x !== id);
                changed = true;
            }
        }
        if (changed) await S.store.videoSubsWrite(subsMap);
        res.json({ code: 0, msg: '已删除' });
    });

    /* ── 原 server.js L3146-3146 ── */
    /* 应用字幕到视频（一个视频可应用多个字幕） */

    /* ── 原 server.js L3147-3154 ── */
    app.post('/api/admin/subtitles/apply', checkAdmin, async (req, res) => {
        const { vid, ids } = req.body || {};
        if (!vid || !Array.isArray(ids)) return res.status(400).json({ code: 1, msg: '参数不完整' });
        const subs = await S.store.videoSubsAll();
        subs[vid] = Array.from(new Set(ids.filter(Boolean)));
        await S.store.videoSubsWrite(subs);
        res.json({ code: 0, msg: '已应用 ' + subs[vid].length + ' 个字幕' });
    });

    /* ── 原 server.js L3156-3163 ── */
    app.post('/api/admin/subtitles/unapply', checkAdmin, async (req, res) => {
        const { vid, id } = req.body || {};
        if (!vid || !id) return res.status(400).json({ code: 1, msg: '参数不完整' });
        const subs = await S.store.videoSubsAll();
        if (Array.isArray(subs[vid])) subs[vid] = subs[vid].filter(x => x !== id);
        await S.store.videoSubsWrite(subs);
        res.json({ code: 0, msg: '已取消应用' });
    });

    /* ── 原 server.js L3165-3165 ── */
    /* 视频可用的字幕：已应用的字幕 + 本地目录扫描 + OpenList 同目录 */

    /* ── 原 server.js L3166-3223 ── */
    app.get('/api/subtitle/detect', async (req, res) => {
        const url = decodeURIComponent(req.query.url || '');
        if (!url) return res.json({ code: 1, msg: '缺少 url 参数' });

        /* 1. 本地目录扫描（原有逻辑） */
        let local = [];
        if (!/^https?:\/\//i.test(url)) {
            const clean = url.split('?')[0].split('#')[0].replace(/^\//, '');
            if (!clean.includes('..') && !path.isAbsolute(clean)) {
                const dir = path.dirname(clean);
                const base = path.basename(clean, path.extname(clean));
                const subExts = ['.srt', '.vtt', '.ass', '.ssa', '.webvtt'];
                const searchDir = path.join(ROOT_DIR, 'public', dir);
                const publicRoot = path.join(ROOT_DIR, 'public');
                if ((searchDir.startsWith(publicRoot + path.sep) || searchDir === publicRoot) && fs.existsSync(searchDir)) {
                    for (const f of fs.readdirSync(searchDir)) {
                        const fullExt = path.extname(f).toLowerCase();
                        if (!subExts.includes(fullExt)) continue;
                        const nameNoExt = f.slice(0, -fullExt.length);
                        if (nameNoExt === base) local.push({ title: '默认', lang: '', url: '/' + path.join(dir, f).replace(/\\/g, '/') });
                        else if (nameNoExt.startsWith(base + '.')) {
                            const langPart = nameNoExt.slice(base.length + 1);
                            local.push({ title: subLangName(langPart), lang: langPart.toLowerCase(), url: '/' + path.join(dir, f).replace(/\\/g, '/') });
                        }
                    }
                    local.sort((a, b) => (a.title === '默认' ? -1 : b.title === '默认' ? 1 : a.title.localeCompare(b.title, 'zh')));
                }
            }
        }

        /* 2. OpenList 同目录检测（远程视频且匹配已配置的 openlist 实例） */
        let remote = [];
        if (/^https?:\/\//i.test(url)) remote = await detectOpenlistSubs(url);

        /* 3. 已应用的字幕库字幕（按 URL 匹配所有 vid，合并去重） */
        let applied = [];
        try {
            const videos = await S.store.videosAll();
            const subsMap = await S.store.videoSubsAll();
            const vids = [];
            for (const [v, u] of Object.entries(videos)) { if (u === url) vids.push(v); }
            if (vids.length) {
                const all = await S.store.subtitleAll();
                const seen = new Set();
                for (const vid of vids) {
                    const ids = Array.isArray(subsMap[vid]) ? subsMap[vid] : [];
                    for (const id of ids) {
                        if (seen.has(id)) continue;
                        seen.add(id);
                        const s = all.find(x => x.id === id);
                        if (s) applied.push({ id: s.id, title: s.langName || s.name, lang: (s.langs && s.langs[0]) || s.lang || '', langs: s.langs || [], url: 'subtitle:' + s.id, type: /\.(ass|ssa)$/i.test(s.file) ? 'ass' : (/\.(vtt|webvtt)$/i.test(s.file) ? 'vtt' : 'srt'), library: true });
                    }
                }
            }
        } catch { /* 忽略 */ }

        res.json({ code: 0, data: { subtitles: [...local, ...applied, ...remote] } });
    });

    /* ── 原 server.js L3225-3225 ── */
    /* 播放器按 ID 加载字幕内容 */

    /* ── 原 server.js L3226-3236 ── */
    app.get('/api/subtitle/by-id', async (req, res) => {
        const id = String(req.query.id || '');
        if (!id) return res.status(400).json({ code: 1, msg: '缺少 id' });
        const all = await S.store.subtitleAll();
        const sub = all.find(s => s.id === id);
        if (!sub) return res.status(404).json({ code: 1, msg: '字幕不存在' });
        const content = await subtitleContent(sub);
        if (content == null) return res.status(502).json({ code: 1, msg: '字幕内容获取失败' });
        res.type('text/plain; charset=utf-8');
        res.send(content);
    });
    },
};
