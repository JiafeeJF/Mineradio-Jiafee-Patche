'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { RoomService, isLanRemoteAddress } = require('./payload/desktop/together-listen/room-service');
const {
  TogetherListenManager,
  MAX_RECONNECT_ATTEMPTS,
  normalizeConnectTarget,
  authorizationCodeForTarget,
} = require('./payload/desktop/together-listen/manager');
const { connectTcp } = require('./payload/desktop/together-listen/tcp-transport');

async function expectHandshakeFailure(socket, expectedStatus) {
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('handshake test timed out')), 3000);
    socket.once('handshake-error', (failure) => {
      clearTimeout(timeout);
      resolve(failure);
    });
    socket.once('open', () => {
      clearTimeout(timeout);
      reject(new Error('unauthorized connection unexpectedly opened'));
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  assert.equal(result.statusCode, expectedStatus);
}

async function verifyPlaybackDisplayReset() {
  const elements = {
    'thumb-title': { textContent: 'Old title' },
    'thumb-artist': { textContent: 'Old artist' },
    'thumb-cover': { src: 'old-cover', removeAttribute(name) { if (name === 'src') this.src = ''; } },
    'thumb-wrap': { classList: { removed: [], remove(name) { this.removed.push(name); } } },
  };
  const display = { title: 'Old title', artist: 'Old artist', cover: 'old-cover' };
  const audio = {
    src: 'old-audio', paused: false, ended: false, seeking: false, readyState: 4,
    duration: 180, currentTime: 30, playbackRate: 1,
    pause() { this.paused = true; },
    removeAttribute(name) { if (name === 'src') this.src = ''; },
    load() {}, addEventListener() {}, removeEventListener() {},
  };
  const context = {
    console, Set, Promise, Object, Array, Math, Number, String,
    window: null, audio, playing: true, playQueue: [{ name: 'Old title' }], currentIdx: 0,
    currentLocalSong: { name: 'Old local title' }, playMode: 'loop', trackSwitchToken: 3,
    document: { getElementById(id) { return elements[id] || null; } },
    togglePlay() {}, nextTrack() {}, prevTrack() {}, playQueueAt() {}, queueSong() {}, removeFromQueue() {}, cyclePlayMode() {}, commitProgressSeek() {},
    queueItemKey() { return ''; }, currentCoverSong() { return null; }, playbackDurationFromSong() { return 0; },
    getPlaybackCurrentSeconds() { return 0; }, getPlaybackDurationSeconds() { return 0; },
    safeRenderQueuePanel() {}, safeShelfRebuild() {}, setPlayIcon() {}, hideLoading() {}, forcePlaybackControlsInteractive() {},
    updatePlaybackProgressUi() {}, syncBeatMapPlaybackCursor() {}, updatePlayModeButton() {}, syncActiveAudioRepeatMode() {},
    clearAudioFadeTimers() {}, restorePlaybackGain() {},
    updateControlTrackInfo(song) { display.title = song && song.name || ''; display.artist = song && song.artist || ''; },
    setControlCoverSrc(src) { display.cover = src; },
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, 'payload', 'public', 'js', 'modules', '12-together-listen', 'player-adapter.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'player-adapter.js' });
  assert.equal(await context.MineradioTogetherPlayerAdapter.resetSessionPlayback(), true);
  assert.deepEqual(display, { title: '', artist: '', cover: '' }, 'bottom playback metadata is cleared');
  assert.equal(elements['thumb-title'].textContent, '');
  assert.equal(elements['thumb-artist'].textContent, '');
  assert.equal(elements['thumb-cover'].src, '');
  assert.deepEqual(elements['thumb-wrap'].classList.removed, ['visible']);
}

async function verifySinglePlayerRecoveryAfterLeave() {
  let emitTogetherEvent = null;
  const calls = { resetSession: 0, originalToggle: 0 };
  const adapter = {
    originals: {
      togglePlay() { calls.originalToggle += 1; return 'single-player'; },
      nextTrack() {}, prevTrack() {}, playQueueAt() {}, queueSong() {}, removeFromQueue() {}, cyclePlayMode() {}, commitProgressSeek() {},
    },
    resetSessionPlayback() { calls.resetSession += 1; return Promise.resolve(true); },
    cancelPendingWait() {}, resetPlaybackRate() {},
    readState() { return { playing: false, position: 0, trackId: '', currentIndex: -1, mode: 'loop' }; },
    snapshot() { return { queue: [], currentIndex: -1, position: 0, playing: false, mode: 'loop' }; },
    trackId() { return ''; }, serializeTrack() { return null; },
  };
  const bridge = {
    onEvent(callback) { emitTogetherEvent = callback; },
    getStatus() { return Promise.resolve({ connectionState: 'idle', clientId: 'local' }); },
    sendOperation() { return Promise.resolve(null); },
  };
  const context = {
    console, Promise, Object, Array, Math, Number, String, Set, Uint8Array,
    window: null, togetherListen: bridge, MineradioTogetherPlaybackCore: require('./payload/public/js/modules/12-together-listen/playback-controller-core'),
    MineradioTogetherPlayerAdapter: adapter, crypto: require('node:crypto').webcrypto,
    document: { body: { classList: { toggle() {} } }, dispatchEvent() {} },
    CustomEvent: function CustomEvent(type, options) { this.type = type; this.detail = options && options.detail; },
    togglePlay() {}, nextTrack() {}, prevTrack() {}, playQueueAt() {}, queueSong() {}, removeFromQueue() {}, cyclePlayMode() {}, commitProgressSeek() {},
    playQueue: [], currentIdx: -1, playMode: 'loop', showToast() {},
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, 'payload', 'public', 'js', 'modules', '12-together-listen', 'playback-controller.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'playback-controller.js' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.resetSession, 0, 'initial idle status must not clear normal single-player playback');

  emitTogetherEvent({ kind: 'status', status: { connectionState: 'connected', clientId: 'local' } });
  await Promise.resolve();
  assert.equal(calls.resetSession, 1, 'entering Together Listen starts with a clean playback session');
  emitTogetherEvent({ kind: 'status', status: { connectionState: 'disconnected', clientId: 'local' } });
  emitTogetherEvent({ kind: 'status', status: { connectionState: 'reconnecting', clientId: 'local' } });
  assert.equal(calls.resetSession, 1, 'transient disconnect keeps playback state available for reconnect');
  emitTogetherEvent({ kind: 'status', status: { connectionState: 'connected', clientId: 'local' } });
  assert.equal(calls.resetSession, 1, 'successful reconnect does not clear the recovered room state');
  emitTogetherEvent({ kind: 'status', status: { connectionState: 'idle', clientId: 'local' } });
  await Promise.resolve();
  assert.equal(calls.resetSession, 2, 'leaving Together Listen clears its playback session');
  assert.equal(context.togglePlay(), 'single-player');
  assert.equal(calls.originalToggle, 1, 'normal player controls are restored after leaving');
  emitTogetherEvent({ kind: 'status', status: { connectionState: 'idle', clientId: 'local' } });
  assert.equal(calls.resetSession, 2, 'duplicate idle events do not clear playback again');
}

async function verifyReconnectLimit() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-reconnect-limit-'));
  const manager = new TogetherListenManager({ userDataPath: root });
  const events = [];
  manager.on('event', (event) => events.push(event));
  manager.target = { url: 'tcp://192.168.1.20:17861', displayAddress: '192.168.1.20:17861', hostname: '192.168.1.20', authorizationCode: '' };
  manager.explicitClose = false;
  try {
    for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      manager.scheduleReconnect();
      assert.equal(manager.reconnectAttempt, attempt);
      assert.equal(manager.connectionState, 'reconnecting');
      clearTimeout(manager.reconnectTimer);
      manager.reconnectTimer = null;
    }
    manager.scheduleReconnect();
    assert.equal(manager.connectionState, 'idle');
    assert.equal(manager.target, null);
    assert.equal(manager.roomState, null);
    assert.equal(events.filter((event) => event.kind === 'error' && event.code === 'RECONNECT_EXHAUSTED').length, 1);
  } finally {
    await manager.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function waitForManagerEvent(manager, predicate, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { manager.removeListener('event', onEvent); reject(new Error('manager event timed out')); }, timeoutMs);
    function onEvent(event) {
      if (!predicate(event)) return;
      clearTimeout(timer);
      manager.removeListener('event', onEvent);
      resolve(event);
    }
    manager.on('event', onEvent);
  });
}

async function verifyReconnectMessageDelivery() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-message-reconnect-'));
  const service = new RoomService({ serverId: 'message-reconnect-room', name: 'Messages', authorizationCode: '482731', port: 0, host: '127.0.0.1' });
  const first = new TogetherListenManager({ userDataPath: path.join(root, 'first') });
  const second = new TogetherListenManager({ userDataPath: path.join(root, 'second') });
  try {
    await service.start();
    const address = `ws://127.0.0.1:${service.port}/together`;
    await Promise.all([
      first.connect(address, { authorizationCode: '482731' }),
      second.connect(address, { authorizationCode: '482731' }),
    ]);
    await Promise.all([
      waitForManagerEvent(first, (event) => event.kind === 'room-state' && event.state.members.length === 2),
      waitForManagerEvent(second, (event) => event.kind === 'room-state' && event.state.members.length === 2),
    ]);
    const before = waitForManagerEvent(second, (event) => event.kind === 'message' && event.text === '重连前');
    first.request('MESSAGE_SEND', { text: '重连前', time: Date.now() });
    await before;
    second.socket.terminate();
    await waitForManagerEvent(second, (event) => event.kind === 'status' && event.status.connectionState === 'connected');
    await new Promise((resolve) => setTimeout(resolve, 1900));
    const after = waitForManagerEvent(second, (event) => event.kind === 'message' && event.text === '重连后');
    first.request('MESSAGE_SEND', { text: '重连后', time: Date.now() });
    await after;
  } finally {
    await first.close();
    await second.close();
    await service.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function verifySavedServers() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mineradio-saved-servers-'));
  const manager = new TogetherListenManager({ userDataPath: root });
  try {
    const remote = manager.saveServer({ name: '远程房间', address: 'example.com:17861', authorizationCode: '123456' });
    assert.equal(remote.address, 'example.com:17861');
    assert.equal(remote.requiresAuthorization, true, 'remote saved servers require authorization');
    const lan = manager.saveServer({ name: '局域网房间', address: '192.168.1.8:17861' });
    assert.equal(lan.requiresAuthorization, false, 'LAN saved servers remain code-free');
    const loopback = manager.saveServer({ name: '回环入口', address: '127.0.0.1:17861' });
    assert.equal(loopback.requiresAuthorization, true, 'loopback proxy entries require authorization');

    const updated = manager.saveServer({ ...remote, name: '远程房间 2' });
    assert.equal(updated.name, '远程房间 2', 'an existing address can be saved again');
    assert.equal(manager.listSaved().length, 3);
    assert.throws(() => manager.saveServer({ name: '错误地址', address: 'not-an-address' }), /端口必须/, 'invalid addresses are rejected before persistence');

    const stored = JSON.parse(fs.readFileSync(path.join(root, 'together-listen.json'), 'utf8'));
    assert.equal(stored.servers.find((entry) => entry.id === remote.id).name, '远程房间 2');
    assert.equal(JSON.stringify(stored).includes('123456'), false, 'authorization codes are never persisted');
    assert.equal(Object.hasOwn(stored.servers[0], 'requiresAuthorization'), false, 'derived authorization state is not persisted');
  } finally {
    await manager.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  for (const address of ['10.0.0.8', '172.16.0.2', '172.31.255.2', '192.168.1.9', '100.64.0.2', '169.254.2.3', '::ffff:192.168.1.9', 'fd00::2', 'fe80::2%12']) {
    assert.equal(isLanRemoteAddress(address), true, `${address} should be treated as LAN`);
  }
  for (const address of ['127.0.0.1', '::1', '8.8.8.8', '1.1.1.1', 'unknown']) {
    assert.equal(isLanRemoteAddress(address), false, `${address} must still require authorization`);
  }

  const service = new RoomService({ serverId: 'test-room', name: 'test', authorizationCode: '246810', port: 0, host: '127.0.0.1' });
  assert.equal(service.authorizationStatus('192.168.10.3', ''), 200, 'LAN peers can join without a code');
  assert.equal(service.authorizationStatus('8.8.8.8', ''), 401, 'public peers cannot join without a code');
  assert.equal(service.authorizationStatus('127.0.0.1', ''), 401, 'loopback proxy traffic cannot bypass public/FRP authorization');
  assert.equal(service.authorizationStatus('8.8.8.8', '246810'), 200, 'public peers can join with the correct code');

  const lanTarget = normalizeConnectTarget('192.168.1.20:17861');
  const publicTarget = normalizeConnectTarget('example.com:17861');
  const loopbackTarget = normalizeConnectTarget('[::1]:17861');
  assert.equal(authorizationCodeForTarget(lanTarget, ''), '', 'LAN target accepts an empty code');
  assert.throws(() => authorizationCodeForTarget(publicTarget, ''), /6 位授权码/, 'public target requires a code');
  assert.throws(() => authorizationCodeForTarget(loopbackTarget, ''), /6 位授权码/, 'IPv6 loopback cannot bypass proxy authorization');

  await service.start();
  await expectHandshakeFailure(connectTcp({ host: '127.0.0.1', port: service.port, authorizationCode: '' }), 401);
  await service.stop();
  await verifyPlaybackDisplayReset();
  await verifySinglePlayerRecoveryAfterLeave();
  await verifyReconnectLimit();
  await verifyReconnectMessageDelivery();
  await verifySavedServers();

  const css = fs.readFileSync(path.join(__dirname, 'payload', 'together-listen', 'together-index.css'), 'utf8');
  const entry = fs.readFileSync(path.join(__dirname, 'payload', 'together-listen', 'index-entry.html'), 'utf8');
  const modal = fs.readFileSync(path.join(__dirname, 'payload', 'together-listen', 'index-modal.html'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, 'payload', 'public', 'js', 'modules', '12-together-listen', 'ui.js'), 'utf8');
  const controller = fs.readFileSync(path.join(__dirname, 'payload', 'public', 'js', 'modules', '12-together-listen', 'playback-controller.js'), 'utf8');
  assert.match(css, /together-signal-flow 3\.8s ease-in-out infinite alternate/, 'presence dot uses a slow ping-pong animation');
  assert.match(entry, /id="together-control" class="together-control quality-control"/, 'Together Listen uses the same mounted control container as the sound-effect popover');
  assert.match(entry, /id="together-entry"[^>]*aria-expanded="false"/, 'mounted panel trigger exposes its expanded state');
  assert.match(css, /DIY-adjacent mounted panel with the sound-effect popover's compact material/, 'Together Listen includes the DIY-adjacent sound-effect-style popover');
  assert.match(css, /\.together-control \.together-modal-mask \{[\s\S]*inset:38px 0 auto auto[\s\S]*width:min\(360px,calc\(100vw - 24px\)\)/, 'panel opens below the DIY-adjacent titlebar control at the sound-effect width');
  assert.match(css, /\.together-control \.together-lobby-view \{[\s\S]*display:flex[\s\S]*flex-direction:column[\s\S]*align-items:stretch/, 'mounted lobby uses a compact full-width single-column layout');
  assert.match(css, /\.together-control \.together-lobby-view\[hidden\],[\s\S]*\.together-control \.together-room-view\[hidden\] \{ display:none !important; \}/, 'lobby and room hidden states remain mutually exclusive');
  assert.match(css, /\.together-panel button:focus-visible/, 'keyboard focus remains visible in the refined panel');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/, 'panel motion respects reduced-motion preferences');
  assert.match(modal, /together-section together-discover-section/, 'LAN discovery has a dedicated composable grid area');
  assert.match(modal, /together-section together-connect-section/, 'direct connection has a dedicated composable grid area');
  assert.match(modal, /together-section together-saved-section/, 'saved servers have a dedicated composable grid area');
  assert.match(css, /border:1px solid rgba\(157,184,207,\.24\)/, 'panel uses the sound-effect quality-popover glass border');
  assert.match(css, /background:rgba\(10,11,14,\.58\)/, 'panel uses a clearer version of the sound-effect quality-popover glass fill');
  assert.match(css, /backdrop-filter:blur\(24px\) saturate\(1\.25\)/, 'panel uses the sound-effect quality-popover glass filter');
  assert.match(css, /box-shadow:0 18px 48px rgba\(0,0,0,\.38\),inset 0 1px 0 rgba\(255,255,255,\.08\)/, 'panel uses the sound-effect quality-popover layered shadow');
  assert.match(css, /scrollbar-width:none/, 'mounted panel keeps scrolling while hiding its right scrollbar');
  assert.match(css, /\.together-control \.together-panel::\-webkit\-scrollbar \{ display:none; width:0; height:0; \}/, 'mounted panel hides the Chromium scrollbar');
  assert.match(css, /\.together-presence-space\.is-leaving \{[^}]*opacity:0[^}]*pointer-events:none/, 'presence area has an explicit fade-out state');
  assert.match(ui, /function setPresenceVisible\(surface, visible\)[\s\S]*setTimeout\(function \(\) \{[\s\S]*surface\.hidden = true;[\s\S]*\}, 260\)/, 'presence area waits for its fade-out before becoming hidden');
  assert.match(css, /@keyframes together-panel-view-out/, 'lobby and room views define a linked exit animation');
  assert.match(css, /@keyframes together-panel-view-in/, 'lobby and room views define a linked entrance animation');
  assert.match(ui, /function transitionPanelView\(connected\)[\s\S]*outgoing\.classList\.add\('is-leaving'\)[\s\S]*incoming\.classList\.add\('is-entering'\)/, 'create/join and room views transition instead of switching immediately');
  assert.match(css, /together-expression-peer var\(--together-expression-duration,8s\) linear both/, 'peer text animation follows message lifetime');
  assert.match(css, /\.together-expression \{[^}]*background:rgba\(5,9,12,\.82\)[^}]*box-shadow:/, 'expression text has a high-contrast bubble');
  assert.match(css, /\.together-expression \{[^}]*position:absolute[^}]*translate:-50% 5px/, 'multiline bubbles are removed from the avatar grid flow');
  assert.match(css, /\.together-host-info\[hidden\] \{ display:none !important; \}/, 'guest connection details are force-hidden');
  assert.match(css, /8%[^}]*scale\(1\.3\)[\s\S]*42%[^}]*scale\(1\.3\)[\s\S]*92%[^}]*scale\(\.86\)[\s\S]*100%[^}]*opacity:0/, 'peer text grows, holds, shrinks, and disappears');
  assert.match(ui, /member\.senderId !== status\.clientId/, 'peer-only expression animation is wired');
  assert.match(ui, /function animateExpressionForm[\s\S]*form\.animate\([\s\S]*duration: 520/, 'input bar animates vertically after expression layout changes');
  assert.match(ui, /prefers-reduced-motion: reduce/, 'input bar animation respects reduced-motion preference');
  assert.match(ui, /status\.hosting === true && !!host/, 'connection-copy panel is host-only');
  assert.match(ui, /await bridge\.saveServer\(\{ name: savedServerName\(address\), address: address \}\)/, 'save-address action no longer depends on a renderer prompt');
  assert.match(ui, /item\.requiresAuthorization && !\/\^\\d\{6\}\$\/\.test\(code\)/, 'saved remote addresses require an explicit six-digit code');
  assert.match(ui, /authorizationCode: item\.requiresAuthorization \? code : ''/, 'saved LAN addresses ignore stale authorization input');
  assert.match(ui, /authorizationInput\.focus\(\)/, 'missing saved-server authorization focuses the code input');
  assert.match(ui, /together-expression-toggle/, 'chat input has a collapse toggle');
  assert.match(ui, /oscillator\.frequency\.exponentialRampToValueAtTime\(430/, 'incoming message tone uses a soft descending pitch');
  assert.match(ui, /if \(state\.status && message\.userId && message\.userId !== state\.status\.clientId\) playMessageTone\(\)/, 'only peer messages trigger notification tone');
  assert.match(ui, /var pendingExpressions = new Map\(\)/, 'messages are buffered while the member list is recovering');
  assert.match(ui, /pendingExpressions\.set\(senderId, normalizedMessage\)/, 'unmatched messages are retained instead of dropped');
  assert.match(ui, /function flushPendingExpressions[\s\S]*applyIncomingMessage\(message\)/, 'buffered messages flush after room state recovery');
  assert.match(ui, /bridge\.onEvent\(function \(event\) \{[\s\S]*event\.kind !== 'message'/, 'chat UI listens directly to the main-process message event');
  assert.match(controller, /event\.kind === 'message'[\s\S]*mineradio-together-message/, 'message events survive reconnect through the renderer event bridge');
  assert.match(controller, /connected && clearPlaybackOnNextConnection/, 'a fresh connection clears stale playback display');
  assert.match(controller, /wasTogetherSessionActive[\s\S]*adapter\.resetSessionPlayback/, 'terminal disconnect releases Together Listen playback state');
  assert.doesNotMatch(ui, /document\.getElementById\('sound-effect-control'\)|document\.getElementById\('collect-btn'\)/, 'Together Listen no longer relocates into the playback control strip');
  assert.match(ui, /control\.appendChild\(panel\)/, 'the panel is attached to its DIY-adjacent titlebar control');
  assert.match(ui, /entryButton\.setAttribute\('aria-expanded', 'true'\)/, 'opening the mounted panel updates accessibility state');
  assert.match(ui, /!control\.contains\(event\.target\)\) close\(\)/, 'clicking outside the mounted panel closes it');
  console.log('together-listen enhancement tests: PASS');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
