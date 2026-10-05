# OpenVideoAPI 插件契约（v2）

> 适用版本：OpenVideoAPI **26.10.0+**（插件子系统重构版）。
> 设计原则：**完全向后兼容**——v1 契约的所有字段、方法、事件、前端注入点原样保留；v2 全部为 **additive（只增不改不删）**。
> 参考实现：`lib/plugin.js`（PluginManager）、`lib/model.js`（PluginModel）、`src/services/plugins.js`（装配）、`src/routes/plugins.js`（HTTP 端点）、`plugins/openvideo-plugin-demo` 1.1.0（全能力演示）。

---

## 1. 插件包结构

插件是一个 npm 包，`package.json` 携带 `openvideoPlugin` 清单：

```json
{
  "name": "openvideo-plugin-xxx",
  "version": "1.0.0",
  "main": "lib/index.js",
  "openvideoPlugin": {
    "name": "xxx",
    "description": "示例插件",
    "inject": ["store", "model", "logger"],
    "provide": ["stats"],
    "deps": { "openvideo": ">=26.0.0", "plugins": { "openvideo-plugin-otp": "^1.0.0" } },
    "hooks": { "install": "onInstall", "enable": "onEnable", "disable": "onDisable", "uninstall": "onUninstall", "update": "onUpdate" },
    "schema": [ { "key": "enabled", "type": "boolean", "default": true } ],
    "client": {
      "admin":  { "scripts": ["lib/client/admin/ui.js"], "styles": ["lib/client/admin/ui.css"], "tabs": [ { "id": "xxx-tab", "title": "示例" } ] },
      "player": { "scripts": ["lib/client/player/overlay.js"] },
      "login":  { "scripts": ["lib/client/login/otp.js"] }
    }
  }
}
```

- **入口**：`main` 指向的模块导出插件本体——`module.exports = apply`（函数）、带 `apply` 方法的对象、或 class（自动实例化）。`apply(ctx, config)` 同步或异步（返回 Promise 亦可）。
- **inject**：声明需要注入到 `ctx` 的服务名（内置服务或其它插件 `provide` 的服务），加载前校验，缺失则加载失败。
- **provide**：声明本插件对外提供的服务名（调用 `ctx.provide(name, instance)` 后其它插件可 `ctx.service(name)` 获取）。不可占用内置服务名：`store model app logger router http version config name plugin on emit provide service static pages cron bus settings logs i18n`。
- **deps**（v2 新增）：
  - `deps.openvideo`：主程序版本范围（semver：`>=26.0.0`、`^26.0`、`1.x`、`*`、`||` 多选、空格 AND）。不满足时加载抛 `主程序版本不满足: 需要 X，当前 Y`。
  - `deps.plugins`：`{ 插件名: 版本范围 }`。启用时逐项校验：未安装 → `依赖插件未安装: X（需要 R）`；版本不满足 → `依赖插件版本不满足: X 需要 R，当前 V`；依赖存在但未启用 → 自动递归启用。
- **hooks**（v2 新增）：声明生命周期钩子（值为**主模块导出的函数名**；也可直接在导出对象上挂 `hooks` 子对象）。
- **schema**：自动生成后台设置表单（渲染端在 `public/admin.html`，插件无需自己写表单）。`{ key, type: boolean|number|string, default, title? }`。
- **client**：前端注入声明，见 §6。

## 2. 生命周期

| 阶段 | 时机 | 说明 |
|---|---|---|
| **load** | 启用时 | 校验 deps → 注入服务 → `apply(ctx, config)`。成功后 `status:'running'`，广播 `plugin:loaded {name,version}`；同步抛错或 Promise 拒绝 → `status:'error'`，错误入 `meta.error` 与插件日志，**不影响其它插件与主进程** |
| **unload** | 停用时 | 执行实例 dispose 链（事件取消、cron、静态挂载、页面注销、i18n 回滚、用户 dispose 回调）→ `status:'stopped'`，广播 `plugin:unloaded {name}` |
| **install** | npm 安装完成后 | 运行 `hooks.install` |
| **enable** | load 成功并保存状态后 | 运行 `hooks.enable` |
| **disable** | unload 之前 | 运行 `hooks.disable` |
| **uninstall** | 停用之后、npm 卸载之前 | 运行 `hooks.uninstall`；随后管理器**整段删除**该插件在 `plugin_settings`（kv）中的设置 |
| **update** | npm 更新安装后、重新 load 前 | 运行 `hooks.update` |

钩子执行规则（`_runHook`）：
- 每次钩子**重新 require** 插件模块（拿到最新代码）。
- 钩子函数收到一个**一次性 ctx**（与正式 ctx 同构）；钩子期间注册的路由/事件/资源随钩子结束自动失效，绝不残留。
- 同步/异步异常与 **15 秒超时**（`Promise.race`）都只记日志、返回 `{ok,msg}`，**绝不中断管理操作**。

## 3. ctx 完整参考

### 3.1 v1 字段（全部保留）

| 成员 | 说明 |
|---|---|
| `ctx.name` | 插件名 |
| `ctx.config` | 当前配置（meta.config 原样传入，不做 schema 默认值合并，与 v1 一致） |
| `ctx.version` | 主程序版本 |
| `ctx.router` | Express 路由代理（`get/post/put/delete/patch/all/use`，见 §5 错误隔离） |
| `ctx.store` / `ctx.model` | 存储访问 / 模型层（`model.define(tableName,{primary,fields})` 动态建表） |
| `ctx.http` | HTTP 客户端（见 3.2） |
| `ctx.log(msg)` | 简易日志 |
| `ctx.on(ev,fn)` | 事件订阅；**v2 起返回取消函数**（v1 返回原 fn，官方插件未依赖该返回值）；`'dispose'` 事件注册卸载回调 |
| `ctx.emit(ev,...args)` | 广播事件 |
| `ctx.provide(name,inst)` | 注册服务 |
| `ctx.service(name)` | 取服务（内置或其它插件提供），无则 `null` |
| `ctx.plugin(fnOrClass, cfg)` | 嵌套加载子插件 |
| inject 声明的服务 | 如 `inject:["app","logger"]` → `ctx.app`、`ctx.logger` |

内置可注入服务：`app`（version/platform/pid/uptime()/getConfig()/saveConfig(patch)/restart(opts)）、`logger`（debug/info/warn/error(scope,msg)/log(level,scope,msg)/tail(n)）、`store`、`model`、`http`、`router`、`version`。

### 3.2 v2 新增

#### ctx.http（在 v1 get/post/json 基础上扩展）
```js
await ctx.http.get(url, opts)          // 返回原始 Response（不自动解析 JSON，需 JSON 用 ctx.http.json()）；默认超时 15s
await ctx.http.post(url, body, opts)   // JSON POST
await ctx.http.json(url, opts)         // 同 get
await ctx.http.text(url, opts)         // 2xx→原始文本，否则 null
await ctx.http.request(url, { method, headers, body, timeout }) // 完整控制；body 为对象时自动 JSON.stringify + Content-Type
```

#### ctx.static(mountPath, dir, opts) — 静态资源目录
```js
ctx.static('/plugins/xxx-assets', 'lib/client/assets');
```
- `mountPath` 须匹配 `^/[A-Za-z0-9_\-./]*$`（禁 `..`）；`dir` 必须位于插件包内且存在（防目录穿越）。
- 内部 `express.static(abs, { fallthrough: true, ...opts })` 挂载；dispose 自动卸载。

#### ctx.pages.register({ route, file, title, auth }) — 自定义页面路由
```js
ctx.pages.register({ route: '/plugin/xxx/hello', file: 'lib/client/page.html', title: 'Hello', auth: false });
ctx.pages.register({ route: '/plugin/xxx/secure', file: 'lib/client/secure.html', title: 'Secure', auth: true });
```
- `route` 规则同上且**不得以 `/api/` 开头**；`file` 必须在插件包内且存在。
- 服务端以 `text/html; no-cache` `sendFile`。
- `auth:true` 时未通过管理员鉴权 → **302 重定向到后台路径**（`config.security.adminPath` 否则 `/admin`）。
- 返回注销函数（也会自动入 dispose 链）。
- 已注册页面可通过公共端点 `GET /api/plugins/pages` 枚举。

#### ctx.cron — 定时任务（自动清理）
```js
const cancel = ctx.cron.every(5000, () => { ... });   // 周期任务，间隔下限 500ms
const cancel = ctx.cron.at(Date.now() + 60000, () => {}); // 一次性任务
```
- fn 同步抛错或 Promise 拒绝**只记日志**，任务继续。
- 返回 cancel；dispose 时全部自动清理。

#### ctx.settings — 插件私有持久化设置
```js
await ctx.settings.set('key', value);        // 任意 JSON 值；单值 ≤100KB，每插件 ≤200 键
await ctx.settings.get('key', defaultValue);
await ctx.settings.del('key');
await ctx.settings.all();
```
- 底层 kv 存储 `plugin_settings`，**按插件名隔离**；卸载插件时管理器自动清空该插件段。

#### ctx.logs — 结构化日志
```js
ctx.logs.debug/info/warn/error(message, detail?);
```
- 进入插件日志环形缓冲（`GET /api/admin/plugins/logs`）与启动横幅/服务日志，scope 为插件名。

#### ctx.i18n — 词条注入
```js
ctx.i18n.add('zh', { 'xxx.hello': '你好' });   // locale 匹配 ^[a-zA-Z-]{2,16}$，返回词条数
ctx.i18n.locales();                              // ['zh','en']
ctx.i18n.t('xxx.hello');                         // 缺省用 config.language（回退 'zh'）
ctx.i18n.t('xxx.hello', 'en');
```
- 公共聚合端点：`GET /api/plugins/i18n?locale=zh[&plugin=xxx]` → `{ terms, manifest }`（后注册插件覆盖同名 key）。

#### ctx.bus — 事件总线增强
```js
const off = ctx.bus.on('xxx:event', fn);   // = ctx.on，返回取消函数
ctx.bus.once('xxx:event', fn);            // 触发一次后自动取消
ctx.bus.off('xxx:event', fn);             // 按引用精确移除
ctx.bus.emit('xxx:event', payload);        // = ctx.emit
ctx.bus.emitTo('openvideo-plugin-otp', 'xxx:event', payload); // 定向投递给某插件，返回 delivered:boolean
ctx.bus.events();                          // 当前所有事件名数组
```

#### ctx.model.namespace(ns) — 存储命名空间
```js
const ns = ctx.model.namespace('xxx');   // ns 匹配 ^[a-zA-Z0-9_]{1,24}$
ns.define('kv', { primary: 'id', fields: { ... } }); // 实际表名 xxx__kv（合计 ≤48 字符）
ns.has(name); ns.list();                 // list 自动剥掉命名空间前缀
```

## 4. 主程序广播的事件

| 事件 | 载荷 | 触发点 |
|---|---|---|
| `danmu:send` | `{vid,text,color,type,time,author}` | 弹幕发送 |
| `video:created` | `{vid,url,source}` source=`map|legacy|new|admin` | 视频映射/解析/后台添加（已映射 URL 的每次 resolve 也会触发） |
| `video:saved` | `{vid,url,source:'admin'}` | 后台保存视频 |
| `video:deleted` | `{vid}` | 后台删除视频 |
| `admin:login-ok` | `{username,ip}` | 管理员登录成功 |
| `admin:login-fail` | `{username,ip,reason:'fail'|'lock'}` | 登录失败/锁定 |
| `plugin:loaded` / `plugin:unloaded` | `{name,version}` | 插件启停 |
| `ready` | — | 启动时全部启用插件加载完成 |
| `before:restart` | — | 服务重启前 |

订阅：`ctx.on('video:created', ({vid,url,source}) => {...})`。**任何 handler 异常都被捕获并记日志，绝不影响主流程。**

## 5. 错误隔离（三层）

1. **路由层**：`ctx.router` 的所有方法（`get/post/put/delete/patch/all/use`）自动包裹**每一个**函数参数（含数组中间件）——
   - 热重载/停用后的旧实例路由自动失效（直接 `next()`，不再执行）；
   - handler 同步抛错或返回的 Promise 拒绝 → 记日志 + 返回 `e.status||e.statusCode||500` 的 `{code:1,msg:'插件路由异常: '+原因}`；已发送响应头则断开连接。**绝不把异常抛回主进程。**
2. **钩子层**：生命周期钩子 15s 超时 + 全捕获，只记日志。
3. **事件层**：`emit` 逐 handler try/catch；cron 任务异常只记日志。

## 6. 前端注入点

| 注入点 | 声明 | 消费方式 |
|---|---|---|
| 后台 | `client.admin`（scripts/styles/tabs≤20） | `OpenVideoAdmin.registerTab(tab)`；脚本以 Blob URL 带 Authorization 注入 |
| 播放器 | `client.player` | `OpenVideoPlayer.replace(...)` |
| 登录页 | `client.login` | `<script src>` 直连 |
| **自定义页面（v2）** | `ctx.pages.register(...)` | 任意路由的整页 HTML（可要求管理员鉴权） |
| **静态资源（v2）** | `ctx.static(mount, dir)` | 任意挂载路径的目录服务 |
| **i18n 词条（v2）** | `ctx.i18n.add(locale, dict)` | `GET /api/plugins/i18n` 聚合拉取 |

客户端脚本通过 `GET /api/plugins/client/:scope/:pkg/*` 下发（admin scope 需管理员鉴权；`Cache-Control: no-cache`）。

## 7. HTTP 端点（与插件相关）

**管理端（需 Bearer token，v1 行为不变）**：`GET /api/admin/plugins`（列表+服务+目录）、`POST .../install`、`.../toggle`、`.../config`、`.../uninstall`、`.../update`、`GET .../market`、`GET .../logs`。

**公共端**：`GET /api/plugins/manifest?scope=player|admin|login`（admin scope 需鉴权）、`GET /api/plugins/client/:scope/:pkg/*`、**v2 新增** `GET /api/plugins/pages`、`GET /api/plugins/i18n?locale=zh[&plugin=xxx]`。

**插件自己的路由**：`ctx.router` 可挂任意路径/方法（约定俗成 `/api/plugin/<name>/...`），无路径白名单。

## 8. 安装、更新与热重载

- 安装：npm 包（`POST /api/admin/plugins/install {pkg,version}`）；本地目录放入 `plugins/` 自动发现（默认停用）。
- 状态文件：`data/plugins.json`（`OPENVIDEO_DATA_DIR` 下）。
- 目录：`OPENVIDEO_PLUGIN_DIR` 覆盖，默认 `<repo>/plugins`。
- 更新：`POST /api/admin/plugins/update {name}` → 停用 → npm 更新 → `hooks.update` → 按原 enabled/config 重载。
- **热重载**：`OPENVIDEO_DEV=1` 时 watcher 监听插件目录（400ms 防抖），本地源码变更的**已启用**插件自动 disable→enable；不可用文件系统递归 watch 时降级 1s mtime 轮询。

## 9. 兼容性结论

- v1 插件（demo 1.0.x、otp 1.0.x、ip-ban 1.0.x、embed-subtitle 1.0.5）在 v2 下**无需修改**即可加载运行：manifest 旧字段全部识别，旧 ctx 全部保留。
- 唯一行为差异：`ctx.on` 返回取消函数而非原 handler（官方四插件均未使用其返回值）。
- 版本约束（deps）与生命周期钩子均为可选声明——不写即无约束、无钩子，与 v1 完全一致。
