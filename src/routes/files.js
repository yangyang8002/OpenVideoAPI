/* 文件管理路由：浏览/删除/复制/压缩/解压/上传
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const multer = require('multer');

module.exports = {
    mount(ctx) {
        const { ROOT_DIR, app, checkAdmin, getUploadLimits } = ctx;

    /* ── 原 server.js L1570-1570 ── */
    // ==================== 文件查看器 ====================

    /* ── 原 server.js L1572-1579 ── */
    function safeResolve(rel) {
        if (rel == null) return ROOT_DIR;
        if (typeof rel !== 'string') return null;
        const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
        const p = path.resolve(ROOT_DIR, clean || '.');
        if (p !== ROOT_DIR && !p.startsWith(ROOT_DIR + path.sep)) return null;
        return p;
    }

    /* ── 原 server.js L1581-1605 ── */
    app.get('/api/admin/files', checkAdmin, (req, res) => {
        const target = safeResolve(req.query.path || '');
        if (!target) return res.status(400).json({ code: 1, msg: '非法路径' });
        let stat;
        try { stat = fs.statSync(target); } catch (e) { return res.status(404).json({ code: 1, msg: '路径不存在' }); }

        if (stat.isFile()) {
            const size = stat.size;
            const previewKB = getUploadLimits().previewKB;
            if (size > previewKB * 1024) return res.json({ code: 0, data: { type: 'file', name: path.basename(target), size, tooLarge: true } });
            let content;
            try { content = fs.readFileSync(target, 'utf8'); } catch (e) { content = '[二进制文件无法预览]'; }
            return res.json({ code: 0, data: { type: 'file', name: path.basename(target), size, content } });
        }

        const entries = fs.readdirSync(target, { withFileTypes: true }).map(d => {
            const full = path.join(target, d.name);
            let size = 0;
            try { if (d.isFile()) size = fs.statSync(full).size; } catch (e) {}
            return { name: d.name, dir: d.isDirectory(), size };
        }).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));

        const rel = path.relative(ROOT_DIR, target).replace(/\\/g, '/');
        res.json({ code: 0, data: { type: 'dir', path: rel || '/', entries } });
    });

    /* ── 原 server.js L1607-1607 ── */
    // 批量删除

    /* ── 原 server.js L1608-1618 ── */
    app.post('/api/admin/files/delete', checkAdmin, (req, res) => {
        const { paths } = req.body || {};
        if (!Array.isArray(paths) || !paths.length) return res.status(400).json({ code: 1, msg: '未选择文件' });
        let deleted = 0, failed = 0;
        for (const p of paths) {
            const target = safeResolve(p);
            if (!target || !fs.existsSync(target)) { failed++; continue; }
            try { fs.rmSync(target, { recursive: true, force: true }); deleted++; } catch (e) { failed++; }
        }
        res.json({ code: 0, msg: `删除 ${deleted} 项${failed ? '，失败 ' + failed + ' 项' : ''}` });
    });

    /* ── 原 server.js L1620-1620 ── */
    // 复制（同目录加 _copy 后缀）

    /* ── 原 server.js L1621-1643 ── */
    app.post('/api/admin/files/copy', checkAdmin, (req, res) => {
        const { paths } = req.body || {};
        if (!Array.isArray(paths) || !paths.length) return res.status(400).json({ code: 1, msg: '未选择文件' });
        let copied = 0, failed = 0;
        for (const p of paths) {
            const target = safeResolve(p);
            if (!target || !fs.existsSync(target)) { failed++; continue; }
            const base = path.basename(target);
            const dir = path.dirname(target);
            const ext = path.extname(base);
            const stem = base.slice(0, -ext.length);
            let outName = stem + '_copy' + ext;
            let out = path.join(dir, outName);
            let i = 2;
            while (fs.existsSync(out)) { out = path.join(dir, `${stem}_copy${i}${ext}`); i++; }
            try {
                if (fs.statSync(target).isDirectory()) fs.cpSync(target, out, { recursive: true });
                else fs.copyFileSync(target, out);
                copied++;
            } catch (e) { failed++; }
        }
        res.json({ code: 0, msg: `复制 ${copied} 项${failed ? '，失败 ' + failed + ' 项' : ''}` });
    });

    /* ── 原 server.js L1645-1645 ── */
    // 压缩（支持 zip/7z/tar/tar.gz，通过 7za）

    /* ── 原 server.js L1646-1711 ── */
    app.post('/api/admin/files/zip', checkAdmin, (req, res) => {
        const { paths, format } = req.body || {};
        if (!Array.isArray(paths) || !paths.length) return res.status(400).json({ code: 1, msg: '未选择文件' });
        const fmt = (format || 'zip').toLowerCase();
        const validFmts = { zip: '.zip', '7z': '.7z', tar: '.tar', 'tar.gz': '.tar.gz', tgz: '.tgz', gz: '.gz' };
        const ext = validFmts[fmt];
        if (!ext) return res.status(400).json({ code: 1, msg: '不支持的格式: ' + fmt });

        const first = safeResolve(paths[0]);
        if (!first) return res.status(400).json({ code: 1, msg: '非法路径' });
        const dir = path.dirname(first);
        const baseName = paths.length === 1 ? path.basename(first, path.extname(first)) : 'archive';
        let outPath = path.join(dir, baseName + ext);
        let i = 2;
        while (fs.existsSync(outPath)) { outPath = path.join(dir, `${baseName}(${i})${ext}`); i++; }

        // 准备临时目录，复制选中项以保持相对结构，再整体压缩
        const tmpDir = path.join(dir, '.zip_tmp_' + Date.now());
        const exe = SEVEN_ZIP || '7za';
        const isTarGz = fmt === 'tar.gz' || fmt === 'tgz';

        const finish = (ok, msg, pathOut) => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            if (!ok) { try { fs.unlinkSync(outPath); } catch (_) {} }
            res.json(ok ? { code: 0, msg, data: { path: pathOut } } : { code: 1, msg });
        };

        try {
            fs.mkdirSync(tmpDir, { recursive: true });
            let added = 0;
            for (const p of paths) {
                const target = safeResolve(p);
                if (!target || !fs.existsSync(target)) continue;
                const rel = path.relative(dir, target);
                const dest = path.join(tmpDir, rel);
                if (fs.statSync(target).isDirectory()) fs.cpSync(target, dest, { recursive: true });
                else { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(target, dest); }
                added++;
            }
            if (!added) return finish(false, '没有可压缩的文件');

            if (isTarGz) {
                // 两阶段：先 7za 打 tar，再用 zlib gzip
                const tarFile = path.join(tmpDir, 'bundle.tar');
                const r = require('child_process').spawnSync(exe, ['a', '-ttar', 'bundle.tar', '*', '-y'], { cwd: tmpDir });
                if (r.status !== 0 || !fs.existsSync(tarFile)) return finish(false, 'tar 打包失败');
                const zlib = require('zlib');
                fs.writeFileSync(outPath, zlib.gzipSync(fs.readFileSync(tarFile)));
                const relOut = path.relative(ROOT_DIR, outPath).replace(/\\/g, '/');
                return finish(true, '已压缩为 ' + fmt, relOut);
            }

            // 其他格式直接用 7za
            const args = ['a', path.basename(outPath), tmpDir.replace(/\\/g, '/') + '/*', '-y'];
            const child = require('child_process').spawn(exe, args, { cwd: dir });
            let errOut = '';
            child.stderr.on('data', d => errOut += d);
            child.on('error', (e) => finish(false, '压缩失败: ' + e.message));
            child.on('close', (code) => {
                if (code !== 0) return finish(false, '压缩失败: ' + (errOut || ('exit ' + code)).split('\n')[0]);
                finish(true, '已压缩为 ' + fmt, path.relative(ROOT_DIR, outPath).replace(/\\/g, '/'));
            });
        } catch (e) {
            finish(false, '压缩失败: ' + e.message);
        }
    });

    /* ── 原 server.js L1713-1713 ── */
    // 解压（支持 zip/7z/rar/gz/tar/tar.gz/xz/iso/img 等，通过 7za）

    /* ── 原 server.js L1714-1714 ── */
    const SEVEN_ZIP = require('7zip-bin').path7za;

    /* ── 原 server.js L1715-1715 ── */
    const SUPPORTED_EXT = ['.zip', '.7z', '.rar', '.gz', '.tgz', '.tar', '.xz', '.tar.gz', '.bz2', '.tbz2', '.iso', '.img', '.lzh', '.cab', '.arj', '.z'];

    /* ── 原 server.js L1717-1734 ── */
    app.post('/api/admin/files/unzip', checkAdmin, (req, res) => {
        const { path: p } = req.body || {};
        const target = safeResolve(p);
        if (!target || !fs.existsSync(target)) return res.status(400).json({ code: 1, msg: '文件不存在' });
        const lower = target.toLowerCase();
        if (!SUPPORTED_EXT.some(ext => lower.endsWith(ext))) {
            return res.status(400).json({ code: 1, msg: '不支持的格式，支持: ' + SUPPORTED_EXT.join(' ') });
        }
        const outDir = path.dirname(target);
        const exe = SEVEN_ZIP || '7za';
        exec(`"${exe}" x "${target}" -o"${outDir.replace(/\\/g, '/')}" -y`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                console.error('[解压] 失败:', error.message, stderr);
                return res.status(500).json({ code: 1, msg: '解压失败: ' + (stderr || error.message).split('\n')[0] });
            }
            res.json({ code: 0, msg: '解压完成' });
        });
    });

    /* ── 原 server.js L1736-1736 ── */
    // 上传（multer 上限取最大允许值，运行时按配置动态校验）

    /* ── 原 server.js L1737-1740 ── */
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 2048 * 1024 * 1024 }
    });
        ctx.upload = upload; /* 供字幕上传路由复用（跨模块） */

    /* ── 原 server.js L1741-1757 ── */
    app.post('/api/admin/files/upload', checkAdmin, upload.array('files'), (req, res) => {
        const dir = safeResolve(req.body.dir || '');
        if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return res.status(400).json({ code: 1, msg: '目标目录无效' });
        if (!req.files || !req.files.length) return res.status(400).json({ code: 1, msg: '未选择文件' });
        const maxMB = getUploadLimits().maxMB;
        const tooBig = req.files.find(f => f.size > maxMB * 1024 * 1024);
        if (tooBig) return res.status(413).json({ code: 1, msg: '文件超过上传上限 ' + maxMB + 'MB: ' + path.basename(tooBig.originalname) });
        let saved = 0;
        for (const f of req.files) {
            const name = path.basename(f.originalname);
            let out = path.join(dir, name);
            let i = 2;
            while (fs.existsSync(out)) { out = path.join(dir, `${path.basename(name, path.extname(name))}(${i})${path.extname(name)}`); i++; }
            try { fs.writeFileSync(out, f.buffer); saved++; } catch (e) {}
        }
        res.json({ code: 0, msg: `上传 ${saved} 个文件` });
    });
    },
};
