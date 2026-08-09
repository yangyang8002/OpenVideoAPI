/* OpenVideoAPI 插件 —— OTP 双因素登录：后台「OTP 登录」管理 tab
 * 功能：查看当前状态 / 生成密钥（二维码 + otpauth URI）/ 一次性恢复码 /
 *       确认启用 / 测试验证码 / 禁用
 * 说明：所有管理操作均需管理员密码（已启用时还需当前验证码或恢复码），
 *       由服务端 /api/plugin/otp/* 校验。
 */
(function () {
    'use strict';
    var D = {
        zh: {
            status: '当前状态', ok: '已启用', not: '未启用', user: '账号',
            enable: '启用 OTP', disable: '禁用 OTP', gen: '生成密钥', confirm: '确认启用',
            username: '管理员账号', password: '管理员密码', code: '动态验证码', testCode: '测试验证码',
            secTip: '已启用时需同时提供当前验证码或恢复码，防止被他人篡改',
            step2: '将密钥添加到验证器 App（Google Authenticator / Microsoft Authenticator / 1Password 等）：',
            scan: '1. 扫描二维码（或手动输入下方密钥）', manual: '2. 手动添加：',
            secret: '密钥', uri: 'otpauth URI', copy: '复制', copied: '已复制', copyFail: '复制失败',
            recTitle: '一次性恢复码（请立即保存，关闭后不再显示）', recWarn: '每个恢复码只能使用一次，请妥善保管',
            confirmTip: '3. 在验证器 App 中输入当前动态验证码，确认启用：',
            confirmBtn: '确认并启用', setupAgain: '重新生成密钥',
            done: '启用成功！请使用验证器 App 中的验证码登录。',
            disableTip: '输入密码与当前验证码（或恢复码）后关闭：',
            disableBtn: '禁用 OTP', disabled: '已禁用 OTP',
            loading: '加载中...', unknown: '未知', err: '操作失败', empty: '',
            fillUserPwd: '请输入账号和密码', fillAll: '请填写完整',
            codeOk: '验证码有效', codeBad: '验证码错误或已过期', tooFreq: '验证尝试过于频繁',
            qrFailed: '二维码加载失败，请使用下方 otpauth URI 手动添加',
            recCopyAll: '复制全部', recUseTip: '可在登录页代替动态验证码使用',
            cancel: '取消', back: '返回',
            disableConfirm: '确认禁用 OTP？禁用后登录不再校验验证码（密钥将被删除）。'
        },
        en: {
            status: 'Status', ok: 'Enabled', not: 'Not enabled', user: 'Account',
            enable: 'Enable OTP', disable: 'Disable OTP', gen: 'Generate secret', confirm: 'Confirm & enable',
            username: 'Admin username', password: 'Admin password', code: 'Authenticator code', testCode: 'Test code',
            secTip: 'When enabled, the current code or a recovery code is also required to prevent tampering',
            step2: 'Add the secret to your authenticator app (Google Authenticator / Microsoft Authenticator / 1Password...):',
            scan: '1. Scan the QR code (or type the secret below)', manual: '2. Add manually:',
            secret: 'Secret', uri: 'otpauth URI', copy: 'Copy', copied: 'Copied', copyFail: 'Copy failed',
            recTitle: 'One-time recovery codes (save them now, shown only once)', recWarn: 'Each code works once — keep them safe',
            confirmTip: '3. Enter the current code from your authenticator app to enable:',
            confirmBtn: 'Confirm & enable', setupAgain: 'Regenerate secret',
            done: 'Enabled! Log in with a code from your authenticator app.',
            disableTip: 'Enter your password and the current code (or a recovery code) to disable:',
            disableBtn: 'Disable OTP', disabled: 'OTP disabled',
            loading: 'Loading...', unknown: 'Unknown', err: 'Operation failed', empty: '',
            fillUserPwd: 'Enter username and password', fillAll: 'Fill in all fields',
            codeOk: 'Code is valid', codeBad: 'Invalid or expired code', tooFreq: 'Too many attempts',
            qrFailed: 'QR failed to load, use the otpauth URI below to add manually',
            recCopyAll: 'Copy all', recUseTip: 'Can be used instead of the code on the login page',
            cancel: 'Cancel', back: 'Back',
            disableConfirm: 'Disable OTP? Login will no longer require codes (the secret will be deleted).'
        }
    };
    function T(key) {
        var lang = (window.I18N && I18N.lang) || 'zh';
        var d = D[lang] || D.en;
        return d[key] || key;
    }
    function esc2(s) {
        var d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }
    function copyText(text, okMsg) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { toast(okMsg || T('copied'), true); }).catch(function () { toast(T('copyFail'), false); });
        } else {
            var ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); toast(okMsg || T('copied'), true); } catch (e) { toast(T('copyFail'), false); }
            document.body.removeChild(ta);
        }
    }
    /* 二维码：优先内联渲染；无库则从 CDN 加载一次，失败显示 URI 文本 */
    var _qrScriptLoading = false, _qrPending = [];
    function showQR(el, text) {
        el.innerHTML = '';
        if (window.QRCode) {
            try { new QRCode(el, { text: text, width: 190, height: 190 }); return; } catch (e) {}
        }
        _qrPending.push({ el: el, text: text });
        if (_qrScriptLoading) return;
        _qrScriptLoading = true;
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/gh/davidshimjs/qrcodejs@master/qrcode.min.js';
        s.onload = function () {
            _qrScriptLoading = false;
            var list = _qrPending; _qrPending = [];
            list.forEach(function (it) { if (window.QRCode) { try { new QRCode(it.el, { text: it.text, width: 190, height: 190 }); } catch (e) { it.el.textContent = it.text; } } else it.el.textContent = it.text; });
        };
        s.onerror = function () {
            _qrScriptLoading = false;
            var list = _qrPending; _qrPending = [];
            list.forEach(function (it) { it.el.textContent = it.text; });
        };
        document.head.appendChild(s);
    }

    var state = { username: '', cfg: null, enrolled: false, pendingSecret: null, pendingUri: null, pendingRecovery: [] };

    function api(path, body) {
        return OpenVideoAdmin.api(path, body ? { method: 'POST', body: JSON.stringify(body) } : {});
    }

    function setMsg(el, m, ok) { el.textContent = m; el.style.color = ok ? 'var(--success)' : 'var(--danger)'; }

    function row(label, id) {
        return '<div class="cfg-row"><span>' + esc2(label) + '</span><input type="text" id="' + id + '" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text);font-size:12px;outline:none"></div>';
    }
    function rowPwd(label, id) {
        return '<div class="cfg-row"><span>' + esc2(label) + '</span><input type="password" id="' + id + '" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text);font-size:12px;outline:none"></div>';
    }

    function renderRoot(el) {
        var u = state.username || (window.adminUser || '');
        el.innerHTML = '<div class="card">' +
            '<h3><span class="dot" style="background:var(--accent);box-shadow:0 0 6px var(--accent)"></span>' + esc2(T('status')) + ' ' +
            '<span id="otpStatusBadge" style="font-size:12px;margin-left:6px"></span></h3>' +
            '<div id="otpStatusBody" style="font-size:12px;color:var(--text2);line-height:2">' + esc2(T('loading')) + '</div>' +
            '</div>' +
            '<div class="card"><h3><span class="dot" style="background:var(--primary);box-shadow:0 0 6px var(--primary)"></span><span id="otpFormTitle">' + esc2(T('enable')) + '</span></h3>' +
            '<div id="otpFormBody"></div></div>';
        loadStatus(el);
    }

    function loadStatus(el) {
        api('/api/plugin/otp/status', { username: state.username || (window.adminUser || '') }).then(function (d) {
            var enabled = !!(d && d.code === 0 && d.data && d.data.enabled);
            state.enrolled = enabled;
            var badge = document.getElementById('otpStatusBadge');
            if (badge) {
                badge.textContent = enabled ? T('ok') : T('not');
                badge.style.color = enabled ? 'var(--success)' : 'var(--text3)';
            }
            var body = document.getElementById('otpStatusBody');
            if (body) body.textContent = (state.username || (window.adminUser || '')) + ' · ' + (enabled ? T('ok') : T('not'));
            renderForm(el);
        }).catch(function () {
            var body = document.getElementById('otpStatusBody');
            if (body) body.textContent = T('err');
        });
    }

    function renderForm(el) {
        var form = document.getElementById('otpFormBody');
        if (!form) return;
        var u = state.username || (window.adminUser || '');
        if (state.enrolled) {
            document.getElementById('otpFormTitle').textContent = T('disable') + ' / ' + T('setupAgain');
            form.innerHTML =
                '<div class="cfg-hint" style="margin-bottom:10px">' + esc2(T('secTip')) + '</div>' +
                row(T('username'), 'otpUsername') + rowPwd(T('password'), 'otpPwd') + row(T('code'), 'otpCode') +
                '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
                '<button class="btn btn-sm btn-primary" id="otpTestBtn">' + esc2(T('testCode')) + '</button>' +
                '<button class="btn btn-sm" id="otpRegenBtn">' + esc2(T('setupAgain')) + '</button>' +
                '<button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" id="otpDisableBtn">' + esc2(T('disableBtn')) + '</button>' +
                '</div><div id="otpFormMsg" style="font-size:12px;min-height:18px;margin-top:8px"></div>';
        } else {
            document.getElementById('otpFormTitle').textContent = T('enable');
            form.innerHTML =
                row(T('username'), 'otpUsername') + rowPwd(T('password'), 'otpPwd') +
                '<div style="margin-top:12px"><button class="btn btn-sm btn-primary" id="otpGenBtn">' + esc2(T('gen')) + '</button></div>' +
                '<div id="otpFormMsg" style="font-size:12px;min-height:18px;margin-top:8px"></div>';
        }
        var uIn = document.getElementById('otpUsername');
        if (uIn && !uIn.value) uIn.value = u;
        bindForm(el);
    }

    function bindForm(el) {
        var genBtn = document.getElementById('otpGenBtn');
        if (genBtn) genBtn.addEventListener('click', function () { doSetup(el); });
        var regenBtn = document.getElementById('otpRegenBtn');
        if (regenBtn) regenBtn.addEventListener('click', function () { doSetup(el); });
        var testBtn = document.getElementById('otpTestBtn');
        if (testBtn) testBtn.addEventListener('click', function () { doTest(el); });
        var disBtn = document.getElementById('otpDisableBtn');
        if (disBtn) disBtn.addEventListener('click', function () { doDisable(el); });
    }

    function formValues() {
        return {
            username: (document.getElementById('otpUsername') || {}).value || '',
            password: (document.getElementById('otpPwd') || {}).value || '',
            code: (document.getElementById('otpCode') || {}).value || ''
        };
    }
    function formMsg(m, ok) { var el = document.getElementById('otpFormMsg'); if (el) setMsg(el, m, ok); }

    function doSetup(el) {
        var v = formValues();
        if (!v.username || !v.password) return formMsg(T('fillUserPwd'), false);
        api('/api/plugin/otp/setup', v).then(function (d) {
            if (d.code !== 0) return formMsg(d.msg || T('err'), false);
            state.pendingSecret = d.data.secret;
            state.pendingUri = d.data.uri;
            state.pendingRecovery = d.data.recovery || [];
            renderSetup(el);
        }).catch(function () { formMsg(T('err'), false); });
    }

    function renderSetup(el) {
        var form = document.getElementById('otpFormBody');
        if (!form) return;
        document.getElementById('otpFormTitle').textContent = T('step2');
        form.innerHTML =
            '<div class="cfg-hint" style="margin-bottom:10px">' + esc2(T('step2')) + '</div>' +
            '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">' +
            '<div><div style="font-size:12px;color:var(--text2);margin-bottom:6px">' + esc2(T('scan')) + '</div><div id="otpQr" style="background:#fff;border-radius:10px;padding:8px;width:206px;height:206px;display:flex;align-items:center;justify-content:center;color:#333;font-size:11px;word-break:break-all"></div></div>' +
            '<div style="flex:1;min-width:260px;font-size:12px;color:var(--text2);line-height:2">' +
            '<div>' + esc2(T('manual')) + '</div>' +
            '<div style="display:flex;align-items:center;gap:8px"><span style="color:var(--text3)">' + esc2(T('secret')) + ':</span><code data-i18n-skip style="color:var(--accent)">' + esc2(state.pendingSecret) + '</code>' +
            '<button class="btn btn-sm" id="otpCopySecret">' + esc2(T('copy')) + '</button></div>' +
            '<div style="display:flex;align-items:center;gap:8px;margin-top:6px"><span style="color:var(--text3)">' + esc2(T('uri')) + ':</span><code data-i18n-skip style="color:var(--accent);font-size:11px;word-break:break-all">' + esc2(state.pendingUri) + '</code></div>' +
            '<button class="btn btn-sm" id="otpCopyUri" style="margin-top:8px">' + esc2(T('copy')) + '</button>' +
            '</div></div>' +
            '<div style="margin-top:14px;border:1px solid var(--warn);border-radius:8px;padding:10px 12px;background:rgba(255,190,51,.06)">' +
            '<div style="font-weight:600;color:var(--warn);font-size:12px">' + esc2(T('recTitle')) + '</div>' +
            '<div style="font-size:11px;color:var(--text3);margin:4px 0 8px">' + esc2(T('recWarn')) + ' · ' + esc2(T('recUseTip')) + '</div>' +
            '<div id="otpRecovery" style="display:flex;gap:6px;flex-wrap:wrap;font-family:monospace;font-size:12px">' +
            state.pendingRecovery.map(function (c) { return '<span class="pl-chip" data-i18n-skip style="color:var(--text)">' + esc2(c) + '</span>'; }).join('') + '</div>' +
            '<button class="btn btn-sm" id="otpCopyRecovery" style="margin-top:8px">' + esc2(T('recCopyAll')) + '</button>' +
            '</div>' +
            '<div class="cfg-hint" style="margin-top:14px">' + esc2(T('confirmTip')) + '</div>' +
            row(T('code'), 'otpConfirmCode') +
            '<div style="margin-top:12px;display:flex;gap:8px"><button class="btn btn-sm btn-primary" id="otpConfirmBtn">' + esc2(T('confirmBtn')) + '</button>' +
            '<button class="btn btn-sm" id="otpCancelBtn">' + esc2(T('cancel')) + '</button></div>' +
            '<div id="otpFormMsg" style="font-size:12px;min-height:18px;margin-top:8px"></div>';
        showQR(document.getElementById('otpQr'), state.pendingUri);
        document.getElementById('otpCopySecret').addEventListener('click', function () { copyText(state.pendingSecret); });
        document.getElementById('otpCopyUri').addEventListener('click', function () { copyText(state.pendingUri); });
        document.getElementById('otpCopyRecovery').addEventListener('click', function () { copyText(state.pendingRecovery.join('\n')); });
        document.getElementById('otpCancelBtn').addEventListener('click', function () { renderForm(el); });
        document.getElementById('otpConfirmBtn').addEventListener('click', function () {
            var v = formValues();
            var code = document.getElementById('otpConfirmCode').value.trim();
            if (!v.username || !v.password) return formMsg(T('fillUserPwd'), false);
            if (!code) return formMsg(T('fillAll'), false);
            api('/api/plugin/otp/confirm', { username: v.username, password: v.password, code: code }).then(function (d) {
                if (d.code !== 0) return formMsg(d.msg || T('err'), false);
                state.enrolled = true;
                state.pendingRecovery = d.data.recovery || state.pendingRecovery;
                renderDone(el);
            }).catch(function () { formMsg(T('err'), false); });
        });
    }

    function renderDone(el) {
        var form = document.getElementById('otpFormBody');
        if (!form) return;
        document.getElementById('otpFormTitle').textContent = T('done');
        form.innerHTML =
            '<div style="color:var(--success);font-size:13px;font-weight:600;margin-bottom:12px">' + esc2(T('done')) + '</div>' +
            '<div style="border:1px solid var(--warn);border-radius:8px;padding:10px 12px;background:rgba(255,190,51,.06)">' +
            '<div style="font-weight:600;color:var(--warn);font-size:12px">' + esc2(T('recTitle')) + '</div>' +
            '<div style="font-size:11px;color:var(--text3);margin:4px 0 8px">' + esc2(T('recWarn')) + '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;font-family:monospace;font-size:12px">' +
            state.pendingRecovery.map(function (c) { return '<span class="pl-chip" data-i18n-skip style="color:var(--text)">' + esc2(c) + '</span>'; }).join('') + '</div>' +
            '<button class="btn btn-sm" id="otpCopyRecovery2" style="margin-top:8px">' + esc2(T('recCopyAll')) + '</button>' +
            '</div><div style="margin-top:12px"><button class="btn btn-sm" id="otpBackBtn">' + esc2(T('back')) + '</button></div>';
        document.getElementById('otpCopyRecovery2').addEventListener('click', function () { copyText(state.pendingRecovery.join('\n')); });
        document.getElementById('otpBackBtn').addEventListener('click', function () { loadStatus(el); });
        var badge = document.getElementById('otpStatusBadge');
        if (badge) { badge.textContent = T('ok'); badge.style.color = 'var(--success)'; }
        var body = document.getElementById('otpStatusBody');
        if (body) body.textContent = (state.username || (window.adminUser || '')) + ' · ' + T('ok');
    }

    function doTest(el) {
        var v = formValues();
        if (!v.username || !v.code) return formMsg(T('fillAll'), false);
        api('/api/plugin/otp/verify', { username: v.username, code: v.code }).then(function (d) {
            if (d && d.code === 0 && d.data && d.data.ok) formMsg(T('codeOk'), true);
            else if (d && d.code === 429) formMsg(T('tooFreq'), false);
            else formMsg(T('codeBad'), false);
        }).catch(function () { formMsg(T('err'), false); });
    }

    function doDisable(el) {
        var v = formValues();
        if (!v.username || !v.password || !v.code) return formMsg(T('fillAll'), false);
        if (!confirm(T('disableConfirm'))) return;
        api('/api/plugin/otp/disable', v).then(function (d) {
            if (d.code !== 0) return formMsg(d.msg || T('err'), false);
            state.enrolled = false;
            formMsg(T('disabled'), true);
            renderForm(el);
        }).catch(function () { formMsg(T('err'), false); });
    }

    OpenVideoAdmin.registerTab({
        id: 'otp-manage',
        title: 'OTP 登录',
        mount: function (el) {
            state.username = window.adminUser || '';
            renderRoot(el);
        }
    });
})();
