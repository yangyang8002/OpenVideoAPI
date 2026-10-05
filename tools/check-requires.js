const fs = require('fs'); const path = require('path');
const R = 'E:/github/OpenVideoAPI/OpenVideoAPI';
let bad = 0; let n = 0;
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.js')) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
        const p = m[2];
        if (!p.startsWith('.')) continue;
        n++;
        const base = path.resolve(path.dirname(f), p);
        const ok = fs.existsSync(base + '.js') || fs.existsSync(base + '.json') || fs.existsSync(path.join(base, 'index.js'));
        if (!ok) { bad++; console.log('UNRESOLVED ' + path.relative(R, f) + ': ' + p); }
      }
    }
  }
})(path.join(R, 'src'));
console.log('relative requires checked: ' + n + ', unresolved: ' + bad);
