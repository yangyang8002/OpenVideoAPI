/* 指纹档案服务：分层视频身份识别（m02083 定案）
 * 背景：URL 身份（signFreeId）只认「同一链接的不同签名/编码实例」；同一文件改名/换盘/搬家后
 * URL 变了 → 分裂新 vid，字幕/弹幕断链。本服务为每个 vid 维护「指纹档案」：
 *   T0 hashes：[{alg,value}] —— OpenList 驱动提供的全文件哈希（md5/sha1/sha256，免费零成本）
 *   T1 meta：{size,durationMs,w,h,vcodec,fps} —— 字节级体积+毫秒级时长+分辨率+编码+帧率
 *               （embed-sub 插件探测字幕轨时顺带 ffprobe 采集）
 * 级联匹配：同 alg 哈希精确相等 → 同一视频；未中则 meta 复合全等（同片不同版本字节必差，
 * 不误伤；同文件副本必全等，必命中）；都未中才由调用方新建 vid。
 * 异步补录碰撞（如 embed-sub 后补 meta 时发现该文件已有别的 vid）→ mergeVideos 合并
 * （canonical=字幕多→弹幕多；URL 取最新实例；subs/notes/danmu/档案/索引全部迁移）。 */
'use strict';

module.exports = {
    define(ctx) {
        const S = ctx.S;

        const FP_KV = 'video_fingerprints';  /* vid → { hashes: [{alg,value}], meta: {…} } */
        const HASH_IDX_KV = 'fp_hash_index'; /* 'alg:value' → vid */
        const META_IDX_KV = 'fp_meta_index'; /* metaSig → vid */
        const ALGS = ['md5', 'sha1', 'sha256'];
        const HEX_RE = /^[0-9a-f]{8,64}$/;
        const META_FIELDS = ['size', 'durationMs', 'w', 'h', 'vcodec', 'fps'];

        /* ---------- 清洗 ---------- */
        function sanitizeHashes(hs) {
            if (!Array.isArray(hs)) return [];
            const out = [], seen = new Set();
            for (const h of hs) {
                if (!h || typeof h !== 'object') continue;
                const alg = String(h.alg || '').toLowerCase();
                const value = String(h.value || '').toLowerCase();
                if (!ALGS.includes(alg) || !HEX_RE.test(value)) continue;
                const k = alg + ':' + value;
                if (seen.has(k)) continue;
                seen.add(k);
                out.push({ alg, value });
            }
            return out;
        }
        /* 各字段独立清洗（部分字段也可入库，等后续补齐再参与匹配） */
        function sanitizeMetaFields(m) {
            const out = {};
            if (!m || typeof m !== 'object') return out;
            const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
            const size = num(m.size); if (size != null) out.size = Math.round(size);
            const dur = num(m.durationMs); if (dur != null) out.durationMs = Math.round(dur);
            const w = num(m.w); if (w != null) out.w = Math.round(w);
            const h = num(m.h); if (h != null) out.h = Math.round(h);
            const fps = num(m.fps); if (fps != null) out.fps = Math.round(fps * 1000) / 1000;
            const vc = String(m.vcodec || '').toLowerCase().slice(0, 32);
            if (/^[a-z0-9_.-]+$/.test(vc)) out.vcodec = vc;
            return out;
        }
        /* 全字段齐才有资格做复合签名（部分档案只存不配） */
        function fullMetaSig(meta) {
            const f = sanitizeMetaFields(meta);
            for (const k of META_FIELDS) if (f[k] == null) return null;
            return f.size + '|' + f.durationMs + '|' + f.w + '|' + f.h + '|' + f.vcodec + '|' + f.fps;
        }

        /* ---------- 级联匹配：T0 哈希 → T1 meta 复合；返回命中 vid 或 null ---------- */
        async function match(fp) {
            if (!fp || typeof fp !== 'object') return null;
            const hashes = sanitizeHashes(fp.hashes);
            if (hashes.length) {
                const idx = (await S.store.kvGet(HASH_IDX_KV)) || {};
                for (const h of hashes) {
                    const v = idx[h.alg + ':' + h.value];
                    if (v) return v;
                }
            }
            const sig = fullMetaSig(fp.meta);
            if (sig) {
                const idx = (await S.store.kvGet(META_IDX_KV)) || {};
                if (idx[sig]) return idx[sig];
            }
            return null;
        }

        /* ---------- 合并两个 vid（canonical=字幕多→弹幕多；URL 取 drop 的最新实例） ---------- */
        async function mergeVideos(a, b) {
            const videos = await S.store.videosAll();
            const exists = (v) => v && videos[v] !== undefined;
            if (!exists(a) && !exists(b)) return a || b;
            if (!exists(a)) return b;
            if (!exists(b)) return a;
            const subsMap = await S.store.videoSubsAll();
            const countOf = (v) => (Array.isArray(subsMap[v]) ? subsMap[v].length : 0);
            const danmuCount = {};
            try { for (const it of await S.store.danmuVids()) danmuCount[it.vid] = it.count || 0; } catch (e) {}
            let keep = a, drop = b;
            if (countOf(b) > countOf(a) || (countOf(b) === countOf(a) && (danmuCount[b] || 0) > (danmuCount[a] || 0))) { keep = b; drop = a; }
            /* 字幕挂载迁移（按字幕 id 去重合并） */
            try {
                const ids = new Set([].concat(subsMap[keep] || [], subsMap[drop] || []));
                subsMap[keep] = Array.from(ids);
                delete subsMap[drop];
                await S.store.videoSubsWrite(subsMap);
            } catch (e) {}
            /* 备注迁移 */
            try {
                const notes = (await S.store.kvGet('video_notes')) || {};
                if (notes[drop] && !notes[keep]) notes[keep] = notes[drop];
                delete notes[drop];
                await S.store.kvSet('video_notes', notes);
            } catch (e) {}
            /* 弹幕迁移（保 id：先删后加，跨后端通用） */
            try {
                const items = (await S.store.danmuAll()).filter((d) => d.vid === drop);
                for (const d of items) {
                    try { await S.store.danmuDelete(d.id); } catch (e) {}
                    try { await S.store.danmuAdd(Object.assign({}, d, { vid: keep })); } catch (e) {}
                }
            } catch (e) {}
            /* URL：drop 是刚解析到的新实例 → 保留其链接（keep 的旧签名可能已过期），再删 drop 条目 */
            try {
                if (videos[drop]) await S.store.videoSet(keep, videos[drop]);
                await S.store.videoDelete(drop);
            } catch (e) {}
            /* 档案合并 + 两索引重指 */
            try {
                const fpMap = (await S.store.kvGet(FP_KV)) || {};
                const ka = fpMap[keep] || { hashes: [], meta: {} };
                const kb = fpMap[drop] || { hashes: [], meta: {} };
                const seen = new Set((ka.hashes || []).map((x) => x.alg + ':' + x.value));
                for (const h of sanitizeHashes(kb.hashes)) {
                    const k2 = h.alg + ':' + h.value;
                    if (!seen.has(k2)) { seen.add(k2); (ka.hashes = ka.hashes || []).push(h); }
                }
                ka.meta = Object.assign({}, kb.meta || {}, ka.meta || {});
                fpMap[keep] = ka;
                delete fpMap[drop];
                await S.store.kvSet(FP_KV, fpMap);
                const hidx = (await S.store.kvGet(HASH_IDX_KV)) || {};
                for (const k2 of Object.keys(hidx)) if (hidx[k2] === drop) hidx[k2] = keep;
                await S.store.kvSet(HASH_IDX_KV, hidx);
                const midx = (await S.store.kvGet(META_IDX_KV)) || {};
                for (const k2 of Object.keys(midx)) if (midx[k2] === drop) midx[k2] = keep;
                await S.store.kvSet(META_IDX_KV, midx);
            } catch (e) {}
            if (S.pluginManager) { try { S.pluginManager.emit('video:deleted', { vid: drop, merged: keep }); } catch (e) {} }
            return keep;
        }

        /* ---------- 落档：合并指纹进 vid 档案并更新索引；碰撞（别的存活 vid 已有同指纹）→ 合并，
           返回存活 vid（正常情况即传入 vid） ---------- */
        async function record(vid, fp) {
            if (!vid || !fp || typeof fp !== 'object') return vid;
            const videos = await S.store.videosAll();
            if (videos[vid] === undefined) return vid; /* 陈旧/不存在：不落档 */
            const newHashes = sanitizeHashes(fp.hashes);
            const newMeta = sanitizeMetaFields(fp.meta);
            if (!newHashes.length && !Object.keys(newMeta).length) return vid;
            const fpMap = (await S.store.kvGet(FP_KV)) || {};
            const cur = fpMap[vid] || { hashes: [], meta: {} };
            /* 碰撞检测：新哈希 / 补齐后的完整签名 命中其他存活 vid → 合并后以存活 vid 重落 */
            let collide = null;
            if (newHashes.length) {
                const idx = (await S.store.kvGet(HASH_IDX_KV)) || {};
                for (const h of newHashes) {
                    const v = idx[h.alg + ':' + h.value];
                    if (v && v !== vid && videos[v] !== undefined) { collide = v; break; }
                }
            }
            if (!collide) {
                const merged = Object.assign({}, cur.meta || {}, newMeta);
                const sig = fullMetaSig(merged);
                if (sig) {
                    const idx = (await S.store.kvGet(META_IDX_KV)) || {};
                    const v = idx[sig];
                    if (v && v !== vid && videos[v] !== undefined) collide = v;
                }
            }
            if (collide) return record(await mergeVideos(collide, vid), fp);
            /* 正常落档 */
            const seen = new Set((cur.hashes || []).map((x) => x.alg + ':' + x.value));
            const hashes = (cur.hashes || []).slice();
            for (const h of newHashes) {
                const k = h.alg + ':' + h.value;
                if (!seen.has(k)) { seen.add(k); hashes.push(h); }
            }
            const meta = Object.assign({}, cur.meta || {}, newMeta);
            fpMap[vid] = { hashes, meta };
            await S.store.kvSet(FP_KV, fpMap);
            if (newHashes.length) {
                const idx = (await S.store.kvGet(HASH_IDX_KV)) || {};
                for (const h of newHashes) idx[h.alg + ':' + h.value] = vid;
                await S.store.kvSet(HASH_IDX_KV, idx);
            }
            const sig = fullMetaSig(meta);
            if (sig) {
                const idx = (await S.store.kvGet(META_IDX_KV)) || {};
                idx[sig] = vid;
                await S.store.kvSet(META_IDX_KV, idx);
            }
            return vid;
        }

        S.fingerprint = { match, record, mergeVideos, sanitizeHashes, sanitizeMetaFields, fullMetaSig };
        ctx.fingerprintService = S.fingerprint;
    }
};