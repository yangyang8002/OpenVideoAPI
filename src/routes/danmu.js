/* 弹幕路由：DPlayer 兼容 v3 + 发送（含 /api/ 限流挂载）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */

module.exports = {
    mount(ctx) {
        const { app, getApiLimiter, S, writeRateLimit, getDanmakuLimits, checkDanmakuLimit, containsBannedWord, fileSizeExceeds, DANMU_FILE } = ctx;

    /* ── 原 server.js L1016-1016 ── */
    app.use('/api/', getApiLimiter());

    /* ── 原 server.js L1018-1046 ── */
    app.get('/api/danmu/v3/', async (req, res) => {
        const id = req.query.id;
        console.log(`[弹幕API] GET 请求(query) - 视频ID: ${id}`);
    
        let danmuList = await S.store.danmuAll();
        console.log(`[弹幕API] 数据库中共有 ${danmuList.length} 条弹幕`);
    
        if (id) {
            danmuList = danmuList.filter(d => d.vid === id);
            console.log(`[弹幕API] 过滤后剩余 ${danmuList.length} 条弹幕`);
        }
    
        const bannedWords = await S.store.bannedAll();
        danmuList = danmuList.filter(d => {
            const text = d.text.toLowerCase();
            return !bannedWords.some(word => text.includes(word.toLowerCase()));
        });
    
        const danmakuData = danmuList.map(d => [
            d.time,
            d.type === 'right' ? 0 : (d.type === 'top' ? 1 : 2),
            parseInt(d.color.replace('#', ''), 16),
            d.author || 'anonymous',
            d.text
        ]);
    
        console.log(`[弹幕API] 返回 ${danmakuData.length} 条弹幕`);
        res.json({ code: 0, data: danmakuData });
    });

    /* ── 原 server.js L1048-1073 ── */
    app.get('/api/danmu/v3/:id', async (req, res) => {
        const id = req.params.id;
        console.log(`[弹幕API] GET 请求(path) - 视频ID: ${id}`);
    
        let danmuList = await S.store.danmuAll();
    
        if (id) {
            danmuList = danmuList.filter(d => d.vid === id);
        }
    
        const bannedWords = await S.store.bannedAll();
        danmuList = danmuList.filter(d => {
            const text = d.text.toLowerCase();
            return !bannedWords.some(word => text.includes(word.toLowerCase()));
        });
    
        const danmakuData = danmuList.map(d => [
            d.time,
            d.type === 'right' ? 0 : (d.type === 'top' ? 1 : 2),
            parseInt(d.color.replace('#', ''), 16),
            d.author || 'anonymous',
            d.text
        ]);
    
        res.json({ code: 0, data: danmakuData });
    });

    /* ── 原 server.js L1075-1103 ── */
    app.get('/api/danmu/', async (req, res) => {
        const id = req.query.id;
        console.log(`[弹幕API] GET 请求(query) - 视频ID: ${id}`);
    
        let danmuList = await S.store.danmuAll();
        console.log(`[弹幕API] 数据库中共有 ${danmuList.length} 条弹幕`);
    
        if (id) {
            danmuList = danmuList.filter(d => d.vid === id);
            console.log(`[弹幕API] 过滤后剩余 ${danmuList.length} 条弹幕`);
        }
    
        const bannedWords = await S.store.bannedAll();
        danmuList = danmuList.filter(d => {
            const text = d.text.toLowerCase();
            return !bannedWords.some(word => text.includes(word.toLowerCase()));
        });
    
        const danmakuData = danmuList.map(d => [
            d.time,
            d.type === 'right' ? 0 : (d.type === 'top' ? 1 : 2),
            parseInt(d.color.replace('#', ''), 16),
            d.author || 'anonymous',
            d.text
        ]);
    
        console.log(`[弹幕API] 返回 ${danmakuData.length} 条弹幕`);
        res.json({ code: 0, data: danmakuData });
    });

    /* ── 原 server.js L1105-1158 ── */
    app.post('/api/danmu/', writeRateLimit(60, 60000), async (req, res) => {
        if (S.dbMigrating) return res.status(503).json({ code: 1, msg: '数据迁移中，请稍后重试' });
        const { id, player, text, color, type, time, author } = req.body || {};
        const vid = id || player;
        console.log(`[弹幕API] POST 请求 - 视频ID: ${vid}, 内容: ${text}`);

        if (!vid || !text) {
            console.log(`[弹幕API] 参数不完整 - id/player: ${vid}, text: ${text}`);
            return res.status(400).json({ code: 1, msg: '参数不完整' });
        }
        if (typeof text !== 'string' || text.length > getDanmakuLimits().maxLength) {
            return res.status(400).json({ code: 1, msg: '弹幕内容过长（最长 ' + getDanmakuLimits().maxLength + ' 字符）' });
        }

        if (!checkDanmakuLimit(req, res)) return;

        if (await containsBannedWord(text)) {
            console.log(`[弹幕API] 弹幕包含屏蔽词: ${text}`);
            return res.status(403).json({ code: 2, msg: '弹幕包含屏蔽词' });
        }

        const danmuList = await S.store.danmuAll();

        let danmuType = 'right';
        if (type === 1) danmuType = 'top';
        else if (type === 2) danmuType = 'bottom';

        let colorHex = '#ffffff';
        if (color !== undefined) {
            colorHex = '#' + parseInt(color).toString(16).padStart(6, '0');
        }

        const newDanmu = {
            id: Date.now().toString(),
            vid: vid,
            text,
            color: colorHex,
            type: danmuType,
            time: parseFloat(time) || 0,
            author: String(author || 'anonymous').slice(0, getDanmakuLimits().authorMaxLength),
            date: new Date().toISOString()
        };

        danmuList.push(newDanmu);
        if (S.store.type === 'json' && fileSizeExceeds(DANMU_FILE, 200 * 1024 * 1024)) {
            return res.status(507).json({ code: 1, msg: '弹幕存储已满' });
        }
        await S.store.danmuAdd(newDanmu);

        console.log(`[弹幕API] 弹幕保存成功: ${text}`);
        /* 广播给插件（可用于弹幕统计、机器人转发、审核等） */
        if (S.pluginManager) S.pluginManager.emit('danmu:send', { vid, text, color: colorHex, type: danmuType, time: parseFloat(time) || 0, author: String(author || 'anonymous') });
        res.json({ code: 0, data: newDanmu });
    });

    /* ── 原 server.js L1160-1213 ── */
    app.post('/api/danmu/v3/', writeRateLimit(60, 60000), async (req, res) => {
        if (S.dbMigrating) return res.status(503).json({ code: 1, msg: '数据迁移中，请稍后重试' });
        const { id, player, text, color, type, time, author } = req.body || {};
        const vid = id || player;
        console.log(`[弹幕API] POST 请求 - 视频ID: ${vid}, 内容: ${text}`);

        if (!vid || !text) {
            console.log(`[弹幕API] 参数不完整 - id/player: ${vid}, text: ${text}`);
            return res.status(400).json({ code: 1, msg: '参数不完整' });
        }
        if (typeof text !== 'string' || text.length > getDanmakuLimits().maxLength) {
            return res.status(400).json({ code: 1, msg: '弹幕内容过长（最长 ' + getDanmakuLimits().maxLength + ' 字符）' });
        }

        if (!checkDanmakuLimit(req, res)) return;

        if (await containsBannedWord(text)) {
            console.log(`[弹幕API] 弹幕包含屏蔽词: ${text}`);
            return res.status(403).json({ code: 2, msg: '弹幕包含屏蔽词' });
        }

        const danmuList = await S.store.danmuAll();

        let danmuType = 'right';
        if (type === 1) danmuType = 'top';
        else if (type === 2) danmuType = 'bottom';

        let colorHex = '#ffffff';
        if (color !== undefined) {
            colorHex = '#' + parseInt(color).toString(16).padStart(6, '0');
        }

        const newDanmu = {
            id: Date.now().toString(),
            vid: vid,
            text,
            color: colorHex,
            type: danmuType,
            time: parseFloat(time) || 0,
            author: String(author || 'anonymous').slice(0, getDanmakuLimits().authorMaxLength),
            date: new Date().toISOString()
        };

        danmuList.push(newDanmu);
        if (S.store.type === 'json' && fileSizeExceeds(DANMU_FILE, 200 * 1024 * 1024)) {
            return res.status(507).json({ code: 1, msg: '弹幕存储已满' });
        }
        await S.store.danmuAdd(newDanmu);

        console.log(`[弹幕API] 弹幕保存成功: ${text}`);
        /* 广播给插件（可用于弹幕统计、机器人转发、审核等） */
        if (S.pluginManager) S.pluginManager.emit('danmu:send', { vid, text, color: colorHex, type: danmuType, time: parseFloat(time) || 0, author: String(author || 'anonymous') });
        res.json({ code: 0, data: newDanmu });
    });
    },
};
