/* 行为兼容对照探针：对 旧/新 两个实例发同样的请求，逐项对比状态码与响应体 */
'use strict';
const [origBase, newBase] = process.argv.slice(2);
const probes = [
  { name: 'GET /player/', m: 'GET', p: '/player/' },
  { name: 'GET /admin/', m: 'GET', p: '/admin/' },
  { name: 'GET /api/danmu/v3 (DPlayer)', m: 'GET', p: '/api/danmu/v3/?id=test123' },
  { name: 'GET /api/danmu/v3 maxLimit', m: 'GET', p: '/api/danmu/v3/?id=test123&maxLimit=5' },
  { name: 'GET /api/video/resolve 空url', m: 'GET', p: '/api/video/resolve' },
  { name: 'GET /api/video/resolve 坏url', m: 'GET', p: '/api/video/resolve?url=http%3A%2F%2Fno.such.host.invalid%2Fv.mp4' },
  { name: 'POST /api/video/resolve (方法不匹配)', m: 'POST', p: '/api/video/resolve', b: '{}' },
  { name: 'POST /api/admin/login 空体', m: 'POST', p: '/api/admin/login', b: '{}' },
  { name: 'POST /api/admin/login 错密码', m: 'POST', p: '/api/admin/login', b: JSON.stringify({ username: 'admin', password: 'wrong-pass' }) },
  { name: 'POST /api/admin/login 正确', m: 'POST', p: '/api/admin/login', b: JSON.stringify({ username: 'admin', password: 'admin123' }), norm: (s, t) => { try { const j = JSON.parse(t); return s + ' code=' + j.code + ' tokenLen=' + ((j.data && j.data.token) || '').length; } catch (e) { return s + ' ' + String(t).slice(0, 80); } } },
  { name: 'POST 弹幕 v3', m: 'POST', p: '/api/danmu/v3/', b: JSON.stringify({ id: 'test123', text: 'hello-smoke', time: 1.5, color: '#ffffff', type: 'right' }) },
  { name: 'GET /api/danmu/v3 再查', m: 'GET', p: '/api/danmu/v3/?id=test123' },
  { name: 'OPTIONS /api/danmu/v3 (CORS)', m: 'OPTIONS', p: '/api/danmu/v3/?id=test123', hdr: true },
  { name: 'GET /不存在路径 (404兜底)', m: 'GET', p: '/api/no/such/route' },
  { name: 'GET /healthz (新增端点)', m: 'GET', p: '/healthz' },
];
function trunc(t) { t = String(t).replace(/\r?\n/g, ' '); return t.length > 150 ? t.slice(0, 150) : t; }
async function hit(base, pr) {
  try {
    const opt = { method: pr.m, headers: {} };
    if (pr.b) { opt.headers['content-type'] = 'application/json'; opt.body = pr.b; }
    const r = await fetch(base + pr.p, opt);
    let t = await r.text();
    let extra = '';
    if (pr.hdr) { extra = ' ACAO=' + (r.headers.get('access-control-allow-origin') || '-') + ' ACAM=' + (r.headers.get('access-control-allow-methods') || '-'); }
    if (pr.norm) return pr.norm(r.status, t) + extra;
    return r.status + ' ' + trunc(t) + extra;
  } catch (e) { return 'FETCH-FAIL ' + e.message; }
}
(async () => {
  let diffs = 0;
  for (const pr of probes) {
    const a = await hit(origBase, pr);
    const b = await hit(newBase, pr);
    const same = a === b;
    if (!same) diffs++;
    console.log((same ? 'SAME ' : 'DIFF ') + pr.name);
    console.log('  旧: ' + a);
    if (!same) console.log('  新: ' + b);
  }
  console.log('== 差异数: ' + diffs + ' / ' + probes.length + '（/healthz 为预期新增差异） ==');
})();
