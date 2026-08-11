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
        },
        zhHant: {
            status: '當前狀態', ok: '已啟用', not: '未啟用', user: '賬號',
            enable: '啟用 OTP', disable: '禁用 OTP', gen: '生成密鑰', confirm: '確認啟用',
            username: '管理員賬號', password: '管理員密碼', code: '動態驗證碼', testCode: '測試驗證碼',
            secTip: '已啟用時需同時提供當前驗證碼或恢復碼，防止被他人篡改',
            step2: '將密鑰添加到驗證器 App（Google Authenticator / Microsoft Authenticator / 1Password 等）：',
            scan: '1. 掃描二維碼（或手動輸入下方密鑰）', manual: '2. 手動添加：',
            secret: '密鑰', uri: 'otpauth URI', copy: '複製', copied: '已複製', copyFail: '複製失敗',
            recTitle: '一次性恢復碼（請立即保存，關閉後不再顯示）', recWarn: '每個恢復碼只能使用一次，請妥善保管',
            confirmTip: '3. 在驗證器 App 中輸入當前動態驗證碼，確認啟用：',
            confirmBtn: '確認並啟用', setupAgain: '重新生成密鑰',
            done: '啟用成功！請使用驗證器 App 中的驗證碼登錄。',
            disableTip: '輸入密碼與當前驗證碼（或恢復碼）後關閉：',
            disableBtn: '禁用 OTP', disabled: '已禁用 OTP',
            loading: '加載中...', unknown: '未知', err: '操作失敗', empty: '',
            fillUserPwd: '請輸入賬號和密碼', fillAll: '請填寫完整',
            codeOk: '驗證碼有效', codeBad: '驗證碼錯誤或已過期', tooFreq: '驗證嘗試過於頻繁',
            qrFailed: '二維碼加載失敗，請使用下方 otpauth URI 手動添加',
            recCopyAll: '複製全部', recUseTip: '可在登錄頁代替動態驗證碼使用',
            cancel: '取消', back: '返回',
            disableConfirm: '確認禁用 OTP？禁用後登錄不再校驗驗證碼（密鑰將被刪除）。'
        },
        wyw: {
            status: '今狀', ok: '已啟', not: '未啟', user: '帳',
            enable: '啟 OTP', disable: '罷 OTP', gen: '生密鑰', confirm: '確認啟用',
            username: '管理之帳', password: '管理之密', code: '動態驗證碼', testCode: '試驗證碼',
            secTip: '已啟時須並供今驗證碼或恢復碼，防人篡之',
            step2: '將密鑰入驗證器 App（Google Authenticator / Microsoft Authenticator / 1Password 等）：',
            scan: '一、掃碼（或手入下鑰）', manual: '二、手加：',
            secret: '鑰', uri: 'otpauth URI', copy: '複', copied: '已複', copyFail: '複之未成',
            recTitle: '一次恢復碼（即存，闔後不復顯）', recWarn: '每恢復碼僅用一次，請善藏之',
            confirmTip: '三、入今動態驗證碼於驗證器 App，確認啟用：',
            confirmBtn: '確認並啟用', setupAgain: '復生密鑰',
            done: '啟成！請以驗證器 App 之碼登錄。',
            disableTip: '入密與今驗證碼（或恢復碼）後闔之：',
            disableBtn: '罷 OTP', disabled: 'OTP 已罷',
            loading: '載中…', unknown: '未曉', err: '為之未成', empty: '',
            fillUserPwd: '請入帳與密', fillAll: '請填全',
            codeOk: '碼有效', codeBad: '碼誤或已過', tooFreq: '試之過頻',
            qrFailed: '碼載未成，請以下方 otpauth URI 手加',
            recCopyAll: '盡複', recUseTip: '可於登錄頁代動態驗證碼',
            cancel: '罷', back: '返',
            disableConfirm: '果欲罷 OTP 乎？罷後登錄不復驗碼（鑰將刪）。'
        },
        ja: {
            status: '状態', ok: '有効', not: '未有効', user: 'アカウント',
            enable: 'OTP を有効化', disable: 'OTP を無効化', gen: 'シークレットを生成', confirm: '確認して有効化',
            username: '管理者ユーザー名', password: '管理者パスワード', code: '認証コード', testCode: 'テストコード',
            secTip: '有効時は現在のコードまたはリカバリーコードも必要です（改ざん防止）',
            step2: 'シークレットを認証アプリに追加（Google Authenticator / Microsoft Authenticator / 1Password など）：',
            scan: '1. QRコードをスキャン（または下のシークレットを入力）', manual: '2. 手動で追加：',
            secret: 'シークレット', uri: 'otpauth URI', copy: 'コピー', copied: 'コピーしました', copyFail: 'コピー失敗',
            recTitle: '一回限りのリカバリーコード（今すぐ保存、閉じると再表示されません）', recWarn: '各コードは一度だけ使用できます。大切に保管してください',
            confirmTip: '3. 認証アプリの現在のコードを入力して有効化：',
            confirmBtn: '確認して有効化', setupAgain: 'シークレットを再生成',
            done: '有効化しました！認証アプリのコードでログインしてください。',
            disableTip: 'パスワードと現在のコード（またはリカバリーコード）を入力して無効化：',
            disableBtn: 'OTP を無効化', disabled: 'OTP を無効化しました',
            loading: '読み込み中...', unknown: '不明', err: '操作に失敗', empty: '',
            fillUserPwd: 'ユーザー名とパスワードを入力してください', fillAll: 'すべて入力してください',
            codeOk: 'コードは有効です', codeBad: 'コードが正しくないか期限切れです', tooFreq: '試行が多すぎます',
            qrFailed: 'QRコードの読み込みに失敗、下の otpauth URI で手動追加してください',
            recCopyAll: 'すべてコピー', recUseTip: 'ログインページでコードの代わりに使用できます',
            cancel: 'キャンセル', back: '戻る',
            disableConfirm: 'OTP を無効化しますか？無効化するとログイン時にコードが不要になります（シークレットは削除されます）。'
        },
        fr: {
            status: 'État', ok: 'Activé', not: 'Non activé', user: 'Compte',
            enable: 'Activer OTP', disable: 'Désactiver OTP', gen: 'Générer la clé', confirm: 'Confirmer et activer',
            username: 'Nom d\'utilisateur admin', password: 'Mot de passe admin', code: 'Code authentificateur', testCode: 'Tester le code',
            secTip: 'Quand il est activé, le code actuel ou un code de récupération est aussi requis (anti-tampering)',
            step2: 'Ajoutez la clé à votre application d\'authentification (Google Authenticator / Microsoft Authenticator / 1Password...) :',
            scan: '1. Scannez le QR code (ou saisissez la clé ci-dessous)', manual: '2. Ajout manuel :',
            secret: 'Clé', uri: 'otpauth URI', copy: 'Copier', copied: 'Copié', copyFail: 'Échec de la copie',
            recTitle: 'Codes de récupération à usage unique (enregistrez-les maintenant, affichés une seule fois)', recWarn: 'Chaque code ne fonctionne qu\'une fois — conservez-les précieusement',
            confirmTip: '3. Saisissez le code actuel de votre application d\'authentification pour activer :',
            confirmBtn: 'Confirmer et activer', setupAgain: 'Régénérer la clé',
            done: 'Activé ! Connectez-vous avec un code de votre application d\'authentification.',
            disableTip: 'Saisissez le mot de passe et le code actuel (ou un code de récupération) pour désactiver :',
            disableBtn: 'Désactiver OTP', disabled: 'OTP désactivé',
            loading: 'Chargement...', unknown: 'Inconnu', err: 'Échec de l\'opération', empty: '',
            fillUserPwd: 'Saisissez le nom d\'utilisateur et le mot de passe', fillAll: 'Remplissez tous les champs',
            codeOk: 'Code valide', codeBad: 'Code invalide ou expiré', tooFreq: 'Trop de tentatives',
            qrFailed: 'Échec du chargement du QR, ajoutez manuellement via l\'URI otpauth ci-dessous',
            recCopyAll: 'Tout copier', recUseTip: 'Peut être utilisé à la place du code sur la page de connexion',
            cancel: 'Annuler', back: 'Retour',
            disableConfirm: 'Désactiver OTP ? La connexion ne demandera plus de code (la clé sera supprimée).'
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
