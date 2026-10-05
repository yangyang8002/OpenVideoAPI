/* 视频映射与 ID 分配（8 位 ID + 旧 hash 弹幕继承）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const fs = require('fs');

module.exports = {
    define(ctx) {
        const { initDataFile, VIDEOS_FILE, S } = ctx;

    /* ── 原 server.js L1215-1215 ── */
    // ==================== 视频映射 ====================

    /* ── 原 server.js L1217-1217 ── */
    initDataFile(VIDEOS_FILE, {});

    /* ── 原 server.js L1219-1219 ── */
    /* 写放大防护：数据文件体积上限 */

    /* ── 原 server.js L1220-1222 ── */
    function fileSizeExceeds(filePath, maxBytes) {
        try { return fs.statSync(filePath).size > maxBytes; } catch { return false; }
    }

    /* ── 原 server.js L1237-1242 ── */
    function isValidVideoUrl(url) {
        if (typeof url !== 'string' || url.length > 2048) return false;
        if (/^https?:\/\//i.test(url)) return true;
        if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;
        return false;
    }

    /* ── 原 server.js L1243-1245 ── */
    function isValidVid(vid) {
        return typeof vid === 'string' && vid.length >= 4 && vid.length <= 32 && /^[a-zA-Z0-9]+$/.test(vid);
    }

    /* ── 原 server.js L1259-1259 ── */
    // ==================== 视频 ID 解析（服务端分配 8 位唯一 ID） ====================

    /* ── 原 server.js L1260-1260 ── */
    const VID_CHARS = '23456789abcdefghijkmnpqrstuvwxyz'; // 去除易混淆字符 0/1/l/o/i

    /* ── 原 server.js L1261-1267 ── */
    function legacyVideoId(url) {
        let v = url;
        try { const u = new URL(url); v = u.pathname + u.search; } catch (e) {}
        let hash = 0;
        for (let i = 0; i < v.length; i++) { hash = ((hash << 5) - hash) + v.charCodeAt(i); hash |= 0; }
        return Math.abs(hash).toString(36);
    }

    /* ── 原 server.js L1268-1270 ── */
    async function hasDanmuForVid(vid) {
        return S.store.danmuHasVid(vid);
    }

    /* ── 原 server.js L1271-1281 ── */
    async function genVideoId() {
        const videos = await S.store.videosAll();
        const used = new Set(Object.keys(videos));
        (await S.store.danmuAllVids()).forEach(v => used.add(v));
        for (let i = 0; i < 200; i++) {
            let s = '';
            for (let j = 0; j < 8; j++) s += VID_CHARS[Math.floor(Math.random() * VID_CHARS.length)];
            if (!used.has(s)) return s;
        }
        return 'v' + Date.now().toString(36);
    }

        Object.assign(ctx, { fileSizeExceeds, fileSizeExceeds, isValidVideoUrl, isValidVideoUrl, isValidVid, isValidVid, VID_CHARS, VID_CHARS, legacyVideoId, legacyVideoId, hasDanmuForVid, hasDanmuForVid, genVideoId, genVideoId });
    },
};
