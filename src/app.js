/* OpenVideoAPI 应用工厂：装配中间件栈与全部路由。
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成。
 * 中间件与路由的注册顺序与原文件完全一致（行为兼容硬性红线）。 */
'use strict';
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const { enableProxyFetch } = require('../lib/proxy');
const S = require('./state');

const MODS = {
    config: require('./config'),
    logger: require('./logger'),
    apiStats: require('./services/api-stats'),
    requestLog: require('./middleware/request-log'),
    headers: require('./middleware/headers'),
    firstRun: require('./middleware/first-run'),
    errorHandler: require('./middleware/error-handler'),
    geo: require('./services/geo'),
    mwSecurity: require('./middleware/security'),
    pow: require('./middleware/pow'),
    rateLimit: require('./middleware/rate-limit'),
    accounts: require('./services/accounts'),
    videos: require('./services/videos'),
    subtitles: require('./services/subtitles'),
    danmu: require('./services/danmu'),
    db: require('./services/db'),
    backup: require('./services/backup'),
    updateCheck: require('./services/update-check'),
    plugins: require('./services/plugins'),
    bannedRefresh: require('./services/banned-refresh'),
    init: require('./services/init'),
    rtAdmin: require('./routes/admin'),
    rtDeps: require('./routes/deps'),
    rtDanmu: require('./routes/danmu'),
    rtVideo: require('./routes/video'),
    rtAuth: require('./routes/auth'),
    rtFiles: require('./routes/files'),
    rtBanned: require('./routes/banned'),
    rtPublic: require('./routes/public'),
    rtSecurity: require('./routes/security'),
    rtDb: require('./routes/db'),
    rtBackup: require('./routes/backup'),
    rtSubtitle: require('./routes/subtitle'),
    rtPlugins: require('./routes/plugins'),
    rtUpdate: require('./routes/update'),
};

/* 定义顺序 = 原文件初始化依赖顺序（后面的模块可引用前面挂到 ctx 的名字） */
const DEFINE_ORDER = ['logger', 'config', 'apiStats', 'requestLog', 'headers', 'firstRun', 'pow', 'rateLimit', 'accounts', 'geo', 'mwSecurity', 'danmu', 'videos', 'rtAdmin', 'db', 'backup', 'subtitles', 'plugins', 'updateCheck', 'rtDeps', 'bannedRefresh', 'errorHandler', 'init'];
/* 路由挂载顺序 = 原 server.js 中路由注册出现顺序 */
const MOUNT_ORDER = ['pow', 'rtDanmu', 'rtVideo', 'rtAuth', 'rtAdmin', 'rtFiles', 'rtBanned', 'rtPublic', 'rtSecurity', 'rtDb', 'rtBackup', 'rtSubtitle', 'rtDeps', 'rtPlugins', 'rtUpdate'];

function createApp() {
    const app = express();
    const PORT = process.env.PORT || 1919;
    const ROOT_DIR = path.resolve(__dirname, '..'); /* = 原 server.js 的 __dirname（仓库根） */
    const ctx = { app, S, PORT, ROOT_DIR };

    if (enableProxyFetch()) {
        console.log('[代理] 已启用出站 HTTP 代理: ' + (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy));
    }

    /* ── 定义阶段：各模块向 ctx 挂载函数/常量 ── */
    for (const k of DEFINE_ORDER) { const m = MODS[k]; if (m && m.define) m.define(ctx); }

    /* ── 中间件栈（原 L177-241 顺序，不可调整） ── */
    app.use('/api/', ctx.apiControl);
    app.use(ctx.logRequest);
    app.use(express.json());
    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: false, frameguard: false }));
    app.use(ctx.advancedHeaders);
    app.use(ctx.securityMiddleware);
    app.use(ctx.powMiddleware);
    app.use(express.static(path.join(ROOT_DIR, 'public')));
    app.use(ctx.corsMiddleware);
    app.use('/api/admin', ctx.firstRunGuard);

    /* ── 健康检查（新增；供负载均衡 / 容器编排探活；不影响任何既有路由） ── */
    app.get('/healthz', (req, res) => {
        res.status(200).json({ code: 0, msg: 'ok', data: { uptimeSec: Math.floor((Date.now() - ctx.API_START_TIME) / 1000), pid: process.pid } });
    });

    /* ── 路由挂载（保持原注册顺序） ── */
    for (const k of MOUNT_ORDER) { const m = MODS[k]; if (m && m.mount) m.mount(ctx); }

    /* ── admin 入口兜底（原 server.js L3850 为末位注册；必须在全部路由之后挂载，
       避免 adminPath='/api' 时剥前缀吞掉后挂模块路由） ── */
    MODS.rtPublic.mountFallback(ctx);

    /* ── 全局错误处理（统一 JSON 兜底；必须最后挂载） ── */
    app.use(ctx.errorHandler);

    return { app, ctx };
}

module.exports = { createApp };
