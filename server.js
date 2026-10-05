#!/usr/bin/env node
/* OpenVideoAPI 服务入口（薄入口）。
 * 原 4100+ 行单文件已拆分：src/ = 应用工厂/中间件/路由/服务；lib/ = 存储/插件/代理等基础设施（名字与职责不变）。
 * 本文件只负责：构建应用 → 初始化存储 → 监听 → 优雅关停；package.json 的 bin 仍指向本文件。 */
'use strict';
const { createApp } = require('./src/app');

/* 未处理的 Promise 拒绝仅记录，不崩溃进程（防个别请求异常导致整体 DoS） */
process.on('unhandledRejection', (err) => {
    console.error('[unhandledRejection]', err && err.message ? err.message : err);
});

const { app, ctx } = createApp();
const S = ctx.S;
const PORT = ctx.PORT;
const { initStore, scheduleUpdate, readConfig, setupDevWatcher, saveApiStats, saveIpStats } = ctx;

function onServerReady() {
    const config = readConfig();
    console.log(`OpenVideoAPI服务已启动: http://localhost:${PORT}`);
    console.log(`播放器地址: http://localhost:${PORT}/player/?url=视频地址`);
    console.log(`管理后台: http://localhost:${PORT}/admin/`);
    console.log(`默认登录账号: admin / admin123`);
    if (config.pow && config.pow.enabled) console.log(`[防火墙] PoW 工作量证明已启用 (难度: ${config.pow.difficulty})`);
    if (config.rateLimit && config.rateLimit.enabled) console.log(`[防火墙] 速率限制已启用 (${config.rateLimit.max}次/${config.rateLimit.windowMs / 1000}s)`);
    setupDevWatcher();
}

/* ── 监听（原 L4108-4133；捕获 server 实例供优雅关停使用） ── */
let server = null;
initStore().then(() => {
    /* 等待端口释放模式（插件/更新触发的重启）：等旧进程让出端口后再监听 */
    const waitPort = process.env.OPENVIDEO_WAIT_PORT;
    if (waitPort) {
        const tryListen = () => {
            const srv = server = app.listen(PORT, () => {
                console.log(`OpenVideoAPI服务已启动: http://localhost:${PORT} (wait-port 重启)`);
                onServerReady();
                scheduleUpdate();
            });
            srv.on('error', (e) => {
                if (e.code === 'EADDRINUSE') { setTimeout(tryListen, 1000); }
                else { console.error('[启动] 监听失败:', e.message); process.exit(1); }
            });
        };
        tryListen();
    } else {
        server = app.listen(PORT, () => {
            onServerReady();
            scheduleUpdate();
        });
    }
}).catch(e => {
    console.error('[数据库] 存储初始化失败，服务启动中止:', e.message);
    process.exit(1);
});

/* ── 优雅关停（SIGTERM/SIGINT）：停止接新连接 → 存量请求 → 统计落盘 → 存储关闭 → 退出 ── */
let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) process.exit(0); /* 第二次信号：立即退出 */
    shuttingDown = true;
    console.log('[关停] 收到 ' + signal + '，停止接收新连接...');
    const closed = new Promise((resolve) => { if (!server) return resolve(); server.close(resolve); });
    const hardStop = new Promise((resolve) => setTimeout(resolve, 10000)); /* 存量请求最多等待 10s */
    await Promise.race([closed, hardStop]);
    try { if (typeof saveApiStats === 'function') saveApiStats(); } catch (e) { console.error('[关停] API统计落盘失败:', (e && e.message ? e.message : e)); }
    try { if (typeof saveIpStats === 'function') saveIpStats(); } catch (e) { console.error('[关停] IP统计落盘失败:', (e && e.message ? e.message : e)); }
    try { if (S.store && typeof S.store.close === 'function') await S.store.close(); } catch (e) { console.error('[关停] 存储关闭失败:', (e && e.message ? e.message : e)); }
    console.log('[关停] 完成，进程退出');
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
