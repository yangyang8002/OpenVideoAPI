#!/usr/bin/env node
/* 重构生成器：把单文件 server.js 机械拆分为 src/ 模块（保持行为兼容）。
 * 用法：node tools/refactor-gen.js   （在主仓根目录执行；输出写入 src/ 与 server.js）
 * 原理：tokenizer 标记 字符串/注释/模板/正则 → 顶层语句切分 → span 表分配到模块 →
 *       标识符改写（S.* 可变状态、__dirname→ROOT_DIR、./lib→../lib）→ 组装 define/mount。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT_DIR, 'server.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

/* ---------- tokenizer ---------- */
function buildMask(s) {
  const n = s.length;
  const mask = new Uint8Array(n);
  let st = 0, quote = '', inClass = false;
  const tplStack = [];
  let prevSig = '', prevWord = '';
  for (let i = 0; i < n; i++) {
    const c = s[i], nc = s[i + 1];
    if (st === 1) { mask[i] = 2; if (c === '\n') st = 0; continue; }
    if (st === 2) { mask[i] = 2; if (c === '*' && nc === '/') { mask[i + 1] = 2; i++; st = 0; } continue; }
    if (st === 3) { mask[i] = 1; if (c === '\\') { mask[i + 1] = 1; i++; } else if (c === quote) st = 0; continue; }
    if (st === 4) { mask[i] = 3; if (c === '\\') { mask[i + 1] = 3; i++; } else if (c === '\`') st = 0; else if (c === '$' && nc === '{') { mask[i] = 3; mask[i + 1] = 3; i++; tplStack.push(0); st = 0; } continue; }
    if (st === 5) {
      mask[i] = 4;
      if (c === '\\') { mask[i + 1] = 4; i++; continue; }
      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') { inClass = true; continue; }
      if (c === '/' || c === '\n') { st = 0; let j = i + 1; while (j < n && /[a-z]/i.test(s[j])) { mask[j] = 4; j++; i++; } }
      continue;
    }
    if (c === '/' && nc === '/') { mask[i] = 2; mask[i + 1] = 2; i += 1; st = 1; continue; }
    if (c === '/' && nc === '*') { mask[i] = 2; mask[i + 1] = 2; i += 1; st = 2; continue; }
    if (c === '"' || c === "'") { mask[i] = 1; st = 3; quote = c; continue; }
    if (c === '\`') { mask[i] = 3; st = 4; continue; }
    if (c === '/') {
      const startsRegex = /[=(,:\[!&|?{};+\-*%<>~^]/.test(prevSig) || ['return','typeof','case','in','of','new','delete','void','do','else','instanceof','throw','yield'].includes(prevWord);
      if (startsRegex) { mask[i] = 4; st = 5; inClass = false; continue; }
    }
    if (c === '}' && tplStack.length) { tplStack[tplStack.length - 1]--; if (tplStack[tplStack.length - 1] < 0) { tplStack.pop(); mask[i] = 3; st = 4; continue; } }
    if (c === '{' && tplStack.length) tplStack[tplStack.length - 1]++;
    if (/\S/.test(c)) { prevSig = c; if (/[A-Za-z0-9_$]/.test(c)) { prevWord = (/[A-Za-z0-9_$]/.test(s[i - 1] || '') ? prevWord.slice(0, -1) : '') + c; } else if (!/[A-Za-z0-9_$]/.test(nc || '')) prevWord = ''; }
  }
  return mask;
}
const MASK = buildMask(SRC);
const LINES = SRC.split('\n');
const lastContent = LINES[LINES.length - 1] === '' ? LINES.length - 1 : LINES.length;
let li = 0, depth = 0; const depthAt = [];
for (let k = 0; k < LINES.length; k++) {
  depthAt[k] = depth;
  for (let ci = 0; ci < LINES[k].length; ci++) {
    if (MASK[li + ci] !== 0) continue;
    const ch = LINES[k][ci];
    if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch)) depth--;
  }
  li += LINES[k].length + 1;
}
if (depth !== 0) throw new Error('mask imbalance: ' + depth);
const contRe = /^[}\)\].,+]/;
const units = []; let cur = null;
for (let k = 0; k < LINES.length; k++) {
  const line = LINES[k];
  if (!line.trim()) continue;
  const atTop = depthAt[k] === 0;
  const isCont = contRe.test(line[0]) || /^\s/.test(line) || /^(else|catch|finally)\b/.test(line);
  if (atTop && !isCont) { if (cur) units.push(cur); cur = { start: k + 1, end: k + 1 }; }
  else if (cur) cur.end = k + 1;
}
if (cur) units.push(cur);
const unitText = u => LINES.slice(u.start - 1, u.end).join('\n');
const sliceLines = (a, b) => LINES.slice(a - 1, b).join('\n');

/* ---------- span 表 ---------- */
const SPANS = [
  [1, 1, 'server', 'tmpl'], [2, 19, '', 'drop'], [20, 22, 'app', 'tmpl'], [23, 29, '', 'drop'], [30, 33, 'server', 'tmpl'],
  [34, 37, 'app', 'tmpl'],
  [38, 40, 'logger', 'define'], [41, 43, 'apistats', 'define'], [44, 52, 'config', 'define'], [53, 64, 'apistats', 'define'],
  [65, 67, '', 'drop'], [68, 176, 'apistats', 'define'],
  [177, 178, 'app', 'tmpl'], [179, 194, 'requestlog', 'define'], [195, 202, 'app', 'tmpl'], [203, 216, 'headers', 'define'],
  [217, 221, 'app', 'tmpl'], [222, 233, 'headers', 'define'], [234, 241, 'firstrun', 'define'],
  [242, 332, 'pow', 'define'], [333, 346, 'pow', 'mount'], [347, 361, 'ratelimit', 'define'], [362, 377, 'config', 'define'],
  [378, 379, 'apistats', 'define'], [380, 381, '', 'drop'], [382, 382, 'apistats', 'define'],
  [383, 385, 'accounts', 'define'], [386, 386, '', 'drop'], [387, 465, 'accounts', 'define'],
  [466, 469, 'config', 'define'], [470, 471, 'accounts', 'define'], [472, 480, 'config', 'define'], [481, 584, 'config', 'define'],
  [585, 723, 'mw-security', 'define'], [724, 906, 'geo', 'define'], [907, 989, 'mw-security', 'define'],
  [990, 1014, 'svc-danmu', 'define'], [1015, 1213, 'rt-danmu', 'mount'],
  [1214, 1222, 'videos', 'define'], [1223, 1236, 'ratelimit', 'define'], [1237, 1245, 'videos', 'define'],
  [1246, 1257, 'rt-video', 'mount'], [1258, 1281, 'videos', 'define'], [1282, 1328, 'rt-video', 'mount'],
  [1329, 1331, 'rt-auth', 'mount'], [1332, 1339, 'ratelimit', 'define'], [1340, 1497, 'rt-auth', 'mount'],
  [1498, 1524, 'rt-admin', 'define'], [1525, 1568, 'rt-admin', 'mount'],
  [1569, 1757, 'rt-files', 'mount'], [1758, 1801, 'rt-banned', 'mount'], [1802, 1833, 'rt-admin', 'mount'], [1834, 1838, 'rt-public', 'mount'],
  [1839, 1902, 'rt-banned', 'mount'], [1903, 2074, 'rt-security', 'mount'],
  [2075, 2095, 'svc-db', 'define'], [2096, 2201, 'rt-db', 'mount'], [2202, 2208, 'svc-db', 'define'],
  [2209, 2211, 'svc-backup', 'define'], [2212, 2212, 'config', 'define'], [2213, 2399, 'svc-backup', 'define'], [2400, 2670, 'rt-backup', 'mount'],
  [2671, 2703, 'svc-db', 'define'], [2704, 2707, 'rt-security', 'mount'], [2708, 2720, 'geo', 'define'], [2721, 2751, 'rt-security', 'mount'],
  [2752, 2760, 'rt-subtitle', 'mount'], [2761, 2936, 'subtitles', 'define'], [2937, 2952, 'rt-video', 'mount'], [2953, 3236, 'rt-subtitle', 'mount'],
  [3237, 3239, 'rt-admin', 'define'], [3240, 3243, '', 'drop'], [3244, 3255, 'rt-admin', 'define'], [3256, 3316, 'rt-admin', 'mount'],
  [3317, 3319, 'rt-deps', 'define'], [3320, 3320, '', 'drop'], [3321, 3384, 'rt-deps', 'define'], [3385, 3439, 'rt-deps', 'mount'],
  [3440, 3448, 'svc-plugins', 'define'], [3449, 3459, 'rt-admin', 'mount'], [3460, 3482, 'svc-plugins', 'define'], [3483, 3506, 'rt-admin', 'mount'],
  [3507, 3668, 'rt-plugins', 'mount'],
  [3669, 3671, 'updatecheck', 'define'], [3672, 3672, '', 'drop'], [3673, 3763, 'updatecheck', 'define'],
  [3764, 3805, 'rt-update', 'mount'], [3806, 3861, 'rt-public', 'mount'], [3862, 3921, 'bannedrefresh', 'define'],
  [3922, 3936, 'errorhandler', 'define'], [3937, 4021, 'init', 'define'],
  [4022, 4024, 'svc-plugins', 'define'], [4025, 4025, '', 'drop'], [4026, 4088, 'svc-plugins', 'define'],
  [4089, 4090, '', 'drop'], [4091, 4106, 'svc-plugins', 'define'],
  [4107, 4133, 'server', 'tmpl'], [4134, lastContent, 'server', 'tmpl'],
];
for (let i = 1; i < SPANS.length; i++) if (SPANS[i][0] !== SPANS[i - 1][1] + 1) throw new Error('span gap @' + SPANS[i][0]);

const S_VARS = new Set(['store','dbMigrating','pluginManager','pluginModel','apiConfigCache','apiConfigCacheAt','ipSearcher4','ipSearcher6','ipGeo','perfHistory','lastCpuUsage','lastCpuAt','lastReqCount','depsCache','marketCache','updateCheckCache','devWatcher','devWatchTimes','restarting']);
const DROP_LETS = new Set([...S_VARS, 'tokenExpiryMs']);

const moduleUnits = {}; const dropped = [];
for (const u of units) {
  const span = SPANS.find(sp => u.start >= sp[0] && u.start <= sp[1]);
  if (!span) throw new Error('uncovered unit @' + u.start);
  const [, , mod, phase] = span;
  const text = unitText(u);
  const letMatch = text.match(/^let\s+([^=;]+?)\s*=/);
  if (letMatch) {
    const names = letMatch[1].split(',').map(x => x.trim()).filter(Boolean);
    if (names.length && names.every(n => DROP_LETS.has(n))) { dropped.push('L' + u.start + ' let ' + names.join(',')); continue; }
  }
  if (/^process\.on\('(SIGINT|SIGTERM)'/.test(text)) { dropped.push('L' + u.start + ' SIG→优雅关停'); continue; }
  if (u.start === 1571) { dropped.push('L1571 ROOT_DIR→ctx'); continue; }
  if (phase === 'drop' || phase === 'tmpl') { if (phase === 'drop') dropped.push('L' + u.start + ' ' + text.slice(0, 40).replace(/\n/g, ' ')); continue; }
  if (!mod) continue;
  (moduleUnits[mod] = moduleUnits[mod] || []).push({ unit: u, phase });
}

/* ---------- 改写 ---------- */
function rewriteCode(text) {
  const lm = buildMask(text);
  let out = ''; let i = 0; const n = text.length;
  const isId = c => /[A-Za-z0-9_$]/.test(c);
  while (i < n) {
    if (lm[i] !== 0) { out += text[i]; i++; continue; }
    if (isId(text[i])) {
      let j = i; while (j < n && isId(text[j])) j++;
      const id = text.slice(i, j);
      /* 对象简写属性位置（{ a, store, b }）不能改成 S.store —— 保留裸名，
       * 由模块 prelude 的 const { store } = ctx 提供绑定 */
      let b = i - 1; while (b >= 0 && /\s/.test(text[b])) b--;
      let a = j; while (a < n && /\s/.test(text[a])) a++;
      const shorthand = S_VARS.has(id) && (text[b] === '{' || text[b] === ',') && (text[a] === ',' || text[a] === '}');
      /* 简写位置若是 S 变量（原模块级 let，只存在于 ctx.S 上、不挂 ctx 顶层），
       * 必须展开为 store: S.store —— prelude 无法为它们提供裸绑定 */
      out += shorthand ? id + ': S.' + id : (S_VARS.has(id) ? 'S.' + id : (id === '__dirname' ? 'ROOT_DIR' : id));
      i = j; continue;
    }
    out += text[i]; i++;
  }
  return out.replace(/'\.\/lib\//g, "'../lib/").replace(/'\.\/package\.json'/g, "'../package.json'");
}
function wrapAsFunction(text, name) {
  const lines = text.split('\n');
  const m = lines[0].match(/^app\.use\((?:'([^']*)',\s*)?\((err,\s*)?req,\s*res,\s*next\)\s*=>\s*\{/);
  if (!m) throw new Error('wrap failed ' + name + ': ' + lines[0]);
  lines[0] = 'function ' + name + '(' + (m[2] ? 'err, ' : '') + 'req, res, next) {';
  if (lines[lines.length - 1].trim() !== '});') throw new Error('wrap tail failed ' + name);
  lines[lines.length - 1] = '}';
  return (m[1] ? '/* 原挂载：' + m[1] + ' */\n' : '') + lines.join('\n');
}
function applyPatches(u, text) {
  if (u.start === 545) return 'function writeConfig(config) {\n    /* 原子写：先写 tmp 再 rename，避免写入中断产生残缺 config.json */\n    const tmpFile = CONFIG_FILE + \'.tmp\';\n    fs.writeFileSync(tmpFile, JSON.stringify(config, null, 2));\n    fs.renameSync(tmpFile, CONFIG_FILE);\n}';
  if (u.start === 2144) {
    if (!/dbMigrating = true;/.test(text)) throw new Error('db/switch anchor missing');
    return text.replace(/dbMigrating = true;/, "dbMigrating = true;\n            /* 迁移前自动备份（沿用现有备份机制；失败仅记录，不阻塞切换） */\n            try { await runBackup(undefined, { autoSync: true }); } catch (e) { console.error('[备份] 迁移前自动备份失败:', (e && e.message ? e.message : e)); }");
  }
  return text;
}
const WRAPS = { 205: 'advancedHeaders', 223: 'corsMiddleware', 236: 'firstRunGuard', 3925: 'errorHandler' };

const moduleBody = {};
for (const [mod, list] of Object.entries(moduleUnits)) {
  const mb = (moduleBody[mod] = { define: [], mount: [] });
  for (const { unit, phase } of list) {
    let text = unitText(unit);
    if (WRAPS[unit.start]) text = wrapAsFunction(text, WRAPS[unit.start]);
    text = rewriteCode(text);
    text = applyPatches(unit, text);
    if (mod === 'rt-files' && unit.start === 1737) text += '\n    ctx.upload = upload; /* 供字幕上传路由复用（跨模块） */' + "";
    mb[phase].push('/* ── 原 server.js L' + unit.start + '-' + unit.end + ' ── */\n' + text);
  }
}

/* ---------- 名称分析 ---------- */
const REQUIRE_ALIASES = ['express','path','fs','crypto','https','exec','rateLimit','helmet','multer','IP2Region','ip2rJs','createStore','collectAll','restoreAll','summarizeData','createCloud','CLOUD_TYPES','PluginManager','PLUGIN_DIR','enableProxyFetch','ipKeyGenerator'];
const BUILTINS = ['app', 'S', 'PORT', 'ROOT_DIR'];
function declNames(texts) {
  const names = []; const reqNames = []; const localNames = [];
  for (const t of texts) {
    /* 只统计顶层（深度0）且未被掩码（字符串/模板/注释内部）的声明：
     * 模板字面量里内嵌的 const challenge=... / function solve(){ 是【客户端脚本】，
     * 不是本模块声明；函数体内的局部 const 也不是（会被 Object.assign 误挂到 ctx） */
    const lm = buildMask(t);
    const lines = t.split('\n');
    const offs = []; const depthAt = []; let off = 0; let depth = 0;
    for (let li = 0; li < lines.length; li++) {
      offs.push(off); depthAt.push(depth);
      for (let k = off; k < off + lines[li].length; k++) { if (lm[k] === 0) { if (t[k] === '{') depth++; else if (t[k] === '}') depth--; } }
      off += lines[li].length + 1;
    }
    for (let li = 0; li < lines.length; li++) {
      if (depthAt[li] !== 0) continue;
      const line = lines[li];
      let p = 0; while (p < line.length && (line[p] === ' ' || line[p] === '\t')) p++;
      if (p >= line.length) continue;
      if (lm[offs[li] + p] !== 0) continue; /* 行首在掩码内（模板/字符串多行内容） */
      let m = line.match(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)/); if (m) { names.push(m[1]); continue; }
      m = line.match(/^const\s+\{([^}]+)\}\s*=\s*require\(/); if (m) { m[1].split(',').forEach(x => { const n = x.trim().split(/:\s*/).pop().trim(); if (n) reqNames.push(n); }); continue; }
      m = line.match(/^const\s+([A-Za-z0-9_$]+)\s*=\s*require\([^()]*\)\s*;/); if (m) { reqNames.push(m[1]); continue; }
      m = line.match(/^const\s+\{([^}]+)\}\s*=(?!\s*require)/); if (m) { m[1].split(',').forEach(x => { const n = x.trim().split(/:\s*/).pop().trim(); if (n && /^[A-Za-z0-9_$]+$/.test(n)) localNames.push(n); }); continue; }
      m = line.match(/^const\s+([A-Za-z0-9_$]+)\s*=/); if (m) { names.push(m[1]); continue; }
    }
    /* 同行粘结声明（原文件存在 const X = 1;function f(){ 写在一行）：行首正则
     * 捕捉不到 ; 后的声明 → 按语句边界位置补扫；掩码内字符替换为空格防误匹配；
     * 只认补扫位置深度为 0 的声明（函数体内的局部 function/const 不得挂 ctx） */
    let plain = '';
    for (let k = 0; k < t.length; k++) plain += (lm[k] === 0 ? t[k] : ' ');
    const depthAtPos = (pos) => { let d = 0; for (let k = 0; k < pos; k++) { const c = plain[k]; if (c === '{') d++; else if (c === '}') d--; } return d; };
    let gm;
    const greFunc = /(?:^|[;}])\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
    while ((gm = greFunc.exec(plain))) { if (depthAtPos(gm.index) === 0) names.push(gm[1]); }
    const greConst = /(?:^|[;}])\s*(?:const|let)\s+([A-Za-z0-9_$]+)\s*=/g;
    while ((gm = greConst.exec(plain))) {
      if (depthAtPos(gm.index) !== 0) continue;
      const rest = plain.slice(gm.index + gm[0].length).replace(/^\s+/, '');
      if (rest.startsWith('require(')) continue; /* 纯 require 别名走 reqNames 通道 */
      names.push(gm[1]);
    }
    const greDest = /(?:^|[;}])\s*const\s+\{([^}]+)\}\s*=\s*([A-Za-z0-9_$]+)/g;
    while ((gm = greDest.exec(plain))) {
      if (depthAtPos(gm.index) !== 0) continue;
      const isReq = gm[2] === 'require';
      gm[1].split(',').forEach(x => { const n2 = x.trim().split(/:\s*/).pop().trim(); if (n2 && /^[A-Za-z0-9_$]+$/.test(n2)) { if (isReq) reqNames.push(n2); else localNames.push(n2); } });
    }
  }
  return { names, reqNames, localNames };
}
function referencedNames(texts) {
  const set = new Set();
  for (const t of texts) {
    const lm = buildMask(t);
    let i = 0; const n = t.length;
    const isId = c => /[A-Za-z0-9_$]/.test(c);
    while (i < n) {
      if (lm[i] !== 0) { i++; continue; }
      if (isId(t[i])) {
        let j = i; while (j < n && isId(t[j])) j++;
        const id = t.slice(i, j);
        if (id.length > 1 || BUILTINS.includes(id)) { /* S 是单字符全局（ctx.S），必须收集 */
          let b = i - 1; while (b >= 0 && /\s/.test(t[b])) b--;
          const before = b >= 0 ? t[b] : '';
          let a = j; while (a < n && /\s/.test(t[a])) a++;
          const after = a < n ? t[a] : '';
          if (before !== '.' && !((before === '{' || before === ',') && after === ':')) set.add(id);
        }
        i = j; continue;
      }
      i++;
    }
  }
  return set;
}
const ALL_DECL = {};
for (const [mod, mb] of Object.entries(moduleBody)) {
  const d = declNames(mb.define); const m = declNames(mb.mount);
  ALL_DECL[mod] = { define: d, mount: m };
}
const GLOBAL_NAMES = new Set(BUILTINS);
for (const a of Object.entries(ALL_DECL)) { a[1].define.names.forEach(x => GLOBAL_NAMES.add(x)); a[1].define.reqNames.forEach(x => GLOBAL_NAMES.add(x)); a[1].mount.names.forEach(x => GLOBAL_NAMES.add(x)); a[1].mount.reqNames.forEach(x => GLOBAL_NAMES.add(x)); }

/* ---------- 模块规格 ---------- */
const SPECS = {
  config:       { file: 'src/config.js', title: '配置加载 / 合并 / 校验（含数据目录与文件路径常量）' },
  logger:       { file: 'src/logger.js', title: '内存日志环形缓冲（管理后台日志查看数据源）' },
  apistats:     { file: 'src/services/api-stats.js', title: 'API 统计：三层时间桶 + 开关/限速控制 + 持久化' },
  requestlog:   { file: 'src/middleware/request-log.js', title: '请求日志中间件' },
  headers:      { file: 'src/middleware/headers.js', title: '高级安全头 / CORS 中间件（配置驱动）' },
  firstrun:     { file: 'src/middleware/first-run.js', title: '首启初始化拦截中间件（未初始化仅放行登录/初始化/库测试）' },
  errorhandler: { file: 'src/middleware/error-handler.js', title: '全局错误处理（统一 JSON 兜底）' },
  geo:          { file: 'src/services/geo.js', title: 'IP 归属地：ip2region xdb 自动更新 + 坐标映射' },
  'mw-security':{ file: 'src/middleware/security.js', title: '安全中心核心：IP 封禁/白名单/统计/异常检测/自动封禁 + 登录记录' },
  pow:          { file: 'src/middleware/pow.js', title: 'PoW 工作量证明（防爬虫质询页 + 验证接口）' },
  ratelimit:    { file: 'src/middleware/rate-limit.js', title: '速率限制（API 限流器 + 写接口每 IP 限速）' },
  accounts:     { file: 'src/services/accounts.js', title: '账号认证：scrypt 哈希 + 令牌签发校验 + 管理员中间件' },
  videos:       { file: 'src/services/videos.js', title: '视频映射与 ID 分配（8 位 ID + 旧 hash 弹幕继承）' },
  subtitles:    { file: 'src/services/subtitles.js', title: '字幕库核心：SSRF 防护/语言解析/ASS→SRT/OpenList 字幕检测' },
  'svc-danmu':  { file: 'src/services/danmu.js', title: '弹幕发送频控（每 IP 每分钟上限）' },
  'svc-db':     { file: 'src/services/db.js', title: '数据库连接配置构建 / 校验 / 脱敏（六后端）' },
  'svc-backup': { file: 'src/services/backup.js', title: '备份核心：定时备份 + 云端同步（FTP/SFTP/WebDAV/OpenList）' },
  updatecheck:  { file: 'src/services/update-check.js', title: '版本检测（GitHub/npm/update.xml 三源）' },
  'svc-plugins':{ file: 'src/services/plugins.js', title: '插件服务：npm 源配置 / 开发热重载 / 优雅重启' },
  bannedrefresh:{ file: 'src/services/banned-refresh.js', title: '敏感词库自动更新（内置词库 git 拉取 + 订阅）' },
  init:         { file: 'src/services/init.js', title: '存储初始化（JSON 自动迁移 + 默认账号 + 插件装配）' },
  'rt-danmu':   { file: 'src/routes/danmu.js', title: '弹幕路由：DPlayer 兼容 v3 + 发送（含 /api/ 限流挂载）' },
  'rt-video':   { file: 'src/routes/video.js', title: '视频路由：映射 / resolve / 管理列表 / OpenList 直链解析' },
  'rt-auth':    { file: 'src/routes/auth.js', title: '认证路由：登录（限流+锁定）/初始化向导/改密/改用户名' },
  'rt-admin':   { file: 'src/routes/admin.js', title: '管理路由：配置/API管理/日志/控制台/重启/更新配置' },
  'rt-files':   { file: 'src/routes/files.js', title: '文件管理路由：浏览/删除/复制/压缩/解压/上传' },
  'rt-banned':  { file: 'src/routes/banned.js', title: '屏蔽词路由：订阅 CRUD / 刷新 / 词库 CRUD / 弹幕管理' },
  'rt-public':  { file: 'src/routes/public.js', title: '公开路由：公共配置 / 主题 / favicon / player / admin 入口' },
  'rt-security':{ file: 'src/routes/security.js', title: '安全中心路由：总览/IP列表/封禁白名单/登录记录/地图聚合' },
  'rt-db':      { file: 'src/routes/db.js', title: '数据库路由：信息/测试/切换（迁移前自动备份）/浏览/导出' },
  'rt-backup':  { file: 'src/routes/backup.js', title: '备份路由：本地备份 CRUD / 恢复（含批量）/ 云端配置与同步' },
  'rt-subtitle':{ file: 'src/routes/subtitle.js', title: '字幕路由：外部链接 / 字幕库 CRUD / 上传 / 本地化 / 检测' },
  'rt-deps':    { file: 'src/routes/deps.js', title: '依赖管理路由：检查（npm+前端 CDN）/ 一键更新' },
  'rt-plugins': { file: 'src/routes/plugins.js', title: '插件路由：安装/启停/配置/卸载/市场/客户端扩展' },
  'rt-update':  { file: 'src/routes/update.js', title: '更新路由：版本检查 / 启动独立更新进程' },
};

/* ---------- define 阶段拓扑排序 ----------
 * prelude 在 define 时按值捕获 ctx 名字 → 引用 B 名字的 A 必须晚于 B 定义（含函数体内引用，
 * 等同原单文件的声明提升语义）。同层按原文件出现顺序，保证行为一致。 */
const defineOwner = {}; const mountOwner = {};
for (const [m2, d] of Object.entries(ALL_DECL)) {
  for (const n of [...d.define.names, ...d.define.reqNames]) if (!defineOwner[n]) defineOwner[n] = m2;
  for (const n of [...d.mount.names, ...d.mount.reqNames]) if (!defineOwner[n] && !mountOwner[n]) mountOwner[n] = m2;
}
const firstSpan = {};
for (const sp of SPANS) if (sp[3] === 'define' && sp[2] && firstSpan[sp[2]] === undefined) firstSpan[sp[2]] = sp[0];
const DEFINE_SET = Object.keys(firstSpan).sort((a, b) => firstSpan[a] - firstSpan[b]);
const deps = {};
for (const mod of DEFINE_SET) deps[mod] = new Set();
const violations = [];
for (const mod of DEFINE_SET) {
  const own = new Set([...ALL_DECL[mod].define.names, ...ALL_DECL[mod].define.reqNames, ...ALL_DECL[mod].define.localNames]);
  const refs = referencedNames(moduleBody[mod].define);
  for (const r of refs) {
    if (!GLOBAL_NAMES.has(r) || own.has(r)) continue;
    const o = defineOwner[r];
    if (o) { if (o !== mod) deps[mod].add(o); }
    else if (mountOwner[r]) violations.push(mod + ' 的 define 引用 ' + r + ' ← ' + mountOwner[r] + '（仅 mount 阶段存在）');
    for (const [m3, d3] of Object.entries(ALL_DECL)) if (m3 !== mod && d3.define.reqNames.includes(r)) violations.push(mod + ' 的 define 引用 ' + r + ' ← ' + m3 + '（require 别名，不挂 ctx）');
  }
}
const DEFINE_ORDER = [];
const pending = DEFINE_SET.slice();
while (pending.length) {
  const idx = pending.findIndex(m2 => [...deps[m2]].every(d => DEFINE_ORDER.includes(d)));
  if (idx === -1) {
    const stuck = pending.map(m2 => m2 + '←[' + [...deps[m2]].filter(d => !DEFINE_ORDER.includes(d)).join(',') + ']').join('  ');
    violations.push('循环依赖: ' + stuck);
    break;
  }
  DEFINE_ORDER.push(pending.splice(idx, 1)[0]);
}
if (violations.length) { console.error('依赖分析违规:\n' + violations.join('\n')); process.exit(1); }
console.log('define 拓扑顺序: ' + DEFINE_ORDER.join(' > '));

/* ---------- requires 生成 ---------- */
function requireLines(refs) {
  const L = [];
  if (refs.has('express')) L.push("const express = require('express');");
  if (refs.has('path')) L.push("const path = require('path');");
  if (refs.has('fs')) L.push("const fs = require('fs');");
  if (refs.has('crypto')) L.push("const crypto = require('crypto');");
  if (refs.has('https')) L.push("const https = require('https');");
  if (refs.has('exec')) L.push("const { exec } = require('child_process');");
  if (refs.has('rateLimit') || refs.has('ipKeyGenerator')) {
    if (refs.has('ipKeyGenerator')) L.push("const { ipKeyGenerator } = require('express-rate-limit');"); else L.push("const rateLimit = require('express-rate-limit');");
    if (refs.has('rateLimit') && refs.has('ipKeyGenerator')) L.push("const rateLimit = require('express-rate-limit');");
  }
  if (refs.has('helmet')) L.push("const helmet = require('helmet');");
  if (refs.has('multer')) L.push("const multer = require('multer');");
  if (refs.has('IP2Region')) L.push("const IP2Region = require('ip2region').default;");
  if (refs.has('ip2rJs')) L.push("const ip2rJs = require('ip2region.js');");
  const store = ['createStore','collectAll','restoreAll','summarizeData'].filter(x => refs.has(x));
  if (store.length) L.push("const { " + store.join(', ') + " } = require('../lib/store');");
  const cloud = []; if (refs.has('createCloud')) cloud.push('createCloud'); if (refs.has('CLOUD_TYPES')) cloud.push('TYPES: CLOUD_TYPES');
  if (cloud.length) L.push("const { " + cloud.join(', ') + " } = require('../lib/cloud');");
  const plug = []; if (refs.has('PluginManager')) plug.push('PluginManager'); if (refs.has('PLUGIN_DIR')) plug.push('PLUGIN_DIR');
  if (plug.length) L.push("const { " + plug.join(', ') + " } = require('../lib/plugin');");
  if (refs.has('enableProxyFetch')) L.push("const { enableProxyFetch } = require('../lib/proxy');");
  return L;
}

/* ---------- 组装模块文件 ---------- */
const written = [];
function indent(text) { return text.split('\n').map(l => l.trim() ? '    ' + l : l).join('\n'); }
function emitModule(mod) {
  const spec = SPECS[mod]; const mb = moduleBody[mod];
  const ownDefine = new Set([...ALL_DECL[mod].define.names, ...ALL_DECL[mod].define.reqNames, ...ALL_DECL[mod].define.localNames]);
  const ownMount = new Set([...ALL_DECL[mod].mount.names, ...ALL_DECL[mod].mount.reqNames, ...ALL_DECL[mod].mount.localNames]);
  const parts = [];
  parts.push('/* ' + spec.title + '\n * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */');
  const allRefs = referencedNames([...mb.define, ...mb.mount]);
  const reqLines = requireLines(allRefs);
  if (reqLines.length) parts.push(reqLines.join('\n'));
  if (mb.define.length) {
    const refs = referencedNames(mb.define);
    const preludeNames = [...new Set([...refs].filter(r => (GLOBAL_NAMES.has(r)) && !ownDefine.has(r)))];
    const attach = ALL_DECL[mod].define.names;
    parts.push('\nmodule.exports = {\n    define(ctx) {\n' + (preludeNames.length ? '        const { ' + preludeNames.join(', ') + ' } = ctx;\n' : '') + '\n' + mb.define.map(indent).join('\n\n') + (attach.length ? '\n\n        Object.assign(ctx, { ' + attach.join(', ') + ' });' : '') + '\n    },' + (mb.mount.length ? '\n\n    mount(ctx) {\n' + (() => { const mrefs = referencedNames(mb.mount); const mp = [...new Set([...mrefs].filter(r => GLOBAL_NAMES.has(r) && !ownMount.has(r)))]; return (mp.length ? '        const { ' + mp.join(', ') + ' } = ctx;\n' : '') + '\n' + mb.mount.map(indent).join('\n\n') + '\n    },'; })() : '') + '\n};');
  } else {
    const mrefs = referencedNames(mb.mount);
    const mp = [...new Set([...mrefs].filter(r => GLOBAL_NAMES.has(r) && !ownMount.has(r)))];
    parts.push('\nmodule.exports = {\n    mount(ctx) {\n' + (mp.length ? '        const { ' + mp.join(', ') + ' } = ctx;\n' : '') + '\n' + mb.mount.map(indent).join('\n\n') + '\n    },\n};');
  }
  let content = parts.join('\n') + '\n';
  /* lib/package.json 相对路径按目录深度修正：src/x.js → ../lib/；src/sub/x.js → ../../lib/ */
  const depth = spec.file.split('/').length - 1;
  if (depth >= 2) { content = content.split("'../lib/").join("'" + '../'.repeat(depth) + "lib/").split("'../package.json'").join("'" + '../'.repeat(depth) + "package.json/".slice(0, -1)); }
  try { new Function(content); } catch (e) { fs.writeFileSync(path.join(ROOT_DIR, 'tools', 'syntax-dump.js'), content, 'utf8'); throw new Error('SYNTAX ' + spec.file + ': ' + e.message); }
  fs.writeFileSync(path.join(ROOT_DIR, spec.file), content, 'utf8');
  written.push({ file: spec.file, lines: content.split('\n').length, define: mb.define.length, mount: mb.mount.length });
}

fs.mkdirSync(path.join(ROOT_DIR, 'src', 'middleware'), { recursive: true });
fs.mkdirSync(path.join(ROOT_DIR, 'src', 'services'), { recursive: true });
fs.mkdirSync(path.join(ROOT_DIR, 'src', 'routes'), { recursive: true });
for (const mod of Object.keys(SPECS)) if (moduleBody[mod]) emitModule(mod); else if (mod === 'firstrun' || mod === 'errorhandler') throw new Error('missing ' + mod);

/* ================= PART 2: state / app / server 模板与输出 ================= */
if (!SRC.includes('function initStore')) { throw new Error('server.js 看起来已是拆分后的薄入口：请先恢复原始单文件再运行本生成器'); }
function checkSyntax(content, file) {
  const body = content.replace(/^#![^\n]*\n/, ''); /* shebang 不能进 new Function */
  try { new Function(body); } catch (e) { throw new Error('SYNTAX ' + file + ': ' + e.message); }
}
function writeChecked(rel, content) {
  checkSyntax(content, rel);
  fs.writeFileSync(path.join(ROOT_DIR, rel), content, 'utf8');
  written.push({ file: rel, lines: content.split('\n').length });
}

/* ---- src/state.js：全局可变状态容器（原顶层 let 集中存放，语义不变） ---- */
const STATE = [
"/* 全局可变状态容器 S（原 server.js 顶层 let 声明的集中存放，语义不变）。 */",
"'use strict';",
"",
"const S = {",
"    store: null,             /* 当前数据存储（启动时装配，可热切换） */",
"    dbMigrating: false,      /* 迁移锁：迁移期间暂停数据写入 */",
"    pluginManager: null,     /* 插件管理器 */",
"    pluginModel: null,       /* 插件动态表模型 */",
"    apiConfigCache: null,",
"    apiConfigCacheAt: 0,",
"    ipSearcher4: null,",
"    ipSearcher6: null,",
"    ipGeo: null,",
"    perfHistory: [],",
"    lastCpuUsage: process.cpuUsage(),",
"    lastCpuAt: Date.now(),",
"    lastReqCount: 0,",
"    depsCache: null,",
"    marketCache: null,",
"    updateCheckCache: null,",
"    devWatcher: null,",
"    devWatchTimes: {},",
"    restarting: false,",
"};",
"",
"module.exports = S;",
""
].join('\n');
writeChecked('src/state.js', STATE);

/* ---- src/app.js：应用工厂（中间件栈与路由挂载顺序 = 原文件顺序） ---- */
const bannerLines = rewriteCode(sliceLines(20, 22)).split('\n').map(l => l ? '    ' + l : l);
const APPKEY = { config: 'config', logger: 'logger', apistats: 'apiStats', requestlog: 'requestLog', headers: 'headers', firstrun: 'firstRun', errorhandler: 'errorHandler', geo: 'geo', 'mw-security': 'mwSecurity', pow: 'pow', ratelimit: 'rateLimit', accounts: 'accounts', videos: 'videos', subtitles: 'subtitles', 'svc-danmu': 'danmu', 'svc-db': 'db', 'svc-backup': 'backup', updatecheck: 'updateCheck', 'svc-plugins': 'plugins', bannedrefresh: 'bannedRefresh', init: 'init', 'rt-admin': 'rtAdmin', 'rt-deps': 'rtDeps' };
const DEFINE_LINE = "const DEFINE_ORDER = ['" + DEFINE_ORDER.map(k => APPKEY[k]).join("', '") + "'];";
const APP = [
"/* OpenVideoAPI 应用工厂：装配中间件栈与全部路由。",
" * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成。",
" * 中间件与路由的注册顺序与原文件完全一致（行为兼容硬性红线）。 */",
"'use strict';",
"const express = require('express');",
"const path = require('path');",
"const helmet = require('helmet');",
"const { enableProxyFetch } = require('../lib/proxy');",
"const S = require('./state');",
"",
"const MODS = {",
"    config: require('./config'),",
"    logger: require('./logger'),",
"    apiStats: require('./services/api-stats'),",
"    requestLog: require('./middleware/request-log'),",
"    headers: require('./middleware/headers'),",
"    firstRun: require('./middleware/first-run'),",
"    errorHandler: require('./middleware/error-handler'),",
"    geo: require('./services/geo'),",
"    mwSecurity: require('./middleware/security'),",
"    pow: require('./middleware/pow'),",
"    rateLimit: require('./middleware/rate-limit'),",
"    accounts: require('./services/accounts'),",
"    videos: require('./services/videos'),",
"    subtitles: require('./services/subtitles'),",
"    danmu: require('./services/danmu'),",
"    db: require('./services/db'),",
"    backup: require('./services/backup'),",
"    updateCheck: require('./services/update-check'),",
"    plugins: require('./services/plugins'),",
"    bannedRefresh: require('./services/banned-refresh'),",
"    init: require('./services/init'),",
"    rtAdmin: require('./routes/admin'),",
"    rtDeps: require('./routes/deps'),",
"    rtDanmu: require('./routes/danmu'),",
"    rtVideo: require('./routes/video'),",
"    rtAuth: require('./routes/auth'),",
"    rtFiles: require('./routes/files'),",
"    rtBanned: require('./routes/banned'),",
"    rtPublic: require('./routes/public'),",
"    rtSecurity: require('./routes/security'),",
"    rtDb: require('./routes/db'),",
"    rtBackup: require('./routes/backup'),",
"    rtSubtitle: require('./routes/subtitle'),",
"    rtPlugins: require('./routes/plugins'),",
"    rtUpdate: require('./routes/update'),",
"};",
"",
"/* 定义顺序 = 原文件初始化依赖顺序（后面的模块可引用前面挂到 ctx 的名字） */",
"__DEFINE_LINE__",
"/* 路由挂载顺序 = 原 server.js 中路由注册出现顺序 */",
"const MOUNT_ORDER = ['pow', 'rtDanmu', 'rtVideo', 'rtAuth', 'rtAdmin', 'rtFiles', 'rtBanned', 'rtPublic', 'rtSecurity', 'rtDb', 'rtBackup', 'rtSubtitle', 'rtDeps', 'rtPlugins', 'rtUpdate'];",
"",
"function createApp() {",
"    const app = express();",
"    const PORT = process.env.PORT || 1919;",
"    const ROOT_DIR = path.resolve(__dirname, '..'); /* = 原 server.js 的 __dirname（仓库根） */",
"    const ctx = { app, S, PORT, ROOT_DIR };",
"",
...bannerLines,
"",
"    /* ── 定义阶段：各模块向 ctx 挂载函数/常量 ── */",
"    for (const k of DEFINE_ORDER) { const m = MODS[k]; if (m && m.define) m.define(ctx); }",
"",
"    /* ── 中间件栈（原 L177-241 顺序，不可调整） ── */",
"    app.use('/api/', ctx.apiControl);",
"    app.use(ctx.logRequest);",
"    app.use(express.json());",
"    app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: false, frameguard: false }));",
"    app.use(ctx.advancedHeaders);",
"    app.use(ctx.securityMiddleware);",
"    app.use(ctx.powMiddleware);",
"    app.use(express.static(path.join(ROOT_DIR, 'public')));",
"    app.use(ctx.corsMiddleware);",
"    app.use('/api/admin', ctx.firstRunGuard);",
"",
"    /* ── 健康检查（新增；供负载均衡 / 容器编排探活；不影响任何既有路由） ── */",
"    app.get('/healthz', (req, res) => {",
"        res.status(200).json({ code: 0, msg: 'ok', data: { uptimeSec: Math.floor((Date.now() - ctx.API_START_TIME) / 1000), pid: process.pid } });",
"    });",
"",
"    /* ── 路由挂载（保持原注册顺序） ── */",
"    for (const k of MOUNT_ORDER) { const m = MODS[k]; if (m && m.mount) m.mount(ctx); }",
"",
"    /* ── 全局错误处理（统一 JSON 兜底；必须最后挂载） ── */",
"    app.use(ctx.errorHandler);",
"",
"    return { app, ctx };",
"}",
"",
"module.exports = { createApp };",
""
].join('\n').replace('__DEFINE_LINE__', DEFINE_LINE);
writeChecked('src/app.js', APP);

/* ---- server.js：薄入口 ---- */
const unhandled = rewriteCode(sliceLines(30, 33));
const onReady = rewriteCode(sliceLines(4135, lastContent));
let bootRaw = rewriteCode(sliceLines(4108, 4133));
const listenMatches = bootRaw.match(/app\.listen\(PORT, \(\) => \{/g) || [];
if (listenMatches.length !== 2) throw new Error('boot listen anchors=' + listenMatches.length);
const boot = bootRaw.split('app.listen(PORT, () => {').join('server = app.listen(PORT, () => {');
const SERVER = [
"#!/usr/bin/env node",
"/* OpenVideoAPI 服务入口（薄入口）。",
" * 原 4100+ 行单文件已拆分：src/ = 应用工厂/中间件/路由/服务；lib/ = 存储/插件/代理等基础设施（名字与职责不变）。",
" * 本文件只负责：构建应用 → 初始化存储 → 监听 → 优雅关停；package.json 的 bin 仍指向本文件。 */",
"'use strict';",
"const { createApp } = require('./src/app');",
"",
...unhandled.split('\n'),
"",
"const { app, ctx } = createApp();",
"const S = ctx.S;",
"const PORT = ctx.PORT;",
"const { initStore, scheduleUpdate, readConfig, setupDevWatcher, saveApiStats, saveIpStats } = ctx;",
"",
...onReady.split('\n'),
"",
"/* ── 监听（原 L4108-4133；捕获 server 实例供优雅关停使用） ── */",
"let server = null;",
...boot.split('\n'),
"",
"/* ── 优雅关停（SIGTERM/SIGINT）：停止接新连接 → 存量请求 → 统计落盘 → 存储关闭 → 退出 ── */",
"let shuttingDown = false;",
"async function gracefulShutdown(signal) {",
"    if (shuttingDown) process.exit(0); /* 第二次信号：立即退出 */",
"    shuttingDown = true;",
"    console.log('[关停] 收到 ' + signal + '，停止接收新连接...');",
"    const closed = new Promise((resolve) => { if (!server) return resolve(); server.close(resolve); });",
"    const hardStop = new Promise((resolve) => setTimeout(resolve, 10000)); /* 存量请求最多等待 10s */",
"    await Promise.race([closed, hardStop]);",
"    try { if (typeof saveApiStats === 'function') saveApiStats(); } catch (e) { console.error('[关停] API统计落盘失败:', (e && e.message ? e.message : e)); }",
"    try { if (typeof saveIpStats === 'function') saveIpStats(); } catch (e) { console.error('[关停] IP统计落盘失败:', (e && e.message ? e.message : e)); }",
"    try { if (S.store && typeof S.store.close === 'function') await S.store.close(); } catch (e) { console.error('[关停] 存储关闭失败:', (e && e.message ? e.message : e)); }",
"    console.log('[关停] 完成，进程退出');",
"    process.exit(0);",
"}",
"process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));",
"process.on('SIGINT', () => gracefulShutdown('SIGINT'));",
""
].join('\n');
writeChecked('server.js', SERVER);

console.log('=== refactor-gen 完成: ' + written.length + ' 个文件 ===');
for (const w of written) console.log('  ' + w.file + '  ' + w.lines + ' 行');
console.log('丢弃/转移单元 ' + dropped.length + ' 个:');
dropped.forEach(d => console.log('  - ' + d));

