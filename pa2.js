
        I18N.init();
        function t(s) { return I18N.t(s); }
        if (document.getElementById('cfgLang')) document.getElementById('cfgLang').value = I18N.lang;
        function setAdminLang(l) { I18N.setLang(l); location.reload(); }
        let adminToken = '', adminUser = '';
        let wordState = { page: 1, total: 0, limit: 50 };
        let dmState = { page: 1, total: 0, limit: 50 };
        function authHeaders() { return { 'Authorization': 'Bearer ' + adminToken, 'Content-Type': 'application/json' }; }

        /* ===== 通用分页条（每页 10/20/50/100 可切换） =====
           插件列表 / 依赖列表按需求不做分页，直接全量加载 */
        const PAGE_SIZES = [10, 20, 50, 100];
        const __pagers = {};
        function pagerHTML(uid, state, load) {
            __pagers[uid] = { state, load };
            const tp = Math.max(1, Math.ceil(state.total / state.limit));
            if (tp <= 1 && state.total <= state.limit) return '';
            return `<div class="pager-row">
                <button class="btn btn-sm" ${state.page <= 1 ? 'disabled' : ''} onclick="__pg('${uid}',${state.page - 1})">上一页</button>
                <span class="info">${state.page} / ${tp} · 共 ${state.total} 条</span>
                <button class="btn btn-sm" ${state.page >= tp ? 'disabled' : ''} onclick="__pg('${uid}',${state.page + 1})">下一页</button>
                <label class="pg-size">每页
                    <select onchange="__pgLimit('${uid}',this.value)">${PAGE_SIZES.map(n => `<option value="${n}" ${n === state.limit ? 'selected' : ''}>${n} 项</option>`).join('')}</select>
                </label>
            </div>`;
        }
        function __pg(uid, p) {
            const s = __pagers[uid];
            if (!s) return;
            s.state.page = Math.max(1, p);
            s.load();
        }
        function __pgLimit(uid, n) {
            const s = __pagers[uid];
            if (!s) return;
            s.state.limit = parseInt(n) || 50;
            s.state.page = 1;
            s.load();
        }
        function setAdminTheme(name) { document.documentElement.dataset.theme = name; localStorage.setItem('ap_admin_theme', name); if (document.getElementById('cfgAdminTheme')) document.getElementById('cfgAdminTheme').value = name; }
        function loadAdminTheme() {
            var t = localStorage.getItem('ap_admin_theme') || 'md3';
            setAdminTheme(t);
        }
        /* ===== 侧边导航分组（次级 tab）+ 自定义位置 ===== */
        const NAV_DEFAULT = {
            groups: [
                { id: 'content', name: '内容管理', items: ['words', 'danmu', 'videos', 'subs'], collapsed: true },
                { id: 'system', name: '系统', items: ['config', 'security', 'db', 'backup', 'files'], collapsed: false },
                { id: 'ext', name: '扩展', items: ['plugins', 'market', 'deps'], collapsed: true },
                { id: 'monitor', name: '监控', items: ['logs', 'debug', 'api'], collapsed: true }
            ],
            pinnedTop: ['console'],
            pinnedBottom: ['about']
        };
        let navConfig = null;
        const NAV_ITEM_LABELS = {};
        function navLabel(id) {
            if (NAV_ITEM_LABELS[id]) return NAV_ITEM_LABELS[id];
            const b = document.querySelector('.nav-item[data-tab="' + id + '"]');
            const lbl = b ? ((b.querySelector('span:last-child') || b).textContent || '').trim() : id;
            NAV_ITEM_LABELS[id] = lbl;
            return lbl;
        }
        function navCollapsed() { try { return JSON.parse(localStorage.getItem('ap_nav_collapsed') || '[]'); } catch (e) { return []; } }
        function toggleNavGroup(id, grp) {
            let c = navCollapsed();
            if (grp.classList.contains('collapsed')) { grp.classList.remove('collapsed'); c = c.filter(x => x !== id); }
            else { grp.classList.add('collapsed'); c.push(id); }
            try { localStorage.setItem('ap_nav_collapsed', JSON.stringify(c)); } catch (e) {}
        }
        function renderNav() {
            const nav = document.querySelector('.side-nav');
            if (!nav) return;
            nav.querySelectorAll('.nav-group').forEach(g => g.remove());
            const groups = (navConfig && navConfig.groups) || [];
            const pinnedBottom = (navConfig && navConfig.pinnedBottom) || ['about'];
            const btns = {};
            nav.querySelectorAll('.nav-item[data-tab]').forEach(b => { btns[b.dataset.tab] = b; });
            const anchor = pinnedBottom.map(id => btns[id]).filter(Boolean)[0] || null;
            /* 折叠状态：有记忆用记忆；首次打开按各组 collapsed 独立默认 */
            let collapsedIds;
            try { if (localStorage.getItem('ap_nav_init') === '1') collapsedIds = navCollapsed(); } catch (e) {}
            if (!collapsedIds) {
                collapsedIds = groups.filter(g => g.collapsed).map(g => g.id);
                try { localStorage.setItem('ap_nav_init', '1'); localStorage.setItem('ap_nav_collapsed', JSON.stringify(collapsedIds)); } catch (e) {}
            }
            groups.forEach(g => {
                const head = document.createElement('button');
                head.type = 'button';
                head.className = 'nav-group-head';
                head.innerHTML = '<span>' + esc(g.name) + '</span><span class="caret">&#9662;</span>';
                const body = document.createElement('div');
                body.className = 'nav-group-body';
                const grp = document.createElement('div');
                grp.className = 'nav-group';
                grp.dataset.gid = g.id;
                grp.appendChild(head);
                grp.appendChild(body);
                if (anchor && anchor.parentNode) nav.insertBefore(grp, anchor);
                else nav.appendChild(grp);
                head.addEventListener('click', function () { toggleNavGroup(g.id, grp); });
                (g.items || []).forEach(id => { if (btns[id]) body.appendChild(btns[id]); });
                if (collapsedIds.includes(g.id)) grp.classList.add('collapsed');
            });
        }
        function initNav() {
            fetch('/api/config/public').then(r => r.json()).then(d => {
                navConfig = (d.data && d.data.nav) || null;
                renderNav();
            }).catch(function () { navConfig = null; renderNav(); });
        }
        /* ---- 导航栏设置（服务器配置卡片） ---- */
        function navFindGroup(gid) { return (navConfig && navConfig.groups || []).find(g => g.id === gid); }
        function navMoveGroup(gi, dir) {
            const groups = navConfig.groups;
            const j = gi + dir;
            if (j < 0 || j >= groups.length) return;
            [groups[gi], groups[j]] = [groups[j], groups[gi]];
            loadNavEditor();
        }
        function navMoveItem(fromGid, id, toGid) {
            if (fromGid === toGid) return;
            const from = navFindGroup(fromGid);
            if (!from) return;
            from.items = from.items.filter(x => x !== id);
            const to = navFindGroup(toGid);
            if (to) to.items.push(id);
            loadNavEditor();
        }
        function navReorderItem(gid, id, dir) {
            const g = navFindGroup(gid);
            if (!g) return;
            const i = g.items.indexOf(id);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= g.items.length) return;
            [g.items[i], g.items[j]] = [g.items[j], g.items[i]];
            loadNavEditor();
        }
        function loadNavEditor() {
            const wrap = document.getElementById('navEditor');
            if (!wrap) return;
            if (!navConfig) navConfig = JSON.parse(JSON.stringify(NAV_DEFAULT));
            const groups = navConfig.groups;
            /* checkbox = 当前折叠状态（所见即所得），初始值取当前记忆 */
            const cur = navCollapsed();
            wrap.innerHTML = groups.map((g, gi) => `
                <div class="nav-edit-group" data-gid="${esc(g.id)}" style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:10px">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
                        <span style="font-size:11px;color:var(--text3)">分组</span>
                        <input class="nav-edit-gname" value="${esc(g.name)}" style="flex:1;min-width:100px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text);font-size:12px;outline:none">
                        <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);cursor:pointer"><input type="checkbox" class="nav-edit-gcollapse" ${cur.includes(g.id) ? 'checked' : ''} style="accent-color:var(--primary)"> 折叠</label>
                        <button class="btn btn-sm" onclick="navMoveGroup(${gi},-1)">上移</button>
                        <button class="btn btn-sm" onclick="navMoveGroup(${gi},1)">下移</button>
                        ${g.id.startsWith('custom') ? `<button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="navRemoveGroup('${esc(g.id)}')">删除</button>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px">${(g.items || []).map(id => `
                        <div class="nav-edit-item" data-tab="${esc(id)}" style="display:flex;align-items:center;gap:6px;padding:4px 8px;background:rgba(255,255,255,.03);border-radius:6px;font-size:12px">
                            <span style="flex:1;color:var(--text)">${esc(navLabel(id))}</span>
                            <select class="nav-edit-gsel" onchange="navMoveItem('${esc(g.id)}','${esc(id)}',this.value)" style="background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:3px 6px;font-size:11px;outline:none">
                                ${groups.map(og => `<option value="${esc(og.id)}" ${og.id === g.id ? 'selected' : ''}>${esc(og.name)}</option>`).join('')}
                            </select>
                            <button class="btn btn-sm" onclick="navReorderItem('${esc(g.id)}','${esc(id)}',-1)">&uarr;</button>
                            <button class="btn btn-sm" onclick="navReorderItem('${esc(g.id)}','${esc(id)}',1)">&darr;</button>
                        </div>`).join('') || '<div style="font-size:11px;color:var(--text3);padding:4px 8px">空分组，可把其他分组中的项目移动到这里</div>'}</div>
                </div>`).join('') +
                '<div style="margin-top:10px"><button class="btn btn-sm" onclick="navAddGroup()">+ 添加分组</button></div>';
            /* 记录各组 checkbox 初值，用于保存时只应用本次改动的组 */
            wrap.querySelectorAll('.nav-edit-group').forEach(ge => {
                ge.dataset.c0 = ge.querySelector('.nav-edit-gcollapse').checked ? '1' : '0';
            });
        }
        function navAddGroup() {
            if (!navConfig) navConfig = JSON.parse(JSON.stringify(NAV_DEFAULT));
            navConfig.groups.push({ id: 'custom' + Date.now().toString(36), name: '新分组', items: [], collapsed: false });
            loadNavEditor();
        }
        function navRemoveGroup(gid) {
            if (!confirm('确认删除该分组？组内项目将保留在页面但不再显示。')) return;
            navConfig.groups = navConfig.groups.filter(g => g.id !== gid);
            loadNavEditor();
        }
        function saveNav() {
            if (!navConfig) return toast('请先读取当前配置', false);
            /* 收集 checkbox 与初值，仅应用本次改动的组（其他组保持当前状态） */
            const changed = [];
            document.querySelectorAll('#navEditor .nav-edit-group').forEach(ge => {
                const g = navFindGroup(ge.dataset.gid);
                if (!g) return;
                g.name = ge.querySelector('.nav-edit-gname').value.trim() || g.name;
                const cb = ge.querySelector('.nav-edit-gcollapse');
                if (!cb) return;
                const was = ge.dataset.c0 === '1';
                const now = cb.checked;
                g.collapsed = now;
                if (was !== now) changed.push({ id: g.id, fold: now });
                ge.dataset.c0 = now ? '1' : '0';
            });
            fetch('/api/admin/config', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ui: { nav: navConfig } }) })
                .then(r => r.json()).then(d => {
                    toast(d.msg, d.code === 0);
                    if (d.code === 0) {
                        /* 只应用本次改动的组 */
                        const cur = navCollapsed();
                        const next = new Set(cur);
                        changed.forEach(c => { if (c.fold) next.add(c.id); else next.delete(c.id); });
                        try { localStorage.setItem('ap_nav_collapsed', JSON.stringify([...next])); localStorage.setItem('ap_nav_init', '1'); } catch (e) {}
                        renderNav();
                        loadNavEditor();
                    }
                });
        }
        function resetNav() {
            if (!confirm('确认恢复默认导航分组与顺序？')) return;
            navConfig = JSON.parse(JSON.stringify(NAV_DEFAULT));
            try { localStorage.removeItem('ap_nav_collapsed'); localStorage.removeItem('ap_nav_init'); } catch (e) {}
            loadNavEditor();
        }
        /* 导航设置卡片折叠（默认始终折叠，点击标题展开） */
        function toggleNavCard() {
            const body = document.getElementById('navCardBody');
            const caret = document.getElementById('navCardCaret');
            if (!body) return;
            const open = body.style.display !== 'none';
            body.style.display = open ? 'none' : '';
            if (caret) caret.innerHTML = open ? '&#9654;' : '&#9660;';
            if (!open) loadNavEditor();
        }
        function initNavCard() {
            const body = document.getElementById('navCardBody');
            const caret = document.getElementById('navCardCaret');
            if (!body) return;
            /* 默认折叠 */
            body.style.display = 'none';
            if (caret) caret.innerHTML = '&#9654;';
        }
        function populateThemeSelects() {
            fetch('/api/theme/player/list').then(r => r.json()).then(d => {
                if (d.code !== 0 || !d.data.length) return;
                const sel = document.getElementById('cfgTheme');
                const cur = sel.value;
                sel.innerHTML = d.data.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
                sel.value = cur;
            }).catch(() => {});
            fetch('/api/theme/admin/list').then(r => r.json()).then(d => {
                if (d.code !== 0 || !d.data.length) return;
                const sel = document.getElementById('cfgAdminTheme');
                const cur = sel.value;
                sel.innerHTML = d.data.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
                sel.value = cur;
            }).catch(() => {});
        }
        function toast(m, ok) {
            m = t(m);
            const t2 = document.getElementById('toast');
            t2.textContent = m; t2.className = ok ? 'toast ok show' : 'toast err show';
            clearTimeout(t2._t); t2._t = setTimeout(() => t2.classList.remove('show'), 2800);
        }

        /* ===== 前端扩展 API（插件脚本通过它注册能力） ===== */
        window.OpenVideoAdmin = {
            tabs: [],
            _ready: false,
            registerTab(tab) {
                this.tabs.push(tab);
                if (this._ready) renderExtTabs();
            },
            getToken() { return adminToken; },
            api(url, opts) {
                opts = opts || {};
                const headers = Object.assign({ 'Authorization': 'Bearer ' + adminToken, 'Content-Type': 'application/json' }, opts.headers || {});
                return fetch(url, Object.assign({}, opts, { headers })).then(r => r.json());
            }
        };
        function renderExtTabs() {
            const nav = document.querySelector('.side-nav');
            if (!nav) return;
            OpenVideoAdmin.tabs.forEach(tab => {
                if (document.getElementById('extPanel-' + tab.id)) return;
                const btn = document.createElement('button');
                btn.className = 'nav-item';
                btn.dataset.tab = 'ext-' + tab.id;
                btn.innerHTML = '<span class="icon">&#128295;</span><span>' + esc(tab.title) + '</span>';
                btn.onclick = () => switchExtTab(tab.id);
                /* 插件扩展 tab 归入「扩展」组（次级 tab），无则自动创建 */
                let extTarget = nav.querySelector('.nav-group[data-gid="ext"] .nav-group-body');
                if (!extTarget) {
                    const grp = document.createElement('div');
                    grp.className = 'nav-group';
                    grp.dataset.gid = 'ext';
                    grp.innerHTML = '<button type="button" class="nav-group-head"><span>扩展</span><span class="caret">&#9662;</span></button><div class="nav-group-body"></div>';
                    const about = nav.querySelector('[data-tab="about"]');
                    if (about && about.parentNode) nav.insertBefore(grp, about);
                    else nav.appendChild(grp);
                    grp.querySelector('.nav-group-head').addEventListener('click', function () { toggleNavGroup('ext', grp); });
                    extTarget = grp.querySelector('.nav-group-body');
                }
                extTarget.appendChild(btn);
                const panel = document.createElement('div');
                panel.className = 'panel';
                panel.id = 'extPanel-' + tab.id;
                document.getElementById('mainPage').appendChild(panel);
            });
        }
        function switchExtTab(id) {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === 'ext-' + id));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            const p = document.getElementById('extPanel-' + id);
            p.classList.add('active');
            if (!p._mounted) {
                p._mounted = true;
                const tab = OpenVideoAdmin.tabs.find(x => x.id === id);
                if (!tab) return;
                try {
                    if (typeof tab.mount === 'function') tab.mount(p);
                    else if (tab.html) p.innerHTML = tab.html;
                } catch (e) { console.error('[插件] tab 挂载异常', e); }
            }
            I18N.apply && I18N.apply(p);
            if (window.__mdOnTab) try { __mdOnTab(id); } catch (e) {}
        }
        /* 加载后台插件扩展（样式 + 脚本）。
           脚本/样式经 fetch 携带鉴权头后用 Blob URL 注入 —— <script src> 无法携带
           Authorization 头，直接引用会因服务端 401 而全部加载失败（tab 不渲染） */
        function loadAdminAsset(url, auth) {
            return fetch(url, { headers: auth ? authHeaders() : {} })
                .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
                .then(b => {
                    const clean = url.split('?')[0];
                    if (/\.css$/i.test(clean)) {
                        const el = document.createElement('link');
                        el.rel = 'stylesheet';
                        el.href = URL.createObjectURL(b);
                        document.head.appendChild(el);
                    } else {
                        const el = document.createElement('script');
                        el.src = URL.createObjectURL(b);
                        document.body.appendChild(el);
                    }
                });
        }
        /* 加载后台插件扩展（样式 + 脚本） */
        function loadAdminPlugins() {
            return fetch('/api/plugins/manifest?scope=admin', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const list = d.data.plugins || [];
                    const chain = [];
                    list.forEach(p => {
                        (p.styles || []).forEach(s => chain.push(() => loadAdminAsset(s, true)));
                        (p.scripts || []).forEach(s => chain.push(() => loadAdminAsset(s, true)));
                    });
                    let i = 0;
                    const next = () => { if (i >= chain.length) { window.OpenVideoAdmin._ready = true; renderExtTabs(); return; } chain[i++]().then(next); };
                    next();
                }).catch(() => {});
        }
        /* 登录页插件扩展（scope=login）：无需登录即可加载，用于扩展登录表单等（如 OTP 验证码输入） */
        function loadLoginPlugins() {
            return fetch('/api/plugins/manifest?scope=login')
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const list = d.data.plugins || [];
                    const chain = [];
                    list.forEach(p => {
                        (p.styles || []).forEach(s => chain.push(() => {
                            const el = document.createElement('link');
                            el.rel = 'stylesheet'; el.href = s;
                            document.head.appendChild(el);
                            return Promise.resolve();
                        }));
                        (p.scripts || []).forEach(s => chain.push(() => new Promise(resolve => {
                            const el = document.createElement('script');
                            el.src = s;
                            el.onload = resolve; el.onerror = resolve;
                            document.body.appendChild(el);
                        })));
                    });
                    let i = 0;
                    const next = () => { if (i >= chain.length) { window._loginPluginsReady = true; return; } chain[i++]().then(next); };
                    next();
                }).catch(() => {});
        }

        function login() {
            const u = document.getElementById('usernameInput').value.trim();
            const p = document.getElementById('passwordInput').value;
            if (!u) return toast('请输入账号', false);
            if (!p) return toast('请输入密码', false);
            fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) {
                        adminToken = d.data.token; adminUser = d.data.username;
                        if (d.data.firstRun) {
                            document.getElementById('loginPage').style.display = 'none';
                            document.getElementById('initPage').style.display = 'flex';
                            initCur = 1;
                            document.getElementById('initLang').value = I18N.lang;
                            initDbTypeChange();
                            initStep(0);
                            return;
                        }
                        /* 记住密码（可选）：WebCrypto AES-GCM 加密 + 持久化登录令牌（仅安全上下文） */
                        const cb = document.getElementById('rememberCb');
                        if (cb && cb.checked) {
                            if (window.isSecureContext) {
                                rememberSave(u, p).then(ok => {
                                    if (ok) { try { localStorage.setItem('ap_token', adminToken); } catch (e) {} }
                                    else { rememberClear(); try { localStorage.removeItem('ap_token'); } catch (e) {} toast('安全保存不可用（需 HTTPS / localhost）', false); }
                                });
                            } else {
                                rememberClear(); try { localStorage.removeItem('ap_token'); } catch (e) {}
                                toast('安全保存不可用（需 HTTPS / localhost）', false);
                            }
                        } else {
                            rememberClear(); try { localStorage.removeItem('ap_token'); } catch (e) {}
                        }
                        enterAdmin();
                    } else toast(d.code === 429 ? '登录过频' : (d.msg || '失败'), false);
                }).catch(() => toast('连接失败', false));
        }

        /* ---- 记住密码（WebCrypto AES-GCM 加密，仅安全上下文可用） ---- */
        function b64u(u8) { let s = ''; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }
        function unb64u(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
        async function rememberSave(u, p) {
            try {
                const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
                const rawKey = await crypto.subtle.exportKey('raw', key);
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(p));
                localStorage.setItem('ap_remember', JSON.stringify({ u, iv: b64u(iv), ct: b64u(new Uint8Array(ct)), key: b64u(new Uint8Array(rawKey)) }));
                return true;
            } catch (e) { return false; }
        }
        async function rememberLoad() {
            try {
                const raw = localStorage.getItem('ap_remember');
                if (!raw) return null;
                const d = JSON.parse(raw);
                const key = await crypto.subtle.importKey('raw', unb64u(d.key), { name: 'AES-GCM' }, false, ['decrypt']);
                const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(d.iv) }, key, unb64u(d.ct));
                return { u: d.u, p: new TextDecoder().decode(pt) };
            } catch (e) { return null; }
        }
        function rememberClear() { try { localStorage.removeItem('ap_remember'); } catch (e) {} }
        function tokenUser(t) { try { return JSON.parse(atob(t.split('.')[0])).u || 'admin'; } catch (e) { return 'admin'; } }

        /* 登录成功后的公共进入流程（登录 / 记住登录恢复共用） */
        function enterAdmin() {
            document.getElementById('loginPage').style.display = 'none';
            document.getElementById('mainPage').style.display = 'block';
            document.getElementById('sideUser').textContent = adminUser;
            loadBannedWords(); loadDanmu(); loadVids(); loadVideos(); loadSubscriptions(); loadFiles(); loadLogs();
            OpenVideoSettings.load(); /* T4：设置页分域渲染 + 主题下拉填充（取代原 loadConfig/populateThemeSelects） */
            startDashPanel();
            loadDashboard(true);
            checkUpdate(false);
            loadAboutVersion();
            loadAdminPlugins();
        }

        /* 页面加载：恢复记住的登录会话（刷新直达控制台）或填充记住的账号密码 */
        async function restoreSession() {
            const token = window.isSecureContext ? (localStorage.getItem('ap_token') || '') : '';
            if (token) {
                try {
                    const r = await fetch('/api/admin/config', { headers: { 'Authorization': 'Bearer ' + token } });
                    const d = await r.json();
                    if (d.code === 0) {
                        adminToken = token;
                        adminUser = tokenUser(token);
                        enterAdmin();
                        return;
                    }
                } catch (e) {}
                try { localStorage.removeItem('ap_token'); } catch (e) {}
            }
            if (window.isSecureContext) {
                const rem = await rememberLoad();
                if (rem) {
                    document.getElementById('usernameInput').value = rem.u;
                    document.getElementById('passwordInput').value = rem.p;
                    const cb = document.getElementById('rememberCb');
                    if (cb) cb.checked = true;
                }
            } else {
                document.getElementById('rememberWrap').style.display = 'none';
            }
        }

        function logout() {
            adminToken = ''; adminUser = '';
            try { localStorage.removeItem('ap_token'); } catch (e) {}
            stopDashPanel();
            /* 清理插件扩展 tab */
            window.OpenVideoAdmin.tabs = [];
            window.OpenVideoAdmin._ready = false;
            document.querySelectorAll('.nav-item[data-tab^="ext-"]').forEach(n => n.remove());
            document.querySelectorAll('.panel[id^="extPanel-"]').forEach(p => p.remove());
            document.getElementById('mainPage').style.display = 'none';
            document.getElementById('loginPage').style.display = 'flex';
            document.getElementById('usernameInput').value = '';
            document.getElementById('passwordInput').value = '';
            document.getElementById('sideUser').textContent = '未登录';
            /* 记住密码时登出后自动填充（方便快速登录；仅在安全上下文） */
            if (window.isSecureContext) {
                rememberLoad().then(function (rem) {
                    if (rem) {
                        document.getElementById('usernameInput').value = rem.u;
                        document.getElementById('passwordInput').value = rem.p;
                        var cb = document.getElementById('rememberCb');
                        if (cb) cb.checked = true;
                    }
                });
            }
        }
        /* 关于页版本号（从服务端动态获取） */
        function loadAboutVersion() {
            fetch('/api/admin/dashboard', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0 || !d.data || !d.data.perf) return;
                    const v = 'v' + d.data.perf.version;
                    document.getElementById('aboutVersion').textContent = v;
                    document.getElementById('aboutFooterVer').textContent = v;
                }).catch(() => {});
        }

        function switchTab(name) {
            const cur = document.querySelector('.nav-item.active');
            if (cur && cur.dataset.tab === 'config' && name !== 'config' && window.OpenVideoSettings && OpenVideoSettings.isDirty() && !confirm(t('有未保存的设置更改，确定离开？'))) return;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === name));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.getElementById(name + 'Panel').classList.add('active');
            if (name === 'api') startApiChart();
            else stopApiChart();
            if (name === 'security') startSecPanel();
            else stopSecPanel();
            if (name === 'console') startDashPanel();
            else stopDashPanel();
            if (name === 'plugins' && !window._plLoaded) { window._plLoaded = true; loadPlugins(); }
            if (name === 'market' && !window._marketLoaded) { window._marketLoaded = true; loadMarket(false); loadMarketSrc(); }
            if (name === 'config' && !window._navEditorLoaded) { window._navEditorLoaded = true; initNavCard(); }
            if (name === 'deps' && !window._depsLoaded) { window._depsLoaded = true; loadDeps(false); }
            if (name === 'db' && !window._dbLoaded) { window._dbLoaded = true; loadDbInfo(); loadDbBrowse(); }
            if (name === 'backup' && !window._bkLoaded) { window._bkLoaded = true; loadBackups(); loadCloudList(); }
            if (name === 'subs' && !window._subsLoaded) { window._subsLoaded = true; loadSubVideos(); }
            if (name === 'openlist' && !window._olLoaded) { window._olLoaded = true; document.getElementById('olFrame').src = '/plugin/openlist/panel'; }
            if (name === 'debug') loadDebugLogs();
            if (window.__mdOnTab) try { __mdOnTab(name); } catch (e) {}
        }

        function loadBannedWords(page) {
            const s = document.getElementById('wordSearch').value.trim();
            wordState.page = page || wordState.page;
            fetch(`/api/admin/banned-words?page=${wordState.page}&limit=${wordState.limit}&search=${encodeURIComponent(s)}`, { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) { wordState.page = d.data.page; wordState.total = d.data.total; renderWordList(d.data.words); renderWordPager(); }
                });
        }
        function renderWordList(w) {
            const c = document.getElementById('wordList');
            c.innerHTML = w.length ? w.map(v => `<span class="tag" data-i18n-skip>${esc(v)}<span class="x" onclick="deleteBannedWord('${esc(v)}')">&times;</span></span>`).join('') : '<div class="empty-state">暂无屏蔽词</div>';
            document.getElementById('wordCount').textContent = `共 ${wordState.total} 条`;
        }
        function renderWordPager() {
            document.getElementById('wordPager').innerHTML = pagerHTML('words', wordState, loadBannedWords);
        }
        function onWordSearch() { wordState.page = 1; loadBannedWords(1); }
        function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
        function addBannedWord() {
            const w = document.getElementById('newWordInput').value.trim();
            if (!w) return toast('请输入关键词', false);
            fetch('/api/admin/banned-words', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ word: w }) })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) { toast('已添加', true); document.getElementById('newWordInput').value = ''; loadBannedWords(wordPage); }
                    else toast(d.msg, false);
                });
        }
        function deleteBannedWord(w) {
            fetch('/api/admin/banned-words', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ word: w }) })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) { toast('已删除', true); const TP = Math.ceil((wordState.total - 1) / wordState.limit); if (wordState.page > TP && TP > 0) wordState.page = TP; loadBannedWords(wordState.page); }
                });
        }

        function loadSubscriptions() {
            fetch('/api/admin/banned-words/subscriptions', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) renderSubscriptions(d.data);
                });
        }
        function renderSubscriptions(list) {
            const c = document.getElementById('subList');
            c.innerHTML = list.length
                ? list.map(u => `<span class="tag">${esc(u)}<span class="x" onclick="deleteSubscription('${esc(u)}')">&times;</span></span>`).join('')
                : '<div class="empty-state">暂无订阅</div>';
        }
        function addSubscription() {
            const url = document.getElementById('subUrlInput').value.trim();
            if (!url) return toast('请输入链接', false);
            fetch('/api/admin/banned-words/subscriptions', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ url }) })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) { toast('已添加', true); document.getElementById('subUrlInput').value = ''; loadSubscriptions(); }
                    else toast(d.msg, false);
                });
        }
        function deleteSubscription(url) {
            fetch('/api/admin/banned-words/subscriptions', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ url }) })
                .then(r => r.json()).then(d => { if (d.code === 0) { toast('已删除', true); loadSubscriptions(); } });
        }
        function refreshBannedWords() {
            fetch('/api/admin/banned-words/refresh', { method: 'POST', headers: authHeaders() })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadBannedWords(1); });
        }

        function loadDanmu(page) {
            const vid = document.getElementById('dmFilterVid').value.trim();
            const search = document.getElementById('dmFilterText').value.trim();
            dmState.page = page || dmState.page;
            let url = '/api/admin/danmu?page=' + dmState.page + '&limit=' + dmState.limit;
            if (vid) url += '&vid=' + encodeURIComponent(vid);
            if (search) url += '&search=' + encodeURIComponent(search);
            fetch(url, { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code === 0) { dmState.page = d.data.page; dmState.total = d.data.total; renderDanmuTable(d.data.list); renderDmPager(); }
            });
        }
        function applyDmFilter() { dmState.page = 1; loadDanmu(1); }
        function clearDmFilter() {
            document.getElementById('dmFilterVid').value = '';
            document.getElementById('dmFilterText').value = '';
            dmState.page = 1; loadDanmu(1);
        }
        function loadVids() {
            fetch('/api/admin/danmu/vids', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code === 0) renderVidList(d.data);
            });
        }
        function renderVidList(vids) {
            const c = document.getElementById('vidList');
            if (!vids.length) { c.innerHTML = '<div class="empty-state" style="font-size:12px">暂无数据</div>'; return; }
            c.innerHTML = vids.map(v => `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="filterByVid('${esc(v.vid)}')"><span style="font-size:12px;color:var(--text);font-family:monospace" title="${esc(v.vid)}">${esc(v.vid).slice(0,12)}</span><span style="font-size:11px;color:var(--text3);flex-shrink:0;margin-left:8px">${v.count}</span></div>`).join('');
        }
        function filterByVid(vid) {
            document.getElementById('dmFilterVid').value = vid;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === 'danmu'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.getElementById('danmuPanel').classList.add('active');
            loadDanmu();
        }
        function renderDanmuTable(list) {
            const tb = document.getElementById('danmuTbody'), em = document.getElementById('danmuEmpty');
            if (!list.length) { tb.innerHTML = ''; em.style.display = 'block'; document.getElementById('dmPager').innerHTML = ''; return; }
            em.style.display = 'none';
            tb.innerHTML = list.map(d => `<tr><td>${new Date(d.date).toLocaleString('zh-CN')}</td><td style="font-size:12px;color:var(--text3)">${esc(d.vid||'-')}</td><td data-i18n-skip><span class="swatch" style="background:${d.color}"></span>${esc(d.text)}</td><td style="font-size:12px;color:var(--text3)">${d.color}</td><td>${d.type==='top'?'<span class="badge top">顶部</span>':d.type==='bottom'?'<span class="badge bottom">底部</span>':'<span class="badge scroll">滚动</span>'}</td><td><button class="btn btn-danger" onclick="deleteDanmu('${d.id}')">删除</button></td></tr>`).join('');
        }
        function renderDmPager() {
            document.getElementById('dmPager').innerHTML = pagerHTML('danmu', dmState, loadDanmu);
        }
        function deleteDanmu(id) {
            if (!confirm('确认删除？')) return;
            fetch('/api/admin/danmu', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id }) })
                .then(r => r.json()).then(d => { if (d.code === 0) { toast('已删除', true); loadDanmu(dmPage); } });
        }


        function changePassword() {
            const o = document.getElementById('cfgOldPwd').value, n = document.getElementById('cfgNewPwd').value;
            if (!o) return toast('请输入原密码', false);
            if (!n || n.length < 4) return toast('新密码至少4位', false);
            fetch('/api/admin/change-password', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ oldPassword: o, newPassword: n }) })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) { toast('已更新', true); document.getElementById('cfgOldPwd').value = ''; document.getElementById('cfgNewPwd').value = ''; }
                    else toast(d.msg, false);
                }).catch(() => toast('连接失败', false));
        }
        function changeUsername() {
            const n = document.getElementById('cfgNewUser').value.trim(), p = document.getElementById('cfgUserPwd').value;
            if (!n) return toast('请输入新用户名', false);
            if (n.length < 2) return toast('用户名至少2位', false);
            if (!p) return toast('请输入密码', false);
            fetch('/api/admin/change-username', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ newUsername: n, password: p }) })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) { if (d.data && d.data.token) { adminToken = d.data.token; adminUser = d.data.username; document.getElementById('sideUser').textContent = adminUser; } toast('已更换', true); document.getElementById('cfgNewUser').value = ''; document.getElementById('cfgUserPwd').value = ''; }
                    else toast(d.msg, false);
                }).catch(() => toast('连接失败', false));
        }

        let allVideos = [], videoState = { page: 1, total: 0, limit: 50 };
        function loadVideos() {
            fetch('/api/admin/videos', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code === 0) { allVideos = d.data || []; videoState.total = allVideos.length; renderVideos(); }
            });
        }
        function renderVideos() {
            document.getElementById('videoCount').textContent = `共 ${videoState.total} 条`;
            const c = document.getElementById('videoTable');
            if (!allVideos.length) { c.innerHTML = '<div class="empty-state">暂无映射，播放视频时会自动记录</div>'; document.getElementById('videoPager').innerHTML = ''; return; }
            const start = (videoState.page - 1) * videoState.limit;
            const list = allVideos.slice(start, start + videoState.limit);
            c.innerHTML = `<table><thead><tr><th style="width:32px"><input type="checkbox" id="videoSelectAllTop" onclick="videoToggleSelectAll()" style="accent-color:var(--primary)"></th><th>视频码</th><th>链接</th><th>操作</th></tr></thead><tbody>${list.map(v=>`<tr><td><input type="checkbox" class="video-cb" value="${esc(v.vid)}" style="accent-color:var(--primary)"></td><td data-i18n-skip style="font-size:12px;font-family:monospace;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v.vid)}">${esc(v.vid)}</td><td data-i18n-skip style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><a href="${esc(v.url)}" target="_blank" style="color:var(--accent);font-size:12px">${esc(v.url)}</a></td><td><button class="btn btn-danger" onclick="deleteVideo('${esc(v.vid)}')">删除</button></td></tr>`).join('')}</tbody></table>`;
            document.getElementById('videoPager').innerHTML = pagerHTML('videos', videoState, renderVideos);
        }
        function addVideo() {
            const vid = document.getElementById('newVid').value.trim();
            const url = document.getElementById('newVidUrl').value.trim();
            if (!vid || !url) return toast('请填写视频码和链接', false);
            fetch('/api/admin/videos', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ vid, url }) })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) { toast('已保存', true); document.getElementById('newVid').value=''; document.getElementById('newVidUrl').value=''; loadVideos(); }
                    else toast(d.msg, false);
                }).catch(() => toast('连接失败', false));
        }
        function deleteVideo(vid) {
            if (!confirm('确认删除？')) return;
            fetch('/api/admin/videos/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ vid }) })
                .then(r => r.json()).then(d => { if (d.code === 0) { toast('已删除', true); loadVideos(); } });
        }

        /* ===== Files ===== */
        let currentFilePath = '';
        function fileGo(p) {
            currentFilePath = p || '';
            loadFiles();
        }
        function fileUp() {
            if (!currentFilePath) return;
            const parts = currentFilePath.split('/').filter(Boolean);
            parts.pop();
            currentFilePath = parts.join('/');
            loadFiles();
        }
        function loadFiles() {
            fetch('/api/admin/files?path=' + encodeURIComponent(currentFilePath), { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) { toast(d.msg || '加载失败', false); return; }
                    const data = d.data;
                    document.getElementById('filePath').textContent = '/' + (data.path || '');
                    document.getElementById('fileContentCard').style.display = 'none';
                    const tb = document.getElementById('fileTbody'), em = document.getElementById('fileEmpty');
                    if (data.type === 'file') {
                        tb.innerHTML = '';
                        em.style.display = 'none';
                        const cc = document.getElementById('fileContentCard');
                        cc.style.display = 'block';
                        document.getElementById('fileContentName').textContent = data.name + ' (' + fmtSize(data.size) + ')';
                        document.getElementById('fileContent').textContent = data.tooLarge ? '[文件超过 200KB，无法预览]' : (data.content || '[空文件]');
                        return;
                    }
                    if (!data.entries.length) { tb.innerHTML = ''; em.style.display = 'block'; return; }
                    em.style.display = 'none';
                    tb.innerHTML = data.entries.map(e => {
                        const name = esc(e.name);
                        const fp = currentFilePath ? currentFilePath + '/' + e.name : e.name;
                        const fpEsc = fp.replace(/'/g, "\\'");
                        const cb = `<input type="checkbox" class="file-cb" value="${fpEsc}" onclick="event.stopPropagation()">`;
                        if (e.dir) {
                            const ic = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;color:var(--accent)"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
                            return `<tr style="cursor:pointer" onclick="fileGo('${fpEsc}')"><td>${cb}</td><td data-i18n-skip>${ic} ${name}</td><td>—</td><td><button class="btn btn-sm" onclick="event.stopPropagation();fileGo('${fpEsc}')">${t('打开')}</button></td></tr>`;
                        }
                        const ic = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:6px;color:var(--text3)"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
                        return `<tr><td>${cb}</td><td data-i18n-skip>${ic} ${name}</td><td>${fmtSize(e.size)}</td><td><button class="btn btn-sm" onclick="viewFile('${fpEsc}')">${t('查看')}</button></td></tr>`;
                    }).join('');
                }).catch(() => toast('加载失败', false));
        }
        function viewFile(p) {
            currentFilePath = p;
            loadFiles();
        }
        function fmtSize(b) {
            if (b < 1024) return b + ' B';
            if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
            if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
            if (b < 1099511627776) return (b / 1073741824).toFixed(2) + ' GB';
            return (b / 1099511627776).toFixed(2) + ' TB';
        }
        function getSelectedFiles() {
            return Array.from(document.querySelectorAll('.file-cb:checked')).map(c => c.value);
        }
        function toggleSelectAll() {
            const all = document.getElementById('fileSelectAll').checked;
            document.querySelectorAll('.file-cb').forEach(c => c.checked = all);
        }
        function fileBatch(action) {
            const sel = getSelectedFiles();
            if (!sel.length) { toast('请先选择文件', false); return; }
            if (action === 'unzip') {
                const exts = /\.(zip|7z|rar|gz|tgz|tar|xz|bz2|tbz2|iso|img|lzh|cab|arj|z)$/i;
                const arcs = sel.filter(p => exts.test(p));
                if (!arcs.length) { toast('请选择压缩包（zip/7z/rar/gz/tar/xz/iso/img 等）', false); return; }
                if (!confirm('确认解压所选 ' + arcs.length + ' 个文件到当前目录？')) return;
                let done = 0;
                arcs.forEach(p => {
                    fetch('/api/admin/files/unzip', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ path: p }) })
                        .then(r => r.json()).then(d => { done++; toast(d.msg, d.code === 0); if (done === arcs.length) loadFiles(); });
                });
                return;
            }
            if (action === 'delete' && !confirm('确认删除所选 ' + sel.length + ' 项？此操作不可恢复！')) return;
            const body = action === 'zip'
                ? JSON.stringify({ paths: sel, format: document.getElementById('zipFormat').value })
                : JSON.stringify({ paths: sel });
            fetch('/api/admin/files/' + action, { method: 'POST', headers: authHeaders(), body })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadFiles(); });
        }
        function uploadFiles() {
            const input = document.getElementById('fileUploadInput');
            const files = input.files;
            if (!files.length) return;
            const fd = new FormData();
            fd.append('dir', currentFilePath || '');
            Array.from(files).forEach(f => fd.append('files', f));
            fetch('/api/admin/files/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + adminToken }, body: fd })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); input.value = ''; loadFiles(); })
                .catch(() => { toast('上传失败', false); input.value = ''; });
        }

        /* ===== Logs ===== */
        let logState = { limit: 100 };
        function loadLogs() {
            const lim = document.getElementById('logLimitSel');
            if (lim) logState.limit = +lim.value;
            fetch('/api/admin/logs?limit=' + logState.limit, { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const tb = document.getElementById('logTbody'), em = document.getElementById('logEmpty');
                    if (!d.data.length) { tb.innerHTML = ''; em.style.display = 'block'; return; }
                    em.style.display = 'none';
                    tb.innerHTML = d.data.map(l => {
                        const st = l.s >= 400 ? 'var(--danger)' : l.s >= 300 ? 'var(--warn)' : 'var(--success)';
                        const meth = l.m === 'GET' ? 'var(--accent)' : l.m === 'POST' ? 'var(--primary)' : l.m === 'DELETE' ? 'var(--danger)' : 'var(--text2)';
                        return `<tr><td style="font-size:11px;color:var(--text3)">${esc(new Date(l.t).toLocaleTimeString('zh-CN'))}</td><td style="color:${meth};font-weight:600">${esc(l.m)}</td><td data-i18n-skip style="font-size:12px;font-family:monospace">${esc(l.p)}</td><td style="color:${st};font-weight:600">${l.s}</td><td style="font-size:11px;color:var(--text3)">${esc(l.ip)}</td><td style="font-size:11px;color:var(--text3)">${l.ms}ms</td></tr>`;
                    }).join('');
                }).catch(() => {});
        }

        /* ===== Debug Logs ===== */
        let debugLogState = { limit: 100, src: 'all' };
        function loadDebugLogs() {
            const lim = document.getElementById('debugLimitSel');
            if (lim) debugLogState.limit = +lim.value;
            const sel = document.getElementById('debugSrcSel');
            if (sel) debugLogState.src = sel.value;
            fetch('/api/admin/debug-logs?limit=' + debugLogState.limit, { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    let rows = d.data || [];
                    if (debugLogState.src === 'core') rows = rows.filter(l => l.src === 'core');
                    else if (debugLogState.src === 'plugin') rows = rows.filter(l => String(l.src).startsWith('plugin:'));
                    const tb = document.getElementById('debugLogTbody'), em = document.getElementById('debugLogEmpty');
                    if (!rows.length) { tb.innerHTML = ''; em.style.display = 'block'; return; }
                    em.style.display = 'none';
                    tb.innerHTML = rows.map(l => {
                        const st = l.s >= 400 ? 'var(--danger)' : l.s >= 300 ? 'var(--warn)' : 'var(--success)';
                        const meth = l.m === 'GET' ? 'var(--accent)' : l.m === 'POST' ? 'var(--primary)' : l.m === 'DELETE' ? 'var(--danger)' : 'var(--text2)';
                        const isPlug = String(l.src || '').startsWith('plugin:');
                        const srcCol = isPlug
                            ? '<span class="pl-chip" style="color:var(--primary)">' + esc(String(l.src).slice(7)) + '</span>'
                            : '<span class="pl-chip" style="color:var(--accent)">本体</span>';
                        return `<tr><td style="font-size:11px;color:var(--text3)">${esc(new Date(l.t).toLocaleTimeString('zh-CN'))}</td><td>${srcCol}</td><td style="color:${meth};font-weight:600">${esc(l.m)}</td><td style="font-family:monospace;font-size:12px">${esc(l.p)}</td><td style="color:${st};font-weight:600">${esc(l.s)}</td><td style="font-size:11px;color:var(--text3)">${esc(l.ip || '-')}</td><td style="font-size:11px;color:var(--text3)">${esc(l.ms || 0)}ms</td></tr>`;
                    }).join('');
                }).catch(() => {});
        }

        /* ===== Topbar: 重启 + 任务列表 ===== */
        (function () {
            var pop = document.getElementById('mdTaskPop');
            var badge = document.getElementById('taskBadge');
            document.getElementById('mdRestartBtn').addEventListener('click', function () {
                if (!confirm(t('确定重启服务？期间服务短暂不可用'))) return;
                var btn = this; btn.disabled = true;
                fetch('/api/admin/restart', { method: 'POST', headers: authHeaders() })
                    .then(function (r) { return r.json(); }).then(function (d) {
                        toast(d.msg || t('重启指令已下发'), d.code === 0);
                        setTimeout(function () { location.reload(); }, 5000);
                    }).catch(function () { btn.disabled = false; toast(t('重启请求失败'), false); });
            });
            document.getElementById('mdTasksBtn').addEventListener('click', function (e) {
                e.stopPropagation();
                pop.style.display = pop.style.display === 'none' ? '' : 'none';
                if (pop.style.display !== 'none') loadAdminTasks();
            });
            document.addEventListener('click', function (e) {
                if (pop.style.display !== 'none' && !pop.contains(e.target) && !e.target.closest('#mdTasksBtn')) pop.style.display = 'none';
            });
            var TYPE_LBL = { dep: t('依赖'), plugin: t('插件'), update: t('程序更新'), restart: t('服务重启') };
            var ST_LBL = { running: t('运行中'), done: t('已完成'), failed: t('失败') };
            window.loadAdminTasks = function () {
                fetch('/api/admin/tasks', { headers: authHeaders() })
                    .then(function (r) { return r.json(); }).then(function (d) {
                        if (d.code !== 0) return;
                        var rows = d.data || [];
                        var running = rows.filter(function (x) { return x.status === 'running'; }).length;
                        badge.style.display = running ? '' : 'none';
                        badge.textContent = running;
                        var body = document.getElementById('taskListBody'), em = document.getElementById('taskEmpty');
                        if (!rows.length) { body.innerHTML = ''; em.style.display = 'block'; return; }
                        em.style.display = 'none';
                        /* 按 batch 分组：每批渲染进度条（完成/总数+百分比填充），无批任务不显条 */
                        var groups = {};
                        rows.forEach(function (x) {
                            var k = x.batch || '__none__';
                            (groups[k] = groups[k] || []).push(x);
                        });
                        var html = '';
                        Object.keys(groups).forEach(function (k) {
                            var g = groups[k];
                            if (k !== '__none__') {
                                var done = g.filter(function (x) { return x.status !== 'running'; }).length;
                                var pct = Math.round(done * 100 / g.length);
                                html += '<div style="margin:4px 0 6px">' +
                                    '<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--text3);margin-bottom:3px">' +
                                    '<b style="color:var(--text)">' + esc(TYPE_LBL[g[0].type] || g[0].type) + '</b>' +
                                    '<span>' + t('进度') + ' ' + done + '/' + g.length + '</span></div>' +
                                    '<div style="height:6px;border-radius:3px;background:var(--surface2);overflow:hidden">' +
                                    '<div style="height:100%;width:' + pct + '%;background:var(--primary);border-radius:3px;transition:width .3s"></div></div></div>';
                            }
                            html += g.map(function (x) {
                                var col = x.status === 'failed' ? 'var(--danger)' : x.status === 'running' ? 'var(--warn)' : 'var(--success)';
                                return '<div style="display:flex;align-items:center;gap:8px;padding:8px 4px;border-bottom:1px solid var(--border)">' +
                                    '<span class="pl-chip" style="color:var(--primary)">' + esc(TYPE_LBL[x.type] || x.type) + '</span>' +
                                    '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px" title="' + esc(x.name) + '">' + esc(x.name) + '</span>' +
                                    '<span class="pl-chip" style="color:' + col + '">' + esc(ST_LBL[x.status] || x.status) + '</span>' +
                                    '<span style="font-size:10px;color:var(--text3)">' + esc(new Date(x.at).toLocaleTimeString('zh-CN')) + '</span></div>';
                            }).join('');
                        });
                        body.innerHTML = html;
                        /* 有任务进行且弹层打开时 5 秒加速轮询（闲时 15 秒） */
                        if (running && pop.style.display !== 'none' && !window._tpQ) {
                            window._tpQ = true;
                            setTimeout(function () { window._tpQ = false; if (pop.style.display !== 'none') loadAdminTasks(); }, 5000);
                        }
                    }).catch(function () {});
            };
            setInterval(function () { if (adminToken) loadAdminTasks(); }, 15000);
        })();

        /* ===== API Management ===== */
        const API_COLORS = [mdVar('--accent', '#62d5ff'), mdVar('--primary', '#a78bfa'), '#ff85a2', '#64dd17', '#ff8c42', '#34d399', '#f59e0b', '#ff4d6a', '#00d4ff', '#c792ea'];
        let apiChartTimer = null;
        function loadApiStats() {
            const span = parseInt(document.getElementById('apiChartSpan').value) || 3600;
            fetch('/api/admin/api/stats?span=' + span, { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const data = d.data;
                    // config table
                    const tb = document.getElementById('apiConfigTbody');
                    tb.innerHTML = Object.entries(data.rules).map(([path, r]) => `
                        <tr>
                            <td style="font-family:monospace;font-size:12px">${esc(path)}</td>
                            <td><input type="checkbox" class="api-enabled" data-path="${esc(path)}" ${r.enabled ? 'checked' : ''}></td>
                            <td><input type="number" class="api-rps" data-path="${esc(path)}" min="0" value="${r.rps || 0}" style="width:70px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text);font-size:12px"></td>
                            <td><input type="number" class="api-bw" data-path="${esc(path)}" min="0" value="${r.bandwidth || 0}" style="width:80px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;background:var(--surface2);color:var(--text);font-size:12px"></td>
                        </tr>`).join('');
                    document.getElementById('apiRetention').value = data.retentionDays || 1;
                    // uptime & totals
                    document.getElementById('apiUptime').textContent = fmtUptime(data.uptimeSec);
                    document.getElementById('apiTotalCalls').textContent = data.totalCalls.toLocaleString();
                    document.getElementById('apiTotalBytes').textContent = fmtSize(data.totals.bytes ? Object.values(data.totals.bytes).reduce((a,b)=>a+b,0) : 0);
                    // per path
                    document.getElementById('apiPerPath').innerHTML = Object.entries(data.totals.calls).map(([p, c]) =>
                        `<div style="display:flex;justify-content:space-between;gap:16px"><span style="font-family:monospace">${esc(p)}</span><span>${c.toLocaleString()} 次 · ${fmtSize((data.totals.bytes||{})[p]||0)}</span></div>`).join('');
                    // chart (buckets at 1s/60s/1h granularity per span)
                    drawApiChart(data.buckets, data.rules, data.bucketUnit || 1);
                }).catch(() => {});
        }
        function fmtUptime(sec) {
            const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
            return (d ? d + '天 ' : '') + (h ? h + '小时 ' : '') + (m ? m + '分 ' : '') + s + '秒';
        }
        function drawApiChart(buckets, rules, unit) {
            const canvas = document.getElementById('apiChart');
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const W = rect.width, H = rect.height;
            ctx.clearRect(0, 0, W, H);
            const paths = Object.keys(rules);
            if (!paths.length) return;
            document.getElementById('apiChartLegend').innerHTML = paths.map((p, i) =>
                `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:10px;height:10px;border-radius:2px;background:${API_COLORS[i % API_COLORS.length]}"></span>${esc(p)}</span>`).join('');
            if (!buckets.length) {
                ctx.fillStyle = mdVar('--text3', '#8e8ea8');
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('暂无数据', W / 2, H / 2);
                return;
            }
            // group buckets: ~120 bars max
            const groupSec = Math.max(1, Math.ceil(buckets.length / 120)) * unit;
            const bars = [];
            for (let i = 0; i < buckets.length; i += groupSec / unit) {
                const slice = buckets.slice(i, i + groupSec / unit);
                const g = { t: slice[0].t, calls: {}, bytes: {} };
                slice.forEach(b => {
                    for (const [p, c] of Object.entries(b.calls)) g.calls[p] = (g.calls[p] || 0) + c;
                    for (const [p, by] of Object.entries(b.bytes)) g.bytes[p] = (g.bytes[p] || 0) + by;
                });
                bars.push(g);
            }
            const padL = 8, padB = 22, padT = 10;
            const chartH = H - padB - padT;
            const bw = Math.max(3, Math.min(20, (W - padL - 10) / bars.length));
            const maxY = Math.max(1, ...bars.map(b => Object.values(b.calls).reduce((a, c) => a + c, 0)));
            const labelFmt = unit >= 3600
                ? (t) => new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                : unit >= 60
                    ? (t) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                    : (t) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            bars.forEach((b, bi) => {
                const x = padL + bi * bw;
                const yBase = padT + chartH;
                let cumH = 0;
                paths.forEach((p, pi) => {
                    const count = b.calls[p] || 0;
                    const h = count / maxY * chartH;
                    ctx.fillStyle = API_COLORS[pi % API_COLORS.length];
                    ctx.globalAlpha = 0.85;
                    ctx.fillRect(x, yBase - cumH - h, bw - 1, h);
                    cumH += h;
                });
                ctx.globalAlpha = 1;
                if (bi % Math.max(1, Math.floor(bars.length / 6)) === 0) {
                    ctx.fillStyle = mdVar('--text3', '#8e8ea8');
                    ctx.font = '9px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(labelFmt(b.t), x + bw / 2, H - 6);
                }
            });
            ctx.strokeStyle = mdRgba(mdVar('--text3', '#8e8ea8'), .3);
            for (let g = 1; g <= 4; g++) {
                const y = padT + chartH * g / 5;
                ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W, y); ctx.stroke();
            }
        }
        function saveApiConfig() {
            const apis = {};
            document.querySelectorAll('#apiConfigTbody tr').forEach(tr => {
                const path = tr.querySelector('.api-enabled').dataset.path;
                apis[path] = {
                    enabled: tr.querySelector('.api-enabled').checked,
                    rps: parseInt(tr.querySelector('.api-rps').value) || 0,
                    bandwidth: parseInt(tr.querySelector('.api-bw').value) || 0
                };
            });
            const retentionDays = parseInt(document.getElementById('apiRetention').value) || 1;
            fetch('/api/admin/api', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ apis, retentionDays }) })
                .then(r => r.json()).then(d => toast(d.msg, d.code === 0));
        }
        function startApiChart() {
            stopApiChart();
            loadApiStats();
            apiChartTimer = setInterval(loadApiStats, 3000);
        }
        function stopApiChart() { if (apiChartTimer) { clearInterval(apiChartTimer); apiChartTimer = null; } }

        /* ===== 安全中心 ===== */
        let secIpState = { page: 1, total: 0, limit: 50 };
        let secMapChart = null, secMapTimer = null, secMapScope = 'world';

        function secFmtBytes(n) {
            n = n || 0;
            if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
            if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
            if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
            return n + ' B';
        }
        function secFmtTime(t) {
            if (!t) return '—';
            const d = new Date(t);
            const pad = n => String(n).padStart(2, '0');
            return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        }
        function loadGeoInfo() {
            fetch('/api/admin/security/geo/info', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0) return;
                const fmt = f => f ? `${f.file} ${(f.size / 1048576).toFixed(1)}MB · ${t('更新于')} ${secFmtTime(f.mtime)}` : `${f ? f.file : ''} ${t('未下载')}`;
                const el = document.getElementById('secGeoInfo');
                el.textContent = `v4: ${d.data.v4 ? fmt(d.data.v4) : t('未下载')}；v6: ${d.data.v6 ? fmt(d.data.v6) : t('未下载')}；${d.data.inUse ? t('已启用 xdb 查询') : t('使用兜底库')}`;
            }).catch(() => {});
        }
        function updateGeoDb() {
            const btn = event && event.target ? event.target : null;
            if (btn) { btn.disabled = true; btn.textContent = '更新中...'; }
            fetch('/api/admin/security/geo/update', { method: 'POST', headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    toast(d.msg, d.code === 0);
                    if (d.code === 0) { loadGeoInfo(); renderSecMap(); }
                }).catch(() => toast('更新失败', false))
                .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '立即更新'; } });
        }
        function secStatusHtml(s) {
            if (s === 'banned') return '<span style="color:var(--danger)">已封禁</span>';
            if (s === 'whitelist') return '<span style="color:var(--success)">白名单</span>';
            return '<span style="color:var(--text2)">正常</span>';
        }
        function esc2(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

        function loadSecurity() {
            fetch('/api/admin/security/overview', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0) return;
                document.getElementById('secTotalCalls').textContent = d.data.totalCalls.toLocaleString();
                document.getElementById('secTotalBytes').textContent = secFmtBytes(d.data.totalBytes);
                document.getElementById('secActiveIps').textContent = d.data.activeIps;
                document.getElementById('secAllIps').textContent = d.data.allIps;
                document.getElementById('secAnomalyTotal').textContent = d.data.anomalies;
                document.getElementById('secBannedTotal').textContent = d.data.banned;
                document.getElementById('secWlTotal').textContent = d.data.whitelist;
            }).catch(() => {});
            fetch('/api/admin/security/anomalies', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0) return;
                document.getElementById('secAnomalyCount').textContent = `共 ${d.data.length} 个`;
                const c = document.getElementById('secAnomalyList');
                c.innerHTML = d.data.length ? '<div class="tbl-wrap"><table><thead><tr><th>IP</th><th>地区</th><th>运营商</th><th>原因</th><th>操作</th></tr></thead><tbody>' +
                    d.data.map(a => `<tr>
                        <td style="color:var(--danger);font-weight:600">${esc2(a.ip)}</td>
                        <td>${esc2(a.region)}</td>
                        <td>${esc2(a.isp || '—')}</td>
                        <td>${a.reasons.map(r => esc2(r)).join('<br>')}</td>
                        <td><button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="secBan('${a.ip}','异常封禁')">封禁</button></td>
                    </tr>`).join('') + '</tbody></table></div>'
                    : '<div class="empty-state">暂无异常 IP</div>';
            }).catch(() => {});
            fetch('/api/admin/security/lists', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0) return;
                const b = document.getElementById('secBanList');
                b.innerHTML = d.data.banned.length ? d.data.banned.map(x =>
                    `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px">
                        <span style="color:var(--danger);font-weight:600;font-family:monospace">${esc2(x.ip)}</span>
                        <span style="color:var(--text3)">${esc2(x.reason || '无理由')} · ${secFmtTime(x.at)}</span>
                        <button class="btn btn-sm" onclick="secUnban('${x.ip}')">解除</button>
                    </div>`).join('') : '<div class="empty-state">无封禁 IP</div>';
                const w = document.getElementById('secWlList');
                w.innerHTML = d.data.whitelist.length ? d.data.whitelist.map(x =>
                    `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 8px;background:var(--surface2);border:1px solid var(--border);border-radius:6px">
                        <span style="color:var(--success);font-weight:600;font-family:monospace">${esc2(x.ip)}</span>
                        <span style="color:var(--text3)">${secFmtTime(x.at)}</span>
                        <button class="btn btn-sm" onclick="secUnwl('${x.ip}')">移除</button>
                    </div>`).join('') : '<div class="empty-state">无白名单 IP</div>';
            }).catch(() => {});
            fetch('/api/admin/config', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0 || !d.data.security) return;
                const a = d.data.security.anomaly || {};
                document.getElementById('secReqPerMin').value = a.reqPerMin || 60;
                document.getElementById('secMbPerMin').value = a.mbPerMin || 20;
                document.getElementById('secReqPerHour').value = a.reqPerHour || 2000;
                document.getElementById('secMbPerHour').value = a.mbPerHour || 1024;
                const ll = d.data.security.loginLimit || {};
                document.getElementById('secLoginMaxFail').value = ll.maxFail || 5;
                document.getElementById('secLoginWindow').value = ll.windowMin || 10;
                document.getElementById('secLoginLock').value = ll.lockMin || 15;
            }).catch(() => {});
        }
        function loadSecIps() {
            const window = document.getElementById('secIpWindow').value;
            const sort = document.getElementById('secIpSort').value;
            const search = document.getElementById('secIpSearch').value.trim();
            fetch(`/api/admin/security/ips?window=${window}&sort=${sort}&search=${encodeURIComponent(search)}&page=${secIpState.page}&limit=${secIpState.limit}`, { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    secIpState.total = d.data.total;
                    const tb = document.getElementById('secIpTbody');
                    tb.innerHTML = d.data.list.length ? d.data.list.map(x => `<tr>
                        <td style="font-family:monospace;color:var(--accent)">${esc2(x.ip)}</td>
                        <td>${esc2(x.region)}</td>
                        <td>${esc2(x.isp || '—')}</td>
                        <td>${x.winCalls}</td>
                        <td>${secFmtBytes(x.winBytes)}</td>
                        <td>${x.totalCalls}</td>
                        <td>${secFmtBytes(x.totalBytes)}</td>
                        <td>${secFmtTime(x.last)}</td>
                        <td>${secStatusHtml(x.status)}</td>
                        <td style="white-space:nowrap">
                            ${x.status === 'banned' ? `<button class="btn btn-sm" onclick="secUnban('${x.ip}')">解封</button>` :
                              x.status === 'whitelist' ? `<button class="btn btn-sm" onclick="secUnwl('${x.ip}')">移出白</button>` :
                              `<button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="secBan('${x.ip}','手动封禁')">封禁</button>
                               <button class="btn btn-sm btn-primary" onclick="secWl('${x.ip}')">加白</button>`}
                        </td>
                    </tr>`).join('') : '<tr><td colspan="10"><div class="empty-state">暂无数据</div></td></tr>';
                    renderSecPager();
                }).catch(() => {});
        }
        function renderSecPager() {
            document.getElementById('secIpPager').innerHTML = pagerHTML('secIps', secIpState, loadSecIps);
        }
        function secPost(url, body, msg) {
            fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
                .then(r => r.json()).then(d => { toast(d.msg || msg, d.code === 0); if (d.code === 0) { loadSecurity(); loadSecIps(); } })
                .catch(() => toast('请求失败', false));
        }
        function secBan(ip, reason) { secPost('/api/admin/security/ban', { ip, reason }, '已封禁'); }
        function secUnban(ip) { secPost('/api/admin/security/unban', { ip }, '已解封'); }
        function secWl(ip) { secPost('/api/admin/security/whitelist', { ip }, '已加白'); }
        function secUnwl(ip) { secPost('/api/admin/security/unwhitelist', { ip }, '已移除'); }
        function secBanManual() {
            const ip = document.getElementById('secBanInput').value.trim();
            if (!ip) return toast('请输入 IP', false);
            secBan(ip, '手动封禁');
            document.getElementById('secBanInput').value = '';
        }
        function secWlManual() {
            const ip = document.getElementById('secWlInput').value.trim();
            if (!ip) return toast('请输入 IP', false);
            secWl(ip);
            document.getElementById('secWlInput').value = '';
        }
        function saveSecConfig() {
            const body = {
                reqPerMin: parseInt(document.getElementById('secReqPerMin').value) || 60,
                mbPerMin: parseInt(document.getElementById('secMbPerMin').value) || 20,
                reqPerHour: parseInt(document.getElementById('secReqPerHour').value) || 2000,
                mbPerHour: parseInt(document.getElementById('secMbPerHour').value) || 1024
            };
            secPost('/api/admin/security/config', body, '阈值已保存');
        }
        /* ===== 登录记录与防护 ===== */
        let loginState = { page: 1, total: 0, limit: 50 };
        function secLoginStatus(x) {
            if (x.ok) return '<span style="color:var(--success)">成功</span>';
            if (x.r === 'locked') return '<span style="color:var(--warn)">锁定</span>';
            if (x.r && x.r.indexOf('lock:') === 0) return '<span style="color:var(--danger)">触发锁定</span>';
            return '<span style="color:var(--danger)">失败</span>';
        }
        function secLoginReason(x) {
            if (x.r === 'ok') return '—';
            if (x.r === 'locked') return '锁定中拒绝';
            if (x.r === 'fail') return '账号或密码错误';
            if (x.r === 'params') return '参数不完整';
            if (x.r && x.r.indexOf('lock:') === 0) return `失败超限，锁定 ${x.r.split(':')[1]} 分钟`;
            return esc2(x.r || '');
        }
        function loadLoginLogs() {
            fetch(`/api/admin/security/logins?page=${loginState.page}&limit=${loginState.limit}`, { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    loginState.total = d.data.total;
                    const tb = document.getElementById('secLoginTbody');
                    tb.innerHTML = d.data.list.length ? d.data.list.map(x => `<tr>
                        <td style="font-size:11px;color:var(--text3);white-space:nowrap">${secFmtTime(x.t)}</td>
                        <td style="font-family:monospace;color:var(--accent)">${esc2(x.ip)}</td>
                        <td>${esc2(x.u || '—')}</td>
                        <td>${secLoginStatus(x)}</td>
                        <td style="font-size:12px;color:var(--text2)">${secLoginReason(x)}</td>
                        <td>${esc2(x.region)}</td>
                        <td style="white-space:nowrap">
                            <button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="secBan('${x.ip}','登录异常封禁')">封禁</button>
                            <button class="btn btn-sm btn-primary" onclick="secWl('${x.ip}')">加白</button>
                        </td>
                    </tr>`).join('') : '<tr><td colspan="7"><div class="empty-state">暂无登录记录</div></td></tr>';
                    renderLoginPager();
                    const locked = d.data.locked || [];
                    document.getElementById('secLoginLocked').textContent = locked.length ? `当前锁定 ${locked.length} 个 IP` : '';
                }).catch(() => {});
        }
        function renderLoginPager() {
            document.getElementById('secLoginPager').innerHTML = pagerHTML('logins', loginState, loadLoginLogs);
        }
        function saveLoginLimit() {
            const body = {
                maxFail: parseInt(document.getElementById('secLoginMaxFail').value) || 5,
                windowMin: parseInt(document.getElementById('secLoginWindow').value) || 10,
                lockMin: parseInt(document.getElementById('secLoginLock').value) || 15
            };
            secPost('/api/admin/security/login-limit', body, '登录防护设置已保存');
        }
        function renderSecMap() {
            const el = document.getElementById('secMap');
            if (!window.echarts) {
                el.innerHTML = '<div class="empty-state">ECharts 加载失败（CDN 不可达），表格视图仍可用</div>';
                return;
            }
            if (!secMapChart) {
                secMapChart = echarts.init(el);
                window.addEventListener('resize', () => secMapChart && secMapChart.resize());
            }
            document.getElementById('secMapScopeWorld').classList.toggle('btn-primary', secMapScope === 'world');
            document.getElementById('secMapScopeChina').classList.toggle('btn-primary', secMapScope === 'china');
            const isChina = secMapScope === 'china';
            const mapName = isChina ? 'china' : 'world';
            const mapUrl = isChina ? 'https://cdn.jsdelivr.net/npm/echarts@4.9.0/map/json/china.json' : 'https://cdn.jsdelivr.net/npm/echarts@4.9.0/map/json/world.json';
            const ptsReq = fetch('/api/admin/security/ips?window=m&sort=calls&limit=200', { headers: authHeaders() }).then(r => r.json());
            const regionsReq = fetch('/api/admin/security/geo/regions?scope=' + secMapScope, { headers: authHeaders() }).then(r => r.json());
            const mapReq = fetch(mapUrl).then(r => r.json());
            Promise.all([ptsReq, regionsReq, mapReq]).then(([pd, rd, geoJson]) => {
                const pts = pd.data.list.filter(x => x.coords).map(x => ({
                    name: x.ip,
                    value: [x.coords[0], x.coords[1], x.totalCalls],
                    status: x.status, region: x.region, isp: x.isp || '', winCalls: x.winCalls
                }));
                let mapData = [];
                if (isChina) {
                    const agg = {};
                    rd.data.forEach(r => { agg[r.name] = r.calls; });
                    mapData = geoJson.features.map(f => {
                        const name = f.properties && f.properties.name;
                        return agg[name] != null ? { name, value: agg[name] } : { name };
                    });
                } else {
                    const byCode = {}, byName = {};
                    rd.data.forEach(r => { if (r.code) byCode[r.code] = r.calls; byName[r.name] = r.calls; });
                    mapData = geoJson.features.map(f => {
                        const name = f.properties && f.properties.name;
                        const id = f.id;
                        let v = byCode[id] != null ? byCode[id] : (byName[name] != null ? byName[name] : null);
                        return v != null ? { name, value: v } : { name };
                    });
                }
                echarts.registerMap(mapName, geoJson);
                const maxMap = Math.max(1, ...mapData.filter(d => d.value != null).map(d => d.value));
                const maxPts = Math.max(1, ...pts.map(p => p.value[2]));
                secMapChart.setOption({
                    backgroundColor: 'transparent',
                    geo: { map: mapName, roam: true, zoom: isChina ? 1 : 1.2, itemStyle: { areaColor: mdVar('--surface2', '#131a2b'), borderColor: mdVar('--border', 'rgba(255,255,255,.12)') } },
                    tooltip: {
                        trigger: 'item',
                        formatter: p => {
                            if (p.seriesType === 'effectScatter') {
                                return `<b>${p.data.name}</b><br>地区：${p.data.region}<br>运营商：${p.data.isp || '—'}<br>窗口请求：${p.data.winCalls}<br>总请求：${p.data.value[2]}`;
                            }
                            if (p.seriesType === 'map') {
                                return `<b>${p.name}</b><br>请求数：${p.value != null ? p.value.toLocaleString() : '—'}`;
                            }
                            return p.name;
                        }
                    },
                    visualMap: [
                        {
                            min: 0, max: maxMap, seriesIndex: 0, orient: 'horizontal',
                            left: 'center', bottom: 0, text: ['高', '低'],
                            textStyle: { color: mdVar('--text2', '#8e8ea8'), fontSize: 10 },
                            inRange: { color: [mdVar('--bg', '#101826'), mdVar('--surface', '#1e3a5f'), mdVar('--surface2', '#2e6e9e'), mdVar('--accent', '#62d5ff'), mdVar('--danger', '#ff4d6a')] }
                        },
                        { min: 0, max: maxPts, seriesIndex: 1, show: false, dimension: 2 }
                    ],
                    series: [
                        {
                            type: 'map', map: mapName, geoIndex: 0, zoom: isChina ? 1 : 1.2,
                            itemStyle: { areaColor: mdVar('--surface2', '#131a2b'), borderColor: mdVar('--border', 'rgba(255,255,255,.12)') },
                            emphasis: { label: { show: false }, itemStyle: { areaColor: mdVar('--md-surface-container-high', '#1e2940') } },
                            select: { disabled: true },
                            data: mapData
                        },
                        {
                            type: 'effectScatter', coordinateSystem: 'geo', data: pts,
                            symbolSize: v => Math.min(22, 6 + Math.sqrt(v[2]) * 2),
                            rippleEffect: { brushType: 'stroke', scale: 3 },
                            itemStyle: { color: p => p.data.status === 'banned' ? mdVar('--danger', '#ff4d6a') : mdVar('--accent', '#62d5ff') },
                            label: { show: false }
                        }
                    ]
                });
            }).catch(() => {
                el.innerHTML = '<div class="empty-state">地图数据加载失败（CDN 不可达），表格视图仍可用</div>';
            });
        }
        function startSecPanel() {
            secIpState.page = 1;
            loginState.page = 1;
            loadSecurity();
            loadSecIps();
            loadLoginLogs();
            loadGeoInfo();
            if (secMapTimer) clearInterval(secMapTimer);
            renderSecMap();
            secMapTimer = setInterval(() => { loadSecurity(); loadSecIps(); loadLoginLogs(); }, 10000);
        }
        function stopSecPanel() { if (secMapTimer) { clearInterval(secMapTimer); secMapTimer = null; } }

        /* ===== 控制台（统计与性能监控） ===== */
        let dashTimer = null, dashReqTimer = null;
        let lastCpuPct = 0, dashPerfPrev = null;
        function loadDashboard(force) {
            fetch('/api/admin/dashboard', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const dt = d.data, tot = dt.totals, cnt = dt.counts, pf = dt.perf;
                    document.getElementById('dashCalls').textContent = tot.calls.toLocaleString();
                    document.getElementById('dashBytes').textContent = fmtSize(tot.bytes);
                    document.getElementById('dashIps').textContent = tot.ips.toLocaleString();
                    document.getElementById('dashDanmu').textContent = cnt.danmu.toLocaleString();
                    document.getElementById('dashVideos').textContent = cnt.videos.toLocaleString();
                    document.getElementById('dashSubs').textContent = cnt.subtitles.toLocaleString();
                    document.getElementById('dashBanned').textContent = cnt.bannedWords.toLocaleString();
                    document.getElementById('dashUptime').textContent = fmtUptime(pf.uptimeSec);
                    document.getElementById('dashToday').textContent = (tot.todayCalls || 0).toLocaleString();
                    document.getElementById('dashActiveIps').textContent = (tot.activeIps24h || 0).toLocaleString();
                    document.getElementById('dashDanmuToday').textContent = (cnt.danmuToday || 0).toLocaleString();
                    document.getElementById('dashVideoToday').textContent = (cnt.videoToday || 0).toLocaleString();
                    document.getElementById('dashMem').textContent = pf.memRss + ' MB';
                    document.getElementById('dashHeap').textContent = pf.memHeap + ' MB';
                    document.getElementById('dashLastMin').textContent = tot.lastMinuteCalls;
                    document.getElementById('dashNode').textContent = pf.node;
                    document.getElementById('dashPid').textContent = pf.pid;
                    document.getElementById('dashPerfInfo').textContent = 'v' + pf.version + ' · ' + (pf.platform || '');
                    if (dt.disk) {
                        const used = Math.max(0, dt.disk.total - dt.disk.free);
                        const pct = dt.disk.total > 0 ? Math.round(used / dt.disk.total * 100) : 0;
                        document.getElementById('dashDisk').textContent = fmtSize(used) + ' / ' + fmtSize(dt.disk.total) + ' (' + pct + '%)';
                    } else {
                        document.getElementById('dashDisk').textContent = '—';
                    }
                    /* CPU 百分比：由两次采样差计算 */
                    if (dashPerfPrev) {
                        const dcpu = pf.cpuMs - dashPerfPrev.cpuMs, dt2 = pf.uptimeSec - dashPerfPrev.uptimeSec;
                        lastCpuPct = dt2 > 0 ? Math.max(0, Math.min(100, (dcpu / 1000) / dt2 * 100)) : lastCpuPct;
                    }
                    dashPerfPrev = { cpuMs: pf.cpuMs, uptimeSec: pf.uptimeSec };
                    document.getElementById('dashCpu').textContent = lastCpuPct.toFixed(1) + '%';
                    drawDashChart(dt.history || []);
                }).catch(() => {});
        }
        function drawDashChart(history) {
            const canvas = document.getElementById('dashChart');
            const rect = canvas.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const W = rect.width, H = rect.height;
            ctx.clearRect(0, 0, W, H);
            if (!history || history.length < 2) {
                ctx.fillStyle = mdVar('--text3', '#8e8ea8');
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('采样中...', W / 2, H / 2);
                return;
            }
            const padL = 34, padB = 22, padT = 10;
            const cw = W - padL - 10, ch = H - padB - padT;
            const maxMem = Math.max(...history.map(p => p.mem)) * 1.2 || 1;
            const maxCpu = 100;
            ctx.font = '9px sans-serif';
            ctx.fillStyle = mdVar('--text3', '#8e8ea8');
            for (let g = 0; g <= 4; g++) {
                const y = padT + ch - ch * g / 4;
                ctx.strokeStyle = mdRgba(mdVar('--text3', '#8e8ea8'), .3);
                ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W, y); ctx.stroke();
                ctx.textAlign = 'right';
                ctx.fillText(Math.round(maxMem * g / 4) + 'M', padL - 4, y + 3);
            }
            /* 绘制两条折线 */
            const pts = (key, max) => history.map((p, i) => {
                const x = padL + (history.length === 1 ? 0 : i / (history.length - 1) * cw);
                const y = padT + ch - Math.min(1, (p[key] || 0) / max) * ch;
                return [x, y];
            });
            const drawLine = (arr, color) => {
                if (!arr.length) return;
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                arr.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
                ctx.stroke();
                ctx.lineTo(arr[arr.length - 1][0], padT + ch);
                ctx.lineTo(arr[0][0], padT + ch);
                ctx.closePath();
                ctx.globalAlpha = .08;
                ctx.fillStyle = color;
                ctx.fill();
                ctx.globalAlpha = 1;
            };
            drawLine(pts('mem', maxMem), mdVar('--accent', '#62d5ff'));
            drawLine(pts('cpu', maxCpu), mdVar('--primary', '#a78bfa'));
            /* 时间轴标签 */
            ctx.fillStyle = mdVar('--text3', '#8e8ea8');
            ctx.textAlign = 'center';
            const step = Math.max(1, Math.floor(history.length / 6));
            for (let i = 0; i < history.length; i += step) {
                const t = new Date(history[i].t);
                ctx.fillText(t.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), padL + i / (history.length - 1) * cw, H - 6);
            }
        }
        /* 请求趋势图（复用 API 统计秒桶） */
        function loadDashReq() {
            fetch('/api/admin/api/stats?span=1800', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const data = d.data;
                    const buckets = data.buckets || [];
                    document.getElementById('dashReqInfo').textContent = '总请求 ' + data.totalCalls.toLocaleString() + ' · 运行 ' + fmtUptime(data.uptimeSec);
                    const canvas = document.getElementById('dashReqChart');
                    const rect = canvas.getBoundingClientRect();
                    if (!rect.width || !rect.height) return;
                    const dpr = window.devicePixelRatio || 1;
                    canvas.width = rect.width * dpr;
                    canvas.height = rect.height * dpr;
                    const ctx = canvas.getContext('2d');
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                    const W = rect.width, H = rect.height;
                    ctx.clearRect(0, 0, W, H);
                    if (!buckets.length) {
                        ctx.fillStyle = mdVar('--text3', '#8e8ea8');
                        ctx.font = '12px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText('暂无数据', W / 2, H / 2);
                        return;
                    }
                    const padL = 34, padB = 20, padT = 8;
                    const cw = W - padL - 10, ch = H - padB - padT;
                    const vals = buckets.map(b => Object.values(b.calls).reduce((a, c) => a + c, 0));
                    const max = Math.max(1, ...vals);
                    /* 填充面积 */
                    ctx.beginPath();
                    vals.forEach((v, i) => {
                        const x = padL + i / (vals.length - 1) * cw;
                        const y = padT + ch - v / max * ch;
                        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                    });
                    ctx.lineTo(padL + cw, padT + ch);
                    ctx.lineTo(padL, padT + ch);
                    ctx.closePath();
                    const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
                    grad.addColorStop(0, mdRgba(mdVar('--primary', '#7c5cfc'), .45));
                    grad.addColorStop(1, mdRgba(mdVar('--primary', '#7c5cfc'), .02));
                    ctx.fillStyle = grad;
                    ctx.fill();
                    /* 折线 */
                    ctx.strokeStyle = mdVar('--primary', '#a78bfa');
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    vals.forEach((v, i) => {
                        const x = padL + i / (vals.length - 1) * cw;
                        const y = padT + ch - v / max * ch;
                        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
                    });
                    ctx.stroke();
                    ctx.fillStyle = mdVar('--text3', '#8e8ea8');
                    ctx.font = '9px sans-serif';
                    ctx.textAlign = 'center';
                    const step = Math.max(1, Math.floor(vals.length / 6));
                    for (let i = 0; i < vals.length; i += step) {
                        ctx.fillText(new Date(buckets[i].t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), padL + i / (vals.length - 1) * cw, H - 5);
                    }
                }).catch(() => {});
        }
        function startDashPanel() {
            stopDashPanel();
            loadDashboard(true);
            loadDashReq();
            dashTimer = setInterval(loadDashboard, 2000);
            dashReqTimer = setInterval(loadDashReq, 3000);
        }
        function stopDashPanel() {
            if (dashTimer) { clearInterval(dashTimer); dashTimer = null; }
            if (dashReqTimer) { clearInterval(dashReqTimer); dashReqTimer = null; }
        }

        /* ===== 插件管理（npm 包 + 服务 + 前端扩展） ===== */
        function installPlugin() {
            const input = document.getElementById('plNpm').value.trim();
            if (!input) return toast('请输入 npm 包名', false);
            const m = input.match(/^(@[a-zA-Z0-9-]+\/)?[a-zA-Z0-9_-]+(@.+)?$/);
            if (!m) return toast('无效的 npm 包名', false);
            const pkg = m[1] ? m[1] + m[2].split('@')[0].replace(/\/$/, '') : input.split('@')[0];
            let version = '';
            const at = input.lastIndexOf('@');
            if (at > 0 && input.indexOf('@') === at) version = input.slice(at + 1);
            toast('npm 安装中（可能需要几分钟）...', true);
            fetch('/api/admin/plugins/install', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ pkg, version }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); if (d.code === 0) { document.getElementById('plNpm').value = ''; loadPlugins(); } })
                .catch(() => toast('请求失败', false));
        }
        function loadPlugins() {
            fetch('/api/admin/plugins', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    renderPlugins(d.data.list || []);
                    loadMarket(false);
                }).catch(() => {});
        }
        function renderPlugins(list) {
            document.getElementById('plCount').textContent = '共 ' + list.length + ' 个';
            const c = document.getElementById('plList');
            if (!list.length) { c.innerHTML = '<div class="empty-state">暂无插件，可通过 npm 包名安装</div>'; return; }
            c.innerHTML = list.map(p => {
                const info = p.info || {};
                const pkg = (info.package || {});
                const mf = info.manifest || {};
                const st = p.status === 'running' ? '<span style="color:var(--success)">运行中</span>'
                    : p.status === 'error' ? `<span style="color:var(--danger)" title="${esc(p.error || '')}">加载失败</span>`
                    : '<span style="color:var(--text3)">已停止</span>';
                const chips = (pkg.version ? `<span class="pl-chip">v${esc(pkg.version)}</span>` : '')
                    + (pkg.author ? `<span class="pl-chip">${esc(pkg.author)}</span>` : '')
                    + `<span class="pl-chip">npm</span>`;
                const caps = [];
                const tabs = ((mf.client && mf.client.admin && mf.client.admin.tabs) || []).length;
                if (tabs) caps.push(`<span class="pl-chip" style="color:var(--accent)">${tabs} 个后台 tab</span>`);
                if (mf.client && mf.client.player && mf.client.player.replaces) caps.push('<span class="pl-chip" style="color:var(--danger)">替换播放器</span>');
                else if (mf.client && mf.client.player && (mf.client.player.scripts || []).length) caps.push('<span class="pl-chip">播放器扩展</span>');
                if (Array.isArray(mf.provide) && mf.provide.length) caps.push(`<span class="pl-chip" style="color:var(--success)">提供: ${esc(mf.provide.join(', '))}</span>`);
                if (Array.isArray(mf.inject) && mf.inject.length) caps.push(`<span class="pl-chip">依赖: ${esc(mf.inject.join(', '))}</span>`);
                return `<div class="pl-card ${p.enabled ? 'on' : ''}" style="border:1px solid ${p.enabled ? 'rgba(52,211,153,.4)' : 'var(--border)'};background:${p.enabled ? 'linear-gradient(135deg,rgba(52,211,153,.06),rgba(255,255,255,.01))' : 'rgba(255,255,255,.02)'};border-radius:10px;padding:12px 14px;margin-bottom:10px">
                    <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">
                        <div style="flex:1;min-width:200px">
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                                <span style="font-weight:700;font-size:14px">${esc(p.name)}</span>
                                ${chips}
                                ${st}
                            </div>
                            <div style="font-size:12px;color:var(--text2);margin-top:4px">${esc(pkg.description || mf.description || '（无描述）')}</div>
                            ${pkg.homepage ? `<div style="font-size:11px;margin-top:3px"><a href="${esc(pkg.homepage)}" target="_blank" style="color:var(--accent)">${esc(pkg.homepage)}</a></div>` : ''}
                            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${caps.join('') || '<span class="pl-chip">无前端扩展</span>'}</div>
                            <div style="font-size:11px;color:var(--text3);margin-top:4px">${esc((mf.schema && mf.schema.length) ? '含配置表单（' + mf.schema.length + ' 项）' : '无配置项')} · 入口 ${esc(info.main || 'index.js')}</div>
                        </div>
                        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                            <button class="btn btn-sm ${p.enabled ? '' : 'btn-primary'}" onclick="togglePlugin('${esc(p.name)}', ${!p.enabled})">${p.enabled ? '停用' : '启用'}</button>
                            ${mf.schema && mf.schema.length ? `<button class="btn btn-sm" onclick="openPlConfig('${esc(p.name)}')">配置</button>` : ''}
                            <button class="btn btn-sm" onclick="updatePlugin('${esc(p.name)}')">更新</button>
                            <button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="uninstallPlugin('${esc(p.name)}')">卸载</button>
                        </div>
                    </div>
                    ${p.error ? `<div style="font-size:11px;color:var(--danger);margin-top:6px">${esc(p.error)}</div>` : ''}
                </div>`;
            }).join('');
        }
        function togglePlugin(name, enabled) {
            fetch('/api/admin/plugins/toggle', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name, enabled }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadPlugins(); });
        }
        function updatePlugin(name) {
            if (!confirm('确认更新插件 ' + name + '？（保留配置与启用状态）')) return;
            fetch('/api/admin/plugins/update', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadPlugins(); });
        }
        function uninstallPlugin(name) {
            if (!confirm('确认卸载插件 ' + name + '？（将删除 npm 包）')) return;
            fetch('/api/admin/plugins/uninstall', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadPlugins(); });
        }
        /* 配置表单（由插件 schema 驱动） */
        let plConfigName = '', plConfigSchema = [], plConfigValues = {};
        function openPlConfig(name) {
            fetch('/api/admin/plugins', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0) return;
                const p = (d.data.list || []).find(x => x.name === name);
                if (!p) return;
                plConfigName = name;
                plConfigSchema = ((p.info && p.info.manifest && p.info.manifest.schema) || []);
                plConfigValues = Object.assign({}, p.config || {});
                document.getElementById('plConfigTitle').textContent = name;
                const c = document.getElementById('plConfigFields');
                c.innerHTML = plConfigSchema.map((f, i) => {
                    const cur = plConfigValues[f.key] != null ? plConfigValues[f.key] : f.default;
                    let input = '';
                    if (f.type === 'boolean') {
                        input = `<input type="checkbox" id="plcf_${i}" ${cur ? 'checked' : ''}>`;
                    } else if (f.type === 'select') {
                        input = `<select id="plcf_${i}" style="flex:1;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:12px;outline:none">${(f.options || []).map(o => `<option value="${esc(o.value)}" ${String(cur) === String(o.value) ? 'selected' : ''}>${esc(o.label || o.value)}</option>`).join('')}</select>`;
                    } else if (f.type === 'textarea') {
                        input = `<textarea id="plcf_${i}" rows="3" style="flex:1;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:12px;outline:none">${esc(cur != null ? cur : '')}</textarea>`;
                    } else {
                        input = `<input type="text" id="plcf_${i}" value="${esc(cur != null ? cur : '')}" style="flex:1;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:7px 10px;font-size:12px;outline:none">`;
                    }
                    return `<div class="cfg-row" style="align-items:flex-start"><span style="min-width:110px;padding-top:6px">${esc(f.label || f.key)}</span><div style="flex:1">${input}${f.hint ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">${esc(f.hint)}</div>` : ''}</div></div>`;
                }).join('');
                document.getElementById('plConfigModal').style.display = 'flex';
            });
        }
        function closePlConfig() { document.getElementById('plConfigModal').style.display = 'none'; }
        function savePluginConfig() {
            const cfg = {};
            plConfigSchema.forEach((f, i) => {
                const el = document.getElementById('plcf_' + i);
                if (!el) return;
                if (f.type === 'boolean') cfg[f.key] = el.checked;
                else if (f.type === 'number') cfg[f.key] = parseFloat(el.value) || 0;
                else if (f.type === 'select') cfg[f.key] = el.value;
                else cfg[f.key] = el.value;
            });
            fetch('/api/admin/plugins/config', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: plConfigName, config: cfg }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); if (d.code === 0) { closePlConfig(); loadPlugins(); } });
        }
        /* 插件市场 v2（版本 + 依赖，安装走 npm） */
        /* ===== 插件市场（独立 tab，支持自定义源） ===== */
        const MARKET_PRESETS = {
            official: 'https://raw.githubusercontent.com/yangyang8002/OpenVideoAPI/master/plugin-registry.json',
            gitee: 'https://gitee.com/yangyang8002/Artplayer-Web-Api/raw/master/plugin-registry.json',
            local: 'file://plugins/registry.json'
        };
        function loadMarketSrc() {
            fetch('/api/admin/config', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0 || !d.data.plugin) return;
                const url = d.data.plugin.registry || '';
                const sel = document.getElementById('mktSourceSel');
                const input = document.getElementById('mktSourceUrl');
                if (!sel || !input) return;
                if (url === MARKET_PRESETS.official) sel.value = 'official';
                else if (url === MARKET_PRESETS.local) sel.value = 'local';
                else { sel.value = 'custom'; }
                input.value = sel.value === 'custom' ? url : MARKET_PRESETS[sel.value];
                input.disabled = sel.value !== 'custom';
            });
        }
        function onMarketSourceChange() {
            const sel = document.getElementById('mktSourceSel');
            const input = document.getElementById('mktSourceUrl');
            if (!sel || !input) return;
            if (sel.value === 'custom') { input.disabled = false; input.focus(); }
            else { input.value = MARKET_PRESETS[sel.value]; input.disabled = true; }
        }
        function saveMarketSource() {
            const sel = document.getElementById('mktSourceSel');
            const input = document.getElementById('mktSourceUrl');
            const url = sel.value === 'custom' ? input.value.trim() : MARKET_PRESETS[sel.value];
            if (!/^(https?:\/\/|file:\/\/)/i.test(url)) { toast('无效的源地址', false); return; }
            fetch('/api/admin/update/config', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ pluginRegistry: url }) })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) { toast(d.msg, false); return; }
                    const m = document.getElementById('mktSrcMsg');
                    if (m) m.textContent = '已保存';
                    toast('已保存', true);
                    loadMarket(true);
                }).catch(() => toast('请求失败', false));
        }
        function toggleMarketSource() {
            const row = document.getElementById('mktSourceRow');
            if (!row) return;
            row.style.display = row.style.display === 'none' ? '' : 'none';
        }
        function loadMarket(force) {
            fetch('/api/admin/plugins/market' + (force ? '?force=1' : ''), { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) {
                        /* 刷新失败不清空已有数据：有数据时仅提示，无数据时显示错误 */
                        if (marketState.all.length) { toast(d.msg || '插件市场获取失败', false); return; }
                        document.getElementById('marketList').innerHTML = '<div class="empty-state">' + esc(d.msg || '插件市场获取失败') + '</div>';
                        return;
                    }
                    const checked = document.getElementById('marketChecked');
                    if (checked) checked.textContent = (d.data.updated ? '更新于 ' + d.data.updated : '') + (d.data.mirror ? ' · 镜像: ' + d.data.mirror : '');
                    /* 回显实际使用的市场源 */
                    const srcUrl = document.getElementById('mktSourceUrl');
                    const srcSel = document.getElementById('mktSourceSel');
                    if (srcUrl && srcSel && d.data.registry) {
                        if (srcSel.value === 'custom') srcUrl.value = d.data.registry;
                        else if (srcUrl.value !== d.data.registry && srcUrl.value !== MARKET_PRESETS[srcSel.value]) srcUrl.value = d.data.registry;
                    }
                    marketState.all = d.data.list || [];
                    marketState.categories = Array.isArray(d.data.categories) ? d.data.categories : [];
                    marketInstalledMap(() => { renderMarketSide(); renderMarketGrid(); });
                }).catch(() => {
                    if (marketState.all.length) { toast('插件市场获取失败（网络不可达）', false); return; }
                    document.getElementById('marketList').innerHTML = '<div class="empty-state">插件市场获取失败（网络不可达）</div>';
                });
        }

        /* ===== Koishi 风格插件市场：侧栏（排序/筛选/分类）+ 搜索 + 卡片网格 ===== */
        const marketState = { all: [], categories: [], sort: 'default', filterOfficial: false, filterNew: false, cat: '全部', installed: {} };
        function marketInstalledMap(cb) {
            fetch('/api/admin/plugins', { headers: authHeaders() }).then(r2 => r2.json()).then(d2 => {
                const installed = {};
                (d2.data.list || []).forEach(p => { installed[p.name] = p; });
                marketState.installed = installed;
                cb();
            }).catch(() => cb());
        }
        function isMarketNew(p) {
            const t = new Date(p.updated || p.created || 0).getTime();
            if (t) return Date.now() - t < 30 * 24 * 3600 * 1000;
            return true;
        }
        const KM_COLORS = ['linear-gradient(135deg,#7c5cfc,#4d9fff)', 'linear-gradient(135deg,#ff7eb3,#ff758c)', 'linear-gradient(135deg,#43e97b,#38f9d7)', 'linear-gradient(135deg,#fa709a,#fee140)', 'linear-gradient(135deg,#30cfd0,#330867)', 'linear-gradient(135deg,#a8edea,#fed6e3)', 'linear-gradient(135deg,#f6d365,#fda085)', 'linear-gradient(135deg,#84fab0,#8fd3f4)'];
        function kmLogo(m) {
            if (m.icon) return `<img class="km-logo" src="${esc(m.icon)}" onerror="this.style.display='none'" alt="">`;
            const letter = (m.name || '?').replace(/^openvideo-plugin-?/i, '').replace(/^@[^/]+\//, '').charAt(0).toUpperCase() || '?';
            let h = 0;
            for (const ch of (m.name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
            return `<span class="km-logo" style="background:${KM_COLORS[h % KM_COLORS.length]}">${esc(letter)}</span>`;
        }
        function kmInstalledCount() { return Object.keys(marketState.installed).length; }
        function setMarketSort(s) {
            marketState.sort = s;
            document.querySelectorAll('#marketPanel .km-item[data-sort]').forEach(b => b.classList.toggle('active', b.dataset.sort === s));
            renderMarketGrid();
        }
        function toggleMarketFilter(f) {
            if (f === 'official') marketState.filterOfficial = !marketState.filterOfficial;
            else marketState.filterNew = !marketState.filterNew;
            document.querySelectorAll('#marketPanel .km-item[data-filter]').forEach(b => b.classList.toggle('active', (b.dataset.filter === 'official' ? marketState.filterOfficial : marketState.filterNew)));
            renderMarketGrid();
        }
        function setMarketCat(c) {
            marketState.cat = c;
            document.querySelectorAll('#kmCats .km-item').forEach(b => b.classList.toggle('active', b.dataset.cat === c));
            renderMarketGrid();
        }
        function renderMarketSide() {
            const cats = [];
            const seen = new Set();
            marketState.categories.forEach(c => { if (c && !seen.has(c)) { seen.add(c); cats.push(c); } });
            marketState.all.forEach(p => { const c = p.category; if (c && !seen.has(c)) { seen.add(c); cats.push(c); } });
            const el = document.getElementById('kmCats');
            if (!el) return;
            el.innerHTML = `<button class="km-item ${marketState.cat === '全部' ? 'active' : ''}" data-cat="全部" onclick="setMarketCat('全部')">全部<span class="cnt">${marketState.all.length}</span></button>` +
                cats.map(c => `<button class="km-item ${marketState.cat === c ? 'active' : ''}" data-cat="${esc(c)}" onclick="setMarketCat('${esc(c)}')">${esc(c)}<span class="cnt">${marketState.all.filter(p => p.category === c).length}</span></button>`).join('');
        }
        function renderMarketGrid() {
            const c = document.getElementById('marketList');
            if (!c) return;
            const q = (document.getElementById('kmSearch').value || '').trim().toLowerCase();
            let list = marketState.all.filter(p => {
                if (marketState.cat !== '全部' && p.category !== marketState.cat) return false;
                if (marketState.filterOfficial && !p.official) return false;
                if (marketState.filterNew && !isMarketNew(p)) return false;
                if (q && !(p.name.toLowerCase().includes(q) || String(p.description || '').toLowerCase().includes(q) || (p.tags || []).some(t => String(t).toLowerCase().includes(q)))) return false;
                return true;
            });
            if (marketState.sort !== 'default') {
                const keyOf = p => marketState.sort === 'score' ? (p.score || 0) : marketState.sort === 'downloads' ? (p.downloads || 0) : (new Date(p.updated || 0).getTime() || 0);
                list = [...list].sort((a, b) => keyOf(b) - keyOf(a));
            }
            if (!list.length) { c.innerHTML = `<div class="km-empty">${q ? '暂无匹配插件' : '暂无可用插件'}</div>`; return; }
            c.innerHTML = `<div class="km-grid">` + list.map(m => {
                const isInstalled = !!marketState.installed[m.name];
                const meta = [];
                if (m.score) meta.push(`<span class="km-score">★ ${m.score}</span>`);
                if (m.downloads) meta.push(`<span>${m.downloads >= 1000 ? (m.downloads / 1000).toFixed(1) + 'k' : m.downloads} 安装量</span>`);
                if (m.latest) meta.push(`<span>v${esc(m.latest)}</span>`);
                if (isInstalled) meta.push('<span class="km-installed">已安装</span>');
                return `<div class="km-card" onclick="openMarketDetail('${esc(m.name)}')">
                    <div class="km-head">${kmLogo(m)}<div style="min-width:0"><div class="km-name">${esc(m.name)}</div><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">${(m.tags || []).slice(0, 3).map(x => `<span class="pl-chip">${esc(x)}</span>`).join('')}</div></div></div>
                    <div class="km-desc">${esc(m.description || '')}</div>
                    <div class="km-meta">${meta.join('')}</div>
                </div>`;
            }).join('') + `</div>`;
        }
        function openMarketDetail(name) {
            const m = marketState.all.find(x => x.name === name);
            if (!m) return;
            const isInstalled = !!marketState.installed[m.name];
            const body = document.getElementById('mktDetailBody');
            body.innerHTML = `
                <div class="km-detail-head">${kmLogo(m)}<div>
                    <div class="km-detail-name">${esc(m.name)} ${m.latest ? `<span class="pl-chip">v${esc(m.latest)}</span>` : ''} ${m.official ? '<span class="pl-chip" style="color:var(--success)">官方</span>' : ''}</div>
                    <div style="font-size:12px;color:var(--text3);margin-top:2px">作者：${esc(m.author || '—')}</div>
                </div></div>
                <div class="km-detail-desc">${esc(m.description || '')}</div>
                <div class="km-detail-meta">
                    ${m.score ? `<div>评分：<b style="color:var(--warn)">★ ${m.score}</b></div>` : ''}
                    ${m.downloads ? `<div>安装量：<b>${m.downloads}</b></div>` : ''}
                    ${m.category ? `<div>分类：<b>${esc(m.category)}</b></div>` : ''}
                    ${m.updated ? `<div>更新于：<b>${esc(m.updated)}</b></div>` : ''}
                    ${(m.dependencies || []).length ? `<div>依赖：<b>${esc(m.dependencies.join(', '))}</b></div>` : ''}
                    ${m.homepage ? `<div>主页：<a href="${esc(m.homepage)}" target="_blank" style="color:var(--accent)">${esc(m.homepage)}</a></div>` : ''}
                </div>
                <div class="km-detail-actions">
                    ${isInstalled ? '<span class="km-installed" style="font-size:12px">已安装</span>' : `
                        ${(m.versions || []).length > 1 ? `<select id="mktDetailVer" style="background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font-size:12px;outline:none">${m.versions.map(v => `<option>${esc(v)}</option>`).join('')}</select>` : ''}
                        <button class="btn btn-sm btn-primary" onclick="installMarketPlugin('${esc(m.name)}')">安装</button>`}
                    ${m.homepage ? `<button class="btn btn-sm" onclick="window.open('${esc(m.homepage)}','_blank')">主页</button>` : ''}
                    <button class="btn btn-sm" onclick="closeMarketDetail()">关闭</button>
                </div>`;
            document.getElementById('mktDetailModal').style.display = 'flex';
        }
        function closeMarketDetail() { document.getElementById('mktDetailModal').style.display = 'none'; }
        function installMarketPlugin(name) {
            const verSel = document.getElementById('mktDetailVer');
            const version = verSel && verSel.value ? verSel.value : '';
            toast('npm 安装中（可能需要几分钟）...', true);
            fetch('/api/admin/plugins/install', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ pkg: name, version }) })
                .then(r => r.json()).then(d => {
                    toast(d.msg, d.code === 0);
                    if (d.code === 0) { closeMarketDetail(); marketInstalledMap(() => renderMarketGrid()); }
                    loadPlugins();
                });
        }

        /* ===== 依赖与更新 ===== */

        function loadDeps(force) {
            fetch('/api/admin/deps' + (force ? '?force=1' : ''), { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const data = d.data;
                    document.getElementById('depsChecked').textContent = '检查于 ' + new Date(data.checkedAt).toLocaleTimeString('zh-CN');
                    /* 版本卡片 */
                    const v = data.version;
                    if (v) {
                        document.getElementById('depsCurVer').textContent = v.current;
                        document.getElementById('depsLatestVer').textContent = v.latest;
                        document.getElementById('depsDeploy').textContent = v.deploy;
                        const btn = document.getElementById('depsUpBtn');
                        const fbtn = document.getElementById('depsForceBtn');
                        btn.style.display = '';
                        fbtn.style.display = '';
                        if (v.hasUpdate) {
                            btn.disabled = false;
                            btn.textContent = '更新到最新版 v' + v.latest;
                        } else {
                            btn.disabled = true;
                            btn.textContent = '已是最新版本';
                        }
                        const notes = document.getElementById('depsNotes');
                        if (v.hasUpdate && v.releaseNotes) {
                            notes.style.display = 'block';
                            notes.textContent = v.releaseNotes;
                        } else notes.style.display = 'none';
                    }
                    /* 依赖表 */
                    const tb = document.getElementById('depsTbody');
                    const deps = data.list || [];
                    if (!deps.length) { tb.innerHTML = '<tr><td colspan="5"><div class="empty-state">暂无依赖</div></td></tr>'; }
                    else {
                        tb.innerHTML = deps.map(x => {
                            const outdated = x.latest && (x.current !== x.latest || x.current === 'latest');
                            const tag = x.type === 'frontend' ? '<span class="pl-chip" style="margin-right:6px">前端 CDN</span>' : '';
                            return `<tr>
                                <td style="font-family:monospace;font-size:12px">${tag}${esc(x.name)}</td>
                                <td>${esc(x.current)}</td>
                                <td style="color:${outdated ? 'var(--success)' : 'var(--text3)'}">${esc(x.latest || '—')}</td>
                                <td>${outdated ? '<span style="color:var(--warn)">可更新</span>' : '<span style="color:var(--success)">最新</span>'}</td>
                                <td><button class="btn btn-sm btn-primary" ${outdated ? '' : 'disabled'} onclick="updateDep('${esc(x.name)}')">更新</button></td>
                            </tr>`;
                        }).join('');
                    }
                    /* 插件更新表 */
                    const ptb = document.getElementById('depsPluginsTbody');
                    const pls = data.plugins || [];
                    if (!pls.length) { ptb.innerHTML = '<tr><td colspan="5"><div class="empty-state">暂无插件</div></td></tr>'; }
                    else {
                        ptb.innerHTML = pls.map(p => `<tr>
                            <td style="font-weight:600">${esc(p.name)}</td>
                            <td>${esc(p.version || '—')}</td>
                            <td style="font-size:12px;color:var(--text3)">${esc(p.source)}</td>
                            <td>${p.status === 'running' ? '<span style="color:var(--success)">运行中</span>' : '<span style="color:var(--text3)">已停止</span>'}</td>
                            <td>${p.updatable ? `<button class="btn btn-sm btn-primary" onclick="updatePlugin('${esc(p.name)}')">更新</button>` : '<span style="font-size:11px;color:var(--text3)">本地包</span>'}</td>
                        </tr>`).join('');
                    }
                }).catch(() => {});
        }
        function checkDeps() {
            var btn = document.getElementById('depsCheckBtn');
            if (btn) { btn.disabled = true; btn.textContent = '检测中…'; }
            fetch('/api/admin/deps?force=1', { headers: authHeaders() })
                .then(function (r) { return r.json(); }).then(function (d) {
                    if (btn) { btn.disabled = false; btn.textContent = '检测更新'; }
                    if (d.code !== 0) return;
                    var deps = d.data.list || [];
                    var outdated = deps.filter(function (x) { return x.latest && (x.current !== x.latest || x.current === 'latest'); });
                    var tb = document.getElementById('depsTbody');
                    if (!deps.length) { tb.innerHTML = '<tr><td colspan="5"><div class="empty-state">暂无依赖</div></td></tr>'; }
                    else {
                        tb.innerHTML = deps.map(function (x) {
                            var od = x.latest && (x.current !== x.latest || x.current === 'latest');
                            var tag = x.type === 'frontend' ? '<span class="pl-chip" style="margin-right:6px">前端 CDN</span>' : '';
                            return '<tr>' +
                                '<td style="font-family:monospace;font-size:12px">' + tag + esc(x.name) + '</td>' +
                                '<td>' + esc(x.current) + '</td>' +
                                '<td style="color:' + (od ? 'var(--success)' : 'var(--text3)') + '">' + esc(x.latest || '—') + '</td>' +
                                '<td>' + (od ? '<span style="color:var(--warn)">可更新</span>' : '<span style="color:var(--success)">最新</span>') + '</td>' +
                                '<td><button class="btn btn-sm btn-primary" ' + (od ? '' : 'disabled') + ' onclick="updateDep(\'' + esc(x.name) + '\')">更新</button></td>' +
                                '</tr>';
                        }).join('');
                    }
                    toast(outdated.length ? ('检测完成：' + outdated.length + ' 个依赖可更新') : '检测完成：全部依赖已是最新', true);
                }).catch(function () { if (btn) { btn.disabled = false; btn.textContent = '检测更新'; } });
        }
        function updateDep(name) {
            fetch('/api/admin/deps/update', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ names: [name] }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); if (d.code === 0 && d.msg.indexOf('前端') === 0) loadDeps(true); });
        }
        function updateAllDeps() {
            if (!confirm('确认更新全部依赖？更新在后台执行，完成后需重启服务生效')) return;
            fetch('/api/admin/deps/update', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) })
                .then(r => r.json()).then(d => toast(d.msg, d.code === 0));
        }

        /* ===== 版本更新（关于页 + 依赖页共用；升级按钮始终可见） ===== */
        function checkUpdate(force) {
            fetch('/api/admin/update/check' + (force ? '?force=1' : ''), { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) { toast(d.msg || '检查更新失败', false); return; }
                    const u = d.data;
                    document.getElementById('upCurrent').textContent = u.current;
                    document.getElementById('upDeploy').textContent = '部署: ' + u.deploy;
                    const wrap = document.getElementById('upLatestWrap');
                    const notes = document.getElementById('upNotes');
                    const btn = document.getElementById('upRunBtn');
                    const fbtn = document.getElementById('upForceBtn');
                    const srow = document.getElementById('upSourceRow');
                    wrap.style.display = '';
                    document.getElementById('upLatest').textContent = u.latest || u.current;
                    srow.style.display = 'flex';
                    if (u.hasUpdate) {
                        if (u.releaseNotes) { notes.style.display = 'block'; notes.textContent = u.releaseNotes; }
                        btn.disabled = false;
                        btn.style.display = '';
                        btn.textContent = '更新到最新版 v' + u.latest;
                    } else {
                        notes.style.display = 'none';
                        btn.disabled = true;
                        btn.style.display = '';
                        btn.textContent = '已是最新版本';
                    }
                    if (fbtn) fbtn.style.display = '';
                }).catch(() => toast('检查更新失败（网络不可达）', false));
        }
        function runUpdate(force) {
            const sel = document.querySelector('input[name="upSource"]:checked');
            const source = sel ? sel.value : 'auto';
            if (force) {
                if (!confirm('确认强制重装当前版本？将重新拉取代码并安装依赖（修复损坏文件/追赶热修复），服务会短暂重启')) return;
            } else {
                if (!confirm('确认更新到最新版？将自动备份数据并重启服务，期间服务不可用')) return;
            }
            const btn = document.getElementById('upRunBtn');
            const fbtn = document.getElementById('upForceBtn');
            btn.disabled = true; btn.textContent = '更新中...';
            if (fbtn) fbtn.disabled = true;
            fetch('/api/admin/update/run', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ source, restart: true, force: !!force }) })
                .then(r => r.json()).then(d => {
                    toast(d.msg, d.code === 0);
                    if (d.code === 0) { btn.textContent = '更新已启动，服务即将重启...'; setTimeout(() => location.reload(), 8000); }
                    else { btn.disabled = false; btn.textContent = btn.dataset.label || '更新到最新版'; if (fbtn) fbtn.disabled = false; }
                }).catch(() => { btn.disabled = false; btn.textContent = btn.dataset.label || '更新到最新版'; if (fbtn) fbtn.disabled = false; toast('更新请求失败', false); });
        }

        /* ===== 数据库管理 ===== */
        let dbBrowseState = { page: 1, total: 0, limit: 50 };
        const DB_TYPES_UI = ['json', 'sqlite', 'mysql', 'mariadb', 'postgres', 'mongodb'];
        function loadDbInfo() {
            fetch('/api/admin/db/info', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const info = d.data;
                    document.getElementById('dbCurLabel').textContent = info.migrating ? '（迁移中）' : '';
                    document.getElementById('dbCurType').textContent = info.label;
                    document.getElementById('dbCurConn').textContent = info.type === 'json' ? 'JSON 文件 (data/*.json)' : JSON.stringify(info.config[info.type] || {});
                    document.getElementById('dbType').value = info.type;
                    dbTypeChange();
                    /* 表概览 */
                    const tb = document.getElementById('dbTables');
                    const tRaw = info.tables || {};
                    const tRows = Array.isArray(tRaw) ? tRaw : Object.entries(tRaw).map(([name, count]) => ({ name, count }));
                    tb.innerHTML = tRows.map(t => `<span class="tag" style="margin:2px">${esc(t.name)}: ${t.count}</span>`).join('') || '<div class="empty-state">无数据</div>';
                }).catch(() => {});
        }
        function dbTypeChange() {
            const t = document.getElementById('dbType').value;
            const f = document.getElementById('dbConnFields');
            /* T3.1:样式收敛到 .panel input / .cfg-row 规则,不再内联旧变量 */
            const mk = (id, ph, def) => `<input type="text" id="${id}" placeholder="${ph}" value="${def}">`;
            if (t === 'json') f.innerHTML = '<div class="cfg-hint">JSON 文件存储（data/*.json），零配置</div>';
            else if (t === 'sqlite') f.innerHTML = `<div class="cfg-row"><span>文件路径</span>${mk('dbSqliteFile', '如 data/app.db', 'data/app.db')}</div>`;
            else if (t === 'mongodb') f.innerHTML = `<div class="cfg-row"><span>主机</span>${mk('dbHost', '127.0.0.1', '127.0.0.1')}</div><div class="cfg-row"><span>端口</span>${mk('dbPort', '27017', '27017')}</div><div class="cfg-row"><span>用户</span>${mk('dbUser', '', '')}</div><div class="cfg-row"><span>密码</span><span class="st-eye-wrap"><input type="password" id="dbPass"><button type="button" class="st-eye" data-eye tabindex="-1" aria-label="显示或隐藏密码" title="显示或隐藏密码"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button></span></div><div class="cfg-row"><span>数据库</span>${mk('dbName', 'artplayer', 'artplayer')}</div>`;
            else f.innerHTML = `<div class="cfg-row"><span>主机</span>${mk('dbHost', '127.0.0.1', '127.0.0.1')}</div><div class="cfg-row"><span>端口</span>${mk('dbPort', t === 'postgres' ? '5432' : '3306', t === 'postgres' ? '5432' : '3306')}</div><div class="cfg-row"><span>用户</span>${mk('dbUser', 'root', 'root')}</div><div class="cfg-row"><span>密码</span><span class="st-eye-wrap"><input type="password" id="dbPass"><button type="button" class="st-eye" data-eye tabindex="-1" aria-label="显示或隐藏密码" title="显示或隐藏密码"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button></span></div><div class="cfg-row"><span>数据库</span>${mk('dbName', 'artplayer', 'artplayer')}</div>`;
        }
        function dbConnBody(type) {
            if (type === 'sqlite') return { type, sqlite: { file: document.getElementById('dbSqliteFile').value } };
            if (type === 'mongodb') return { type, mongodb: { host: document.getElementById('dbHost').value, port: parseInt(document.getElementById('dbPort').value) || 27017, user: document.getElementById('dbUser').value, password: document.getElementById('dbPass').value, database: document.getElementById('dbName').value } };
            const c = { host: document.getElementById('dbHost').value, port: parseInt(document.getElementById('dbPort').value) || 3306, user: document.getElementById('dbUser').value, password: document.getElementById('dbPass').value, database: document.getElementById('dbName').value };
            return { type, mysql: c, postgres: c, mongodb: c };
        }
        function testDbConn() {
            const body = dbConnBody(document.getElementById('dbType').value);
            toast('测试中...', true);
            fetch('/api/admin/db/test', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
                .then(r => r.json()).then(d => toast(d.msg, d.code === 0));
        }
        function switchDbStorage() {
            const t = document.getElementById('dbType').value;
            if (t === 'json') { if (!confirm('确认切换到 JSON 文件存储？现有数据将迁移到 data/*.json')) return; }
            else if (!confirm('确认切换到 ' + t + '？现有数据将全部迁移')) return;
            fetch('/api/admin/db/switch', { method: 'POST', headers: authHeaders(), body: JSON.stringify(dbConnBody(t)) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); if (d.code === 0) { loadDbInfo(); loadDashboard(); } });
        }
        function loadDbBrowse() {
            const table = document.getElementById('dbBrowseTable').value;
            const search = document.getElementById('dbBrowseSearch').value.trim();
            fetch(`/api/admin/db/data?table=${table}&page=${dbBrowseState.page}&limit=${dbBrowseState.limit}&search=${encodeURIComponent(search)}`, { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    dbBrowseState.total = d.data.total;
                    const rows = d.data.list || [];
                    const head = document.getElementById('dbBrowseHead');
                    const body = document.getElementById('dbBrowseBody');
                    const empty = document.getElementById('dbBrowseEmpty');
                    if (!rows.length) { head.innerHTML = ''; body.innerHTML = ''; empty.style.display = 'block'; document.getElementById('dbBrowsePager').innerHTML = ''; return; }
                    empty.style.display = 'none';
                    const cols = Object.keys(rows[0]);
                    head.innerHTML = '<tr>' + cols.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';
                    body.innerHTML = rows.map(r => '<tr>' + cols.map(c => {
                        let v = r[c];
                        if (v == null) v = '';
                        if (typeof v === 'object') v = JSON.stringify(v);
                        v = String(v);
                        return `<td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v)}" data-i18n-skip>${esc(v.length > 120 ? v.slice(0, 120) + '…' : v)}</td>`;
                    }).join('') + '</tr>').join('');
                    renderDbBrowsePager();
                }).catch(() => {});
        }
        function renderDbBrowsePager() {
            document.getElementById('dbBrowsePager').innerHTML = pagerHTML('dbBrowse', dbBrowseState, loadDbBrowse);
        }
        function exportDb() {
            window.open('/api/admin/db/export', '_blank');
        }

        /* ===== 备份中心 ===== */
        let allBackups = [], bkState = { page: 1, total: 0, limit: 50 };
        function loadBackups() {
            fetch('/api/admin/backup/list', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const data = d.data;
                    const cfg = data.config;
                    document.getElementById('bkStatus').textContent = cfg.enabled ? `启用 · 每 ${cfg.intervalHours} 小时 · 保留 ${cfg.maxKeep} 份` : '未启用';
                    allBackups = data.backups || [];
                    bkState.total = allBackups.length;
                    renderBackups();
                }).catch(() => {});
        }
        function renderBackups() {
            const c = document.getElementById('backupList');
            if (!allBackups.length) { c.innerHTML = '<div class="empty-state">暂无备份</div>'; document.getElementById('bkPager').innerHTML = ''; return; }
            const start = (bkState.page - 1) * bkState.limit;
            const list = allBackups.slice(start, start + bkState.limit);
            c.innerHTML = list.map(b => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;flex-wrap:wrap">
                <input type="checkbox" class="bk-cb" value="${esc(b.name)}" style="accent-color:var(--primary)">
                <span style="font-family:monospace;flex:1;min-width:160px">${esc(b.name)}</span>
                <span style="color:var(--text3)">${fmtSize(b.size)}</span>
                <span style="color:var(--text3)">${new Date(b.mtime).toLocaleString('zh-CN')}</span>
                <span style="display:flex;gap:6px">
                    <button class="btn btn-sm" onclick="downloadBackup('${esc(b.name)}')">下载</button>
                    <button class="btn btn-sm btn-primary" onclick="restoreBackup('${esc(b.name)}')">恢复</button>
                    <button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="deleteBackup('${esc(b.name)}')">删除</button>
                </span>
            </div>`).join('');
            document.getElementById('bkPager').innerHTML = pagerHTML('backups', bkState, renderBackups);
        }
        function bkToggleSelectAll() {
            const on = document.getElementById('bkSelectAll').checked;
            document.querySelectorAll('.bk-cb').forEach(c => c.checked = on);
        }
        function restoreSelectedBackups() {
            const sel = Array.from(document.querySelectorAll('.bk-cb:checked')).map(c => c.value);
            if (!sel.length) return toast('请先选择备份', false);
            if (!confirm('确认恢复所选 ' + sel.length + ' 个备份？（按时间从旧到新依次恢复）')) return;
            fetch('/api/admin/backup/restore-batch', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ names: sel }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadBackups(); });
        }
        function downloadBackup(name) { window.open('/api/admin/backup/download?name=' + encodeURIComponent(name), '_blank'); }
        function restoreBackup(name) {
            if (!confirm('确认从备份恢复 ' + name + '？当前数据将被覆盖')) return;
            fetch('/api/admin/backup/restore', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadBackups(); });
        }
        function deleteBackup(name) {
            if (!confirm('确认删除备份 ' + name + '？')) return;
            fetch('/api/admin/backup/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadBackups(); });
        }
        function openBackupModal() { document.getElementById('backupModal').style.display = 'flex'; bmTargetChange(); }
        function closeBackupModal() { document.getElementById('backupModal').style.display = 'none'; }
        function bmTargetChange() {
            const v = document.querySelector('input[name="bmTarget"]:checked').value;
            document.getElementById('bmCloudHint').style.display = v === 'local' ? 'none' : '';
            if (v !== 'local') document.getElementById('bmCloudHint').textContent = '云端备份需要先在「管理配置 → 云端同步」中保存连接配置';
        }
        function createBackupFlow() {
            const contents = [];
            if (document.getElementById('bmContentData').checked) contents.push('data');
            if (document.getElementById('bmContentConfig').checked) contents.push('config');
            if (!contents.length) return toast('请至少选择一种备份内容', false);
            const t = document.querySelector('input[name="bmTarget"]:checked').value;
            const targets = t === 'both' ? ['local', 'cloud'] : [t];
            fetch('/api/admin/backup/create', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ contents, targets }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); if (d.code === 0) { closeBackupModal(); loadBackups(); loadCloudList(); } });
        }
        function openBkConfigModal() { document.getElementById('bkConfigModal').style.display = 'flex'; loadBkCfg(); loadCloudConfigs(); }
        function closeBkConfigModal() { document.getElementById('bkConfigModal').style.display = 'none'; }
        function bkCfgSwitch(name) {
            document.querySelectorAll('.bk-cfg-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
            document.getElementById('bkCfgTabBk').style.display = name === 'bk' ? '' : 'none';
            document.getElementById('bkCfgTabCl').style.display = name === 'cl' ? '' : 'none';
        }
        function loadBkCfg() {
            fetch('/api/admin/backup/list', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0) return;
                const cfg = d.data.config;
                document.getElementById('cfgBkEnabled').checked = !!cfg.enabled;
                document.getElementById('cfgBkInterval').value = cfg.intervalHours;
                document.getElementById('cfgBkMaxKeep').value = cfg.maxKeep;
                document.getElementById('cfgBkContentData').checked = cfg.contents.includes('data');
                document.getElementById('cfgBkContentConfig').checked = cfg.contents.includes('config');
            });
        }
        function saveBkCfgFromModal() {
            const contents = [];
            if (document.getElementById('cfgBkContentData').checked) contents.push('data');
            if (document.getElementById('cfgBkContentConfig').checked) contents.push('config');
            const body = {
                enabled: document.getElementById('cfgBkEnabled').checked,
                intervalHours: parseInt(document.getElementById('cfgBkInterval').value) || 24,
                maxKeep: parseInt(document.getElementById('cfgBkMaxKeep').value) || 10,
                contents
            };
            fetch('/api/admin/backup/config', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); if (d.code === 0) loadBackups(); });
        }
        /* 云端配置 */
        let cloudCfgs = [], cloudEditId = '';
        function loadCloudConfigs() {
            fetch('/api/admin/cloud/config', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    cloudCfgs = d.data;
                    const c = document.getElementById('cloudCfgList');
                    c.innerHTML = cloudCfgs.map(x => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;flex-wrap:wrap">
                        <span style="font-weight:600">${esc(x.type)}</span>
                        <span style="color:var(--text2);flex:1;min-width:140px">${esc(x.host || x.baseUrl || '')}${x.user ? ' · ' + esc(x.user) : ''}</span>
                        <span style="color:var(--text3)">${x.enabled ? '<span style="color:var(--success)">启用</span>' : '停用'}</span>
                        ${x.lastSyncAt ? `<span style="color:var(--text3);font-size:11px">${new Date(x.lastSyncAt).toLocaleString('zh-CN')}</span>` : ''}
                        <span style="display:flex;gap:6px">
                            <button class="btn btn-sm" onclick="editCloudCfg('${x.id}')">编辑</button>
                            <button class="btn btn-sm" onclick="testCloudCfg('${x.id}')">测试</button>
                            <button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="deleteCloudCfg('${x.id}')">删除</button>
                        </span>
                    </div>`).join('') || '<div class="empty-state">暂无云端配置</div>';
                }).catch(() => {});
        }
        function addCloudCfg() { cloudEditId = ''; showCloudForm({ enabled: true, type: 'ftp', host: '', port: 21, user: '', password: '', path: '/backups', baseUrl: '', secure: false }); }
        function editCloudCfg(id) {
            const x = cloudCfgs.find(c => c.id === id);
            if (!x) return;
            cloudEditId = id;
            showCloudForm({ enabled: x.enabled, type: x.type, host: x.host, port: x.port, user: x.user, password: x.password === '******' ? '' : x.password, path: x.path, baseUrl: x.baseUrl, secure: x.secure });
        }
        function showCloudForm(v) {
            document.getElementById('cloudCfgList').style.display = 'none';
            document.getElementById('cloudCfgForm').style.display = '';
            document.getElementById('cfgClEnabled').checked = !!v.enabled;
            document.getElementById('cfgClType').value = v.type;
            document.getElementById('cfgClHost').value = v.host || '';
            document.getElementById('cfgClPort').value = v.port || '';
            document.getElementById('cfgClUser').value = v.user || '';
            document.getElementById('cfgClPass').value = v.password || '';
            document.getElementById('cfgClPath').value = v.path || '/backups';
            document.getElementById('cfgClBaseUrl').value = v.baseUrl || '';
            document.getElementById('cfgClSecure').checked = !!v.secure;
            cfgCloudTypeChange();
        }
        function cancelCloudCfgEdit() {
            cloudEditId = '';
            document.getElementById('cloudCfgForm').style.display = 'none';
            document.getElementById('cloudCfgList').style.display = '';
            loadCloudConfigs();
        }
        function cfgCloudTypeChange() {
            const t = document.getElementById('cfgClType').value;
            document.getElementById('cfgClFields').innerHTML = t === 'openlist'
                ? `<div class="cfg-row"><span>地址</span><input type="text" id="cfgClBaseUrl" placeholder="https://pan.example.com"></div>
                   <div class="cfg-row"><span>路径</span><input type="text" id="cfgClPath" placeholder="/backups"></div>
                   <div class="cfg-row"><span>账号</span><input type="text" id="cfgClUser"></div>
                   <div class="cfg-row"><span>密码</span><span class="st-eye-wrap"><input type="password" id="cfgClPass"><button type="button" class="st-eye" data-eye tabindex="-1" aria-label="显示或隐藏密码" title="显示或隐藏密码"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button></span></div>`
                : `<div class="cfg-row"><span>主机</span><input type="text" id="cfgClHost" placeholder="ftp.example.com"></div>
                   <div class="cfg-row"><span>端口</span><input type="number" id="cfgClPort"></div>
                   <div class="cfg-row"><span>账号</span><input type="text" id="cfgClUser"></div>
                   <div class="cfg-row"><span>密码</span><span class="st-eye-wrap"><input type="password" id="cfgClPass"><button type="button" class="st-eye" data-eye tabindex="-1" aria-label="显示或隐藏密码" title="显示或隐藏密码"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button></span></div>
                   <div class="cfg-row"><span>路径</span><input type="text" id="cfgClPath" placeholder="/backups"></div>
                   ${t === 'ftp' ? `<div class="cfg-row"><label><input type="checkbox" id="cfgClSecure"> FTPS 加密</label></div>` : ''}`;
        }
        function cloudCfgBody() {
            const t = document.getElementById('cfgClType').value;
            const base = { enabled: document.getElementById('cfgClEnabled').checked, type: t };
            if (t === 'openlist') return { ...base, baseUrl: document.getElementById('cfgClBaseUrl').value.trim(), path: document.getElementById('cfgClPath').value.trim(), user: document.getElementById('cfgClUser').value.trim(), password: document.getElementById('cfgClPass').value };
            return { ...base, host: document.getElementById('cfgClHost').value.trim(), port: parseInt(document.getElementById('cfgClPort').value) || 0, user: document.getElementById('cfgClUser').value.trim(), password: document.getElementById('cfgClPass').value, path: document.getElementById('cfgClPath').value.trim(), secure: document.getElementById('cfgClSecure') ? document.getElementById('cfgClSecure').checked : false };
        }
        function testCloudCfgConn() {
            toast('测试中...', true);
            fetch('/api/admin/cloud/test', { method: 'POST', headers: authHeaders(), body: JSON.stringify(cloudCfgBody()) })
                .then(r => r.json()).then(d => toast(d.msg, d.code === 0));
        }
        function saveCloudCfgFromModal() {
            const body = cloudCfgBody();
            if (cloudEditId) body.id = cloudEditId;
            fetch('/api/admin/cloud/config', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); if (d.code === 0) { cancelCloudCfgEdit(); loadCloudConfigs(); loadCloudList(); } });
        }
        function deleteCloudCfg(id) {
            if (!confirm('确认删除该云端配置？')) return;
            fetch('/api/admin/cloud/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadCloudConfigs(); });
        }
        function testCloudCfg(id) {
            const x = cloudCfgs.find(c => c.id === id);
            if (!x) return;
            fetch('/api/admin/cloud/test', { method: 'POST', headers: authHeaders(), body: JSON.stringify(x) })
                .then(r => r.json()).then(d => toast(d.msg, d.code === 0));
        }
        let allCloud = [], cloudState = { page: 1, total: 0, limit: 50 };
        function loadCloudList() {
            fetch('/api/admin/cloud/list', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) { document.getElementById('cloudList').innerHTML = '<div class="empty-state">' + esc(d.msg || '云端未配置') + '</div>'; return; }
                    const c = document.getElementById('cloudList');
                    allCloud = d.data || [];
                    cloudState.total = allCloud.length;
                    if (!allCloud.length) { c.innerHTML = '<div class="empty-state">云端无备份</div>'; document.getElementById('cloudPager').innerHTML = ''; return; }
                    const start = (cloudState.page - 1) * cloudState.limit;
                    const list = allCloud.slice(start, start + cloudState.limit);
                    c.innerHTML = list.map(b => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px;flex-wrap:wrap">
                        <span style="font-family:monospace;flex:1;min-width:160px">${esc(b.name)}</span>
                        <span style="color:var(--text3)">${fmtSize(b.size || 0)}</span>
                        <span style="color:var(--text3)">${b.modified ? new Date(b.modified).toLocaleString('zh-CN') : ''}</span>
                        <span style="display:flex;gap:6px">
                            <button class="btn btn-sm" onclick="downloadCloudBackup('${esc(b.name)}')">下载到本地</button>
                            <button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="deleteCloudBackup('${esc(b.name)}')">删除</button>
                        </span>
                    </div>`).join('');
                    document.getElementById('cloudPager').innerHTML = pagerHTML('cloud', cloudState, renderCloudList);
                }).catch(() => {});
        }
        function renderCloudList() { loadCloudList(); }
        function downloadCloudBackup(name) {
            fetch('/api/admin/cloud/download', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadBackups(); });
        }
        function deleteCloudBackup(name) {
            if (!confirm('确认删除云端备份 ' + name + '？')) return;
            fetch('/api/admin/cloud/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadCloudList(); });
        }

        /* ===== 字幕管理 ===== */
        let subState = { page: 1, total: 0, limit: 50 };
        function subNewTypeChange() {
            const t = document.querySelector('input[name="subNewType"]:checked').value;
            document.getElementById('subNewUrlRow').style.display = t === 'url' ? '' : 'none';
            document.getElementById('subNewTextRow').style.display = t === 'text' ? '' : 'none';
        }
        /* ===== 字幕管理（视频 → 字幕） ===== */
        let subVideos = [], subVideosAll = [], subVideoState = { page: 1, total: 0, limit: 50 };
        let subVideoCounts = {}, curSubVid = '', curSubUrl = '';
        function loadSubVideos() {
            const search = document.getElementById('svSearch').value.trim().toLowerCase();
            fetch('/api/admin/videos', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code !== 0) return;
                subVideosAll = (d.data || []).filter(v => !search || String(v.vid).toLowerCase().includes(search) || String(v.url).toLowerCase().includes(search));
                subVideoState.total = subVideosAll.length;
                renderSubVideos();
            });
            fetch('/api/admin/subtitles/video-counts', { headers: authHeaders() }).then(r => r.json()).then(d => {
                if (d.code === 0) { subVideoCounts = d.data; renderSubVideos(); }
            }).catch(() => {});
        }
        function renderSubVideos() {
            document.getElementById('svCount').textContent = '共 ' + subVideoState.total + ' 个';
            const c = document.getElementById('subVideoList');
            if (!subVideosAll.length) { c.innerHTML = '<div class="empty-state">暂无视频映射</div>'; document.getElementById('subVideoPager').innerHTML = ''; return; }
            const start = (subVideoState.page - 1) * subVideoState.limit;
            const list = subVideosAll.slice(start, start + subVideoState.limit);
            c.innerHTML = list.map(v => {
                const n = subVideoCounts[v.vid] || 0;
                const active = v.vid === curSubVid;
                return `<div class="sv-item ${active ? 'on' : ''}" style="display:flex;align-items:center;gap:8px;padding:9px 10px;border-radius:8px;cursor:pointer;border:1px solid ${active ? 'rgba(124,92,252,.45)' : 'var(--border)'};background:${active ? 'rgba(124,92,252,.12)' : 'rgba(255,255,255,.02)'};margin-bottom:6px;transition:all .15s" onclick="selectSubVideo('${esc(v.vid)}','${esc(v.url)}')">
                    <div style="flex:1;min-width:0">
                        <div style="font-family:monospace;font-size:12px;color:var(--accent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.vid)}</div>
                        <div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.url)}</div>
                    </div>
                    <span class="pl-chip" style="${n ? 'color:var(--success)' : ''}">${n} 字幕</span>
                </div>`;
            }).join('');
            document.getElementById('subVideoPager').innerHTML = pagerHTML('subVideos', subVideoState, renderSubVideos);
        }
        function selectSubVideo(vid, url) {
            curSubVid = vid;
            curSubUrl = url;
            renderSubVideos();
            document.getElementById('svInfo').textContent = vid + (url ? ' · ' + url : '');
            document.getElementById('svAddCard').style.display = '';
            subState.page = 1;
            loadSubtitles();
        }
        function loadSubtitles() {
            if (!curSubVid) { document.getElementById('svSubs').innerHTML = '<div class="empty-state">请先在左侧选择一个视频</div>'; document.getElementById('subPager').innerHTML = ''; return; }
            fetch(`/api/admin/subtitles?vid=${encodeURIComponent(curSubVid)}&page=${subState.page}&limit=${subState.limit}`, { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    subState.total = d.data.total;
                    const c = document.getElementById('svSubs');
                    const list = d.data.list || [];
                    if (!list.length) { c.innerHTML = '<div class="empty-state">该视频暂无字幕，可在右侧添加</div>'; document.getElementById('subPager').innerHTML = ''; return; }
                    c.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>名称</th><th>语言</th><th>类型</th><th>状态</th><th>操作</th></tr></thead><tbody>' + list.map(s => `<tr>
                        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.name)}">${esc(s.name)}</td>
                        <td>${(s.langs && s.langs.length > 1) ? `<span class="pl-chip" style="color:var(--warn)" title="双语字幕">${esc(s.langs.map(l => l).join(' + '))}</span>` : `<span style="font-size:12px;color:var(--text3)">${esc(s.langName || s.lang || '—')}</span>`}</td>
                        <td style="font-size:12px;color:var(--text3)">${esc(s.type)}</td>
                        <td>${s.localized ? '<span style="color:var(--success)">本地</span>' : '<span style="color:var(--text3)">远程</span>'}</td>
                        <td style="white-space:nowrap">
                            ${s.type === 'url' && !s.localized ? `<button class="btn btn-sm" onclick="localizeSubtitle('${s.id}')">本地化</button>` : ''}
                            <button class="btn btn-sm" onclick="removeSubFromVideo('${s.id}')">移除</button>
                            <button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" onclick="deleteSubtitle('${s.id}')">删除</button>
                        </td>
                    </tr>`).join('') + '</tbody></table></div>';
                    renderSubPager();
                }).catch(() => {});
        }
        function svAddLang(langs) {
            const el = document.getElementById('subNewLang');
            el.value = el.value.trim() ? el.value.trim() + ',' + langs : langs;
        }
        function addSubtitle() {
            if (!curSubVid) return toast('请先选择视频', false);
            const name = document.getElementById('subNewName').value.trim();
            const langs = document.getElementById('subNewLang').value.trim();
            const t = document.querySelector('input[name="subNewType"]:checked').value;
            const body = { name, lang: langs, langs, type: t, vid: curSubVid };
            if (t === 'url') {
                const url = document.getElementById('subNewUrl').value.trim();
                if (!/^https?:\/\//i.test(url)) return toast('请输入有效的字幕链接', false);
                body.url = url;
                body.localize = document.querySelector('input[name="subNewLocalize"]:checked').value === '1';
            } else {
                const content = document.getElementById('subNewText').value;
                if (!content) return toast('请输入字幕内容', false);
                body.content = content;
            }
            fetch('/api/admin/subtitles', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
                .then(r => r.json()).then(d => { toast(d.msg || '已添加', d.code === 0); if (d.code === 0) { document.getElementById('subNewName').value = ''; document.getElementById('subNewLang').value = ''; document.getElementById('subNewUrl').value = ''; document.getElementById('subNewText').value = ''; loadSubtitles(); loadSubVideos(); } });
        }
        function uploadSubtitleFiles() {
            if (!curSubVid) return toast('请先选择视频', false);
            const input = document.getElementById('subNewFile');
            if (!input.files.length) return;
            const fd = new FormData();
            fd.append('vid', curSubVid);
            Array.from(input.files).forEach(f => fd.append('files', f));
            fetch('/api/admin/subtitles/upload', { method: 'POST', headers: { 'Authorization': 'Bearer ' + adminToken }, body: fd })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); input.value = ''; if (d.code === 0) { loadSubtitles(); loadSubVideos(); } });
        }
        /* 仅移除该视频的字幕关联（保留字幕库） */
        function removeSubFromVideo(id) {
            if (!confirm('确认从该视频移除字幕？（字幕库保留）')) return;
            fetch('/api/admin/subtitles', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id, vid: curSubVid }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadSubtitles(); loadSubVideos(); });
        }
        /* 彻底删除字幕（从字幕库与所有视频移除） */
        function deleteSubtitle(id) {
            if (!confirm('确认删除该字幕？（将从字幕库与所有视频移除）')) return;
            fetch('/api/admin/subtitles', { method: 'DELETE', headers: authHeaders(), body: JSON.stringify({ id, deleteLibrary: true }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadSubtitles(); loadSubVideos(); });
        }
        function localizeSubtitle(id) {
            fetch('/api/admin/subtitles/localize', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ id }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadSubtitles(); });
        }

        /* ===== 视频批量操作 ===== */
        function videoToggleSelectAll() {
            const hdr = document.getElementById('videoSelectAll');
            const top = document.getElementById('videoSelectAllTop');
            const on = hdr ? hdr.checked : (top ? top.checked : false);
            if (hdr) hdr.checked = on;
            if (top) top.checked = on;
            document.querySelectorAll('.video-cb').forEach(c => c.checked = on);
        }
        function getSelectedVideos() {
            return Array.from(document.querySelectorAll('.video-cb:checked')).map(c => c.value);
        }
        function videoBatchDelete() {
            const sel = getSelectedVideos();
            if (!sel.length) return toast('请先选择视频', false);
            if (!confirm('确认删除所选 ' + sel.length + ' 个视频映射？')) return;
            fetch('/api/admin/videos/delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ vids: sel }) })
                .then(r => r.json()).then(d => { toast(d.msg, d.code === 0); loadVideos(); });
        }
        function openCodeModal(title, code) {
            document.getElementById('codeModalTitle').textContent = title;
            document.getElementById('codeModalContent').textContent = code;
            document.getElementById('codeModal').style.display = 'flex';
        }
        function closeCodeModal() { document.getElementById('codeModal').style.display = 'none'; }
        function copyCodeModal() {
            const text = document.getElementById('codeModalContent').textContent;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => toast('已复制', true)).catch(() => toast('复制失败', false));
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                try { document.execCommand('copy'); toast('已复制', true); } catch (e) { toast('复制失败', false); }
                document.body.removeChild(ta);
            }
        }
        function videoCopyCodes(type) {
            fetch('/api/admin/videos', { headers: authHeaders() })
                .then(r => r.json()).then(d => {
                    if (d.code !== 0) return;
                    const list = d.data || [];
                    if (!list.length) return toast('暂无视频映射', false);
                    const base = location.origin + '/player/?url=';
                    let code = '';
                    if (type === 'html') {
                        code = list.map(v => `<a href="${base}${encodeURIComponent(v.url)}" target="_blank">播放视频</a>`).join('\n');
                    } else if (type === 'md') {
                        code = list.map(v => `[播放视频](${base}${encodeURIComponent(v.url)})`).join('\n');
                    } else if (type === 'js') {
                        code = list.map(v => `window.open('${base}${encodeURIComponent(v.url)}')`).join('\n');
                    } else {
                        code = list.map(v => base + encodeURIComponent(v.url)).join('\n');
                    }
                    openCodeModal('已生成 ' + list.length + ' 条', code);
                });
        }

        /* ===== 首次启动初始化向导 ===== */
        let initCur = 1;
        function initLangChange() { I18N.setLang(document.getElementById('initLang').value); }
        function initDbTypeChange() {
            const t = document.getElementById('initDbType').value;
            const f = document.getElementById('initDbFields');
            /* T3.1:样式收敛到 .init-step-body 规则(间距由 CSS 提供) */
            const mk = (id, ph) => `<input type="text" id="${id}" placeholder="${ph}">`;
            if (t === 'json') f.innerHTML = '<div class="cfg-hint">JSON 文件存储（data/*.json），零配置</div>';
            else if (t === 'sqlite') f.innerHTML = mk('initSqliteFile', '文件路径（默认 data/app.db）');
            else if (t === 'mongodb') f.innerHTML = mk('initDbHost', '主机 127.0.0.1') + mk('initDbPort', '端口 27017') + mk('initDbUser', '用户（可空）') + '<span class="st-eye-wrap"><input type="password" id="initDbPass" placeholder="密码"><button type="button" class="st-eye" data-eye tabindex="-1" aria-label="显示或隐藏密码" title="显示或隐藏密码"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button></span>' + mk('initDbName', '数据库 artplayer');
            else f.innerHTML = mk('initDbHost', '主机 127.0.0.1') + mk('initDbPort', '端口 ' + (t === 'postgres' ? '5432' : '3306')) + mk('initDbUser', '用户 root') + '<span class="st-eye-wrap"><input type="password" id="initDbPass" placeholder="密码"><button type="button" class="st-eye" data-eye tabindex="-1" aria-label="显示或隐藏密码" title="显示或隐藏密码"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button></span>' + mk('initDbName', '数据库 artplayer');
        }
        function initDbBody() {
            const t = document.getElementById('initDbType').value;
            if (t === 'json') return { type: 'json' };
            if (t === 'sqlite') return { type: 'sqlite', sqlite: { file: document.getElementById('initSqliteFile').value || 'data/app.db' } };
            if (t === 'mongodb') return { type: 'mongodb', mongodb: { host: document.getElementById('initDbHost').value, port: parseInt(document.getElementById('initDbPort').value) || 27017, user: document.getElementById('initDbUser').value, password: document.getElementById('initDbPass').value, database: document.getElementById('initDbName').value || 'artplayer' } };
            const c = { host: document.getElementById('initDbHost').value, port: parseInt(document.getElementById('initDbPort').value) || 3306, user: document.getElementById('initDbUser').value, password: document.getElementById('initDbPass').value, database: document.getElementById('initDbName').value || 'artplayer' };
            return { type: t, mysql: c, postgres: c, mongodb: c };
        }
        function testInitDbConn() {
            toast('测试中...', true);
            fetch('/api/admin/db/test', { method: 'POST', headers: authHeaders(), body: JSON.stringify(initDbBody()) })
                .then(r => r.json()).then(d => toast(d.msg, d.code === 0));
        }
        function initStep(delta) {
            const next = initCur + delta;
            /* 离开密码步骤（点「完成初始化」）时才校验密码，进入该步骤时不校验（此时密码尚未填写） */
            if (delta > 0 && initCur === 4) {
                const n1 = document.getElementById('initNewPwd').value;
                const n2 = document.getElementById('initNewPwd2').value;
                if (n1 !== n2) { document.getElementById('initMsg').textContent = '两次输入的密码不一致'; return; }
                if (n1.length < 4) { document.getElementById('initMsg').textContent = '新密码至少4位'; return; }
            }
            if (delta > 0 && next === 2) {
                document.getElementById('initTzPreview').textContent = '当前时间: ' + new Date().toLocaleString('zh-CN', { timeZone: document.getElementById('initTz').value });
            }
            if (next < 1 || next > 4) {
                if (next > 4) initFinish();
                return;
            }
            initCur = next;
            document.getElementById('initMsg').textContent = '';
            for (let i = 1; i <= 4; i++) {
                document.getElementById('initStep' + i).style.display = i === next ? '' : 'none';
                const s = document.querySelector(`.init-step[data-step="${i}"]`);
                s.classList.toggle('active', i === next);
                s.classList.toggle('done', i < next);
            }
            document.getElementById('initPrevBtn').style.display = next === 1 ? 'none' : '';
            const nb = document.getElementById('initNextBtn');
            nb.textContent = next === 4 ? '完成初始化' : '下一步';
        }
        function initFinish() {
            const body = {
                newPassword: document.getElementById('initNewPwd').value,
                adminPath: document.getElementById('initAdminPath').value.trim(),
                timezone: document.getElementById('initTz').value,
                language: document.getElementById('initLang').value,
                db: initDbBody()
            };
            const btn = document.getElementById('initNextBtn');
            btn.disabled = true; btn.textContent = '提交中...';
            fetch('/api/admin/init', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
                .then(r => r.json()).then(d => {
                    if (d.code === 0) {
                        toast('初始化完成', true);
                        I18N.setLang(body.language);
                        setTimeout(() => location.reload(), 1200);
                    } else {
                        document.getElementById('initMsg').textContent = d.msg || '初始化失败';
                        btn.disabled = false; btn.textContent = '完成初始化';
                    }
                }).catch(() => { btn.disabled = false; btn.textContent = '完成初始化'; document.getElementById('initMsg').textContent = '请求失败'; });
        }

        document.getElementById('passwordInput').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
        document.getElementById('newWordInput').addEventListener('keypress', e => { if (e.key === 'Enter') addBannedWord(); });
        loadAdminTheme();
        initNav();
        loadLoginPlugins();
        restoreSession();
    