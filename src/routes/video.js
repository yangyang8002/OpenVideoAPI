/* 视频路由：映射 / resolve / 管理列表 / OpenList 直链解析
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const { createCloud } = require('../../lib/cloud');

module.exports = {
    mount(ctx) {
        const { app, writeRateLimit, S, isValidVid, isValidVideoUrl, normalizeOpenlistUrl, legacyVideoId, hasDanmuForVid, genVideoId, checkAdmin, matchOpenlistCfg, safeErrMsg } = ctx;

    /* ── 原 server.js L1247-1257 ── */
    app.post('/api/video/map', writeRateLimit(30, 60000), async (req, res) => {
        if (S.dbMigrating) return res.status(503).json({ code: 1, msg: '数据迁移中，请稍后重试' });
        const { vid, url } = req.body || {};
        if (!isValidVid(vid) || !isValidVideoUrl(url)) return res.status(400).json({ code: 1, msg: '参数不合法' });
        try {
            const key = normalizeOpenlistUrl(url);
            await S.store.videoSet(vid, key);
            if (S.pluginManager) S.pluginManager.emit('video:created', { vid, url: key, source: 'map' });
            res.json({ code: 0, msg: '已记录' });
        } catch (e) {
            res.status(e.code || 500).json({ code: 1, msg: e.code === 507 ? '映射表已满' : '保存失败' });
        }
    });

    /* 视频截图：服务端 ffmpeg 抓帧（跨域视频 canvas 会被污染，服务端无此限制） */
    app.post('/api/video/screenshot', writeRateLimit(10, 60000), async (req, res) => {
        const { url, time } = req.body || {};
        const u = String(url || '').trim();
        if (!u || !isValidVideoUrl(u)) return res.status(400).json({ code: 1, msg: '缺少或非法的 url 参数' });
        const t = Math.max(0, Math.min(parseFloat(time) || 0, 86400));
        const fs = require('fs');
        const path = require('path');
        const os = require('os');
        const { spawn } = require('child_process');
        let ffBin = 'ffmpeg';
        try { if (fs.existsSync('/usr/bin/ffmpeg')) ffBin = '/usr/bin/ffmpeg'; } catch (e) {}
        const file = path.join(os.tmpdir(), 'ovshot-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg');
        const child = spawn(ffBin, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', u, '-frames:v', '1', '-q:v', '3', '-y', file]);
        let err = '';
        child.stderr && child.stderr.on('data', (d) => { err += d; });
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} }, 60000);
        child.on('error', (e) => {
            clearTimeout(timer);
            return res.status(500).json({ code: 1, msg: '截图失败：ffmpeg 不可用（' + (e.message || '') + '）' });
        });
        child.on('exit', (code) => {
            clearTimeout(timer);
            try {
                if (code === 0 && fs.existsSync(file) && fs.statSync(file).size > 0) {
                    const b64 = fs.readFileSync(file).toString('base64');
                    try { fs.unlinkSync(file); } catch (e) {}
                    return res.json({ code: 0, data: { image: 'data:image/jpeg;base64,' + b64 } });
                }
                try { fs.unlinkSync(file); } catch (e) {}
            } catch (e) {}
            res.status(500).json({ code: 1, msg: '截图失败：无法读取视频画面（' + String(err || '').slice(-160) + '）' });
        });
    });

    /* ── 原 server.js L1282-1308 ── */
    /* 任意 CDN 签名直链的身份归一：剥离轮换的签名/会话参数（t/s/r/bzs/ur/urn/bzp）与纯装饰参数（filename），
       同一视频的不同签名实例映射到同一 vid（弹幕/字幕不丢）；存储仍保留完整链接（播放/ffprobe 可用） */
    function signFreeId(u) {
        try {
            const p = new URL(u);
            if (!/^https?:$/.test(p.protocol)) return u;
            for (const k of ['t', 's', 'r', 'bzs', 'ur', 'urn', 'bzp', 'filename']) p.searchParams.delete(k);
            const q = p.searchParams.toString();
            return p.origin + p.pathname + (q ? '?' + q : '');
        } catch (e) { return u; }
    }

    app.get('/api/video/resolve', writeRateLimit(60, 60000), async (req, res) => {
        const url = (req.query.url || '').trim();
        if (!url || !isValidVideoUrl(url)) return res.status(400).json({ code: 1, msg: '缺少或非法的 url 参数' });
        /* OpenList 签名链接归一化：vid 基于剥掉签名参数的规范链接，签名变化不产生新 vid */
        const key = normalizeOpenlistUrl(url);
        const nid = signFreeId(key);
        const videos = await S.store.videosAll();
        let existing = null;
        for (const [vid, u] of Object.entries(videos)) {
            if (u === key || signFreeId(u) === nid) { existing = vid; break; }
        }
        if (existing) {
            /* 命中旧签名实例：刷新存储为最新签名链接（resolve-link 播放解析始终用新链） */
            if (videos[existing] !== key) { try { await S.store.videoSet(existing, key); } catch (e) {} }
            if (S.pluginManager) S.pluginManager.emit('video:created', { vid: existing, url: key, source: 'map' });
            return res.json({ code: 0, data: { vid: existing, source: 'map' } });
        }
        // 旧散列算法兼容：该 URL 已有历史弹幕 → 继承旧 ID，弹幕不丢
        const legacyId = legacyVideoId(key);
        if (await hasDanmuForVid(legacyId)) {
            try {
                await S.store.videoSet(legacyId, key);
                if (S.pluginManager) S.pluginManager.emit('video:created', { vid: legacyId, url: key, source: 'legacy' });
                return res.json({ code: 0, data: { vid: legacyId, source: 'legacy' } });
            } catch (e) { return res.status(507).json({ code: 1, msg: '映射表已满' }); }
        }
        const vid = await genVideoId();
        try {
            await S.store.videoSet(vid, key);
            if (S.pluginManager) S.pluginManager.emit('video:created', { vid, url: key, source: 'new' });
            res.json({ code: 0, data: { vid, source: 'new' } });
        } catch (e) {
            res.status(507).json({ code: 1, msg: '映射表已满' });
        }
    });

    /* ── 原 server.js L1310-1314 ── */
    /* 从链接取文件名（OpenList /d/<路径> 最后一段；decode 失败回退原文段） */
    function fileNameOf(url) {
        const raw = String(url || '').split('?')[0].split('#')[0];
        const seg = raw.split('/').filter(Boolean).pop() || '';
        try { return decodeURIComponent(seg) || seg; } catch (e) { return seg; }
    }

    /* v26.10：视频管理列表返回 name(文件名)+note(备注，openlist 扫描写入网盘目录) */
    app.get('/api/admin/videos', checkAdmin, async (req, res) => {
        const videos = await S.store.videosAll();
        const notes = (await S.store.kvGet('video_notes')) || {};
        const list = Object.entries(videos).map(([vid, url]) => ({ vid, url, name: fileNameOf(url), note: String(notes[vid] || '') }));
        res.json({ code: 0, data: list });
    });

    /* ── 原 server.js L1316-1321 ── */
    app.post('/api/admin/videos', checkAdmin, async (req, res) => {
        const { vid, url } = req.body;
        if (!vid || !url) return res.status(400).json({ code: 1, msg: '参数不完整' });
        await S.store.videoSet(vid, url);
        if (S.pluginManager) {
            S.pluginManager.emit('video:saved', { vid, url, source: 'admin' });
            S.pluginManager.emit('video:created', { vid, url, source: 'admin' });
        }
        res.json({ code: 0, msg: '已保存', data: { vid, url } });
    });

    /* ── 原 server.js L1323-1328 ── */
    app.post('/api/admin/videos/delete', checkAdmin, async (req, res) => {
        const { vid } = req.body;
        const ok = await S.store.videoDelete(vid);
        if (!ok) return res.status(404).json({ code: 1, msg: '不存在' });
        if (S.pluginManager) S.pluginManager.emit('video:deleted', { vid });
        res.json({ code: 0, msg: '已删除' });
    });

    /* ── 原 server.js L2938-2938 ── */
    /* 解析 OpenList 视频的云盘直链（签名链接 → 二次直链）：播放器播放直链，弹幕/字幕仍以归一化后的原链接为准 */

    /* ── 原 server.js L2939-2952 ── */
    app.get('/api/video/resolve-link', writeRateLimit(60, 60000), async (req, res) => {
        const url = (req.query.url || '').trim();
        if (!url || !isValidVideoUrl(url)) return res.status(400).json({ code: 1, msg: '缺少或非法的 url 参数' });
        const hit = matchOpenlistCfg(url);
        if (!hit) return res.json({ code: 0, data: { url, matched: false } });
        try {
            const cloud = createCloud({ ...hit.cfg, path: '/' + hit.rel.split('/').slice(0, -1).join('/') });
            const raw = await cloud.resolve('/' + hit.rel);
            if (!raw) return res.json({ code: 0, data: { url, matched: false } });
            res.json({ code: 0, data: { url: raw, matched: true, original: url, cleanUrl: hit.cleanUrl } });
        } catch (e) {
            res.status(502).json({ code: 1, msg: '直链解析失败: ' + safeErrMsg(e) });
        }
    });
    },
};
