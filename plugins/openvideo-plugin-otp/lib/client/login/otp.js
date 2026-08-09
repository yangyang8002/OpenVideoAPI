/* OpenVideoAPI 插件 —— OTP 双因素登录：登录页注入动态验证码输入框
 * 作用：在后台登录页（admin.html 的 loginPage）添加验证码输入，
 *       登录时先调用 /api/plugin/otp/verify 校验 TOTP/恢复码，通过后再走原登录流程。
 * 说明：本脚本通过 manifest scope=login 在登录页加载（无需登录）。
 */
(function () {
    'use strict';
    if (window.__openvideoOtpLoginPatched) return;
    window.__openvideoOtpLoginPatched = true;

    /* 本地化（插件内小词典：随主界面语言切换） */
    var D = {
        zh: { ph: '动态验证码（已启用时必填）', need: '请输入动态验证码', err: '验证码错误或已过期', notEn: '该账号未启用 OTP', freq: '验证尝试过于频繁，请稍后再试', net: '连接失败' },
        zhHant: { ph: '動態驗證碼（已啟用時必填）', need: '請輸入動態驗證碼', err: '驗證碼錯誤或已過期', notEn: '該賬號未啟用 OTP', freq: '驗證嘗試過於頻繁，請稍後再試', net: '連接失敗' },
        en: { ph: 'Authenticator code (required if enabled)', need: 'Enter the authenticator code', err: 'Invalid or expired code', notEn: 'OTP is not enabled for this account', freq: 'Too many attempts, try again later', net: 'Connection failed' },
        ja: { ph: '認証コード（有効時は必須）', need: '認証コードを入力してください', err: '認証コードが正しくないか期限切れです', notEn: 'このアカウントでは OTP が有効ではありません', freq: '試行が多すぎます。しばらくしてからお試しください', net: '接続失敗' },
        fr: { ph: 'Code authentificateur (requis si activé)', need: 'Saisissez le code authentificateur', err: 'Code invalide ou expiré', notEn: 'OTP non activé pour ce compte', freq: 'Trop de tentatives, réessayez plus tard', net: 'Échec de la connexion' },
        wyw: { ph: '動態驗證碼（已啟時必填）', need: '請入動態驗證碼', err: '驗證碼誤或已過', notEn: '此賬未啟 OTP', freq: '試之過頻，請少頃復試', net: '連之未成' }
    };
    function T(key) {
        var lang = (window.I18N && I18N.lang) || 'zh';
        var d = D[lang] || D.en;
        return d[key] || key;
    }

    function patch() {
        var pass = document.getElementById('passwordInput');
        if (!pass) return;
        if (document.getElementById('otpCodeInput')) return;

        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'otpCodeInput';
        input.placeholder = T('ph');
        input.autocomplete = 'one-time-code';
        input.inputmode = 'numeric';
        input.style.display = 'none';
        pass.parentNode.insertBefore(input, pass.nextSibling);
        input.addEventListener('keypress', function (e) { if (e.key === 'Enter') login(); });

        var origLogin = window.login;
        if (typeof origLogin !== 'function') return;
        window.login = function () {
            var u = document.getElementById('usernameInput') ? document.getElementById('usernameInput').value.trim() : '';
            var code = input.value.trim();
            if (!u) return origLogin();
            fetch('/api/plugin/otp/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: u })
            }).then(function (r) { return r.json(); }).then(function (d) {
                var need = !!(d && d.code === 0 && d.data && d.data.enabled);
                input.style.display = need ? '' : 'none';
                if (!need) { origLogin(); return; }
                if (!code) { toast(T('need'), false); return; }
                fetch('/api/plugin/otp/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: u, code: code })
                }).then(function (r) { return r.json(); }).then(function (v) {
                    if (v && v.code === 0 && v.data && v.data.ok) { origLogin(); }
                    else {
                        var msg = v && v.code === 429 ? T('freq') : (v && v.code === 2 ? T('notEn') : T('err'));
                        toast(msg, false);
                    }
                }).catch(function () { toast(T('net'), false); });
            }).catch(function () { origLogin(); });
        };

        /* 登出回到登录页时清空验证码（补丁保留，无需重新加载） */
        var oldLogout = window.logout;
        if (typeof oldLogout === 'function') {
            window.logout = function () {
                var el = document.getElementById('otpCodeInput');
                if (el) el.value = '';
                return oldLogout.apply(this, arguments);
            };
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', patch);
    else patch();
})();
