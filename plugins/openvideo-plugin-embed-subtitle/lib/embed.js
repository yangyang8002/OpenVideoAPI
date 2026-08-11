/* OpenVideoAPI 插件 —— 内封字幕采集：后台「内封字幕」tab
 * 流程：输入视频文件路径 → 检测（ffprobe 列出内封字幕轨）→ 勾选轨道 → 提取到字幕库（可关联视频）
 */
(function () {
    'use strict';
    var D = {
        zh: {
            title: '内封字幕采集', tip: '输入服务器本地视频文件路径（相对项目根，如 public/videos/demo.mkv，或绝对路径），检测其内嵌字幕轨道并用 ffmpeg 提取到字幕库。',
            file: '视频文件路径', detect: '检测内封字幕', detecting: '检测中...', none: '未检测到文本字幕轨道',
            image: '图形字幕', text: '文本', lang: '语言', codec: '编码', def: '默认', forced: '强制',
            extractSel: '提取所选轨道到字幕库', extracting: '提取中...', done: '已提取 N 条字幕并加入字幕库',
            vid: '关联视频码（可选）', needFile: '请输入视频文件路径', needTrack: '请勾选至少一条文本字幕轨道',
            notFound: 'ffprobe 执行失败：请确认服务器已安装 ffmpeg，或在插件配置中指定 ffprobePath / ffmpegPath',
            empty: '暂无'
        },
        en: {
            title: 'Embedded Subtitles', tip: 'Enter a local video file path on the server (relative to the project root, e.g. public/videos/demo.mkv, or absolute), detect its embedded subtitle tracks and extract them into the subtitle library with ffmpeg.',
            file: 'Video file path', detect: 'Detect embedded subtitles', detecting: 'Detecting...', none: 'No text subtitle tracks found',
            image: 'image', text: 'text', lang: 'Lang', codec: 'Codec', def: 'default', forced: 'forced',
            extractSel: 'Extract selected tracks to library', extracting: 'Extracting...', done: 'N subtitles extracted and added to the library',
            vid: 'Video ID to link (optional)', needFile: 'Enter the video file path', needTrack: 'Select at least one text subtitle track',
            notFound: 'ffprobe failed: make sure ffmpeg is installed on the server, or set ffprobePath / ffmpegPath in the plugin config',
            empty: 'none'
        }
    };
    function T(k) {
        var lang = (window.I18N && I18N.lang) || 'zh';
        var d = D[lang] || D.en;
        return d[k] || k;
    }
    function esc2(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    OpenVideoAdmin.registerTab({
        id: 'embed-subtitle',
        title: '内封字幕',
        mount: function (el) {
            el.innerHTML = `
                <div class="card">
                    <h3><span class="dot" style="background:var(--primary);box-shadow:0 0 6px var(--primary)"></span>${esc2(T('title'))}</h3>
                    <div class="cfg-hint" style="margin-bottom:10px">${esc2(T('tip'))}</div>
                    <div class="cfg-row"><span>${esc2(T('file'))}</span>
                        <input type="text" id="esFile" placeholder="public/videos/demo.mkv" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text);font-size:12px;outline:none">
                    </div>
                    <div class="cfg-row"><span>${esc2(T('vid'))}</span>
                        <input type="text" id="esVid" placeholder="" style="flex:1;padding:7px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface2);color:var(--text);font-size:12px;outline:none">
                    </div>
                    <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        <button class="btn btn-sm btn-primary" id="esDetectBtn">${esc2(T('detect'))}</button>
                        <button class="btn btn-sm" id="esExtractBtn" style="display:none">${esc2(T('extractSel'))}</button>
                        <span id="esMsg" style="font-size:12px;color:var(--text3)"></span>
                    </div>
                    <div id="esTracks" style="margin-top:14px;display:flex;flex-direction:column;gap:8px"></div>
                </div>`;
            var msgEl = document.getElementById('esMsg');
            var tracksEl = document.getElementById('esTracks');
            var extractBtn = document.getElementById('esExtractBtn');
            var state = { streams: [], file: '' };

            function setMsg(m, ok) { msgEl.textContent = m; msgEl.style.color = ok ? 'var(--success)' : 'var(--danger)'; }

            document.getElementById('esDetectBtn').addEventListener('click', function () {
                var file = document.getElementById('esFile').value.trim();
                if (!file) return setMsg(T('needFile'), false);
                setMsg(T('detecting'), true);
                document.getElementById('esDetectBtn').disabled = true;
                OpenVideoAdmin.api('/api/plugin/embed-sub/detect', { method: 'POST', body: JSON.stringify({ file: file }) })
                    .then(function (d) {
                        document.getElementById('esDetectBtn').disabled = false;
                        if (d.code !== 0) { setMsg(d.msg || T('notFound'), false); return; }
                        state.file = file;
                        state.streams = d.data.streams || [];
                        renderTracks();
                        setMsg(state.streams.length ? '' : T('none'), false);
                    })
                    .catch(function () { document.getElementById('esDetectBtn').disabled = false; setMsg(T('notFound'), false); });
            });

            extractBtn.addEventListener('click', function () {
                var checked = Array.from(document.querySelectorAll('#esTracks .es-cb:checked')).map(function (c) { return parseInt(c.value); });
                if (!checked.length) return setMsg(T('needTrack'), false);
                setMsg(T('extracting'), true);
                extractBtn.disabled = true;
                OpenVideoAdmin.api('/api/plugin/embed-sub/extract-all', { method: 'POST', body: JSON.stringify({ file: state.file, indexes: checked, vid: document.getElementById('esVid').value.trim() || '' }) })
                    .then(function (d) {
                        extractBtn.disabled = false;
                        if (d.code !== 0) { setMsg(d.msg, false); return; }
                        var items = (d.data && d.data.items) || [];
                        var linked = items[0] && items[0].vid ? '（已关联视频码 ' + items[0].vid + '）' : '';
                        setMsg(T('done').replace('N', items.length) + linked, true);
                    })
                    .catch(function () { extractBtn.disabled = false; setMsg(T('notFound'), false); });
            });

            function renderTracks() {
                var list = state.streams;
                tracksEl.innerHTML = list.length ? list.map(function (s) {
                    var langName = s.language ? s.language.toUpperCase() : '—';
                    var badges = [];
                    if (s.image) badges.push('<span class="pl-chip" style="color:var(--warn)">' + esc2(T('image')) + '</span>');
                    else badges.push('<span class="pl-chip" style="color:var(--success)">' + esc2(T('text')) + '</span>');
                    if (s.default) badges.push('<span class="pl-chip">' + esc2(T('def')) + '</span>');
                    if (s.forced) badges.push('<span class="pl-chip" style="color:var(--accent)">' + esc2(T('forced')) + '</span>');
                    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.02);font-size:12.5px;flex-wrap:wrap">
                        <input type="checkbox" class="es-cb" value="${s.index}" ${s.image ? 'disabled' : ''} style="accent-color:var(--primary)">
                        <span style="color:var(--text3);font-family:monospace">#${s.index}</span>
                        <b style="color:var(--text)">${langName}</b>
                        <span style="color:var(--text3)">${esc2(s.title || '')}</span>
                        <span style="color:var(--text3);font-size:11px">${esc2(s.codec || '')}</span>
                        ${badges.join('')}
                        ${s.image ? '<span style="color:var(--warn);font-size:11px">—</span>' : ''}
                    </div>`;
                }).join('') : '<div class="empty-state">' + esc2(T('empty')) + '</div>';
                extractBtn.style.display = list.length ? '' : 'none';
            }
        }
    });
})();
