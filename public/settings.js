/* ===== T4 设置中心（public/settings.js）=================================
 * 管理面板「设置」页：分域渲染 / 搜索定位 / dirty 拦截 / 即时校验 / 单项恢复默认。
 * 纯增量脚本，不改动 admin.html 既有逻辑；复用其全局函数：
 *   authHeaders / t / toast / populateThemeSelects / setAdminTheme / setAdminLang
 *   loadDbInfo / loadApiStats / saveApiConfig / openPlConfig
 * 数据来自 GET /api/admin/settings（schema + values）；保存走
 * POST /api/admin/settings/save（先校验后落盘，与旧 /api/admin/config 并存）。
 * 校验规则与服务端 src/routes/admin.js 的 validateSettingsValues 完全一致。 */
(function () {
    var EYE = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>';
    var RESET_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>';
    /* 主题下拉的静态兜底列表（populateThemeSelects 拉取 /api/theme/* 后覆盖） */
    var PLAYER_THEMES = ['bili', 'bilibili', 'sakura', 'ocean', 'sunset', 'forest', 'mono', 'cyber', 'shoujo', 'jrpg', 'neon'];
    var ADMIN_THEMES = ['md3', 'bilibili', 'sakura', 'ocean', 'sunset', 'forest', 'mono', 'cyber', 'shoujo', 'jrpg', 'neon'];
    var DOT_COLORS = { general: 'var(--accent)', theme: 'var(--primary)', danmaku: 'var(--warn)', video: 'var(--success)', security: 'var(--danger)', api: 'var(--primary)', db: 'var(--accent)', backup: 'var(--success)', plugins: 'var(--warn)' };

    var schema = null, order = [], values = {}, snapshot = {}, dirty = false, loadedOnce = false;
    var dirtySet = {};
    var searchTimer = null;

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function tt(s) { return (typeof t === 'function') ? t(s) : s; }
    /* T4 修复：item 键与域键前缀不总一致（如 plugins 域含 plugin.*、theme 域含 cdn.*），
       与服务端 settingsResolve 一致改为全域扁平查找 */
    function ruleOf(path) {
        if (!schema) return null;
        for (var i = 0; i < order.length; i++) {
            var items = schema[order[i]] && schema[order[i]].items;
            if (items && items[path]) return items[path];
        }
        return null;
    }
    function eachPath(fn) { order.forEach(function (dom) { var items = (schema[dom] && schema[dom].items) || {}; Object.keys(items).forEach(function (p) { fn(p, items[p]); }); }); }
    function fieldEl(path) { return document.querySelector('[data-path="' + path + '"]'); }

    /* 读取一项（convert 字段换算为存储值：界面秒 → 存储 ms） */
    function readOne(path) {
        var rule = ruleOf(path), el = fieldEl(path);
        if (!rule || !el) return snapshot[path];
        if (rule.type === 'checks') return Array.prototype.slice.call(el.querySelectorAll('input:checked')).map(function (b) { return b.value; });
        if (rule.type === 'bool') return el.checked;
        if (rule.type === 'int') { if (el.value === '') return ''; var n = Number(el.value); return rule.convert ? n * 1000 : n; }
        return el.value;
    }
    /* 界面原值（用于校验与提示文案，不换算） */
    function displayOne(path) {
        var rule = ruleOf(path), el = fieldEl(path);
        if (!rule || !el) return '';
        if (rule.type === 'checks') return readOne(path);
        if (rule.type === 'bool') return el.checked;
        return el.value;
    }

    /* 即时校验：规则与服务端 validateSettingsValues 一致；convert 字段以界面单位提示边界 */
    function validationError(rule, v) {
        if (rule.type === 'bool') return '';
        if (rule.type === 'int') {
            var n = typeof v === 'number' ? v : Number(v);
            if (v === '' || v == null || !Number.isInteger(n)) return '必须是整数';
            var lo = (rule.convert && rule.min != null) ? rule.min / 1000 : rule.min;
            var hi = (rule.convert && rule.max != null) ? rule.max / 1000 : rule.max;
            if (lo != null && n < lo) return '不能小于 ' + lo;
            if (hi != null && n > hi) return '不能大于 ' + hi;
            return '';
        }
        if (rule.type === 'select') {
            if (rule.options && rule.options.length && rule.options.indexOf(String(v)) < 0) return '不支持的取值';
            return '';
        }
        if (rule.type === 'checks') {
            if (!Array.isArray(v) || !v.length) return '至少选择一项';
            return '';
        }
        var s = String(v == null ? '' : v).trim();
        if (rule.pattern && s && !(new RegExp(rule.pattern)).test(s)) return '格式不正确';
        return '';
    }

    function setInputValue(path, v) {
        var rule = ruleOf(path), el = fieldEl(path);
        if (!rule || !el) return;
        if (rule.type === 'bool') el.checked = !!v;
        else if (rule.type === 'checks') Array.prototype.slice.call(el.querySelectorAll('input')).forEach(function (b) { b.checked = v.indexOf(b.value) >= 0; });
        else if (rule.type === 'int' && rule.convert) el.value = v / 1000;
        else el.value = v;
    }

    function markItem(path) {
        var rule = ruleOf(path); if (!rule) return;
        var errEl = document.querySelector('[data-err="' + path + '"]');
        var item = errEl && errEl.closest('.st-item');
        var e = validationError(rule, displayOne(path));
        if (errEl) errEl.textContent = e ? tt(e) : '';
        if (item) item.classList.toggle('st-item-invalid', !!e);
    }

    function showErrors(map) {
        document.querySelectorAll('.st-err').forEach(function (el) { el.textContent = ''; });
        document.querySelectorAll('.st-item-invalid').forEach(function (el) { el.classList.remove('st-item-invalid'); });
        Object.keys(map || {}).forEach(function (p) {
            var errEl = document.querySelector('[data-err="' + p + '"]');
            var item = errEl && errEl.closest('.st-item');
            if (errEl) errEl.textContent = tt(map[p]);
            if (item) item.classList.add('st-item-invalid');
        });
    }

    function updateBanner() {
        var b = document.getElementById('stBanner'); if (!b) return;
        b.classList.toggle('show', dirty);
        var txt = document.getElementById('stBannerText');
        if (txt) txt.textContent = dirty ? (Object.keys(dirtySet).length + ' ' + tt('项设置未保存')) : '';
        window.onbeforeunload = dirty ? function (e) { e.preventDefault(); e.returnValue = ''; } : null;
    }

    function reDiff() {
        dirtySet = {};
        eachPath(function (p) { if (String(readOne(p)) !== String(snapshot[p])) dirtySet[p] = 1; });
        dirty = Object.keys(dirtySet).length > 0;
        document.querySelectorAll('.st-item').forEach(function (el) { el.classList.toggle('st-item-dirty', !!dirtySet[el.getAttribute('data-id')]); });
        updateBanner();
    }

    function resetItem(path) {
        var rule = ruleOf(path); if (!rule) return;
        setInputValue(path, rule.default);
        markItem(path); reDiff();
    }

    function discard() {
        eachPath(function (p) { setInputValue(p, snapshot[p]); });
        showErrors(null); reDiff();
    }

    function saveAll() {
        var errs = {};
        eachPath(function (p, rule) { var e = validationError(rule, displayOne(p)); if (e) errs[p] = e; });
        showErrors(errs);
        if (Object.keys(errs).length) {
            toast(tt('请先修正标红的设置项'), false);
            var bad = document.querySelector('.st-item-invalid');
            if (bad) bad.scrollIntoView({ block: 'center' });
            return;
        }
        var vals = {}, changed = {};
        eachPath(function (p) { vals[p] = readOne(p); if (String(vals[p]) !== String(snapshot[p])) changed[p] = 1; });
        fetch('/api/admin/settings/save', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ values: vals }) })
            .then(function (r) { return r.json(); }).then(function (d) {
                if (d.code === 0) {
                    snapshot = vals; dirtySet = {}; dirty = false;
                    document.querySelectorAll('.st-item-dirty').forEach(function (el) { el.classList.remove('st-item-dirty'); });
                    updateBanner();
                    Object.keys(changed).forEach(function (p) {
                        var rule = ruleOf(p);
                        if (rule && rule.afterSave && typeof window[rule.afterSave] === 'function') window[rule.afterSave](vals[p]);
                    });
                    toast(tt(d.msg || '设置已保存'), true);
                } else if (d.code === 2 && d.errors) {
                    showErrors(d.errors); toast(tt(d.msg || '部分设置项校验未通过'), false);
                } else {
                    toast(tt(d.msg || '保存失败'), false);
                }
            }).catch(function () { toast(tt('请求失败'), false); });
    }

    /* 搜索：匹配中文源串（data-search）或当前渲染文本；未命中隐藏；Enter 跳首个命中 */
    function applySearch(q) {
        q = String(q || '').trim().toLowerCase();
        var hits = 0;
        document.querySelectorAll('#stSections .st-item, #stSections .st-custom').forEach(function (el) {
            var hay = ((el.getAttribute('data-search') || '') + ' ' + el.textContent).toLowerCase();
            var show = !q || hay.indexOf(q) >= 0;
            el.classList.toggle('st-hidden', !show);
            el.classList.toggle('st-hit', !!q && show);
            if (q && show) hits++;
        });
        document.querySelectorAll('#stSections .card.st-section').forEach(function (c) {
            var any = c.querySelector('.st-item:not(.st-hidden)');
            c.classList.toggle('st-hidden', !!q && !any);
        });
        document.querySelectorAll('#stSections .st-wrap').forEach(function (w) {
            var any = w.querySelector('.st-item:not(.st-hidden), .st-custom:not(.st-hidden)');
            w.classList.toggle('st-hidden', !!q && !any);
        });
        var cnt = document.getElementById('stCount');
        if (cnt) cnt.textContent = q ? (hits + ' ' + tt('项匹配')) : '';
    }

    function jumpTo(dom) {
        var sec = document.getElementById('st-sec-' + dom); if (!sec) return;
        var box = document.getElementById('stSearch');
        if (box && box.value) { box.value = ''; applySearch(''); }
        sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.querySelectorAll('.st-chip').forEach(function (c) { c.classList.toggle('st-active', c.getAttribute('data-dom') === dom); });
    }

    function jumpToFirstHit() {
        var first = document.querySelector('.st-item.st-hit, .st-custom.st-hit');
        if (!first) return;
        first.scrollIntoView({ block: 'center' });
        first.classList.remove('st-flash'); void first.offsetWidth; first.classList.add('st-flash');
    }

    function fmtDefault(rule) {
        var d = rule.default;
        if (rule.type === 'bool') return d ? tt('开') : tt('关');
        if (rule.type === 'int') return (rule.convert ? d / 1000 : d) + (rule.unit ? ' ' + tt(rule.unit) : '');
        if (rule.type === 'checks') return (rule.optionLabels ? d.map(function (x) { return tt(rule.optionLabels[x] || x); }) : d).join(' + ');
        return d === '' ? '—' : d;
    }

    function itemHtml(path, rule) {
        var v = values[path] !== undefined ? values[path] : rule.default;
        var id = rule.inputId || ('st-' + path.replace(/\./g, '-'));
        var ctrl = '';
        if (rule.type === 'bool') {
            ctrl = '<label class="st-check"><input type="checkbox" data-path="' + path + '"' + (v ? ' checked' : '') + '><span class="st-track"></span><span class="st-knob"></span></label>';
        } else if (rule.type === 'int') {
            var lo = (rule.convert && rule.min != null) ? rule.min / 1000 : rule.min;
            var hi = (rule.convert && rule.max != null) ? rule.max / 1000 : rule.max;
            ctrl = '<span class="st-unit-wrap"><input type="number" id="' + id + '" data-path="' + path + '" placeholder=" "' +
                (lo != null ? ' min="' + lo + '"' : '') + (hi != null ? ' max="' + hi + '"' : '') +
                ' value="' + (rule.convert ? v / 1000 : v) + '">' +
                (rule.unit ? '<span class="st-unit">' + esc(rule.unit) + '</span>' : '') + '</span>';
        } else if (rule.type === 'text') {
            ctrl = '<input type="text" id="' + id + '" class="st-text" data-path="' + path + '" placeholder=" " value="' + esc(v) + '">';
        } else if (rule.type === 'select') {
            var opts = (rule.options && rule.options.length) ? rule.options
                : (id === 'cfgTheme' ? PLAYER_THEMES : (id === 'cfgAdminTheme' ? ADMIN_THEMES : []));
            ctrl = '<select id="' + id + '" class="st-select" data-path="' + path + '"' + (rule.skip ? ' data-i18n-skip' : '') + '>' +
                opts.map(function (o) { return '<option value="' + esc(o) + '">' + esc((rule.optionLabels && rule.optionLabels[o]) || o) + '</option>'; }).join('') +
                '</select>';
        } else if (rule.type === 'checks') {
            ctrl = '<div class="st-checks" data-path="' + path + '" data-role="checks">' +
                rule.options.map(function (o) {
                    return '<label class="st-check-opt"><input type="checkbox" value="' + esc(o) + '"' + (v && v.indexOf(o) >= 0 ? ' checked' : '') + '><span>' + esc((rule.optionLabels && rule.optionLabels[o]) || o) + '</span></label>';
                }).join('') + '</div>';
        }
        var cell = (rule.type === 'bool') ? '<div class="st-ctrl">' + ctrl + '</div>' : ctrl;
        return '<div class="st-item" data-id="' + path + '" data-search="' + esc(((rule.label || '') + ' ' + (rule.desc || '')).toLowerCase()) + '">' +
            '<div class="st-head"><span class="st-label">' + esc(rule.label) + '</span>' +
            '<span class="st-default">' + tt('默认') + ' ' + esc(fmtDefault(rule)) + '</span>' +
            '<button type="button" class="st-reset" data-reset="' + path + '" title="' + tt('恢复默认') + '">' + RESET_SVG + '</button></div>' +
            cell +
            (rule.desc ? '<div class="st-desc">' + esc(rule.desc) + '</div>' : '') +
            '<div class="st-err" data-err="' + path + '"></div>' +
            '</div>';
    }

    /* 自定义块：沿用 admin.html 原 markup（保留全部 id 与 onclick，机制不动） */
    function customHtml(dom) {
        if (dom === 'general') return '<div class="card st-custom" data-search="导航栏 侧边导航 分组 菜单 顺序 折叠">' +
            '<h3 style="cursor:pointer" onclick="toggleNavCard()"><span class="dot" style="background:var(--accent);box-shadow:0 0 6px var(--accent)"></span>导航栏设置' +
            '<span id="navCardCaret" style="font-size:12px;opacity:.7;margin-left:4px">&#9654;</span>' +
            '<button class="btn btn-sm" style="margin-left:10px" onclick="event.stopPropagation();loadNavEditor()">读取当前</button>' +
            '<button class="btn btn-sm" style="margin-left:6px" onclick="event.stopPropagation();resetNav()">重置默认</button>' +
            '<button class="btn btn-sm btn-primary" style="margin-left:6px" onclick="event.stopPropagation();saveNav()">保存</button>' +
            '<span id="navCfgMsg" style="font-weight:400;font-size:11px;color:var(--text3);margin-left:8px"></span>' +
            '</h3>' +
            '<div id="navCardBody" style="display:none">' +
            '<div class="cfg-hint">侧边导航按分组（次级 tab）展示，组头可点击折叠。每组「折叠」勾选表示该组折叠、取消表示展开（所见即所得）；保存时只应用本次改动的组，其余组保持当前状态。插件扩展 tab 固定归入「扩展」组。</div>' +
            '<div id="navEditor"><div class="empty-state">点击「读取当前」加载导航配置</div></div>' +
            '</div></div>';
        if (dom === 'security') return '<div class="card st-custom" data-search="账号 用户名 改名 改密 登录凭据">' +
            '<h3><span class="dot" style="background:var(--accent);box-shadow:0 0 6px var(--accent)"></span>账号</h3>' +
            '<div class="cfg-row"><input type="text" id="cfgNewUser" placeholder="新用户名"><input type="password" id="cfgUserPwd" placeholder="密码"><button class="btn btn-sm" onclick="changeUsername()">改名</button></div>' +
            '<div class="cfg-row" style="margin-top:4px"><input type="password" id="cfgOldPwd" placeholder="原密码"><input type="password" id="cfgNewPwd" placeholder="新密码"><button class="btn btn-sm" onclick="changePassword()">改密</button></div>' +
            '<div class="cfg-hint">修改立即写入账号存储；改名或改密后需使用新凭据重新登录。</div>' +
            '</div>';
        if (dom === 'api') return '<div class="card st-custom" data-search="api 路由 规则 启用 每秒上限 带宽 apis">' +
            '<h3><span class="dot" style="background:var(--primary);box-shadow:0 0 6px var(--primary)"></span>API 路由规则</h3>' +
            '<div class="cfg-hint">逐条控制公开 API 的启用与限速；上方「统计保留天数」与规则随「保存全部」一并提交，也可单独保存规则。</div>' +
            '<div style="overflow-x:auto"><table><thead><tr><th>API 路径</th><th>启用</th><th>每秒上限</th><th>带宽上限(KB/s)</th></tr></thead><tbody id="apiConfigTbody"></tbody></table></div>' +
            '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn btn-sm btn-primary" onclick="saveApiConfig()">保存 API 规则</button></div>' +
            '</div>';
        if (dom === 'db') return '<div class="card st-custom" data-search="当前存储 存储类型 连接信息 数据表 导出">' +
            '<h3><span class="dot" style="background:var(--primary);box-shadow:0 0 6px var(--primary)"></span>当前存储 <span id="dbCurLabel" style="font-weight:400;font-size:12px;color:var(--text3);margin-left:6px"></span></h3>' +
            '<div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:10px">' +
            '<div><div style="font-size:11px;color:var(--text3)">存储类型</div><div id="dbCurType" style="font-size:18px;font-weight:700;color:var(--text)">—</div></div>' +
            '<div><div style="font-size:11px;color:var(--text3)">连接信息</div><div id="dbCurConn" style="font-size:13px;color:var(--text2);word-break:break-all">—</div></div>' +
            '</div>' +
            '<div id="dbTables" style="font-size:12px">加载中...</div>' +
            '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-sm" onclick="loadDbInfo()">刷新</button><button class="btn btn-sm" onclick="exportDb()">导出备份</button></div>' +
            '</div>' +
            '<div class="card st-custom" data-search="切换存储 迁移 数据库 sqlite mysql postgres mongodb 连接 测试">' +
            '<h3><span class="dot" style="background:var(--accent);box-shadow:0 0 6px var(--accent)"></span>切换存储 / 迁移数据</h3>' +
            '<div class="cfg-row"><span>存储类型</span>' +
            '<select id="dbType" onchange="dbTypeChange()" style="flex:1">' +
            '<option value="json">JSON 文件（默认，零依赖）</option>' +
            '<option value="sqlite">SQLite（本地文件，零配置）</option>' +
            '<option value="mysql">MySQL</option>' +
            '<option value="mariadb">MariaDB</option>' +
            '<option value="postgres">PostgreSQL</option>' +
            '<option value="mongodb">MongoDB（文档数据库）</option>' +
            '</select>' +
            '</div>' +
            '<div id="dbConnFields"></div>' +
            '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-sm" onclick="testDbConn()">测试连接</button><button class="btn btn-sm btn-primary" onclick="switchDbStorage()">切换并迁移</button></div>' +
            '<div class="cfg-hint">切换前自动全量备份；密码仅用于本次连接，不会回显已保存的凭据。</div>' +
            '</div>';
        if (dom === 'plugins') return '<div class="card st-custom" data-search="插件 已安装 配置 schema 热重载">' +
            '<h3><span class="dot" style="background:var(--warn);box-shadow:0 0 6px var(--warn)"></span>已安装插件</h3>' +
            '<div id="stPluginList"><div class="empty-state">加载中...</div></div>' +
            '<div class="cfg-hint">插件配置由各插件声明的 Schema 驱动，点击「配置」在弹窗中编辑，保存后热重载。</div>' +
            '</div>';
        return '';
    }

    function renderNav() {
        var nav = document.getElementById('stNav'); if (!nav) return;
        nav.innerHTML = order.map(function (d) {
            return '<button type="button" class="st-chip" data-dom="' + esc(d) + '">' + esc((schema[d] && schema[d].title) || d) + '</button>';
        }).join('');
    }

    function renderSections() {
        var wrap = document.getElementById('stSections'); if (!wrap) return;
        var html = '';
        order.forEach(function (dom) {
            var def = schema[dom] || { title: dom, items: {} };
            var items = def.items || {};
            var keys = Object.keys(items);
            var inner = '';
            if (keys.length) {
                var col = DOT_COLORS[dom] || 'var(--accent)';
                inner += '<div class="card st-section">' +
                    '<h3 class="st-sec-title"><span class="dot" style="background:' + col + ';box-shadow:0 0 6px ' + col + '"></span>' + esc(def.title) + '</h3>' +
                    '<div class="st-items">' + keys.map(function (p) { return itemHtml(p, items[p]); }).join('') + '</div></div>';
            }
            inner += customHtml(dom);
            html += '<section class="st-wrap" id="st-sec-' + esc(dom) + '">' + inner + '</section>';
        });
        wrap.innerHTML = html;
    }

    function loadPluginList() {
        var el = document.getElementById('stPluginList'); if (!el) return;
        fetch('/api/admin/plugins', { headers: authHeaders() }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.code !== 0) { el.innerHTML = '<div class="empty-state">' + tt('加载失败') + '</div>'; return; }
            var list = d.data || [];
            if (!list.length) { el.innerHTML = '<div class="empty-state">' + tt('暂无已安装插件') + '</div>'; return; }
            el.innerHTML = list.map(function (p) {
                return '<div class="st-plugin-row"><span class="st-plugin-name">' + esc(p.name) + '</span>' +
                    '<button type="button" class="btn btn-sm" data-plcfg="' + esc(p.name) + '">' + tt('配置') + '</button></div>';
            }).join('');
        }).catch(function () { el.innerHTML = '<div class="empty-state">' + tt('加载失败') + '</div>'; });
    }

    /* 事件绑定：容器为静态元素（innerHTML 重建不影响委托） */
    function bindEvents() {
        var wrap = document.getElementById('stSections');
        if (wrap && !wrap.__stBound) {
            wrap.__stBound = true;
            wrap.addEventListener('input', function (e) {
                var el = e.target.closest('[data-path]');
                if (el) { markItem(el.getAttribute('data-path')); reDiff(); }
            });
            wrap.addEventListener('change', function (e) {
                var el = e.target.closest('[data-path]');
                if (!el) return;
                var path = el.getAttribute('data-path'), rule = ruleOf(path);
                if (rule && rule.onChange && typeof window[rule.onChange] === 'function') window[rule.onChange](readOne(path));
                markItem(path); reDiff();
            });
            wrap.addEventListener('click', function (e) {
                var eye = e.target.closest('[data-eye]');
                if (eye) {
                    var inp = eye.parentElement.querySelector('input');
                    if (inp) { inp.type = inp.type === 'password' ? 'text' : 'password'; eye.classList.toggle('st-eye-on'); }
                    return;
                }
                var rst = e.target.closest('.st-reset');
                if (rst) { resetItem(rst.getAttribute('data-reset')); return; }
                var pl = e.target.closest('[data-plcfg]');
                if (pl && typeof openPlConfig === 'function') openPlConfig(pl.getAttribute('data-plcfg'));
            });
        }
        var nav = document.getElementById('stNav');
        if (nav && !nav.__stBound) {
            nav.__stBound = true;
            nav.addEventListener('click', function (e) {
                var chip = e.target.closest('.st-chip');
                if (chip) jumpTo(chip.getAttribute('data-dom'));
            });
        }
        var box = document.getElementById('stSearch');
        if (box && !box.__stBound) {
            box.__stBound = true;
            box.addEventListener('input', function () {
                clearTimeout(searchTimer);
                var q = box.value;
                searchTimer = setTimeout(function () { applySearch(q); }, 150);
            });
            box.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); jumpToFirstHit(); }
            });
        }
        var dis = document.getElementById('stDiscardBtn'), sav = document.getElementById('stSaveBtn');
        if (dis && !dis.__stBound) { dis.__stBound = true; dis.addEventListener('click', discard); }
        if (sav && !sav.__stBound) { sav.__stBound = true; sav.addEventListener('click', saveAll); }
    }

    function load() {
        if (loadedOnce) return;
        loadedOnce = true;
        fetch('/api/admin/settings', { headers: authHeaders() }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.code !== 0 || !d.data || !d.data.schema) return;
            schema = d.data.schema;
            order = d.data.order || Object.keys(schema);
            values = d.data.values || {};
            renderNav(); renderSections(); bindEvents();
            if (typeof populateThemeSelects === 'function') populateThemeSelects();
            var selP = document.getElementById('cfgTheme'); if (selP) selP.value = values['theme'] || 'bili';
            var selA = document.getElementById('cfgAdminTheme'); if (selA) selA.value = values['adminTheme'] || 'md3';
            var selL = document.getElementById('cfgLang'); if (selL) selL.value = values['language'] || 'zh';
            if (typeof setAdminTheme === 'function') setAdminTheme(values['adminTheme'] || 'md3');
            if (typeof loadDbInfo === 'function') loadDbInfo();
            if (typeof loadApiStats === 'function') loadApiStats();
            loadPluginList();
            snapshot = {};
            eachPath(function (p) { snapshot[p] = readOne(p); });
            dirty = false; dirtySet = {}; updateBanner();
        }).catch(function () {});
    }

    window.OpenVideoSettings = {
        load: load,
        isDirty: function () { return dirty; },
        save: saveAll,
        discard: discard,
        search: applySearch
    };
})();
