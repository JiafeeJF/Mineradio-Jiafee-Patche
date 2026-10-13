'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { PatchEngine } = require('./desktop/patch-engine');

const patcherRoot = __dirname;
const official = path.resolve(__dirname, '..', 'Mineradio-paused-2.2.0');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-patcher-'));
const target = path.join(temp, 'Mineradio');
fs.cpSync(official, target, { recursive:true });
const engine = new PatchEngine(patcherRoot, path.join(patcherRoot, 'payload'));
const fx = 'jiafee-fx-v2';
const together = 'jiafee-coplay2';
const read = (rel) => fs.readFileSync(path.join(target, rel), 'utf8');
const hash = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(target, rel))).digest('hex');
const originalHashes = Object.fromEntries(['desktop/main.js','desktop/preload.js','public/index.html','public/css/index.css','public/js/index-loader.js','public/js/modules/05-playback/13-playback-start-audio.js','public/js/modules/05-playback/18-cuefield-automix-integration.js','public/js/modules/06-lyrics/04-progress-seek.js','package.json'].map((rel) => [rel, crypto.createHash('sha256').update(fs.readFileSync(path.join(official, rel))).digest('hex')]));

assert.match(fs.readFileSync(path.join(patcherRoot, 'desktop', 'index.html'), 'utf8'), /<div class="developer">JIAFEE 开发<\/div>/, 'patcher home page credits JIAFEE');

try {
  assert.equal(engine.install(target, [fx]).ok, true, 'FX-only install');
  assert.match(read('public/js/index-loader.js'), /10-sound-effect-runtime/);
  assert.equal(read('public/js/index-loader.js').includes('12-together-listen'), false);
  assert.equal(engine.uninstall(target, [fx]).ok, true, 'FX-only uninstall');

  const realWrite = fs.writeFileSync;
  let injectedWrites = 0;
  fs.writeFileSync = function patchedWrite(file, ...args) {
    if (path.resolve(String(file)).startsWith(path.resolve(target) + path.sep) && ++injectedWrites === 2) throw new Error('DELIBERATE_WRITE_FAILURE');
    return realWrite.call(fs, file, ...args);
  };
  try {
    const failed = engine.install(target, [fx]);
    assert.equal(failed.ok, false, 'deliberate write failure is reported');
    assert.match(failed.reason, /已回滚/);
    assert.equal(fs.existsSync(path.join(target, 'public', 'js', 'modules', '07-fx', '10-sound-effect-runtime.js')), false, 'partial file rolled back');
  } finally { fs.writeFileSync = realWrite; }

  assert.equal(engine.install(target, [together]).ok, true, 'Together-only install');
  assert.match(read('desktop/main.js'), /TogetherListenManager/);
  assert.match(read('desktop/main.js'), /mineradio-together-create-room/);
  assert.match(read('desktop/preload.js'), /contextBridge\.exposeInMainWorld\('togetherListen'/);
  assert.match(read('public/index.html'), /id="together-modal"/);
  assert.match(read('public/index.html'), /id="together-presence-space"/);
  assert.match(read('public/js/modules/05-playback/13-playback-start-audio.js'), /opts\.startPaused === true/);
  assert.match(read('desktop/together-listen/room-service.js'), /isLanRemoteAddress/);
  assert.match(read('desktop/together-listen/manager.js'), /MAX_RECONNECT_ATTEMPTS = 3/);
  assert.match(read('desktop/together-listen/manager.js'), /requiresAuthorization: !targetAllowsBlankAuthorization/);
  assert.match(read('desktop/together-listen/manager.js'), /normalizeConnectTarget\(value\.address\)/);
  assert.match(read('public/js/modules/12-together-listen/ui.js'), /is-peer-expression/);
  assert.match(read('public/js/modules/12-together-listen/ui.js'), /animateExpressionForm/);
  assert.match(read('public/js/modules/12-together-listen/ui.js'), /远程保存地址需要先输入 6 位授权码/);
  assert.match(read('public/js/modules/12-together-listen/ui.js'), /name: savedServerName\(address\)/);
  assert.match(read('public/js/modules/12-together-listen/player-adapter.js'), /clearPlaybackDisplay/);
  assert.match(read('public/js/modules/12-together-listen/playback-controller.js'), /clearPlaybackOnNextConnection/);
  assert.match(read('public/js/modules/12-together-listen/playback-controller.js'), /wasTogetherSessionActive/);
  assert.match(read('public/js/modules/12-together-listen/playback-controller.js'), /mineradio-together-message/);
  assert.match(read('public/js/modules/12-together-listen/ui.js'), /together-expression-toggle/);
  assert.match(read('public/js/modules/12-together-listen/ui.js'), /pendingExpressions/);
  assert.match(read('public/css/index.css'), /together-signal-flow 3\.8s ease-in-out infinite alternate/);
  assert.match(read('public/css/index.css'), /together-expression-peer var\(--together-expression-duration,8s\)/);
  assert.match(read('public/css/index.css'), /\.together-expression \{ position:absolute/);
  assert.match(read('public/css/index.css'), /\.together-host-info\[hidden\]/);
  assert.doesNotThrow(() => require(path.join(target, 'desktop', 'together-listen', 'room-service.js')), 'Together runtime resolves bundled ws');
  assert.equal(engine.install(target, [together]).ok, true, 'idempotent Together install');
  assert.equal((read('public/js/index-loader.js').match(/12-together-listen\/ui\.js/g) || []).length, 1);
  assert.equal(engine.uninstall(target, [together]).ok, true, 'Together-only uninstall');

  assert.equal(engine.install(target, [fx]).ok, true, 'sequential FX first');
  assert.equal(engine.install(target, [together]).ok, true, 'sequential Together second');
  assert.equal(engine.uninstall(target, [fx]).ok, true, 'remove FX while Together remains');
  assert.match(read('public/js/index-loader.js'), /12-together-listen\/ui\.js/);
  assert.equal(engine.uninstall(target, [together]).ok, true);

  assert.equal(engine.install(target, [together]).ok, true, 'sequential Together first');
  assert.equal(engine.install(target, [fx]).ok, true, 'sequential FX second');
  assert.equal(engine.uninstall(target, [together]).ok, true, 'remove Together while FX remains');
  assert.match(read('public/js/index-loader.js'), /10-sound-effect-runtime/);
  assert.equal(engine.uninstall(target, [fx]).ok, true);

  assert.equal(engine.install(target, [fx, together]).ok, true, 'combined install');
  assert.match(read('public/js/index-loader.js'), /10-sound-effect-runtime/);
  assert.match(read('public/js/index-loader.js'), /12-together-listen\/ui\.js/);
  assert.match(read('public/index.html'), /Jiafee jiafee-fx-v2 begin/);
  assert.match(read('public/index.html'), /Jiafee jiafee-coplay2-entry begin/);
  assert.equal(engine.uninstall(target, [together]).ok, true, 'preserve FX while removing Together');
  assert.match(read('public/js/index-loader.js'), /10-sound-effect-runtime/);
  assert.equal(read('public/js/index-loader.js').includes('12-together-listen'), false);
  assert.equal(engine.uninstall(target, [fx]).ok, true, 'remove FX after Together');
  for (const [rel, expected] of Object.entries(originalHashes)) assert.equal(hash(rel), expected, `restored ${rel}`);
  console.log('multifunction patch tests: PASS');
} finally {
  fs.rmSync(temp, { recursive:true, force:true });
}
