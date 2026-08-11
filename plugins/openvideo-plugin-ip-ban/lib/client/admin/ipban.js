/* OpenVideoAPI 插件 —— 自动封禁 IP：后台「IP 封禁」tab
 * 状态 / 阈值展示、立即扫描、手动封禁 / 解封、一键解封插件产生的封禁
 */
(function () {
    'use strict';
    var D = {
        zh: {
            tip: '按请求数 / 流量超限自动封禁 IP（阈值在插件配置中可调），安全中心白名单 IP 除外，支持按地区（国家）屏蔽。封禁写入安全中心并即时生效。',
            status: '扫描状态', scanning: '扫描中...', last: '上次扫描', checked: '检查 IP', banned: '本次封禁', total: '累计封禁', active: '当前插件封禁',
            thresholds: '当前阈值', reqMin: '请求/分', reqHour: '请求/时', mbMin: 'MB/分', mbHour: 'MB/时', banMin: '封禁时长', region: '地区屏蔽', bypass: '白名单除外',
            scanNow: '立即扫描', manualBan: '手动封禁 IP', unban: '解封', unbanAll: '解封全部（本插件）', recent: '最近封禁记录',
            ipPh: '如 1.2.3.4', empty: '暂无记录', reason: '原因', time: '时间', minute: '分钟', permanent: '永久', on: '开启', off: '关闭'
        },
        en: {
            tip: 'Auto-ban IPs exceeding request/traffic thresholds (configurable in plugin settings); whitelisted IPs are exempt; optional region (country) blocking. Bans are written to Security and take effect immediately.',
            status: 'Scan status', scanning: 'Scanning...', last: 'Last scan', checked: 'IPs checked', banned: 'Banned this run', total: 'Total banned', active: 'Active plugin bans',
            thresholds: 'Thresholds', reqMin: 'req/min', reqHour: 'req/hour', mbMin: 'MB/min', mbHour: 'MB/hour', banMin: 'Ban duration', region: 'Region block', bypass: 'Whitelist exempt',
            scanNow: 'Scan now', manualBan: 'Manually ban IP', unban: 'Unban', unbanAll: 'Unban all (plugin)', recent: 'Recent bans',
            ipPh: 'e.g. 1.2.3.4', empty: 'No records', reason: 'Reason', time: 'Time', minute: 'min', permanent: 'permanent', on: 'on', off: 'off'
        },
        zhHant: {
            tip: '按請求數 / 流量超限自動封禁 IP（閾值在插件配置中可調），安全中心白名單 IP 除外，支持按地區（國家）屏蔽。封禁寫入安全中心並即時生效。',
            status: '掃描狀態', scanning: '掃描中...', last: '上次掃描', checked: '檢查 IP', banned: '本次封禁', total: '累計封禁', active: '當前插件封禁',
            thresholds: '當前閾值', reqMin: '請求/分', reqHour: '請求/時', mbMin: 'MB/分', mbHour: 'MB/時', banMin: '封禁時長', region: '地區屏蔽', bypass: '白名單除外',
            scanNow: '立即掃描', manualBan: '手動封禁 IP', unban: '解封', unbanAll: '解封全部（本插件）', recent: '最近封禁記錄',
            ipPh: '如 1.2.3.4', empty: '暫無記錄', reason: '原因', time: '時間', minute: '分鐘', permanent: '永久', on: '開啟', off: '關閉'
        },
        wyw: {
            tip: '按求數 / 流超限自動禁 IP（限在插件之設可調），安防白籍 IP 除外，可按域（國）屏之。禁入安防而即效。',
            status: '察狀', scanning: '察中...', last: '昨察', checked: '察 IP', banned: '此禁', total: '累禁', active: '今插件之禁',
            thresholds: '今限', reqMin: '求/分', reqHour: '求/時', mbMin: 'MB/分', mbHour: 'MB/時', banMin: '禁時', region: '域屏', bypass: '白籍免',
            scanNow: '即察', manualBan: '手禁 IP', unban: '解禁', unbanAll: '盡解（本插件）', recent: '近禁之錄',
            ipPh: '如 1.2.3.4', empty: '無錄', reason: '故', time: '時', minute: '分', permanent: '永', on: '啟', off: '閉'
        },
        ja: {
            tip: 'リクエスト数 / トラフィック超過の IP を自動 BAN（しきい値はプラグイン設定で調整可）。セキュリティのホワイトリスト IP は除外され、地域（国）によるブロックも可能。BAN はセキュリティセンターに書き込まれ即時反映。',
            status: 'スキャン状態', scanning: 'スキャン中...', last: '最終スキャン', checked: '確認IP', banned: '今回BAN', total: '累計BAN', active: '現在のプラグインBAN',
            thresholds: '現在のしきい値', reqMin: 'リクエスト/分', reqHour: 'リクエスト/時', mbMin: 'MB/分', mbHour: 'MB/時', banMin: 'BAN時間', region: '地域ブロック', bypass: 'ホワイトリスト除外',
            scanNow: '今すぐスキャン', manualBan: '手動でBAN', unban: '解除', unbanAll: 'すべて解除（本プラグイン）', recent: '最近のBAN記録',
            ipPh: '例 1.2.3.4', empty: '記録なし', reason: '理由', time: '時間', minute: '分', permanent: '永久', on: '有効', off: '無効'
        },
        fr: {
            tip: 'Bannit automatiquement les IP qui dépassent les seuils de requêtes / trafic (seuils réglables dans la configuration du plugin) ; les IP de la liste blanche de Sécurité sont exemptées ; blocage par région (pays) possible. Les bannissements sont écrits dans Sécurité et appliqués immédiatement.',
            status: 'État du scan', scanning: 'Scan...', last: 'Dernier scan', checked: 'IP vérifiées', banned: 'Bannis cette passe', total: 'Bannis au total', active: 'Bannis actifs (plugin)',
            thresholds: 'Seuils actuels', reqMin: 'req/min', reqHour: 'req/h', mbMin: 'MB/min', mbHour: 'MB/h', banMin: 'Durée de ban', region: 'Blocage régional', bypass: 'Liste blanche exempte',
            scanNow: 'Scanner maintenant', manualBan: 'Bannir manuellement', unban: 'Débannir', unbanAll: 'Tout débannir (plugin)', recent: 'Bannissements récents',
            ipPh: 'ex. 1.2.3.4', empty: 'Aucun enregistrement', reason: 'Raison', time: 'Heure', minute: 'min', permanent: 'permanent', on: 'activé', off: 'désactivé'
        }
    };
    function T(k) {
        var lang = (window.I18N && I18N.lang) || 'zh';
        var d = D[lang] || D.en;
        return d[k] || k;
    }
    function esc2(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    OpenVideoAdmin.registerTab({
        id: 'ip-ban',
        title: 'IP 封禁',
        mount: function (el) {
            el.innerHTML = `
                <div class="card">
                    <h3><span class="dot" style="background:var(--danger);box-shadow:0 0 6px var(--danger)"></span>${esc2(T('status'))}
                        <button class="btn btn-sm btn-primary" style="margin-left:10px" id="ibScanBtn">${esc2(T('scanNow'))}</button>
                        <button class="btn btn-sm" style="margin-left:6px" id="ibUnbanAllBtn" style2="border-color:var(--warn);color:var(--warn)">${esc2(T('unbanAll'))}</button>
                    </h3>
                    <div class="cfg-hint" style="margin-bottom:10px">${esc2(T('tip'))}</div>
                    <div id="ibStats" style="display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text2)">${esc2(T('scanning'))}</div>
                    <div id="ibThresholds" style="font-size:11px;color:var(--text3);margin-top:8px"></div>
                    <div style="display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap">
                        <input type="text" id="ibIpInput" placeholder="${esc2(T('ipPh'))}" style="width:160px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text);font-size:12px;outline:none">
                        <button class="btn btn-sm" style="border-color:var(--danger);color:var(--danger)" id="ibBanBtn">${esc2(T('manualBan'))}</button>
                    </div>
                    <div id="ibRecent" style="margin-top:14px;display:flex;flex-direction:column;gap:4px;font-size:12px"></div>
                </div>`;
            var statsEl = document.getElementById('ibStats');
            var thEl = document.getElementById('ibThresholds');
            var recentEl = document.getElementById('ibRecent');

            function load() {
                OpenVideoAdmin.api('/api/plugin/ip-ban/status').then(function (d) {
                    if (d.code !== 0) return;
                    var s = d.data;
                    statsEl.innerHTML =
                        '<span>' + esc2(T('last')) + ': <b style="color:var(--text)">' + (s.lastScan ? new Date(s.lastScan).toLocaleTimeString() : '—') + '</b></span>' +
                        '<span>' + esc2(T('checked')) + ': <b style="color:var(--text)">' + s.lastChecked + '</b></span>' +
                        '<span>' + esc2(T('banned')) + ': <b style="color:var(--danger)">' + s.lastBanned + '</b></span>' +
                        '<span>' + esc2(T('total')) + ': <b style="color:var(--text)">' + s.totalBanned + '</b></span>' +
                        '<span>' + esc2(T('active')) + ': <b style="color:var(--warn)">' + s.pluginBanCount + '</b></span>';
                    var c = s.config || {};
                    thEl.textContent = esc2(T('thresholds')) + ': ' +
                        esc2(T('reqMin')) + ' ' + (c.reqPerMin || '—') + ' · ' +
                        esc2(T('reqHour')) + ' ' + (c.reqPerHour || '—') + ' · ' +
                        esc2(T('mbMin')) + ' ' + (c.mbPerMin || '—') + ' · ' +
                        esc2(T('mbHour')) + ' ' + (c.mbPerHour || '—') + ' · ' +
                        esc2(T('banMin')) + ' ' + (c.banMinutes ? c.banMinutes + ' ' + esc2(T('minute')) : esc2(T('permanent'))) + ' · ' +
                        esc2(T('region')) + ' ' + (c.regionBlock ? (c.regionList || esc2(T('on'))) : esc2(T('off'))) + ' · ' +
                        esc2(T('bypass')) + ' ' + (c.whitelistBypass ? esc2(T('on')) : esc2(T('off')));
                    recentEl.innerHTML = (s.recent && s.recent.length)
                        ? s.recent.map(function (r) {
                            return '<div style="display:flex;align-items:center;gap:10px;padding:5px 8px;background:rgba(255,255,255,.03);border-radius:6px;font-size:12px">' +
                                '<code data-i18n-skip style="color:var(--danger)">' + esc2(r.ip) + '</code>' +
                                '<span style="flex:1;color:var(--text2)">' + esc2(r.reason) + '</span>' +
                                '<span style="color:var(--text3);font-size:11px">' + new Date(r.at).toLocaleString() + '</span></div>';
                        }).join('')
                        : '<div class="empty-state">' + esc2(T('empty')) + '</div>';
                });
            }

            document.getElementById('ibScanBtn').addEventListener('click', function () {
                var b = this; b.disabled = true; b.textContent = T('scanning');
                OpenVideoAdmin.api('/api/plugin/ip-ban/scan', { method: 'POST', body: '{}' })
                    .then(function (d) { toast(d.msg, d.code === 0); b.disabled = false; b.textContent = T('scanNow'); load(); });
            });
            document.getElementById('ibBanBtn').addEventListener('click', function () {
                var ip = document.getElementById('ibIpInput').value.trim();
                if (!ip) return;
                OpenVideoAdmin.api('/api/plugin/ip-ban/ban', { method: 'POST', body: JSON.stringify({ ip: ip }) })
                    .then(function (d) { toast(d.msg, d.code === 0); if (d.code === 0) { document.getElementById('ibIpInput').value = ''; load(); } });
            });
            document.getElementById('ibUnbanAllBtn').addEventListener('click', function () {
                if (!confirm('确认解封本插件产生的全部封禁？')) return;
                OpenVideoAdmin.api('/api/plugin/ip-ban/unban-all', { method: 'POST', body: '{}' })
                    .then(function (d) { toast(d.msg, d.code === 0); load(); });
            });
            load();
        }
    });
})();
