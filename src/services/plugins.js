/* 插件服务：npm 源配置 / 开发热重载 / 优雅重启
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');
const { PLUGIN_DIR } = require('../../lib/plugin');

module.exports = {
    define(ctx) {
        const { readConfig, S, ROOT_DIR, PORT } = ctx;

    /* ── 原 server.js L3441-3441 ── */
    // ==================== 插件管理（npm 包 + 服务层 + 前端扩展） ====================

    /* ── 原 server.js L3443-3443 ── */
    /* 插件日志（调试工具数据源）：环形缓冲 */

    /* ── 原 server.js L3444-3444 ── */
    const pluginLogs = [];

    /* ── 原 server.js L3445-3448 ── */
    function pluginLogPush(level, scope, msg) {
        pluginLogs.push({ t: Date.now(), level, scope, msg: String(msg).slice(0, 500) });
        if (pluginLogs.length > 1000) pluginLogs.splice(0, pluginLogs.length - 1000);
    }

    /* ── 原 server.js L3461-3461 ── */
    /* npm 镜像源（更新 / 插件安装 / 依赖更新共用；环境变量 > config.plugin.npmRegistry > 官方源） */

    /* ── 原 server.js L3462-3465 ── */
    function getNpmRegistry() {
        const c = readConfig().plugin || {};
        return (process.env.OPENVIDEO_NPM_REGISTRY || c.npmRegistry || 'https://registry.npmjs.org').replace(/\/+$/, '');
    }

    /* ── 原 server.js L3466-3469 ── */
    function npmRegistryArg() {
        const reg = getNpmRegistry();
        return reg ? '--registry="' + reg + '"' : '';
    }

    /* ── 原 server.js L3471-3471 ── */
    const DEFAULT_PLUGIN_REGISTRY = 'https://raw.githubusercontent.com/yangyang8002/OpenVideoAPI/master/plugin-registry.json';

    /* ── 原 server.js L3472-3472 ── */
    /* 官方源镜像（国内直连友好），仅当配置为官方默认源时作为回退 */

    /* ── 原 server.js L3473-3475 ── */
    const PLUGIN_REGISTRY_MIRRORS = {
        'https://gitee.com/yangyang8002/Artplayer-Web-Api/raw/master/plugin-registry.json': 'Gitee'
    };

    /* ── 原 server.js L3476-3482 ── */
    function getPluginConfig() {
        const c = readConfig().plugin || {};
        return {
            registry: process.env.OPENVIDEO_PLUGIN_REGISTRY || c.registry || DEFAULT_PLUGIN_REGISTRY,
            npmRegistry: getNpmRegistry()
        };
    }

    /* ── 原 server.js L4023-4023 ── */
    /* 开发模式：监听本地插件目录，文件变更自动重载（OPENVIDEO_DEV=1 或 --dev） */

    /* ── 原 server.js L4024-4024 ── */
    const DEV_MODE = process.env.OPENVIDEO_DEV === '1' || process.argv.includes('--dev');

    /* ── 原 server.js L4026-4088 ── */
    function setupDevWatcher() {
        if (!DEV_MODE || !S.pluginManager) return;
        const pending = {};
        const reload = (pkg) => {
            if (!S.pluginManager.meta.has(pkg)) return;
            const meta = S.pluginManager.meta.get(pkg);
            if (meta.source.type !== 'local') return; /* 只热重载本地开发插件 */
            if (!meta.enabled) return;
            pluginLogPush('info', 'dev', '检测到文件变更，重载插件 ' + pkg);
            console.log('[dev] 重载插件: ' + pkg);
            S.pluginManager.setEnabled(pkg, false).then(() => S.pluginManager.setEnabled(pkg, true)).catch(() => {});
        };
        const schedule = (pkg) => {
            clearTimeout(pending[pkg]);
            pending[pkg] = setTimeout(() => { delete pending[pkg]; reload(pkg); }, 400);
        };
        const onChange = (ev, name) => {
            if (!name) return;
            const seg = String(name).split(/[\\/]/);
            const pkg = seg[0];
            if (!pkg || pkg === 'node_modules' || pkg.startsWith('.')) return;
            if (!/\.(js|json)$/i.test(String(name))) return;
            schedule(pkg);
        };
        /* 新目录出现时自动发现注册 */
        const scanNew = () => {
            try {
                S.pluginManager.discoverLocal();
            } catch (e) {}
        };
        try {
            if (!fs.existsSync(PLUGIN_DIR)) fs.mkdirSync(PLUGIN_DIR, { recursive: true });
            S.devWatcher = fs.watch(PLUGIN_DIR, { recursive: true }, (ev, name) => { scanNew(); onChange(ev, name); });
            console.log('[dev] 已启用插件热重载: ' + PLUGIN_DIR);
        } catch (e) {
            /* 递归监听不可用（部分 Linux）→ 降级为轮询 */
            console.log('[dev] 递归监听不可用，降级为 1s 轮询: ' + e.message);
            const scan = () => {
                try {
                    scanNew();
                    for (const d of fs.readdirSync(PLUGIN_DIR, { withFileTypes: true })) {
                        if (!d.isDirectory() || d.name === 'node_modules' || d.name.startsWith('.')) continue;
                        const dir = path.join(PLUGIN_DIR, d.name);
                        let newest = 0;
                        const walk = (p) => {
                            for (const e2 of fs.readdirSync(p, { withFileTypes: true })) {
                                const fp = path.join(p, e2.name);
                                if (e2.isDirectory()) walk(fp);
                                else if (/\.(js|json)$/i.test(e2.name)) { try { const st = fs.statSync(fp); if (st.mtimeMs > newest) newest = st.mtimeMs; } catch (x) {} }
                            }
                        };
                        walk(dir);
                        const key = d.name;
                        const prev = S.devWatchTimes[key] || 0;
                        if (prev && newest > prev + 500) schedule(key);
                        S.devWatchTimes[key] = newest;
                    }
                } catch (e2) {}
            };
            S.devWatchTimes = {};
            S.devWatcher = setInterval(scan, 1000);
        }
    }

    /* ── 原 server.js L4091-4106 ── */
    async function restartServer({ delay = 1500 } = {}) {
        if (S.restarting) throw new Error('已在重启中');
        S.restarting = true;
        if (S.pluginManager) S.pluginManager.emit('before:restart');
        console.log('[重启] ' + (delay / 1000) + 's 后重启服务...');
        await new Promise(r => setTimeout(r, delay));
        const child = require('child_process').spawn(process.execPath, ['server.js'], {
            cwd: ROOT_DIR,
            env: { ...process.env, OPENVIDEO_WAIT_PORT: String(PORT) },
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        console.log('[重启] 新进程已启动 PID=' + child.pid + '，当前进程退出');
        process.exit(0);
    }

        Object.assign(ctx, { pluginLogs, pluginLogs, pluginLogPush, pluginLogPush, getNpmRegistry, getNpmRegistry, npmRegistryArg, npmRegistryArg, DEFAULT_PLUGIN_REGISTRY, DEFAULT_PLUGIN_REGISTRY, PLUGIN_REGISTRY_MIRRORS, PLUGIN_REGISTRY_MIRRORS, getPluginConfig, getPluginConfig, DEV_MODE, DEV_MODE, setupDevWatcher, setupDevWatcher, restartServer, restartServer });
    },
};
