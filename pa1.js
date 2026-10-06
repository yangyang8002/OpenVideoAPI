
/* ===== MD3 启动引导(T3):首帧渲染前应用主题与明暗模式,避免闪烁 ===== */
(function () {
    var d = document.documentElement;
    try { d.dataset.theme = localStorage.getItem('ap_admin_theme') || 'md3'; }
    catch (e) { d.dataset.theme = 'md3'; }
    try { d.dataset.mode = localStorage.getItem('ap_admin_mode') || 'system'; }
    catch (e) { d.dataset.mode = 'system'; }
})();
/* MD3 图表取色:读取当前主题 CSS 变量(自动解析一层 var() 引用),失败回退原配色 */
function mdVar(name, fallback) {
    var v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) {}
    if (!v) return fallback;
    if (v.indexOf('var(') === 0) {
        var m = v.match(/var\((--[\w-]+)\)/);
        return m ? mdVar(m[1], fallback) : fallback;
    }
    if (v.indexOf('color-mix(') === 0) return fallback;
    return v;
}
function mdRgba(color, alpha) {
    var c = (color || '').trim();
    if (c.charAt(0) === '#') {
        var x = c.slice(1);
        if (x.length === 3) x = x.charAt(0) + x.charAt(0) + x.charAt(1) + x.charAt(1) + x.charAt(2) + x.charAt(2);
        x = x.slice(0, 6);
        var n = parseInt(x, 16);
        if (!isNaN(n)) return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + alpha + ')';
        return c;
    }
    var m = c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
    if (m) return 'rgba(' + m[1] + ',' + m[2] + ',' + m[3] + ',' + alpha + ')';
    return c;
}
