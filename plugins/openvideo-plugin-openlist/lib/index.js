'use strict';
/* OpenList 网盘接入插件：服务端代理 /api/fs/list 与 /api/fs/get（避免浏览器跨域与令牌泄露），
 * 面板浏览网盘目录树；「注册到库」走主项目 /api/video/resolve（联动内封字幕自动扫描）；
 * 「复制播放链接」生成 /player/?url=<OpenList /d/ 链接> 直达播放页 */

module.exports = {
    apply(ctx, config) {
        const wrap = (fn) => async (req, res) => {
            try { await fn(req, res); }
            catch (e) {
                const status = e.status || 500;
                res.status(status).json({ code: status === 500 ? 1 : status, msg: e.message || '操作失败' });
            }
        };
        const cfg = () => ({
            base: String((config && config.baseUrl) || '').replace(/\/+$/, ''),
            token: String((config && config.token) || '')
        });
        /* OpenList API 调用：code!==200 视为失败（AList 系约定） */
        const api = async (p, body) => {
            const { base, token } = cfg();
            if (!base) { const e = new Error('未配置 OpenList 地址（请在插件设置中填写 baseUrl）'); e.status = 503; throw e; }
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers.Authorization = token;
            const r = await ctx.http.post(base + p, body, { headers, timeout: 20000 });
            const j = await r.json().catch(() => null);
            if (!j) throw new Error('OpenList 响应解析失败');
            if (j.code !== 200) throw new Error('OpenList: ' + (j.message || ('code ' + j.code)));
            return j.data;
        };

        /* 配置状态（面板判断可用性） */
        ctx.router.get('/api/plugin/openlist/status', wrap(async (req, res) => {
            const { base } = cfg();
            res.json({ code: 0, data: { configured: !!base, base } });
        }));

        /* 列目录：POST /api/fs/list（per_page:0 = 全量），目录在前按名称排序 */
        ctx.router.post('/api/plugin/openlist/list', wrap(async (req, res) => {
            const p = String((req.body || {}).path || '/');
            const data = await api('/api/fs/list', { path: p, page: 1, per_page: 0, refresh: false });
            const dirs = [], files = [];
            for (const it of (data.content || [])) {
                (it.is_dir ? dirs : files).push({ name: it.name, size: it.is_dir ? 0 : (it.size || 0) });
            }
            const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh');
            dirs.sort(byName); files.sort(byName);
            res.json({ code: 0, data: { path: p, dirs, files } });
        }));

        /* 取文件链接：POST /api/fs/get → /d/<path>?sign=（主项目 resolve-link 原生支持该形态） */
        ctx.router.post('/api/plugin/openlist/link', wrap(async (req, res) => {
            const p = String((req.body || {}).path || '');
            if (!p || p === '/') { const e = new Error('缺少 path'); e.status = 400; throw e; }
            const data = await api('/api/fs/get', { path: p });
            const sign = data.sign || '';
            const { base } = cfg();
            const enc = p.split('/').map(x => encodeURIComponent(x)).join('/').replace(/^\/+/, '');
            const link = base + '/d/' + enc + (sign ? '?sign=' + sign : '');
            res.json({ code: 0, data: { name: data.name || '', size: data.size || 0, link } });
        }));

        /* 管理面板：网盘文件浏览页（管理员鉴权） */
        ctx.pages.register({ route: '/plugin/openlist/panel', file: 'lib/client/panel.html', title: 'OpenList 文件浏览', auth: true });
    },
};
