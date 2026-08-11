'use strict';
/* ==========================================================================
 * 出站 HTTP 代理支持（可选）
 *
 * 设置环境变量 HTTPS_PROXY / HTTP_PROXY 后，服务端所有 fetch 请求
 * （插件市场 / 更新检查 / ip2region 地址库下载 / 字幕本地化 / 云端同步等）
 * 统一走代理 —— 适用于国内网络环境（Clash / v2ray 等本地代理）。
 *
 * 用法：
 *   HTTPS_PROXY=http://127.0.0.1:7890 node server.js
 *
 * 实现：CONNECT 隧道 + http(s) 转发，纯 Node 内置模块，无第三方依赖。
 * ========================================================================== */
const http = require('http');
const https = require('https');
const tls = require('tls');
const { Readable } = require('stream');

function parseProxy(urlStr) {
    const u = new URL(urlStr);
    return { host: u.hostname, port: parseInt(u.port) || 80 };
}

function buildProxiedFetch(proxyUrl) {
    const p = parseProxy(proxyUrl);
    const agent = null;

    return function proxiedFetch(urlStr, opts) {
        opts = opts || {};
        const url = new URL(urlStr);
        const isHttps = url.protocol === 'https:';
        const targetPort = url.port || (isHttps ? 443 : 80);
        const mod = isHttps ? https : http;

        return new Promise((resolve, reject) => {
            const connectReq = http.request({
                host: p.host,
                port: p.port,
                method: 'CONNECT',
                path: url.hostname + ':' + targetPort,
                setHost: false
            });
            let settled = false;
            const fail = (e) => { if (!settled) { settled = true; reject(e); } };

            connectReq.on('connect', (res, socket) => {
                if (res.statusCode !== 200) {
                    socket.destroy();
                    fail(new Error('代理 CONNECT 失败: HTTP ' + res.statusCode));
                    return;
                }
                const doRequest = (tlsSock) => {
                    const req = mod.request({
                        createConnection: () => tlsSock,
                        host: url.hostname,
                        port: targetPort,
                        path: url.pathname + url.search,
                        method: opts.method || 'GET',
                        headers: opts.headers || {}
                    });
                    const signal = opts.signal;
                    if (signal) {
                        const onAbort = () => req.destroy(new Error('aborted'));
                        if (signal.aborted) onAbort();
                        else signal.addEventListener('abort', onAbort, { once: true });
                    }
                    req.on('response', (r) => {
                        resolve({
                            ok: r.statusCode >= 200 && r.statusCode < 300,
                            status: r.statusCode,
                            headers: r.headers,
                            body: Readable.toWeb(r),
                            async json() { return JSON.parse(await readAll(r)); },
                            async text() { return await readAll(r); },
                            async arrayBuffer() { return Buffer.from(await readAll(r), 'utf8').buffer; }
                        });
                    });
                    req.on('error', fail);
                    const body = opts.body;
                    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
                    req.end();
                };
                if (!isHttps) doRequest(socket);
                else {
                    const tlsSock = tls.connect({ socket, servername: url.hostname });
                    tlsSock.on('secureConnect', () => doRequest(tlsSock));
                    tlsSock.on('error', fail);
                }
            });
            connectReq.on('error', fail);
            connectReq.end();
        });
    };
}

function readAll(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stream.on('error', reject);
    });
}

/* 读取代理地址（优先级：HTTPS_PROXY > https_proxy > HTTP_PROXY > http_proxy） */
function detectProxy() {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
        const v = process.env[name];
        if (v && /^https?:\/\//i.test(v)) return v;
    }
    return '';
}

/* 若配置了代理环境变量，则替换全局 fetch；否则保持原生行为 */
function enableProxyFetch() {
    const proxy = detectProxy();
    if (!proxy || global.__openvideoProxyPatched) return false;
    global.__openvideoProxyPatched = true;
    const proxied = buildProxiedFetch(proxy);
    global.fetch = (url, opts) => proxied(url, opts);
    return true;
}

module.exports = { enableProxyFetch, buildProxiedFetch, detectProxy };
