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
