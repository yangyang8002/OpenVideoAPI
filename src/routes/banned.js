/* 屏蔽词路由：订阅 CRUD / 刷新 / 词库 CRUD / 弹幕管理
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    mount(ctx) {
        const { app, checkAdmin, readConfig, writeConfig, refreshBannedWords, S } = ctx;

    /* ── 原 server.js L1759-1759 ── */
    // ==================== 自定义屏蔽词订阅 ====================

    /* ── 原 server.js L1761-1765 ── */
    app.get('/api/admin/banned-words/subscriptions', checkAdmin, (req, res) => {
        const config = readConfig();
        const subs = (config.bannedWords && config.bannedWords.subscriptions) || [];
        res.json({ code: 0, data: subs });
    });

    /* ── 原 server.js L1767-1781 ── */
    app.post('/api/admin/banned-words/subscriptions', checkAdmin, (req, res) => {
        const { url } = req.body;
        if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
            return res.status(400).json({ code: 1, msg: '请提供有效的 HTTP(s) 链接' });
        }
        const config = readConfig();
        if (!config.bannedWords) config.bannedWords = {};
        if (!config.bannedWords.subscriptions) config.bannedWords.subscriptions = [];
        if (config.bannedWords.subscriptions.includes(url.trim())) {
            return res.status(400).json({ code: 2, msg: '该订阅已存在' });
        }
        config.bannedWords.subscriptions.push(url.trim());
        writeConfig(config);
        res.json({ code: 0, msg: '已添加', data: config.bannedWords.subscriptions });
    });

    /* ── 原 server.js L1783-1792 ── */
    app.delete('/api/admin/banned-words/subscriptions', checkAdmin, (req, res) => {
        const { url } = req.body;
        const config = readConfig();
        const subs = (config.bannedWords && config.bannedWords.subscriptions) || [];
        const idx = subs.indexOf(url);
        if (idx === -1) return res.status(404).json({ code: 1, msg: '订阅不存在' });
        subs.splice(idx, 1);
        writeConfig(config);
        res.json({ code: 0, msg: '已删除', data: subs });
    });

    /* ── 原 server.js L1794-1801 ── */
    app.post('/api/admin/banned-words/refresh', checkAdmin, async (req, res) => {
        try {
            const count = await refreshBannedWords();
            res.json({ code: 0, msg: `已刷新，共 ${count} 个屏蔽词` });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '刷新失败: ' + e.message });
        }
    });

    /* ── 原 server.js L1840-1855 ── */
    app.get('/api/admin/banned-words', checkAdmin, async (req, res) => {
        let words = await S.store.bannedAll(true);
        const search = (req.query.search || '').toLowerCase();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;

        if (search) {
            words = words.filter(w => w.toLowerCase().includes(search));
        }

        const total = words.length;
        const start = (page - 1) * limit;
        const paged = words.slice(start, start + limit);

        res.json({ code: 0, data: { words: paged, total, page, limit } });
    });

    /* ── 原 server.js L1857-1868 ── */
    app.post('/api/admin/banned-words', checkAdmin, async (req, res) => {
        const { word } = req.body;
        if (!word || !word.trim()) {
            return res.status(400).json({ code: 1, msg: '关键词不能为空' });
        }
    
        const ok = await S.store.bannedAdd(word.trim());
        if (!ok) {
            return res.status(400).json({ code: 2, msg: '该关键词已存在' });
        }
        res.json({ code: 0, msg: '添加成功' });
    });

    /* ── 原 server.js L1870-1878 ── */
    app.delete('/api/admin/banned-words', checkAdmin, async (req, res) => {
        const { word } = req.body;
        if (!word) return res.status(400).json({ code: 1, msg: '参数不完整' });
        const ok = await S.store.bannedDelete(word);
        if (!ok) {
            return res.status(404).json({ code: 1, msg: '关键词不存在' });
        }
        res.json({ code: 0, msg: '删除成功' });
    });

    /* ── 原 server.js L1880-1887 ── */
    app.get('/api/admin/danmu', checkAdmin, async (req, res) => {
        const vid = req.query.vid || '';
        const search = (req.query.search || '').toLowerCase();
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const d = await S.store.danmuPage({ page, limit, vid, search });
        res.json({ code: 0, data: { list: d.list, total: d.total, page, limit } });
    });

    /* ── 原 server.js L1889-1892 ── */
    app.get('/api/admin/danmu/vids', checkAdmin, async (req, res) => {
        const vids = await S.store.danmuVids();
        res.json({ code: 0, data: vids });
    });

    /* ── 原 server.js L1894-1902 ── */
    app.delete('/api/admin/danmu', checkAdmin, async (req, res) => {
        const { id } = req.body;
        if (!id) return res.status(400).json({ code: 1, msg: '参数不完整' });
        const ok = await S.store.danmuDelete(id);
        if (!ok) {
            return res.status(404).json({ code: 1, msg: '弹幕不存在' });
        }
        res.json({ code: 0, msg: '删除成功' });
    });
    },
};
