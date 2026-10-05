/* PoW 工作量证明（防爬虫质询页 + 验证接口）
 * 由 tools/refactor-gen.js 从单文件 server.js 机械拆分生成（语句逐条保留原语义）。 */
const crypto = require('crypto');

module.exports = {
    define(ctx) {
        const { readConfig } = ctx;

    /* ── 原 server.js L243-243 ── */
    // ==================== PoW 工作量证明（Anubis 同款防爬虫） ====================

    /* ── 原 server.js L244-244 ── */
    const POW_SECRET = crypto.randomBytes(32).toString('hex');

    /* ── 原 server.js L245-245 ── */
    const POW_COOKIE = 'dp_pow';

    /* ── 原 server.js L247-255 ── */
    function parseCookies(cookieHeader) {
        const cookies = {};
        if (!cookieHeader) return cookies;
        cookieHeader.split(';').forEach(c => {
            const idx = c.indexOf('=');
            if (idx > -1) cookies[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
        });
        return cookies;
    }

    /* ── 原 server.js L257-260 ── */
    function signPayload(payload) {
        const hmac = crypto.createHmac('sha256', POW_SECRET).update(payload).digest('hex');
        return payload + '.' + hmac;
    }

    /* ── 原 server.js L262-270 ── */
    function verifyPayload(signed) {
        const idx = signed.lastIndexOf('.');
        if (idx === -1) return null;
        const payload = signed.slice(0, idx);
        const sig = signed.slice(idx + 1);
        const expected = crypto.createHmac('sha256', POW_SECRET).update(payload).digest('hex');
        if (sig !== expected) return null;
        return payload;
    }

    /* ── 原 server.js L272-332 ── */
    function powMiddleware(req, res, next) {
        const config = readConfig();
        if (!config.pow || !config.pow.enabled) return next();
        if (req.ipWhitelisted) return next();
        const adminPath = (config.security && config.security.adminPath) || '/admin';
        if (req.path.startsWith('/api/') || req.path.startsWith('/admin') || req.path.startsWith(adminPath)) return next();

        const cookies = parseCookies(req.headers.cookie || '');
        const signed = cookies[POW_COOKIE];
        if (signed) {
            const payload = verifyPayload(signed);
            if (payload) {
                try {
                    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
                    if (Date.now() - data.t < 3600000) return next();
                } catch (e) {}
            }
        }

        const challenge = crypto.randomBytes(16).toString('hex');
        const difficulty = config.pow.difficulty || 4;
        const en = /^en/i.test(req.headers['accept-language'] || '');
        const t1 = en ? 'Verifying connection security...' : '正在验证连接安全...';
        const t2 = en ? 'Proof-of-work in progress' : '正在进行工作量证明计算';
        const t3 = en ? 'Verifying, entering...' : '验证完成，正在进入...';
        const t4 = en ? 'Computing... (' : '计算中... (';
        const t5 = en ? 'Verification complete, entering...' : '验证完成，正在进入...';
        const t6 = en ? 'Connection Verification' : '连接验证';
        res.type('html').send(`<!DOCTYPE html><html lang="${en ? 'en' : 'zh'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t6}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#07070d;color:#e4e4ed;display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,sans-serif}.card{text-align:center;padding:32px 40px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:#14141f;max-width:420px}h2{margin-bottom:8px;font-size:20px}#status{color:#9099a3;font-size:13px;margin-top:12px}.bar{margin-top:16px;height:3px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden}.bar-inner{height:100%;width:0;background:linear-gradient(90deg,#00a1d6,#00c3f0);border-radius:3px;transition:width .3s}</style></head><body><div class="card"><h2>${t1}</h2><p id="status" style="font-size:13px;color:#9099a3">${t2}</p><div class="bar"><div class="bar-inner" id="bar"></div></div></div><script>
    const challenge='${challenge}', difficulty=${difficulty}, target='0'.repeat(difficulty);
    let found=false,nonce=0;
    function solve(){
        const start=performance.now(),enc=new TextEncoder(),data=enc.encode(challenge);
        const nonceBuf=new ArrayBuffer(8),dv=new DataView(nonceBuf);
        let best=0;
        async function step(){
            for(let i=0;i<20000&&!found;i++,nonce++){
                dv.setBigUint64(0,BigInt(nonce),true);
                const combined=new Uint8Array(data.length+8);
                combined.set(data);combined.set(new Uint8Array(nonceBuf),data.length);
                const hash=await crypto.subtle.digest('SHA-256',combined);
                const bytes=new Uint8Array(hash);
                let zeros=0;
                for(let j=0;j<bytes.length;j++){
                    if(bytes[j]===0)zeros+=2;
                    else{if(bytes[j]<16)zeros+=1;break}
                }
                if(zeros>=difficulty){found=true;
                    document.getElementById('status').innerHTML='${t3}';
                    fetch('/api/pow/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce,challenge})}).then(r=>r.json()).then(d=>{if(d.ok)location.reload()});
                    return;
                }
                if(zeros>best){best=zeros;document.getElementById('bar').style.width=Math.min(90,Math.round(zeros/difficulty*100))+'%'}
            }
            if(!found){document.getElementById('status').innerHTML='${t4}'+nonce+'${en ? ')' : '次)'}';requestAnimationFrame(step)}
        }
        requestAnimationFrame(step);
    }
    solve();
    </script></body></html>`);
    }

        Object.assign(ctx, { POW_SECRET, POW_SECRET, POW_COOKIE, POW_COOKIE, parseCookies, parseCookies, signPayload, signPayload, verifyPayload, verifyPayload, powMiddleware, powMiddleware });
    },

    mount(ctx) {
        const { app, readConfig, signPayload, POW_COOKIE } = ctx;

    /* ── 原 server.js L334-346 ── */
    app.post('/api/pow/verify', (req, res) => {
        const config = readConfig();
        const { nonce, challenge } = req.body;
        if ((nonce !== 0 && !nonce) || !challenge) return res.json({ ok: false });
        const combined = Buffer.concat([Buffer.from(challenge, 'utf8'), Buffer.from(new BigUint64Array([BigInt(nonce)]).buffer)]);
        const hash = crypto.createHash('sha256').update(combined).digest('hex');
        const target = '0'.repeat(config.pow.difficulty || 4);
        if (!hash.startsWith(target)) return res.json({ ok: false });
        const payload = Buffer.from(JSON.stringify({ t: Date.now() })).toString('base64');
        const signed = signPayload(payload);
        res.setHeader('Set-Cookie', POW_COOKIE + '=' + signed + '; Path=/; Max-Age=3600; SameSite=Lax; HttpOnly');
        res.json({ ok: true });
    });
    },
};
