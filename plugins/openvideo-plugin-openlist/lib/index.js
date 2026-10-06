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

        /* ── 整个文件夹扫描（含子目录）：后台注册全部视频，进度进顶栏任务列表 ── */
        const VEXT = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'ts', 'm3u8', 'wmv', 'mpg', 'mpeg'];
        const SCAN_CAP = 1000;     /* 单次扫描视频文件上限 */
        const TICK = 400;          /* 暂停等待的轮询切片 ms */
        const scan = { scanning: false, paused: false, stopRequested: false, taskId: 0, path: '', total: 0, done: 0, ok: 0, fail: 0, lastFile: '', lastSummary: '' };
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const isVideo = (n) => VEXT.some(x => String(n).toLowerCase().endsWith('.' + x));
        const shortName = (p) => String(p).split('/').pop() || p;

        const listDir = async (p) => {
            const data = await api('/api/fs/list', { path: p, page: 1, per_page: 0, refresh: false });
            return data.content || [];
        };
        /* 递归收集视频文件：文件在前、子目录深度优先，按名称排序，达上限即停 */
        const collect = async (p, out, seen) => {
            if (out.length >= SCAN_CAP || scan.stopRequested) return;
            const items = await listDir(p);
            const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'zh');
            const dirs = items.filter(x => x.is_dir).sort(byName);
            const files = items.filter(x => !x.is_dir && isVideo(x.name)).sort(byName);
            for (const f of files) {
                if (out.length >= SCAN_CAP) return;
                const fp = (p === '/' ? '' : p) + '/' + f.name;
                if (!seen.has(fp)) { seen.add(fp); out.push(fp); }
            }
            for (const d of dirs) {
                if (out.length >= SCAN_CAP || scan.stopRequested) return;
                await collect((p === '/' ? '' : p) + '/' + d.name, out, seen);
            }
        };
        const fileLink = async (p) => {
            const data = await api('/api/fs/get', { path: p });
            const { base } = cfg();
            const enc = p.split('/').map(x => encodeURIComponent(x)).join('/').replace(/^\/+/, '');
            const sign = data.sign || '';
            return base + '/d/' + enc + (sign ? '?sign=' + sign : '');
        };

        /* 宿主 writeRateLimit 已对本机回环自调用放行限速（trust proxy='loopback' 下外部不可伪造回环），
         * resolve 全速直发，不再做滑动窗口节流；这里只处理暂停/停止（旧版宿主若仍限速，429 重试退避兜底）。
         * 返回 'go' 或 'stop'；暂停期间挂起并把「⏸ 已暂停」写进任务详情 */
        const waitTurn = async () => {
            let pauseMarked = false;
            while (true) {
                if (scan.stopRequested) return 'stop';
                if (scan.paused) {
                    if (!pauseMarked) {
                        pauseMarked = true;
                        ctx.tasks.finish(scan.taskId, 'running', '⏸ 已暂停 · ' + scan.done + '/' + scan.total + ' · 成功 ' + scan.ok + ' · 失败 ' + scan.fail);
                        ctx.logger.info('openlist', '文件夹扫描已暂停: ' + scan.done + '/' + scan.total);
                    }
                    await sleep(TICK);
                    continue;
                }
                if (pauseMarked) { pauseMarked = false; ctx.logger.info('openlist', '文件夹扫描已继续'); }
                return 'go';
            }
        };

        const runScan = async (root) => {
            const t = ctx.tasks.add('plugin', 'OpenList 文件夹扫描', '正在收集文件清单…', 'openlist-scan-' + Date.now());
            scan.taskId = t.id;
            let manualStop = false;
            try {
                ctx.logger.info('openlist', '文件夹扫描开始: ' + root);
                const out = [], seen = new Set();
                await collect(root, out, seen);
                scan.total = out.length; scan.done = 0; scan.ok = 0; scan.fail = 0;
                if (!out.length) {
                    scan.lastSummary = '目录内未发现视频文件';
                    ctx.tasks.finish(t.id, 'done', scan.lastSummary);
                    ctx.logger.warn('openlist', '文件夹扫描: 未发现视频文件 (' + root + ')');
                    return;
                }
                const port = process.env.PORT || 1919;
                for (const fp of out) {
                    if (await waitTurn() === 'stop') { manualStop = true; break; }
                    scan.lastFile = shortName(fp);
                    ctx.tasks.finish(t.id, 'running', (scan.done + 1) + '/' + scan.total + ' · 成功 ' + scan.ok + ' · 失败 ' + scan.fail + ' · ' + scan.lastFile);
                    let ok = false, why = '';
                    for (let i = 0; i < 2 && !ok; i++) {   /* 失败重试一次（重试前重新等窗口；429 多退 5s） */
                        if (i > 0 && await waitTurn() === 'stop') { manualStop = true; break; }
                        try {
                            const link = await fileLink(fp);
                            const r = await ctx.http.get('http://127.0.0.1:' + port + '/api/video/resolve?url=' + encodeURIComponent(link), { timeout: 30000 });
                            const j = await r.json().catch(() => null);
                            if (j && j.code === 0 && j.data && j.data.vid) ok = true;
                            else why = (j && j.msg) || ('resolve code ' + (j && j.code));
                        } catch (e) { why = e.message; }
                        if (!ok && i === 0) await sleep(/429|频繁/.test(String(why)) ? 5000 : 3000);
                    }
                    if (manualStop) break;
                    if (ok) scan.ok++; else { scan.fail++; ctx.logger.warn('openlist', '注册失败: ' + fp + ' — ' + why); }
                    scan.done++;
                    ctx.tasks.finish(t.id, 'running', scan.done + '/' + scan.total + ' · 成功 ' + scan.ok + ' · 失败 ' + scan.fail + ' · ' + scan.lastFile);
                }
                if (manualStop) {
                    scan.lastSummary = '已手动停止：完成 ' + scan.done + '/' + scan.total + '，成功注册 ' + scan.ok + '，失败 ' + scan.fail;
                    ctx.tasks.finish(t.id, 'done', scan.lastSummary);
                    ctx.logger.info('openlist', '文件夹扫描被手动停止: ' + scan.lastSummary);
                } else {
                    const capped = scan.total >= SCAN_CAP;
                    scan.lastSummary = '完成：共 ' + scan.total + ' 个视频' + (capped ? '（达 ' + SCAN_CAP + ' 上限）' : '') + '，成功注册 ' + scan.ok + '，失败 ' + scan.fail;
                    ctx.tasks.finish(t.id, (scan.fail && !scan.ok) ? 'fail' : 'done', scan.lastSummary);
                    ctx.logger.info('openlist', '文件夹扫描结束: ' + scan.lastSummary);
                }
            } catch (e) {
                scan.lastSummary = '扫描出错: ' + (e.message || e);
                ctx.tasks.finish(t.id, 'fail', scan.lastSummary);
                ctx.logger.error('openlist', '文件夹扫描异常: ' + (e.message || e));
            } finally {
                scan.scanning = false; scan.paused = false; scan.stopRequested = false;
            }
        };

        /* 启动扫描：单并发守卫，立即返回后台执行（需管理员登录：header 或 dp_admin cookie） */
        const needAdmin = (req) => {
            if (!ctx.isAdmin || !ctx.isAdmin(req)) { const e = new Error('需要管理员登录'); e.status = 401; throw e; }
        };
        ctx.router.post('/api/plugin/openlist/scan', wrap(async (req, res) => {
            needAdmin(req);
            if (scan.scanning) { const e = new Error('已有文件夹扫描进行中，请稍候'); e.status = 409; throw e; }
            const p = String((req.body || {}).path || '/');
            const { base } = cfg();
            if (!base) { const e = new Error('未配置 OpenList 地址（请在插件设置中填写 baseUrl）'); e.status = 503; throw e; }
            scan.scanning = true; scan.paused = false; scan.stopRequested = false; scan.taskId = 0; scan.path = p; scan.total = 0; scan.done = 0; scan.ok = 0; scan.fail = 0; scan.lastFile = ''; scan.lastSummary = '';
            runScan(p).catch(() => {});
            res.json({ code: 0, data: { started: true, path: p } });
        }));

        /* 扫描状态（面板轮询，需管理员） */
        ctx.router.get('/api/plugin/openlist/scan/status', wrap(async (req, res) => {
            needAdmin(req);
            res.json({ code: 0, data: Object.assign({}, scan) });
        }));

        /* 暂停 / 继续 / 停止扫描（需管理员；400ms 轮询切片内生效） */
        ctx.router.post('/api/plugin/openlist/scan/control', wrap(async (req, res) => {
            needAdmin(req);
            if (!scan.scanning) { const e = new Error('当前没有进行中的扫描'); e.status = 409; throw e; }
            const act = String((req.body || {}).action || '');
            if (act === 'pause') scan.paused = true;
            else if (act === 'resume') scan.paused = false;
            else if (act === 'stop') scan.stopRequested = true;
            else { const e = new Error('action 必须是 pause / resume / stop'); e.status = 400; throw e; }
            ctx.logger.info('openlist', '文件夹扫描控制: ' + act);
            res.json({ code: 0, data: { action: act, paused: scan.paused, stopRequested: scan.stopRequested } });
        }));

        /* 管理面板：网盘文件浏览页（管理员鉴权） */
        ctx.pages.register({ route: '/plugin/openlist/panel', file: 'lib/client/panel.html', title: 'OpenList 文件浏览', auth: true });
    },
};
