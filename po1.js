
var VEXT = ['mp4','mkv','webm','avi','mov','flv','ts','m3u8','wmv','mpg','mpeg'];
var CWD = '/';
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fmtSize(n) { if (!n) return ''; var u = ['B','KB','MB','GB','TB'], i = 0; while (n >= 1024 && i < 4) { n = n / 1024; i++; } return (i ? n.toFixed(1) : n) + ' ' + u[i]; }
function toast(s, bad) { var st = document.getElementById('stat'); st.textContent = s; st.className = 'msg ' + (bad ? 'err' : 'ok'); }
function copyText(s, done) {
  function legacy() { var i = document.createElement('textarea'); i.value = s; document.body.appendChild(i); i.select(); try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(i); }
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(done, legacy); else legacy();
}
function extOf(n) { var i = String(n).lastIndexOf('.'); return i > 0 ? String(n).slice(i + 1).toLowerCase() : ''; }
function loadStatus() {
  fetch('/api/plugin/openlist/status').then(function (r) { return r.json(); }).then(function (d) {
    if (d.code !== 0 || !(d.data && d.data.configured)) {
      toast('未配置：请在后台 插件 → openlist 设置中填写 baseUrl' + (d.data && d.data.base ? '' : ''), true);
      return;
    }
    listPath('/');
  }).catch(function () { toast('加载失败', true); });
}
function listPath(p) {
  CWD = p || '/';
  toast('加载中...');
  fetch('/api/plugin/openlist/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: CWD }) })
    .then(function (r) { return r.json(); }).then(function (d) {
      if (d.code !== 0) { toast(d.msg || '读取失败', true); return; }
      var parts = CWD.split('/').filter(Boolean);
      var cr = '<a data-p="/">/</a>';
      var acc = '';
      for (var i = 0; i < parts.length; i++) { acc += '/' + parts[i]; cr += ' <a data-p="' + esc(acc) + '">' + esc(parts[i]) + '</a> /'; }
      document.getElementById('crumbs').innerHTML = cr;
      var rows = [];
      d.data.dirs.forEach(function (x) { rows.push('<tr><td class="name dir" data-d="' + esc(x.name) + '">📁 ' + esc(x.name) + '</td><td>—</td><td></td></tr>'); });
      d.data.files.forEach(function (x) {
        var e = extOf(x.name), v = VEXT.indexOf(e) >= 0;
        rows.push('<tr><td class="name">' + (v ? '🎬 ' : '📄 ') + esc(x.name) + (e ? ' <span class="vext">' + esc(e) + '</span>' : '') + '</td><td>' + fmtSize(x.size) + '</td>' +
          '<td>' + (v ? '<button data-l="' + esc(x.name) + '" data-act="play">播放链接</button><button data-l="' + esc(x.name) + '" data-act="reg">注册到库</button>' : '') + '</td></tr>');
      });
      document.getElementById('tbl').innerHTML = '<table><tr><th>名称</th><th>大小</th><th>操作</th></tr>' + rows.join('') + '</table>';
      toast('共 ' + d.data.dirs.length + ' 个目录 · ' + d.data.files.length + ' 个文件');
    }).catch(function () { toast('读取失败', true); });
}
function withLink(name, fn) {
  toast('获取链接中...');
  var p = (CWD === '/' ? '' : CWD) + '/' + name;
  fetch('/api/plugin/openlist/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: p }) })
    .then(function (r) { return r.json(); }).then(function (d) {
      if (d.code !== 0) { toast(d.msg || '获取链接失败', true); return null; }
      fn(d.data.link);
      return d.data.link;
    }).catch(function () { toast('获取链接失败', true); });
}
document.getElementById('crumbs').addEventListener('click', function (e) {
  var a = e.target.closest('a'); if (!a) return; listPath(a.getAttribute('data-p'));
});
document.getElementById('tbl').addEventListener('click', function (e) {
  var b = e.target.closest('button');
  var d = e.target.closest('td.name');
  if (d && d.getAttribute('data-d')) { listPath((CWD === '/' ? '' : CWD) + '/' + d.getAttribute('data-d')); return; }
  if (!b) return;
  var name = b.getAttribute('data-l'), act = b.getAttribute('data-act');
  if (act === 'play') {
    withLink(name, function (link) {
      var full = location.origin + '/player/?url=' + encodeURIComponent(link);
      copyText(full, function () { toast('已复制播放链接，可直接分享/打开'); });
    });
  } else if (act === 'reg') {
    withLink(name, function (link) {
      fetch('/api/video/resolve?url=' + encodeURIComponent(link)).then(function (r) { return r.json(); }).then(function (d2) {
        if (d2.code === 0 && d2.data && d2.data.vid) toast('已注册 vid=' + d2.data.vid + '（若含内封字幕将自动提取，稍后弹窗提醒）');
        else toast(d2.msg || '注册失败', true);
      }).catch(function () { toast('注册失败', true); });
    });
  }
});
loadStatus();
