'use strict';
/* ==========================================================================
 * OpenVideoAPI 插件系统（v2 契约 —— 全部能力向后兼容 v1）
 *
 * 插件 = npm 包（或 plugins/ 下的本地包目录），包内 main 导出 apply(ctx, config)
 * （函数 / 类 / 带 apply 的对象）。包元数据位于 package.json 的 openvideoPlugin 字段：
 *
 *   {
 *     "openvideoPlugin": {
 *       "name": "demo",                          // 显示名（缺省取包名）
 *       "description": "...",                    // 展示用描述
 *       "inject": ["store", "app", "logger"],    // 依赖的服务（自动按依赖排序加载）
 *       "provide": ["stats"],                    // 本插件提供的服务名（ctx.provide 注册）
 *       "schema": [...],                         // 配置表单（同前版 schema 数组）
 *       "deps": {                                // v2 依赖声明（可选）
 *         "openvideo": ">=26.0.0",               //   主程序版本范围（semver 子集）
 *         "plugins": { "openvideo-plugin-otp": ">=1.0.0" }   // 其他插件依赖
 *       },
 *       "hooks": {                               // v2 生命周期钩子（可选；值为主模块导出名）
 *         "install": "onInstall", "enable": "onEnable", "disable": "onDisable",
 *         "uninstall": "onUninstall", "update": "onUpdate"
 *       },
 *       "client": {
 *         "admin":  { "styles": [...], "scripts": [...], "tabs": [{id,title}] },
 *         "player": { "styles": [...], "scripts": [...], "replaces": false },
 *         "login":  { "styles": [...], "scripts": [...] }   // 登录页扩展（无需登录，如 OTP 验证码输入）
 *       }
 *     }
 *   }
 *
 * ctx 能力（v1 全部保留；标 v2 为新增）：
 *   router         Express 路由（任意路径/方法/中间件；热重载后旧实例路由自动失效；
 *                  v2：路由级错误隔离 —— 同步/异步异常统一记录并回 500 JSON，不影响主进程）
 *   static(m,d,o)  v2：注册插件包内静态资源目录 app.use(m, express.static(pkg/d))
 *   pages          v2：自定义页面路由 ctx.pages.register({route,file,title,auth})
 *                  （auth:true 需管理员登录，未登录重定向到后台；GET /api/plugins/pages 公开列表）
 *   cron           v2：定时任务 ctx.cron.every(ms,fn) / ctx.cron.at(date,fn)，dispose 自动清理
 *   bus            v2：事件总线扩展 on/once/off/emit/emitTo/events（ctx.on/emit 保留）
 *   settings       v2：插件私有持久化设置 get/set/del/all（kv 存储，按插件命名空间隔离）
 *   logs           v2：分级日志 debug/info/warn/error（等价 inject logger，写入插件日志环形缓冲）
 *   i18n           v2：词条注入 add(locale,dict)/locales()/t(key,locale)；对外 GET /api/plugins/i18n
 *   model          动态表 ctx.model.define(name, schema)；v2：命名空间 ctx.model.namespace('ns')
 *   store/app      数据存储 / 服务控制（version/restart/getConfig/saveConfig/uptime）
 *   logger/http    分级日志 / fetch 封装（v2 增加 request 任意方法 + text）
 *   config/version 当前插件配置 / 服务端版本
 *   on/emit        事件总线（v2：on 返回取消函数）
 *   provide/service 服务注册与获取（插件间协作）
 *   plugin()       嵌套插件
 *
 * 事件类型：danmu:send / ready / before:restart / dispose（插件内部清理）/
 *   v2 新增：plugin:loaded / plugin:unloaded / video:created / video:saved / video:deleted /
 *   admin:login-ok / admin:login-fail / 插件自定义（含 emitTo 定向）
 *
 * 状态持久化：data/plugins.json；插件目录：plugins/（npm 包在 plugins/node_modules/）
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = process.env.OPENVIDEO_PLUGIN_DIR ? path.resolve(process.env.OPENVIDEO_PLUGIN_DIR) : path.join(ROOT, 'plugins');
const STATE_FILE = path.join(process.env.OPENVIDEO_DATA_DIR ? path.resolve(process.env.OPENVIDEO_DATA_DIR) : path.join(ROOT, 'data'), 'plugins.json');
const PKG_NAME_RE = /^(@[a-zA-Z0-9-]+\/)?[a-zA-Z0-9_-]+$/;
const CLIENT_ASSET_RE = /\.(js|css)$/;
const HOOK_TIMEOUT_MS = 15000;
const SETTINGS_KV_KEY = 'plugin_settings';
const PAGE_ROUTE_RE = /^\/[A-Za-z0-9_\-./]*$/;
const I18N_LOCALE_RE = /^[a-zA-Z-]{2,16}$/;

/* 内置服务名（插件不可覆写）—— v2 追加 static/pages/cron/bus/settings/logs/i18n */
const BUILTIN_SERVICES = ['store', 'model', 'app', 'logger', 'router', 'http', 'version', 'config', 'name', 'plugin', 'on', 'emit', 'provide', 'service',
    'static', 'pages', 'cron', 'bus', 'settings', 'logs', 'i18n'];

/* load() 阶段 inject 声明的合法内置 ctx 成员（其余必须由 provide 提供） */
const CTX_BUILTINS = ['store', 'model', 'app', 'logger', 'http', 'router', 'version', 'config', 'name', 'on', 'emit', 'provide', 'service', 'plugin',
    'static', 'pages', 'cron', 'bus', 'settings', 'logs', 'i18n'];

/* planLoadOrder 阶段无需查找提供者的内置服务名 */
const CTX_BUILTIN_SERVICES = ['store', 'model', 'app', 'logger', 'http', 'router', 'version',
    'static', 'pages', 'cron', 'bus', 'settings', 'logs', 'i18n'];

/* ==========================================================================
 * 轻量 semver 范围判定（无第三方依赖）
 * 支持：'' / '*' / 'x'（任意）；'||' 多选一；空格分隔 = AND；
 * 比较子：= 精确、> >= < <=、^、~、以及 x 范围（1.x、1.2.x）
 * ========================================================================== */
function parseVer(v) {
    const m = String(v || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/i);
    if (!m) return null;
    return [parseInt(m[1], 10), parseInt(m[2] || '0', 10), parseInt(m[3] || '0', 10)];
}
function cmp3(a, b) {
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; }
    return 0;
}
function testComp(ver, comp) {
    comp = String(comp || '').trim();
    if (comp === '' || comp === '*' || /^[xX]$/.test(comp)) return true;
    let op = '=';
    let body = comp;
    const mm = comp.match(/^(\^|~|>=|<=|>|<|=)?(.*)$/);
    if (mm && mm[1]) { op = mm[1]; body = mm[2].trim(); }
    const toks = body.split('.');
    const nums = [];
    let wildAt = -1;
    for (let i = 0; i < toks.length && i < 3; i++) {
        const t = toks[i].trim();
        if (t === '' || t === '*' || /^[xX]$/.test(t)) { wildAt = i; break; }
        const n = parseInt(t, 10);
        if (isNaN(n)) return false;
        nums.push(n);
    }
    const prec = wildAt >= 0 ? wildAt : nums.length;  /* 精确到第几位（0 = 任意） */
    const ref = [nums[0] || 0, nums[1] || 0, nums[2] || 0];
    if (prec === 0) return true;
    if (op === '=' || op === '^' || op === '~') {
        for (let i = 0; i < prec; i++) if (ver[i] !== ref[i]) return false;
        if (op === '=' || prec >= 3) return true;
        if (op === '^') return cmp3(ver, [ref[0] + 1, 0, 0]) < 0;   /* ^1.x → >=1.0.0 <2.0.0 */
        return cmp3(ver, [ref[0], ref[1] + 1, 0]) < 0;              /* ~1.2.x → >=1.2.0 <1.3.0 */
    }
    const c = cmp3(ver, ref);
    if (op === '>=') return c >= 0;
    if (op === '<=') return c <= 0;
    if (op === '>') return c > 0;
    if (op === '<') return c < 0;
    return false;
}
function satisfies(version, range) {
    const v = parseVer(version);
    if (!v) return false;
    const rangeStr = String(range || '').trim();
    if (rangeStr === '' || rangeStr === '*' || rangeStr === 'x' || rangeStr === 'latest') return true;
    for (const alt of rangeStr.split(/\s*\|\|\s*/)) {
        if (!alt.trim()) continue;
        let ok = true;
        for (const comp of alt.trim().split(/\s+/)) {
            if (!testComp(v, comp)) { ok = false; break; }
        }
        if (ok) return true;
    }
    return false;
}

class PluginManager {
    constructor({ app, store, model, readConfig, saveConfig, restartServer, log, version, npmRegistry, pluginLog, isAdmin }) {
        this.app = app;
        this.store = store;
        this.model = model;
        this.readConfig = readConfig || (() => ({}));
        this.saveConfig = saveConfig || (async () => {});
        this.restartServer = restartServer || (async () => { throw new Error('重启服务不可用'); });
        this.npmRegistry = npmRegistry || (() => '');
        this.log = log || ((m) => console.log('[插件] ' + m));
        this.version = version || '';
        /* v2：插件日志直写环形缓冲 / 管理员判定（自定义页面 auth 用） */
        this.pluginLog = pluginLog || ((level, scope, msg) => this.log('[' + scope + '] ' + msg));
        this.isAdmin = isAdmin || (() => false);
        this.meta = new Map();      /* name -> {enabled, config, source, installedAt, status, error, info} */
        this.instances = new Map(); /* name -> {ctx, disposeFns, dispose}（dispose 执行实例级清理） */
        this.loading = new Set();
        this.events = new Map();    /* event -> Set<{name, fn}> */
        this.services = new Map();  /* serviceName -> instance（内置 + 插件提供） */
        this.pages = [];            /* v2：已注册自定义页面 [{plugin, route, file, title, auth}] */
        this.i18n = new Map();      /* v2：pluginName -> Map(locale -> dict) */
        this._enabling = new Set(); /* v2：递归启用依赖的环保护 */
        /* 内置服务：app/logger 由外部注入（init.js 通过 _injectServices 填充） */
        this.services.set('store', store);
        this.services.set('model', model);
        this.services.set('app', null);
        this.services.set('logger', null);
    }

    /* init.js 在创建后注入 app/logger 服务实例 */
    _injectServices(services) {
        for (const [k, v] of Object.entries(services || {})) this.services.set(k, v);
    }

    /* ---------- 状态持久化 ---------- */
    loadState() {
        try {
            const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            if (d && typeof d === 'object') {
                for (const [name, v] of Object.entries(d)) {
                    this.meta.set(name, {
                        enabled: !!v.enabled,
                        config: v.config || {},
                        source: v.source || { type: 'local', name, version: '' },
                        installedAt: v.installedAt || Date.now(),
                        status: 'stopped',
                        error: '',
                        info: v.info || null
                    });
                }
            }
        } catch (e) {}
        if (!fs.existsSync(PLUGIN_DIR)) fs.mkdirSync(PLUGIN_DIR, { recursive: true });
        /* 自动发现本地插件包（plugins/ 下带 openvideoPlugin 或 main 的目录，未注册则加入为停用状态） */
        this.discoverLocal();
    }
    /* 扫描 plugins/ 下的本地插件包并自动注册（开发环境：新建插件目录即可被识别） */
    discoverLocal() {
        let added = 0;
        try {
            for (const d of fs.readdirSync(PLUGIN_DIR, { withFileTypes: true })) {
                if (!d.isDirectory() || d.name === 'node_modules' || d.name.startsWith('.')) continue;
                if (this.meta.has(d.name)) continue;
                const pkgFile = path.join(PLUGIN_DIR, d.name, 'package.json');
                if (!fs.existsSync(pkgFile)) continue;
                try {
                    const pj = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
                    if (!pj.openvideoPlugin && !pj.main) continue;
                    this.meta.set(d.name, {
                        enabled: false,
                        config: {},
                        source: { type: 'local', name: d.name, version: pj.version || '' },
                        installedAt: Date.now(),
                        status: 'stopped',
                        error: '',
                        info: null
                    });
                    added++;
                    this.log('自动发现本地插件: ' + d.name + (pj.version ? '@' + pj.version : ''));
                } catch (e) {}
            }
        } catch (e) {}
        if (added) this.saveState();
        return added;
    }
    saveState() {
        const out = {};
        for (const [name, m] of this.meta) {
            out[name] = { enabled: m.enabled, config: m.config, source: m.source, installedAt: m.installedAt };
        }
        try {
            fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
            fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 2));
        } catch (e) { this.log('状态保存失败: ' + e.message); }
    }

    /* ---------- 包解析 ---------- */
    pkgDirOf(meta) {
        if (meta.source.type === 'npm') return path.join(PLUGIN_DIR, 'node_modules', meta.source.pkg);
        return path.join(PLUGIN_DIR, meta.source.name);
    }
    readPkg(meta) {
        const dir = this.pkgDirOf(meta);
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        const manifest = (pj && pj.openvideoPlugin && typeof pj.openvideoPlugin === 'object') ? pj.openvideoPlugin : {};
        return {
            dir,
            name: manifest.name || pj.name,
            version: pj.version || '',
            description: manifest.description || pj.description || '',
            author: (typeof pj.author === 'object' ? pj.author.name : pj.author) || '',
            homepage: pj.homepage || '',
            main: pj.main || 'index.js',
            manifest,
            pkg: pj
        };
    }
    _manifestOf(meta) {
        if (meta && meta.info && meta.info.manifest) return meta.info.manifest;
        try { return this.readPkg(meta).manifest; } catch (e) { return {}; }
    }
    _readVersion(meta) {
        if (meta && meta.info && meta.info.package && meta.info.package.version) return meta.info.package.version;
        try { return this.readPkg(meta).version; } catch (e) { return ''; }
    }

    /* ---------- 事件总线 ---------- */
    _on(name, event, fn) {
        if (event === 'dispose') return;
        if (!this.events.has(event)) this.events.set(event, new Set());
        const h = { name, fn };
        this.events.get(event).add(h);
        return () => this.events.get(event).delete(h);
    }
    emit(event, ...args) {
        const set = this.events.get(event);
        if (!set) return;
        for (const h of Array.from(set)) {
            try { h.fn.apply(null, args); } catch (e) { this.log('[' + h.name + '] 事件 ' + event + ' 处理异常: ' + (e.message || e)); }
        }
    }
    /* v2：定向事件 —— 只投递给指定插件的处理函数（插件间通信） */
    _emitTo(targetName, event, args) {
        const set = this.events.get(event);
        if (!set) return false;
        let delivered = false;
        for (const h of Array.from(set)) {
            if (h.name !== targetName) continue;
            delivered = true;
            try { h.fn.apply(null, args); } catch (e) { this.log('[' + h.name + '] 定向事件 ' + event + ' 处理异常: ' + (e.message || e)); }
        }
        return delivered;
    }
    /* v2：按 name + fn 引用精确移除单个监听 */
    _off(name, event, fn) {
        const set = this.events.get(event);
        if (!set) return;
        for (const h of Array.from(set)) if (h.name === name && h.fn === fn) set.delete(h);
    }
    _clearEvents(name) {
        for (const [ev, set] of this.events) {
            for (const h of set) if (h.name === name) set.delete(h);
        }
    }

    /* ---------- v2：路由级错误隔离 ---------- */
    /* 从中间件参数中识别 res（带 setHeader+end 的对象）与 next（函数），尽力回 500 JSON；
     * 已发送响应则断开连接；无法识别时把错误交给 next 不让它穿透为未捕获异常。 */
    _routeError(name, e, inner) {
        const msg = String((e && e.message) || e).slice(0, 300);
        this.log('[' + name + '] 路由异常: ' + msg);
        try { this.pluginLog('error', name, '路由异常: ' + msg); } catch (x) {}
        let res = null, next = null;
        for (const a of inner) {
            if (a && typeof a === 'object' && typeof a.setHeader === 'function' && typeof a.end === 'function') res = a;
            else if (typeof a === 'function') next = a;
        }
        try {
            if (res) {
                if (res.headersSent) { if (typeof res.destroy === 'function') res.destroy(); return; }
                const st = (e && (e.status || e.statusCode)) || 500;
                return res.status(st >= 400 && st < 600 ? st : 500).json({ code: 1, msg: '插件路由异常: ' + msg });
            }
            if (typeof next === 'function') return next(e);
        } catch (x) {}
    }

    /* ---------- 插件上下文 ---------- */
    makeCtx(name, meta, info, config, instRef) {
        const self = this;
        const disposeFns = [];   /* ctx.on('dispose', fn) 注册的清理回调 */
        const ownOffs = [];      /* v2：本实例注册的事件取消函数（dispose 精确撤销，不误伤同名的其他实例） */
        const i18nRollback = []; /* v2：本实例注入的 i18n 词条回滚记录 */

        /* v2：路由/中间件包裹器 —— 热重载失效守卫 + 同步异常捕获 + Promise 拒绝捕获 */
        const wrapHandler = (fn) => function (...inner) {
            if (self.instances.get(name) !== instRef.current) {
                const nxt = inner[inner.length - 1];
                if (typeof nxt === 'function') return nxt();
                return;
            }
            let r;
            try { r = fn.apply(this, inner); }
            catch (e) { return self._routeError(name, e, inner); }
            if (r && typeof r.then === 'function' && typeof r.catch === 'function') {
                r.then(null, (e) => self._routeError(name, e, inner));
            }
            return r;
        };

        /* 路由代理：v2 起包裹所有函数参数（含数组中间件），支持 get/post/put/delete/patch/all/use */
        const routerProxy = new Proxy(this.app, {
            get(target, prop) {
                if (['get', 'post', 'put', 'delete', 'patch', 'all', 'use'].includes(prop)) {
                    return (...args) => {
                        for (let i = 0; i < args.length; i++) {
                            const a = args[i];
                            if (typeof a === 'function') args[i] = wrapHandler(a);
                            else if (Array.isArray(a)) args[i] = a.map(f => (typeof f === 'function' ? wrapHandler(f) : f));
                        }
                        return target[prop](...args);
                    };
                }
                const v = target[prop];
                return typeof v === 'function' ? v.bind(target) : v;
            }
        });

        const http = {
            async get(url, opts) {
                return fetch(url, { signal: AbortSignal.timeout((opts && opts.timeout) || 15000), ...(opts || {}) });
            },
            async post(url, body, opts) {
                return fetch(url, {
                    method: 'POST',
                    signal: AbortSignal.timeout((opts && opts.timeout) || 15000),
                    headers: { 'Content-Type': 'application/json' },
                    body: typeof body === 'string' ? body : JSON.stringify(body || {}),
                    ...(opts || {})
                });
            },
            async json(url, opts) {
                const r = await this.get(url, opts);
                return r.ok ? r.json() : null;
            },
            /* v2：任意方法请求（对象 body 自动 JSON + Content-Type） */
            async request(url, opts) {
                const o = { ...(opts || {}) };
                const method = String(o.method || 'GET').toUpperCase();
                let body = o.body;
                if (body != null && typeof body === 'object' && typeof body.pipe !== 'function' && !ArrayBuffer.isView(body)) {
                    body = JSON.stringify(body);
                    o.headers = { 'Content-Type': 'application/json', ...(o.headers || {}) };
                }
                return fetch(url, { method, signal: AbortSignal.timeout(o.timeout || 15000), ...o, body });
            },
            /* v2：取文本（非 2xx 返回 null） */
            async text(url, opts) {
                const r = await this.get(url, opts);
                return r.ok ? r.text() : null;
            }
        };

        /* v2：插件私有持久化设置（kv: plugin_settings，按插件名隔离） */
        const settings = {
            async get(key, def) {
                const all = await self._settingsAll();
                const mine = all[name] || {};
                return (key in mine) ? mine[key] : def;
            },
            async set(key, value) {
                const raw = JSON.stringify(value);
                if (raw.length > 100 * 1024) throw new Error('单个设置值过大（>100KB）');
                const all = await self._settingsAll();
                const mine = all[name] || (all[name] = {});
                if (!(key in mine) && Object.keys(mine).length >= 200) throw new Error('设置项过多（>200）');
                mine[key] = value;
                await self.store.kvSet(SETTINGS_KV_KEY, all);
                return value;
            },
            async del(key) {
                const all = await self._settingsAll();
                if (all[name]) {
                    delete all[name][key];
                    await self.store.kvSet(SETTINGS_KV_KEY, all);
                }
                return true;
            },
            async all() {
                const all = await self._settingsAll();
                return { ...(all[name] || {}) };
            }
        };

        /* v2：定时任务（dispose 自动清理；fn 的同步/异步异常都只记日志） */
        const runSafe = (fn, label) => {
            try {
                const r = fn();
                if (r && typeof r.catch === 'function') r.catch(e => self.log('[' + name + '] ' + label + '异常: ' + ((e && e.message) || e)));
            } catch (e) { self.log('[' + name + '] ' + label + '异常: ' + ((e && e.message) || e)); }
        };
        const cron = {
            every(ms, fn) {
                if (typeof fn !== 'function') throw new Error('cron.every 需要函数参数');
                const interval = parseInt(ms, 10);
                if (!(interval > 0)) throw new Error('无效的定时间隔: ' + ms);
                const t = setInterval(() => runSafe(fn, '定时任务'), Math.max(500, interval));
                const cancel = () => clearInterval(t);
                disposeFns.push(cancel);
                return cancel;
            },
            at(when, fn) {
                if (typeof fn !== 'function') throw new Error('cron.at 需要函数参数');
                const ts = (when instanceof Date) ? when.getTime() : parseInt(when, 10);
                if (!(ts > 0)) throw new Error('无效的定时时间: ' + when);
                const t = setTimeout(() => runSafe(fn, '一次性定时任务'), Math.max(0, ts - Date.now()));
                const cancel = () => clearTimeout(t);
                disposeFns.push(cancel);
                return cancel;
            }
        };

        /* v2：自定义页面路由（auth 页面未登录重定向到后台登录） */
        const pages = {
            register({ route, file, title, auth } = {}) {
                const rt = String(route || '');
                if (!PAGE_ROUTE_RE.test(rt) || rt.includes('..')) throw new Error('非法页面路由: ' + route);
                if (/^\/api(\/|$)/.test(rt)) throw new Error('页面路由不允许 /api/ 前缀: ' + route);
                const rel = String(file || '').replace(/^\/+/, '');
                const full = path.resolve(info.dir, rel);
                if (full !== info.dir && !full.startsWith(info.dir + path.sep)) throw new Error('页面文件必须在插件包内: ' + file);
                if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('页面文件不存在: ' + file);
                const entry = { plugin: name, route: rt, file: rel, title: String(title || name), auth: !!auth };
                self.pages.push(entry);
                self.app.get(rt, wrapHandler((req, res) => {
                    if (entry.auth && !self.isAdmin(req)) return res.redirect(self._adminBase());
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.sendFile(full);
                }));
                const cancel = () => {
                    const i = self.pages.indexOf(entry);
                    if (i >= 0) self.pages.splice(i, 1);
                };
                disposeFns.push(cancel);
                return entry;
            }
        };

        /* v2：插件包内静态资源目录注册 */
        const mountStatic = (mountPath, dir, opts) => {
            const mp = String(mountPath || '');
            if (!PAGE_ROUTE_RE.test(mp) || mp.includes('..')) throw new Error('非法挂载路径: ' + mountPath);
            const abs = path.resolve(info.dir, String(dir).replace(/^\/+/, ''));
            if (abs !== info.dir && !abs.startsWith(info.dir + path.sep)) throw new Error('静态目录必须在插件包内: ' + dir);
            if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error('静态目录不存在: ' + dir);
            const mw = express.static(abs, { fallthrough: true, ...(opts || {}) });
            self.app.use(mp, wrapHandler((req, res, next) => mw(req, res, next)));
            return mp;
        };

        /* v2：分级日志（写入插件日志环形缓冲，可在后台调试工具查看） */
        const logs = {
            debug: (msg, detail) => self.pluginLog('debug', name, String(msg) + (detail != null ? ' ' + String(detail) : '')),
            info: (msg, detail) => self.pluginLog('info', name, String(msg) + (detail != null ? ' ' + String(detail) : '')),
            warn: (msg, detail) => self.pluginLog('warn', name, String(msg) + (detail != null ? ' ' + String(detail) : '')),
            error: (msg, detail) => self.pluginLog('error', name, String(msg) + (detail != null ? ' ' + String(detail) : ''))
        };

        /* v2：i18n 词条注入（dispose 时精确回滚本实例注入的词条） */
        const i18n = {
            add(locale, dict) {
                const loc = String(locale || '').trim();
                if (!I18N_LOCALE_RE.test(loc)) throw new Error('非法语言代码: ' + locale);
                if (!dict || typeof dict !== 'object' || Array.isArray(dict)) throw new Error('i18n 词条必须是对象');
                let mine = self.i18n.get(name);
                if (!mine) { mine = new Map(); self.i18n.set(name, mine); }
                const cur = mine.get(loc) || {};
                const before = {};
                for (const k of Object.keys(dict)) before[k] = (k in cur) ? cur[k] : undefined;
                mine.set(loc, Object.assign({}, cur, dict));
                i18nRollback.push(() => {
                    const m = self.i18n.get(name);
                    if (!m) return;
                    const d = m.get(loc) || {};
                    for (const [k, v] of Object.entries(before)) {
                        if (v === undefined) delete d[k];
                        else d[k] = v;
                    }
                    if (Object.keys(d).length === 0) m.delete(loc);
                    if (m.size === 0) self.i18n.delete(name);
                });
                return Object.keys(dict).length;
            },
            locales() {
                const mine = self.i18n.get(name);
                return mine ? Array.from(mine.keys()) : [];
            },
            t(key, locale) {
                const mine = self.i18n.get(name);
                if (!mine) return String(key == null ? '' : key);
                const d = mine.get(locale || self._lang()) || mine.get('zh') || {};
                return (key in d) ? d[key] : String(key == null ? '' : key);
            }
        };

        const ctx = {
            name,
            config,
            version: self.version,
            router: routerProxy,
            store: self.store,
            model: self.model,
            http,
            log: (msg) => self.log('[' + name + '] ' + msg),
            /* v2：on() 返回取消函数（v1 返回 fn 本身；官方插件均未使用其返回值） */
            on(ev, fn) {
                if (ev === 'dispose' && typeof fn === 'function') {
                    disposeFns.push(fn);
                    return () => { const i = disposeFns.indexOf(fn); if (i >= 0) disposeFns.splice(i, 1); };
                }
                const off = self._on(name, ev, fn);
                ownOffs.push(off);
                return off;
            },
            emit: (ev, ...args) => self.emit(ev, ...args),
            provide(serviceName, instance) {
                if (BUILTIN_SERVICES.includes(serviceName)) throw new Error('服务名 ' + serviceName + ' 为内置保留');
                self.services.set(serviceName, instance);
            },
            service(serviceName) {
                return self.services.get(serviceName) || null;
            },
            plugin(plugin, pluginConfig) {
                if (typeof plugin === 'function') {
                    if (/^class\s/.test(Function.prototype.toString.call(plugin))) new plugin(ctx, pluginConfig || {});
                    else plugin(ctx, pluginConfig || {});
                } else if (plugin && typeof plugin.apply === 'function') {
                    plugin.apply(ctx, pluginConfig || {});
                }
                return true;
            },
            /* ---------- v2 新增能力 ---------- */
            static: mountStatic,
            pages,
            cron,
            settings,
            logs,
            i18n
        };
        /* v2：事件总线扩展（on/once/off/emit/emitTo/events） */
        ctx.bus = {
            on: (ev, fn) => ctx.on(ev, fn),
            once(ev, fn) {
                if (typeof fn !== 'function') throw new Error('bus.once 需要函数参数');
                let off = null;
                off = self._on(name, ev, (...args) => {
                    if (off) off();
                    try { fn(...args); } catch (e) { self.log('[' + name + '] 事件 ' + ev + ' 处理异常: ' + (e.message || e)); }
                });
                ownOffs.push(off);
                return off;
            },
            off: (ev, fn) => self._off(name, ev, fn),
            emit: (ev, ...args) => self.emit(ev, ...args),
            emitTo: (target, ev, ...args) => self._emitTo(target, ev, args),
            events: () => Array.from(self.events.keys())
        };

        /* 把声明依赖（inject）的服务直接挂到 ctx 上：ctx.app / ctx.logger / ctx.stats ...
         * （v2：static/pages/cron/bus/settings/logs/i18n 声明后保留内置实现） */
        const inject = (info.manifest && Array.isArray(info.manifest.inject)) ? info.manifest.inject : [];
        for (const svc of inject) {
            if (svc in ctx) continue;
            if (self.services.has(svc)) ctx[svc] = self.services.get(svc);
        }
        return { ctx, disposeFns, dispose() {
            /* v2：精确撤销本实例注册的事件 / 清理回调 / i18n 词条（不误伤同名插件的其他实例，
             * 生命周期钩子的临时 ctx 也走这里，不会清掉运行中实例的状态） */
            for (const off of ownOffs) { try { off(); } catch (e) {} }
            for (const fn of disposeFns) { try { fn(); } catch (e) {} }
            for (const rb of i18nRollback) { try { rb(); } catch (e) {} }
        } };
    }

    /* ---------- 模块解析 ---------- */
    _resolvePlugin(mod) {
        if (!mod) return null;
        if (mod.default && (typeof mod.default === 'function' || (mod.default && typeof mod.default.apply === 'function'))) return mod.default;
        if (typeof mod === 'function' || (mod && typeof mod.apply === 'function')) return mod;
        return null;
    }

    /* ---------- 依赖解析：inject 服务 → 提供者插件 + v2 插件依赖，按拓扑序加载 ---------- */
    /* 返回 { order: [names], errors: [msg] } */
    planLoadOrder(names) {
        const providerOf = new Map();  /* serviceName -> pluginName */
        const providedBy = new Map();  /* pluginName -> [serviceName] */
        for (const [pname, pmeta] of this.meta) {
            if (!names.includes(pname)) continue;
            let manifest = (pmeta.info && pmeta.info.manifest) || {};
            if (!manifest.provide) {
                try { manifest = this.readPkg(pmeta).manifest; } catch (e) {}
            }
            const provides = Array.isArray(manifest.provide) ? manifest.provide : [];
            providedBy.set(pname, provides);
            for (const svc of provides) providerOf.set(svc, pname);
        }
        const order = [];
        const visited = new Set();
        const errors = [];
        const visit = (pname, stack) => {
            if (visited.has(pname)) return;
            if (stack.includes(pname)) { errors.push('循环依赖: ' + [...stack, pname].join(' → ')); return; }
            visited.add(pname);
            const m = this.meta.get(pname);
            let manifest = (m.info && m.info.manifest) || {};
            if (!manifest.inject) { try { manifest = this.readPkg(m).manifest; } catch (e) {} }
            const inject = Array.isArray(manifest.inject) ? manifest.inject : [];
            for (const svc of inject) {
                if (CTX_BUILTIN_SERVICES.includes(svc)) continue; /* 内置 */
                const provider = providerOf.get(svc);
                if (!provider) { errors.push('服务 ' + svc + ' 无提供者（' + pname + ' 依赖）'); continue; }
                visit(provider, [...stack, pname]);
            }
            /* v2：deps.plugins 插件依赖也纳入拓扑序（依赖者先加载） */
            const depCfg = (manifest.deps && manifest.deps.plugins && typeof manifest.deps.plugins === 'object') ? manifest.deps.plugins : {};
            for (const depName of Object.keys(depCfg)) {
                if (!this.meta.has(depName)) { errors.push('插件 ' + pname + ' 依赖 ' + depName + ' 未安装'); continue; }
                if (names.includes(depName)) visit(depName, [...stack, pname]);
            }
            order.push(pname);
        };
        for (const n of names) visit(n, []);
        return { order, errors };
    }

    /* ---------- 加载 / 卸载 ---------- */
    async load(name) {
        const meta = this.meta.get(name);
        if (!meta) throw new Error('插件不存在: ' + name);
        if (this.instances.has(name)) await this.unload(name);
        if (this.loading.has(name)) return;
        this.loading.add(name);
        meta.status = 'loading';
        meta.error = '';
        const instRef = { current: null };
        try {
            const info = this.readPkg(meta);
            const abs = path.join(info.dir, info.main);
            if (!fs.existsSync(abs)) throw new Error('插件入口不存在: ' + info.main);
            /* v2：主程序版本约束（manifest.deps.openvideo，semver 范围） */
            const dc = (info.manifest.deps && info.manifest.deps.openvideo) || null;
            if (dc && !satisfies(this.version, dc)) {
                throw new Error('主程序版本不满足: 需要 ' + dc + '，当前 ' + this.version);
            }
            delete require.cache[require.resolve(abs)];
            const mod = require(abs);
            const plugin = this._resolvePlugin(mod);
            if (!plugin) throw new Error('插件导出无效（需要函数/类/带 apply 的对象）');
            /* 依赖检查（内置 ctx 成员与已注册服务均可满足） */
            for (const svc of info.manifest.inject || []) {
                if (CTX_BUILTINS.includes(svc)) continue;
                if (!this.services.has(svc)) throw new Error('依赖服务不可用: ' + svc);
            }
            meta.info = {
                package: { name: info.name, version: info.version, description: info.description, author: info.author, homepage: info.homepage, pkgName: meta.source.pkg || meta.source.name },
                manifest: info.manifest,
                main: info.main
            };
            /* 保留 makeCtx 完整返回（含 dispose）——卸载时执行实例级清理（页面注销/事件取消/定时器/词条回滚） */
            const inst = this.makeCtx(name, meta, info, meta.config, instRef);
            const ctx = inst.ctx;
            instRef.current = inst;
            let r;
            if (typeof plugin === 'function') {
                if (/^class\s/.test(Function.prototype.toString.call(plugin))) r = new plugin(ctx, meta.config);
                else r = plugin(ctx, meta.config);
            } else if (plugin && typeof plugin.apply === 'function') {
                r = plugin.apply(ctx, meta.config);
            }
            /* v2：异步 apply 的失败也记录为插件错误（不产生未处理拒绝） */
            if (r && typeof r.then === 'function' && typeof r.catch === 'function') {
                r.catch(e => {
                    meta.status = 'error';
                    meta.error = String((e && e.message) || e).slice(0, 300);
                    this.log('[' + name + '] apply 异步失败: ' + meta.error);
                    try { this.pluginLog('error', name, 'apply 失败: ' + meta.error); } catch (x) {}
                    this.saveState();
                });
            }
            this.instances.set(name, inst);
            meta.status = 'running';
            this.log('已加载: ' + name + '@' + info.version);
            this.emit('plugin:loaded', { name, version: info.version });
        } catch (e) {
            meta.status = 'error';
            meta.error = String((e && e.message) || e).slice(0, 300);
            this.log('加载失败: ' + name + ' -> ' + meta.error);
        } finally {
            this.loading.delete(name);
        }
        this.saveState();
    }

    async unload(name) {
        const inst = this.instances.get(name);
        if (inst) {
            try { inst.dispose(); } catch (e) {}
            this._clearEvents(name);
            this.instances.delete(name);
        }
        const meta = this.meta.get(name);
        if (meta) { meta.status = 'stopped'; meta.error = ''; }
        this.log('已卸载: ' + name);
        this.emit('plugin:unloaded', { name });
    }

    /* ---------- 启动：按依赖拓扑序加载全部已启用插件，随后广播 ready ---------- */
    async loadEnabled() {
        const enabled = Array.from(this.meta.entries()).filter(([, m]) => m.enabled).map(([n]) => n);
        const { order, errors } = this.planLoadOrder(enabled);
        for (const e of errors) this.log('依赖警告: ' + e);
        for (const name of order) await this.load(name);
        /* 未进入拓扑序的（无依赖）直接加载 */
        for (const name of enabled) if (!order.includes(name)) await this.load(name);
        this.emit('ready');
    }

    /* ---------- v2：生命周期钩子（install/enable/disable/uninstall/update） ----------
     * 钩子 = 主模块的具名导出（manifest.hooks[生命周期] 指定导出名，或导出 hooks 字典）。
     * 使用临时 ctx 执行（钩子里注册的路由/事件随钩子结束自动失效），15s 超时保护，
     * 任何失败只记日志与插件日志，绝不中断管理操作。 */
    async _runHook(name, lifecycle) {
        const meta = this.meta.get(name);
        if (!meta) return { ok: false, msg: '插件不存在' };
        let fn = null, info = null;
        try {
            info = this.readPkg(meta);
            const abs = path.join(info.dir, info.main);
            if (!fs.existsSync(abs)) return { ok: false, msg: '入口不存在' };
            delete require.cache[require.resolve(abs)];
            const mod = require(abs);
            const hookMap = (info.manifest && info.manifest.hooks && typeof info.manifest.hooks === 'object') ? info.manifest.hooks : {};
            const exportName = hookMap[lifecycle];
            if (typeof exportName === 'string' && mod && typeof mod[exportName] === 'function') fn = mod[exportName];
            else if (mod && mod.hooks && typeof mod.hooks[lifecycle] === 'function') fn = mod.hooks[lifecycle];
        } catch (e) {
            return { ok: false, msg: String((e && e.message) || e).slice(0, 200) };
        }
        if (!fn) return { ok: false, msg: '钩子未声明' };
        const instRef = { current: null };
        let hookInst = null;
        try {
            hookInst = this.makeCtx(name, meta, info, meta.config, instRef);
            instRef.current = { ctx: hookInst.ctx, disposeFns: hookInst.disposeFns };
            const p = (async () => fn(hookInst.ctx, meta.config))();
            p.catch(() => {});
            let timer = null;
            const timeoutP = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('钩子超时（' + HOOK_TIMEOUT_MS + 'ms）')), HOOK_TIMEOUT_MS); });
            try {
                await Promise.race([p, timeoutP]);
            } finally {
                if (timer) clearTimeout(timer);
            }
            this.log('[' + name + '] 生命周期钩子 ' + lifecycle + ' 完成');
            return { ok: true, msg: '' };
        } catch (e) {
            const msg = String((e && e.message) || e).slice(0, 300);
            this.log('[' + name + '] 生命周期钩子 ' + lifecycle + ' 失败: ' + msg);
            try { this.pluginLog('error', name, '钩子 ' + lifecycle + ' 失败: ' + msg); } catch (x) {}
            return { ok: false, msg };
        } finally {
            if (hookInst) { try { hookInst.dispose(); } catch (e) {} }
        }
    }

    /* ---------- 安装（仅支持 npm 包） ---------- */
    async install({ pkg, version }) {
        const pkgName = pkg || '';
        if (!PKG_NAME_RE.test(pkgName)) throw new Error('无效的 npm 包名');
        const spec = version ? pkgName + '@' + version : pkgName;
        const baseName = pkgName.replace(/^.*\//, '');
        if (this.meta.has(baseName)) throw new Error('插件已存在: ' + baseName);
        if (!fs.existsSync(PLUGIN_DIR)) fs.mkdirSync(PLUGIN_DIR, { recursive: true });
        const regArg = this.npmRegistry() ? '--registry="' + this.npmRegistry() + '"' : '';
        try {
            execSync('npm install --prefix "' + PLUGIN_DIR + '" "' + spec + '" --no-audit --no-fund ' + regArg, { stdio: 'pipe', timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
        } catch (e) {
            throw new Error('npm 安装失败: ' + String((e && (e.stdout || e.message)) || e).slice(-300));
        }
        /* 校验包结构：main 入口存在 */
        const dir = path.join(PLUGIN_DIR, 'node_modules', pkgName);
        let pj;
        try { pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch (e) { throw new Error('包内缺少 package.json'); }
        const main = pj.main || 'index.js';
        if (!fs.existsSync(path.join(dir, main))) throw new Error('包入口不存在: ' + main);
        this.meta.set(baseName, {
            enabled: false,
            config: {},
            source: { type: 'npm', pkg: pkgName, version: pj.version || version || '' },
            installedAt: Date.now(),
            status: 'stopped',
            error: '',
            info: null
        });
        this.saveState();
        await this._runHook(baseName, 'install');
        return baseName;
    }

    /* ---------- 卸载 ---------- */
    async uninstall(name) {
        const meta = this.meta.get(name);
        if (!meta) throw new Error('插件不存在: ' + name);
        if (meta.enabled) await this.setEnabled(name, false);
        await this._runHook(name, 'uninstall');
        if (meta.source.type === 'npm') {
            try {
                execSync('npm uninstall --prefix "' + PLUGIN_DIR + '" "' + (meta.source.pkg || name) + '" --no-audit --no-fund ' + (this.npmRegistry() ? '--registry="' + this.npmRegistry() + '"' : ''), { stdio: 'pipe', timeout: 120000 });
            } catch (e) {}
        }
        this.meta.delete(name);
        /* v2：清理该插件在 kv plugin_settings 中的私有设置，避免卸载后残留 */
        try {
            const all = await this._settingsAll();
            if (all[name]) { delete all[name]; await this.store.kvSet(SETTINGS_KV_KEY, all); }
        } catch (e2) {}
        this.saveState();
        this.log('已卸载: ' + name + (meta.source.type === 'local' ? '（本地包保留在目录，可删除 plugins/' + name + ' 彻底移除）' : ''));
    }

    /* ---------- 更新（保留配置与启用状态） ---------- */
    async update(name) {
        const meta = this.meta.get(name);
        if (!meta) throw new Error('插件不存在: ' + name);
        /* v2 热更新：npm 与本地来源均可更新——本地包按插件名安装官方 npm 包并切换为 npm 来源（配置与启用状态保留） */
        const isNpm = meta.source.type === 'npm';
        const pkgName = isNpm ? (meta.source.pkg || name) : name;
        if (!PKG_NAME_RE.test(pkgName)) throw new Error('无效的 npm 包名: ' + pkgName);
        const enabled = meta.enabled, config = meta.config;
        if (enabled) await this.unload(name);
        try {
            execSync('npm install --prefix "' + PLUGIN_DIR + '" "' + pkgName + '@latest" --no-audit --no-fund ' + (this.npmRegistry() ? '--registry="' + this.npmRegistry() + '"' : ''), { stdio: 'pipe', timeout: 300000 });
        } catch (e) {
            throw new Error('npm 更新失败: ' + String((e && (e.stdout || e.message)) || e).slice(-300));
        }
        if (!isNpm) {
            /* 本地 → npm 来源切换（读取新包版本号；本地目录保留在 plugins/，不再加载） */
            let ver = '';
            try { ver = (JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'node_modules', pkgName, 'package.json'), 'utf8')) || {}).version || ''; } catch (e) {}
            meta.source = { type: 'npm', pkg: pkgName, version: ver };
            this.log('插件 ' + name + ' 已切换为 npm 包来源（本地目录保留在 plugins/' + name + '，可手动删除）');
        }
        meta.enabled = enabled;
        meta.config = config;
        meta.info = null;
        await this._runHook(name, 'update');
        if (enabled) await this.load(name);
        this.saveState();
        this.log('已更新: ' + name);
    }

    /* ---------- 启停 / 配置 ---------- */
    async setEnabled(name, enabled) {
        const meta = this.meta.get(name);
        if (!meta) throw new Error('插件不存在: ' + name);
        if (enabled) {
            if (this._enabling.has(name)) return;   /* 依赖环保护 */
            this._enabling.add(name);
            try {
                /* v2：插件依赖（manifest.deps.plugins）—— 未安装报错；版本不满足报错；
                 * 依赖未启用则递归启用（自动连带拉起依赖链） */
                const depCfg = (this._manifestOf(meta).deps || {});
                const plugins = (depCfg.plugins && typeof depCfg.plugins === 'object') ? depCfg.plugins : {};
                for (const [depName, range] of Object.entries(plugins)) {
                    const dm = this.meta.get(depName);
                    if (!dm) throw new Error('依赖插件未安装: ' + depName + (range ? '（需要 ' + range + '）' : ''));
                    if (range && !satisfies(this._readVersion(dm), range)) {
                        throw new Error('依赖插件版本不满足: ' + depName + ' 需要 ' + range + '，当前 ' + (this._readVersion(dm) || '未知'));
                    }
                    if (!dm.enabled) {
                        this.log('自动启用依赖插件: ' + depName);
                        await this.setEnabled(depName, true);
                    }
                }
                /* 自动启用依赖提供者（按拓扑序）—— v1 行为保留 */
                const { order, errors } = this.planLoadOrder([name]);
                for (const dep of order) {
                    if (dep !== name) {
                        const dm = this.meta.get(dep);
                        if (dm && !dm.enabled) { dm.enabled = true; await this.load(dep); }
                    }
                }
                for (const e of errors) this.log('依赖警告: ' + e);
            } finally {
                this._enabling.delete(name);
            }
        }
        meta.enabled = !!enabled;
        if (enabled) {
            await this.load(name);
            this.saveState();
            await this._runHook(name, 'enable');
        } else {
            await this._runHook(name, 'disable');
            await this.unload(name);
            this.saveState();
        }
    }
    async setConfig(name, config) {
        const meta = this.meta.get(name);
        if (!meta) throw new Error('插件不存在: ' + name);
        meta.config = (config && typeof config === 'object') ? config : {};
        this.saveState();
        if (meta.enabled) await this.load(name);
    }

    /* ---------- 存储切换后重建上下文绑定 ---------- */
    rebindStore(store, model) {
        this.store = store;
        this.model = model;
        this.services.set('store', store);
        this.services.set('model', model);
        for (const inst of this.instances.values()) {
            inst.ctx.store = store;
            inst.ctx.model = model;
        }
        if (model && typeof model.rebind === 'function') model.rebind(store);
    }

    /* ---------- v2：设置存储 / 页面与 i18n 查询 ---------- */
    async _settingsAll() {
        try {
            const v = await this.store.kvGet(SETTINGS_KV_KEY);
            return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
        } catch (e) { return {}; }
    }
    pagesList() {
        return this.pages.map(p => ({ plugin: p.plugin, route: p.route, title: p.title, auth: p.auth }));
    }
    /* 合并全部（或指定）插件在某语言下的词条；后注册覆盖同名 key */
    /* i18n 过滤名解析：精确包名优先，其次 manifest 短名（如 demo；meta.info 可能缺失，回退读包） */
    _resolveI18nPlugin(name) {
        if (!name) return null;
        if (this.i18n.has(name)) return name;
        for (const [pname] of this.i18n) {
            const m = this.meta.get(pname);
            if (!m) continue;
            let short = (m.info && m.info.name) || '';
            if (!short) { try { short = this.readPkg(m).name; } catch (err) {} }
            if (short === name) return pname;
        }
        return name;
    }
    mergedI18n(locale, pluginName) {
        const out = {};
        const loc = String(locale || 'zh');
        const want = this._resolveI18nPlugin(pluginName);
        for (const [pname, locMap] of this.i18n) {
            if (want && pname !== want) continue;
            const d = locMap.get(loc);
            if (d) Object.assign(out, d);
        }
        return out;
    }
    i18nManifest() {
        const out = [];
        for (const [pname, locMap] of this.i18n) {
            let terms = 0;
            for (const d of locMap.values()) terms += Object.keys(d).length;
            out.push({ plugin: pname, locales: Array.from(locMap.keys()), terms });
        }
        return out;
    }
    _adminBase() {
        try {
            const c = this.readConfig() || {};
            const ap = (c.security && c.security.adminPath) ? String(c.security.adminPath).replace(/^\/+|\/+$/g, '') : '';
            return ap ? '/' + ap : '/admin';
        } catch (e) { return '/admin'; }
    }
    _lang() {
        try { return (this.readConfig() || {}).language || 'zh'; } catch (e) { return 'zh'; }
    }

    /* ---------- 客户端扩展清单 ---------- */
    /* scope: 'admin' | 'player' | 'login'；返回插件的前端资源列表（路径已按插件命名空间化） */
    clientManifest(scope) {
        const out = [];
        for (const [name, meta] of this.meta) {
            if (meta.status !== 'running' && !meta.enabled) continue;
            const info = meta.info;
            if (!info || !info.manifest) continue;
            const client = (info.manifest.client && info.manifest.client[scope]) || null;
            if (!client) continue;
            const base = '/api/plugins/client/' + scope + '/' + encodeURIComponent(meta.source.pkg || name);
            const styles = (client.styles || []).map(s => base + '/' + encodeURIComponent(String(s)));
            const scripts = (client.scripts || []).map(s => base + '/' + encodeURIComponent(String(s)));
            const tabs = (scope === 'admin' && Array.isArray(client.tabs)) ? client.tabs.slice(0, 20) : [];
            out.push({
                name,
                version: info.package.version,
                title: info.manifest.name || name,
                styles,
                scripts,
                tabs: tabs.map(t => ({ id: String(t.id).slice(0, 48), title: String(t.title || t.id).slice(0, 60) })),
                replaces: !!client.replaces
            });
        }
        return out;
    }

    /* 解析客户端资源文件路径（防目录穿越） */
    resolveClientAsset(pkgName, relPath) {
        if (!CLIENT_ASSET_RE.test(relPath)) throw new Error('仅允许 js/css 资源');
        const meta = this.meta.get(pkgName.replace(/^.*\//, '')) || this.meta.get(pkgName);
        if (!meta) throw new Error('插件未安装: ' + pkgName);
        const dir = this.pkgDirOf(meta);
        const full = path.resolve(dir, String(relPath).replace(/^\/+/, ''));
        if (full !== dir && !full.startsWith(dir + path.sep)) throw new Error('非法路径');
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('资源不存在');
        return full;
    }

    /* ---------- 列表 ---------- */
    list() {
        return Array.from(this.meta.entries()).map(([name, m]) => ({
            name,
            enabled: m.enabled,
            status: m.status,
            error: m.error,
            config: m.config,
            source: m.source,
            installedAt: m.installedAt,
            info: m.info
        }));
    }
}

module.exports = { PluginManager, PLUGIN_DIR, satisfies };
