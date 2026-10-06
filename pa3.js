
/* ===== Material Design 3 增强层(T3):明暗模式 / 侧栏收展 / 顶栏 / FAB / 涟漪 =====
   纯增量脚本:不改动既有逻辑;无本脚本时页面仍可运行(仅失去 MD3 增强交互)。 */
(function () {
    var sidebar = document.getElementById('sidebar');
    var mainPage = document.getElementById('mainPage');
    var topbar = document.getElementById('mdTopbar');
    var progress = document.getElementById('mdTopbarProgress');
    var fab = document.getElementById('mdFab');
    var railBtn = document.getElementById('mdNavToggle');
    var title = document.getElementById('topbarTitle');
    var MODE_KEY = 'ap_admin_mode', RAIL_KEY = 'ap_admin_rail';

    /* 顶栏标题跟随当前激活导航项 */
    window.__mdOnTab = function () {
        var el = document.querySelector('.nav-item.active');
        if (el && title) {
            var lbl = '';
            try { lbl = navLabel(el.dataset.tab) || ''; } catch (e) {}
            title.textContent = lbl || ((el.querySelector('span:last-child') || el).textContent || '').trim();
        }
    };

    /* 明暗模式:亮 / 暗 / 跟随系统,记忆于 localStorage */
    function applyMode(m) {
        if (['light', 'dark', 'system'].indexOf(m) < 0) m = 'system';
        document.documentElement.dataset.mode = m;
        try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
        var btns = document.querySelectorAll('#mdModeSeg .md-seg-btn');
        for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].dataset.mode === m);
    }
    var segBtns = document.querySelectorAll('#mdModeSeg .md-seg-btn');
    for (var i = 0; i < segBtns.length; i++) segBtns[i].addEventListener('click', function () { applyMode(this.dataset.mode); });
    var savedMode = 'system';
    try { savedMode = localStorage.getItem(MODE_KEY) || 'system'; } catch (e) {}
    applyMode(savedMode);

    /* 侧栏收展(Navigation Rail) */
    function refreshTips() {
        if (typeof I18N === 'undefined' || !I18N.t) return;
        if (railBtn) railBtn.setAttribute('data-tip', I18N.t('展开 / 收起侧栏'));
        if (fab) fab.setAttribute('data-tip', I18N.t('回到顶部'));
        var segT = { light: '亮色', dark: '暗色', system: '跟随系统' };
        var sb = document.querySelectorAll('#mdModeSeg .md-seg-btn');
        for (var i = 0; i < sb.length; i++) sb[i].setAttribute('data-tip', I18N.t(segT[sb[i].dataset.mode] || ''));
        var items = document.querySelectorAll('.side-nav .nav-item');
        for (var j = 0; j < items.length; j++) {
            var n = items[j];
            if (sidebar && sidebar.classList.contains('rail')) {
                var s = n.querySelector('span:last-child');
                if (s) n.setAttribute('data-tip', (s.textContent || '').trim());
            } else if (n.hasAttribute('data-tip')) n.removeAttribute('data-tip');
        }
    }
    function applyRail(on) {
        if (sidebar) sidebar.classList.toggle('rail', !!on);
        try { localStorage.setItem(RAIL_KEY, on ? '1' : '0'); } catch (e) {}
        refreshTips();
    }
    /* T3.1 移动端抽屉:≤768px 时汉堡开合侧栏 + 遮罩;桌面端仍为 Navigation Rail 收展 */
    var mq = window.matchMedia ? window.matchMedia('(max-width: 768px)') : null;
    function isMobile() { return !!(mq && mq.matches); }
    var scrim = document.createElement('div');
    scrim.className = 'drawer-scrim';
    document.body.appendChild(scrim);
    function openDrawer() { if (sidebar) sidebar.classList.add('drawer-open'); scrim.classList.add('show'); }
    function closeDrawer() { if (sidebar) sidebar.classList.remove('drawer-open'); scrim.classList.remove('show'); }
    function drawerOpen() { return !!(sidebar && sidebar.classList.contains('drawer-open')); }
    if (mq) {
        var onMq = function (e) { if (e.matches && sidebar) sidebar.classList.remove('rail'); closeDrawer(); };
        if (mq.addEventListener) mq.addEventListener('change', onMq);
        else if (mq.addListener) mq.addListener(onMq);
    }
    if (railBtn) railBtn.addEventListener('click', function () {
        if (isMobile()) { if (drawerOpen()) closeDrawer(); else openDrawer(); }
        else applyRail(sidebar ? !sidebar.classList.contains('rail') : false);
    });
    scrim.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawerOpen()) closeDrawer(); });
    /* 抽屉内点选导航后自动收起 */
    if (sidebar) sidebar.addEventListener('click', function (e) {
        if (drawerOpen() && e.target.closest && e.target.closest('.nav-item')) closeDrawer();
    });
    try { if (localStorage.getItem(RAIL_KEY) === '1') applyRail(true); } catch (e) {}
    if (isMobile() && sidebar) sidebar.classList.remove('rail');
    if (window.I18N && I18N.apply) {
        var _apply = I18N.apply;
        I18N.apply = function (root) { _apply(root); try { refreshTips(); } catch (e) {} };
    }
    refreshTips();

    /* 顶栏滚动反馈:elevation + 阅读进度 + 回顶 FAB */
    if (mainPage && topbar) mainPage.addEventListener('scroll', function () {
        var st = mainPage.scrollTop, max = mainPage.scrollHeight - mainPage.clientHeight;
        topbar.classList.toggle('scrolled', st > 4);
        if (progress) progress.style.width = (max > 0 ? Math.min(100, st / max * 100) : 0) + '%';
        if (fab) fab.classList.toggle('show', st > 420);
    }, { passive: true });
    if (fab) fab.addEventListener('click', function () {
        if (mainPage) mainPage.scrollTo({ top: 0, behavior: 'smooth' });
    });

    /* 涟漪(MD3 ripple) */
    document.addEventListener('pointerdown', function (e) {
        var host = e.target.closest ? e.target.closest('.btn, .nav-item, .md-icon-btn, .md-seg-btn, .bk-cfg-tab, .km-item, .sv-item, .md-fab, .pager button') : null;
        if (!host || host.disabled) return;
        var r = host.getBoundingClientRect();
        var d = Math.max(r.width, r.height);
        var sp = document.createElement('span');
        sp.className = 'md-ripple';
        sp.style.width = sp.style.height = d + 'px';
        sp.style.left = (e.clientX - r.left - d / 2) + 'px';
        sp.style.top = (e.clientY - r.top - d / 2) + 'px';
        host.appendChild(sp);
        sp.addEventListener('animationend', function () { sp.remove(); });
    });

    /* T3.1:.md-field 输入兜底 —— 插件/个别浏览器填充不更新 :placeholder-shown 时,
       以 .filled 类强制浮动标签;登录页程序化回填由 CSS :not(:placeholder-shown) 原生覆盖 */
    document.addEventListener('input', function (e) {
        var tgt = e.target, f = tgt && tgt.closest && tgt.closest('.md-field');
        if (f) f.classList.toggle('filled', !!tgt.value);
    }, true);
    var mdFieldInputs = document.querySelectorAll('.md-field input');
    for (var fi = 0; fi < mdFieldInputs.length; fi++) {
        var ff = mdFieldInputs[fi].closest('.md-field');
        if (ff) ff.classList.toggle('filled', !!mdFieldInputs[fi].value);
    }

    __mdOnTab();
})();

/* ================= T3.1 收尾(Lead):密码显隐 document 级兜底 + 表格横滚自动包裹 ================= */
(function () {
    /* 模态/向导里的 [data-eye]:settings.js 的处理器只挂 #stSections,
       文档级兜底覆盖其余位置;#stSections 内的交由 settings.js,防双触发 */
    document.addEventListener('click', function (e) {
        var eye = e.target && e.target.closest ? e.target.closest('[data-eye]') : null;
        if (!eye) return;
        if (eye.closest && eye.closest('#stSections')) return;
        var inp = eye.parentElement && eye.parentElement.querySelector('input');
        if (inp) {
            inp.type = inp.type === 'password' ? 'text' : 'password';
            eye.classList.toggle('st-eye-on');
        }
    });
    /* 裸 table(静态与动态渲染)自动包入 .tbl-wrap,窄屏横向滚动兜底 */
    function wrapTables(scope) {
        var ts = scope.querySelectorAll('table');
        for (var i = 0; i < ts.length; i++) {
            var t = ts[i];
            if (t.closest && t.closest('.tbl-wrap')) continue;
            var w = document.createElement('div');
            w.className = 'tbl-wrap';
            t.parentNode.insertBefore(w, t);
            w.appendChild(t);
        }
    }
    var mp = document.getElementById('mainPage');
    if (mp) {
        wrapTables(mp);
        if (window.MutationObserver) {
            new MutationObserver(function () { wrapTables(mp); }).observe(mp, { childList: true, subtree: true });
        }
    }
})();
