/* 版本检测（GitHub/npm/update.xml 三源）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const path = require('path');
const fs = require('fs');

module.exports = {
    define(ctx) {
        const { ROOT_DIR, readConfig, S, APP_VERSION } = ctx;

    /* ── 原 server.js L3670-3670 ── */
    // ==================== 版本检测与更新 ====================

    /* ── 原 server.js L3673-3681 ── */
    function cmpVer(a, b) {
        const pa = String(a || '').replace(/^v/i, '').split('.').map(n => parseInt(n) || 0);
        const pb = String(b || '').replace(/^v/i, '').split('.').map(n => parseInt(n) || 0);
        for (let i = 0; i < 3; i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x > y ? 1 : -1;
        }
        return 0;
    }

    /* ── 原 server.js L3683-3683 ── */
    /* 检测部署方式：docker / npm 全局 / git 源码 / 普通源码 */

    /* ── 原 server.js L3684-3692 ── */
    function detectDeploy() {
        if (fs.existsSync('/.dockerenv')) return 'docker';
        try {
            const globalRoot = require('child_process').execSync('npm root -g', { encoding: 'utf8' }).trim();
            if (globalRoot && ROOT_DIR.startsWith(globalRoot)) return 'npm-global';
        } catch (e) {}
        if (fs.existsSync(path.join(ROOT_DIR, '.git'))) return 'git-source';
        return 'source';
    }

    /* ── 原 server.js L3694-3694 ── */
    /* 更新源配置（可配置化，改名/自建镜像站无需改代码） */

    /* ── 原 server.js L3695-3700 ── */
    function getUpdateConfig() {
        const c = readConfig().update || {};
        const repo = process.env.OPENVIDEO_UPDATE_REPO || c.repo || 'yangyang8002/OpenVideoAPI';
        const npmPkg = process.env.OPENVIDEO_NPM_PKG || c.npmPkg || 'open-video-api';
        return { repo, npmPkg };
    }

    /* ── 原 server.js L3702-3763 ── */
    async function checkVersionUpdate(force) {
        const now = Date.now();
        if (!force && S.updateCheckCache && now - S.updateCheckCache.at < 3600000) return S.updateCheckCache.data;
        const { repo, npmPkg } = getUpdateConfig();
        const result = {
            checkedAt: now,
            current: APP_VERSION,
            deploy: detectDeploy(),
            sources: {},
            hasUpdate: false,
            latest: null,
            releaseNotes: ''
        };
        /* GitHub 最新 Release */
        try {
            const r = await fetch('https://api.github.com/repos/' + repo + '/releases/latest', { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'OpenVideoAPI' } });
            if (r.ok) {
                const d = await r.json();
                result.sources.github = { tag: d.tag_name || '', published: d.published_at || '', url: d.html_url || '', body: (d.body || '').slice(0, 2000) };
            }
        } catch (e) {}
        /* npm 最新版本 */
        try {
            const r2 = await fetch('https://registry.npmjs.org/' + encodeURIComponent(npmPkg) + '/latest', { signal: AbortSignal.timeout(12000) });
            if (r2.ok) {
                const d2 = await r2.json();
                result.sources.npm = { version: d2.version || '' };
            }
        } catch (e) {}
        /* 远程 update.xml：版本清单 + 变更文件列表 */
        try {
            const r3 = await fetch('https://raw.githubusercontent.com/' + repo + '/master/update.xml', { signal: AbortSignal.timeout(12000) });
            if (r3.ok) {
                const txt = await r3.text();
                const ver = (txt.match(/<version>([^<]+)<\/version>/) || [])[1] || '';
                const msg = (txt.match(/<message>([\s\S]*?)<\/message>/) || [])[1] || '';
                const re = /<file\s+path="([^"]+)"\s+sha256="[^"]+"(?:\s+size="\d+")?\/>/g;
                let m, files = [];
                while ((m = re.exec(txt))) files.push(m[1]);
                result.sources.manifest = { version: ver, message: msg.trim(), files };
            }
        } catch (e) {}
        /* 取最高版本作为最新（manifest 优先于 github/npm 作为发布源） */
        let latest = null, srcName = '';
        const cands = [];
        if (result.sources.manifest && result.sources.manifest.version) cands.push(['manifest', result.sources.manifest.version.replace(/^v/i, '')]);
        if (result.sources.github && result.sources.github.tag) cands.push(['github', result.sources.github.tag.replace(/^v/i, '')]);
        if (result.sources.npm && result.sources.npm.version) cands.push(['npm', result.sources.npm.version]);
        for (const [name, ver] of cands) {
            if (!latest || cmpVer(ver, latest) > 0) { latest = ver; srcName = name; }
        }
        if (latest && cmpVer(latest, APP_VERSION) > 0) {
            result.hasUpdate = true;
            result.latest = latest;
            result.latestSource = srcName;
            result.releaseNotes = (result.sources.manifest && result.sources.manifest.message) || (result.sources.github ? result.sources.github.body || '' : '');
            result.releaseUrl = result.sources.github ? result.sources.github.url : 'https://github.com/' + repo + '/releases';
            result.changedFiles = (result.sources.manifest && result.sources.manifest.files) || [];
        }
        S.updateCheckCache = { at: now, data: result };
        return result;
    }

        Object.assign(ctx, { cmpVer, cmpVer, detectDeploy, detectDeploy, getUpdateConfig, getUpdateConfig, checkVersionUpdate, checkVersionUpdate });
    },
};
