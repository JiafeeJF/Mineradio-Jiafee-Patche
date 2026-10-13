'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const base = 'e:/Mineradio-main/Mineradio-main 2.1.0';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coplay2-test-'));
const appDir = path.join(tmp, 'resources', 'app');
fs.mkdirSync(path.join(appDir, 'public'), { recursive: true });
fs.copyFileSync(path.join(base, 'server.js'), path.join(appDir, 'server.js'));
fs.copyFileSync(path.join(base, 'public', 'index.html'), path.join(appDir, 'public', 'index.html'));

const manifest = JSON.parse(fs.readFileSync('e:/Mineradio-main/Jiafee-FX-Patcher/patch-manifest-coplay.json', 'utf8'));
const { applyInsert, removeInsert } = require('e:/Mineradio-main/Jiafee-FX-Patcher/desktop/patch-inserts.js');
const backupRoot = path.join(appDir, '.backup');

// ---- anchor preflight ----
for (const ins of manifest.payloadInserts) {
  const t = fs.readFileSync(path.join(appDir, ins.file), 'utf8');
  const count = t.split(ins.anchor).length - 1;
  console.log('anchor [' + ins.anchor + '] in ' + ins.file + ': ' + count + ' occurrence(s)');
}

// ---- install round 1 ----
let results = manifest.payloadInserts.map(i => applyInsert(appDir, i, manifest, backupRoot, false));
console.log('install r1:', JSON.stringify(results.map(r => ({ f: r.rel, inserted: !!r.inserted, skipped: !!r.skipped, reason: r.reason }))));

// ---- install round 2 (idempotency) ----
results = manifest.payloadInserts.map(i => applyInsert(appDir, i, manifest, backupRoot, true));
console.log('install r2:', JSON.stringify(results.map(r => ({ f: r.rel, already: !!r.already, inserted: !!r.inserted }))));
const serverT = fs.readFileSync(path.join(appDir, 'server.js'), 'utf8');
const htmlT = fs.readFileSync(path.join(appDir, 'public', 'index.html'), 'utf8');
console.log('marker count server.js:', (serverT.match(/Jiafee jiafee-coplay2 begin/g) || []).length);
console.log('marker count index.html:', (htmlT.match(/Jiafee jiafee-coplay2 begin/g) || []).length);

// ---- validate patched files ----
console.log('html still ends with </html>:', htmlT.trimEnd().endsWith('</html>'));
const lines = htmlT.split('\n');
const bodyIdx = lines.findIndex(l => l.includes('</body>'));
console.log('inserted tags before </body>:', JSON.stringify(lines.slice(Math.max(0, bodyIdx - 4), bodyIdx)));
console.log('patched server.js requires coplay-signaling-server:', serverT.indexOf("require('./coplay-signaling-server')") !== -1);

// ---- restore ----
results = manifest.payloadInserts.map(i => removeInsert(appDir, i, manifest));
console.log('restore:', JSON.stringify(results.map(r => ({ f: r.rel, removed: !!r.removed, skipped: !!r.skipped, reason: r.reason }))));
const afterSrv = fs.readFileSync(path.join(appDir, 'server.js'), 'utf8');
const afterHtml = fs.readFileSync(path.join(appDir, 'public', 'index.html'), 'utf8');
const origSrv = fs.readFileSync(path.join(base, 'server.js'), 'utf8');
const origHtml = fs.readFileSync(path.join(base, 'public', 'index.html'), 'utf8');
console.log('server.js byte-identical restore:', afterSrv === origSrv);
console.log('index.html byte-identical restore:', afterHtml === origHtml);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('TEMP CLEANED');
