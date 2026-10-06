/* 更新路由：版本检查 / 启动独立更新进程
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');

module.exports = {
    mount(ctx) {
        const { app, checkAdmin, checkVersionUpdate, safeErrMsg, detectDeploy, APP_VERSION, ROOT_DIR, PORT, addUpdateTask, finishUpdateTask } = ctx;

    /* ── 原 server.js L3765-3773 ── */
    app.get('/api/admin/update/check', checkAdmin, async (req, res) => {
        try {
            const force = req.query.force === '1';
            const data = await checkVersionUpdate(force);
            res.json({ code: 0, data });
        } catch (e) {
            res.status(500).json({ code: 1, msg: '检查更新失败: ' + safeErrMsg(e) });
        }
    });

    /* ── 原 server.js L3775-3776 ── */
    /* 执行更新：交由独立进程 update.js（备份 data/ → 更新代码 → 校验 → 依赖安装 → 重启）
       来源可选：git（git pull）/ npm（下载 npm 包覆盖）/ auto（按部署方式自动） */

    /* ── 原 server.js L3777-3805 ── */
    /* 重启服务：派生新进程后退出当前进程（无监管器环境下自重生） */
    app.post('/api/admin/restart', checkAdmin, async (req, res) => {
        if (detectDeploy() === 'docker') return res.json({ code: 1, msg: 'Docker 部署请在宿主机执行: docker compose restart' });
        const task = addUpdateTask('restart', '服务重启', '管理后台触发');
        res.json({ code: 0, msg: '重启指令已下发，服务将在 1 秒后重启（约 5-10 秒恢复）' });
        console.log('[重启] 管理后台触发服务重启');
        setTimeout(() => {
            try {
                let out = 'ignore';
                try { out = fs.openSync(path.join(process.cwd(), 'logs', 'server.log'), 'a'); } catch (e) {}
                const entry = path.relative(process.cwd(), require.main.filename) || 'server.js';
                const child = require('child_process').spawn(process.execPath, [entry], {
                    cwd: process.cwd(),
                    env: { ...process.env, PORT: String(PORT) },
                    detached: true,
                    stdio: ['ignore', out, out]
                });
                child.unref();
                finishUpdateTask(task.id, 'done', '新进程已派生 PID=' + child.pid);
                console.log('[重启] 新进程已派生 PID=' + child.pid + '，当前进程即将退出');
            } catch (e) {
                finishUpdateTask(task.id, 'failed', e.message);
                console.error('[重启] 派生失败，保持当前进程: ' + e.message);
                return;
            }
            setTimeout(() => process.exit(0), 400);
        }, 900);
    });

    app.post('/api/admin/update/run', checkAdmin, async (req, res) => {
        const { restart, source, force } = req.body || {};
        const deploy = detectDeploy();
        const info = await checkVersionUpdate(true).catch(() => null);
        /* force=true 允许「无新版本时强制重装当前版本」（修复损坏文件/追赶热修复） */
        if (info && !info.hasUpdate && !force) return res.json({ code: 1, msg: '当前已是最新版本', data: { current: APP_VERSION, latest: info.latest } });
        if (deploy === 'docker') {
            return res.json({ code: 1, msg: 'Docker 部署请在宿主机执行: docker pull yangyang8002/open-video-api:latest && docker compose up -d' });
        }
        if (!fs.existsSync(path.join(ROOT_DIR, 'update.js'))) {
            return res.json({ code: 1, msg: '未找到 update.js（独立更新进程），请检查安装完整性' });
        }
        if (deploy === 'source' && source !== 'npm') {
            return res.json({ code: 1, msg: '无法识别部署方式，请选择从 npm 更新或手动更新' });
        }
        /* 启动独立更新进程（不占用当前进程执行更新，避免文件句柄/状态问题） */
        const args = [path.join(ROOT_DIR, 'update.js'), '--source=' + (source === 'npm' || source === 'git' ? source : 'auto')];
        if (restart === false) args.push('--no-restart');
        if (force) args.push('--force');
        const child = require('child_process').spawn(process.execPath, args, {
            cwd: ROOT_DIR,
            env: { ...process.env, PORT: String(PORT) },
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        const task = addUpdateTask('update', '程序更新（' + (source === 'git' ? 'Git' : source === 'npm' ? 'npm' : '自动') + (force ? ' · 强制' : '') + '）', '备份 → 拉取 → 校验 → 安装依赖 → 重启');
        child.on('exit', (code) => finishUpdateTask(task.id, code === 0 ? 'done' : 'failed', '更新进程退出码 ' + code));
        console.log('[更新] 已启动独立更新进程 PID=' + child.pid + ' source=' + source + (force ? ' force=1' : ''));
        res.json({ code: 0, msg: '更新进程已启动（来源: ' + (source === 'git' ? 'Git' : source === 'npm' ? 'npm' : '自动') + '）后台执行：备份 → 拉取代码 → 清单校验 → 依赖安装 → ' + (restart === false ? '等待手动重启' : '自动重启') + '；日志见 data/update.log', data: { pid: child.pid, deploy, source, force: !!force } });
    });
    },
};
