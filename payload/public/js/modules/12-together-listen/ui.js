'use strict';

(function installTogetherListenUi() {
  if (!window.togetherListen) return;
  var bridge = window.togetherListen;
  // Only public display fields cross the Together Listen bridge. Never return cookies/raw account data.
  var accountApiCache = null;
  var accountApiPending = null;
  var accountApiControllers = new Set();
  function readHostAccountSnapshot() {
    // Retain display fields only: never copy cookies/tokens into module state.
    function display(status) {
      if (!status) return null;
      var profile = status.profile || {};
      var level = typeof providerVipLevel === 'function' ? providerVipLevel(status === (typeof loginStatus !== 'undefined' ? loginStatus : null) ? 'netease' : 'qq', status) : status.vipLevel;
      return { loggedIn: status.loggedIn === true, userId: String(status.userId || status.uin || profile.userId || ''),
        nickname: status.nickname || profile.nickname || status.name || '', avatar: status.avatar || status.avatarUrl || profile.avatarUrl || '',
        isVip: status.isVip === true, isSvip: status.isSvip === true, vipType: status.vipType || profile.vipType || 0, vipLevel: level };
    }
    return { ne: display(typeof loginStatus !== 'undefined' ? loginStatus : null), qq: display(typeof qqLoginStatus !== 'undefined' ? qqLoginStatus : null) };
  }
  function normalizeLocalUserProfile(ne, qq) {
    var account = ne && ne.loggedIn === true ? ne : qq && qq.loggedIn === true ? qq : null;
    if (!account) return { platform: 'none', uid: '', name: '未登录用户', avatar: '', isVip: false };
    var profile = account.profile || {};
    var avatar = String(account.avatar || account.avatarUrl || profile.avatarUrl || '');
    if (avatar.indexOf('//') === 0) avatar = 'https:' + avatar;
    if (!/^https?:\/\//i.test(avatar)) avatar = '';
    var platform = account === ne ? 'netease' : 'qq';
    var membership = typeof providerVipLevel === 'function' ? providerVipLevel(platform, account) : (account.isSvip === true || account.vipLevel === 'svip' ? 'svip' : (account.isVip === true || Number(account.vipType || profile.vipType || 0) > 0 ? 'vip' : 'none'));
    return {
      platform: platform,
      uid: String(account.userId || account.uin || profile.userId || '').trim(),
      name: String(account.nickname || profile.nickname || account.name || '未登录用户').trim().slice(0, 42),
      avatar: avatar,
      isVip: membership !== 'none',
      vipLevel: membership
    };
  }

  async function readAccountEndpoint(path, fallback, requireIdentity) {
    var controller = new AbortController();
    accountApiControllers.add(controller);
    var timer = setTimeout(function () { controller.abort(); }, 12000);
    try {
      // The host backend owns platform credentials. Only a same-origin status request is made here.
      var response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('ACCOUNT_HTTP_ERROR');
      var info = await response.json();
      if (!info || typeof info.loggedIn !== 'boolean' || info.error) throw new Error('ACCOUNT_STATUS_UNAVAILABLE');
      if (requireIdentity && (info.statusPending || (!info.loggedIn && info.hasCookie))) throw new Error('ACCOUNT_STATUS_UNCONFIRMED');
      return info;
    } catch (_) {
      if (requireIdentity) throw new Error('暂时无法确认音乐账号，请稍后重试连接');
      // Temporary API failure must not clear a valid host account or request another login.
      return fallback;
    } finally { clearTimeout(timer); accountApiControllers.delete(controller); }
  }
  async function getLocalUserProfile(requireIdentity) {
    var snapshot = readHostAccountSnapshot();
    var snapshotKey = JSON.stringify(snapshot);
    if (accountSyncClosed) { if (requireIdentity) throw new Error('账号检测已取消'); return normalizeLocalUserProfile(snapshot.ne, snapshot.qq); }
    if (accountApiCache && (!requireIdentity || accountApiCache.verified) && accountApiCache.key === snapshotKey && Date.now() < accountApiCache.until) return accountApiCache.profile;
    if (accountApiPending && accountApiPending.key === snapshotKey && (!requireIdentity || accountApiPending.verified)) return accountApiPending.promise;
    var pending = { key: snapshotKey, verified: !!requireIdentity };
    pending.promise = (async function () {
      var results;
      if (requireIdentity) {
        var ne = await readAccountEndpoint('/api/login/status', null, true);
        // Netease has priority; a slow/unavailable secondary platform must not delay it.
        results = [ne, ne.loggedIn ? null : await readAccountEndpoint('/api/qq/login/status', null, true)];
      } else {
        results = await Promise.all([
          readAccountEndpoint('/api/login/status', snapshot.ne),
          readAccountEndpoint('/api/qq/login/status', snapshot.qq)
        ]);
      }
      var current = readHostAccountSnapshot();
      if (accountSyncClosed || JSON.stringify(current) !== snapshotKey) {
        if (requireIdentity) throw new Error('登录状态发生变化，请重新连接');
        return normalizeLocalUserProfile(current.ne, current.qq);
      }
      var profile = normalizeLocalUserProfile(results[0], results[1]);
      accountApiCache = { key: snapshotKey, profile: profile, verified: !!requireIdentity, until: Date.now() + 60000 };
      return profile;
    })();
    accountApiPending = pending;
    try { return await pending.promise; }
    finally { if (accountApiPending === pending) accountApiPending = null; }
  }
  var accountSyncPending = null;
  var accountSyncKey = '';
  var accountSyncClosed = false;
  var accountAvatarRetryAt = 0;
  var localAccountProfile = null;
  var identitySyncKey = '';
  async function syncAccountIdentity(fresh) {
    // Admission must use the host's saved login session, never startup renderer defaults.
    // Avatar fetching is deliberately outside this path; no credentials leave the host.
    if (fresh) accountApiCache = null;
    var profile = await getLocalUserProfile(true);
    if (profile.platform !== 'none' && !profile.uid) throw new Error('已登录账号缺少用户 ID，请刷新登录状态后重试');
    var key = profile.platform + ':' + profile.uid;
    if (key === identitySyncKey) return;
    var display = { platform: profile.platform, uid: profile.uid, name: profile.name, avatar: 'default:signal' };
    if (state.profile && state.profile.platform === profile.platform && state.profile.uid === profile.uid) display.avatar = state.profile.avatar;
    state.profile = await bridge.saveProfile(display);
    accountSyncKey = '';
    identitySyncKey = key;
    var status = await bridge.getStatus();
    if (status && status.connectionState === 'connected') await bridge.sendOperation('PRESENCE', display);
  }
  async function syncAccountProfile() {
    if (accountSyncPending) return accountSyncPending;
    accountSyncPending = (async function () {
      var hostKey = JSON.stringify(readHostAccountSnapshot());
      var profile = await getLocalUserProfile();
      var key = JSON.stringify(profile);
      if (accountSyncClosed || (key === accountSyncKey && (!accountAvatarRetryAt || Date.now() < accountAvatarRetryAt))) return;
      var avatarFailed = false;
      var avatar = 'default:signal';
      if (profile.avatar) {
        var abort = new AbortController();
        var timeout = setTimeout(function () { abort.abort(); }, 4000);
        try {
          var response = await fetch(typeof avatarSrc === 'function' ? avatarSrc(profile.avatar) : '/api/cover?url=' + encodeURIComponent(profile.avatar), { credentials: 'omit', signal: abort.signal });
          if (!response.ok) throw new Error('头像下载失败');
          avatar = await compressAvatar(await response.blob());
        } catch (_) {
          avatarFailed = true;
          setMessage('账号昵称已读取；头像暂不可用，使用默认头像。', 'error');
        } finally { clearTimeout(timeout); }
      }
      // Discard a stale fetch if login/logout happened while the avatar was loading.
      if (accountSyncClosed || JSON.stringify(readHostAccountSnapshot()) !== hostKey || JSON.stringify(await getLocalUserProfile()) !== key) return;
      var display = { name: profile.name, avatar: avatar, platform: profile.platform, uid: profile.uid };
      localAccountProfile = profile;
      state.profile = await bridge.saveProfile(display);
      var status = await bridge.getStatus();
      if (status && status.connectionState === 'connected') await bridge.sendOperation('PRESENCE', display);
      accountSyncKey = key;
      accountAvatarRetryAt = avatarFailed ? Date.now() + 30000 : 0;
      renderProfile();
    })();
    try { await accountSyncPending; } finally { accountSyncPending = null; }
  }
  var state = { status: null, rooms: [], saved: [], probes: {}, busy: false, profile: null, selectedAvatar: 'default:signal' };
  var panel = document.getElementById('together-modal');
  var control = document.getElementById('together-control');
  var entryButton = document.getElementById('together-entry');
  var statusText = document.getElementById('together-entry-status');
  var expressionFormAnimation = null;
  var messageAudioContext = null;
  var expressionChatExpanded = true;
  var pendingExpressions = new Map();
  var presenceHideTimer = null;
  var panelViewExitTimer = null;
  var panelViewEnterTimer = null;
  var panelViewConnected = null;

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]; }); }
  function setMessage(text, kind) { var el = document.getElementById('together-message'); if (!el) return; el.textContent = text || ''; el.dataset.kind = kind || ''; }
  function setBusy(value) { state.busy = !!value; if (panel) panel.classList.toggle('is-busy', state.busy); }
  function formatTime(value) { if (!value) return '尚未连接'; try { return new Date(value).toLocaleString(); } catch (_) { return '未知'; } }
  function savedServerName(address) {
    return String(address || '').replace(/^(?:tcp|wss?):\/\//i, '').replace(/\/together\/?$/i, '') || '好友服务器';
  }

  function avatarClass(value) { return /^default:/.test(value || '') ? String(value).replace(':', '-') : ''; }
  function renderAvatar(element, avatar, name) {
    if (!element) return;
    element.className = element.className.replace(/\sdefault-(?:signal|rose|mono|mint)/g, '');
    element.textContent = '';
    if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(avatar || '')) {
      var image = document.createElement('img'); image.alt = ''; image.src = avatar; element.appendChild(image);
    } else {
      var preset = avatarClass(avatar || 'default:signal'); if (preset) element.classList.add(preset);
      var initial = document.createElement('span'); initial.textContent = Array.from(String(name || '听'))[0] || '听'; element.appendChild(initial);
    }
  }
  function memberStatusText(member) {
    var labels = { idle: '在线', loading: '正在加载', ready: '已准备', playing: '正在播放', paused: '已暂停', seeking: '正在定位', switching: '正在切歌', buffering: '正在缓冲', waiting: '等待对方', error: '播放异常' };
    var text = labels[member.status] || '在线';
    if (Number(member.latencyMs) > 0) text += ' · ' + Math.round(Number(member.latencyMs)) + 'ms';
    return text;
  }
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function setPresenceVisible(surface, visible) {
    if (!surface) return;
    if (presenceHideTimer) { clearTimeout(presenceHideTimer); presenceHideTimer = null; }
    if (visible) {
      surface.hidden = false;
      surface.classList.remove('is-leaving');
      surface.classList.add('is-visible');
      return;
    }
    surface.classList.remove('is-visible');
    if (surface.hidden || prefersReducedMotion()) {
      surface.hidden = true;
      surface.classList.remove('is-leaving');
      return;
    }
    surface.classList.add('is-leaving');
    presenceHideTimer = setTimeout(function () {
      presenceHideTimer = null;
      if (surface.classList.contains('is-visible')) return;
      surface.hidden = true;
      surface.classList.remove('is-leaving');
    }, 260);
  }
  function transitionPanelView(connected) {
    var lobby = document.getElementById('together-lobby-view');
    var room = document.getElementById('together-room-view');
    if (!lobby || !room) return;
    if (panelViewConnected === connected && (panelViewExitTimer || panelViewEnterTimer)) return;
    if (panelViewExitTimer) { clearTimeout(panelViewExitTimer); panelViewExitTimer = null; }
    if (panelViewEnterTimer) { clearTimeout(panelViewEnterTimer); panelViewEnterTimer = null; }
    lobby.classList.remove('is-entering', 'is-leaving');
    room.classList.remove('is-entering', 'is-leaving');
    if (panelViewConnected === null || prefersReducedMotion()) {
      lobby.hidden = connected;
      room.hidden = !connected;
      panelViewConnected = connected;
      return;
    }
    if (panelViewConnected === connected) {
      lobby.hidden = connected;
      room.hidden = !connected;
      return;
    }
    var outgoing = panelViewConnected ? room : lobby;
    var incoming = connected ? room : lobby;
    lobby.hidden = panelViewConnected;
    room.hidden = !panelViewConnected;
    panelViewConnected = connected;
    outgoing.classList.add('is-leaving');
    panelViewExitTimer = setTimeout(function () {
      panelViewExitTimer = null;
      outgoing.hidden = true;
      outgoing.classList.remove('is-leaving');
      incoming.hidden = false;
      incoming.classList.add('is-entering');
      panelViewEnterTimer = setTimeout(function () {
        panelViewEnterTimer = null;
        incoming.classList.remove('is-entering');
      }, 320);
    }, 160);
  }
  function animateExpressionForm(previousTop) {
    var form = document.getElementById('together-expression-form');
    if (!form || !Number.isFinite(previousTop)) return;
    if (expressionFormAnimation) { expressionFormAnimation.cancel(); expressionFormAnimation = null; }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var nextTop = form.getBoundingClientRect().top;
    var delta = previousTop - nextTop;
    if (Math.abs(delta) < 0.5 || typeof form.animate !== 'function') return;
    var animation = form.animate([
      { transform: 'translateY(' + delta + 'px)' },
      { transform: 'translateY(0)' }
    ], { duration: 520, easing: 'cubic-bezier(.22,.72,.2,1)' });
    expressionFormAnimation = animation;
    animation.onfinish = function () { if (expressionFormAnimation === animation) expressionFormAnimation = null; };
    animation.oncancel = function () { if (expressionFormAnimation === animation) expressionFormAnimation = null; };
  }
  function updateExpressionSpace(surface) {
    var pair = surface && surface.querySelector('.together-presence-pair');
    if (!pair) return;
    var maxHeight = 0;
    pair.querySelectorAll('[data-presence-expression]').forEach(function (expression) {
      if (!expression.hidden) maxHeight = Math.max(maxHeight, Math.ceil((expression.offsetHeight || 0) * 1.3));
    });
    pair.style.setProperty('--together-expression-space', maxHeight ? (maxHeight + 5) + 'px' : '0px');
  }
  function playMessageTone() {
    try {
      var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      if (!messageAudioContext) messageAudioContext = new AudioContextCtor();
      if (messageAudioContext.state === 'suspended' && typeof messageAudioContext.resume === 'function') messageAudioContext.resume().catch(function () {});
      var now = messageAudioContext.currentTime;
      var oscillator = messageAudioContext.createOscillator();
      var gain = messageAudioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(560, now);
      oscillator.frequency.exponentialRampToValueAtTime(430, now + .16);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.035, now + .018);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .18);
      oscillator.connect(gain); gain.connect(messageAudioContext.destination);
      oscillator.start(now); oscillator.stop(now + .2);
    } catch (_) { }
  }
  function applyIncomingMessage(message) {
    var status = state.status || {};
    var room = status.room || {};
    var members = Array.isArray(room.members) ? room.members : [];
    var senderId = String(message && message.userId || '');
    var normalizedMessage = {
      userId: senderId,
      text: String(message && message.text || ''),
      time: Number(message && message.time) || Date.now(),
      expiresAt: Number(message && message.expiresAt) || Date.now() + 8000,
    };
    if (!senderId || normalizedMessage.expiresAt <= Date.now()) return false;
    var member = members.find(function (entry) { return entry.senderId === senderId; });
    if (!member) {
      pendingExpressions.set(senderId, normalizedMessage);
      while (pendingExpressions.size > 8) pendingExpressions.delete(pendingExpressions.keys().next().value);
      return false;
    }
    pendingExpressions.delete(senderId);
    member.expression = { text: normalizedMessage.text, time: normalizedMessage.time, expiresAt: normalizedMessage.expiresAt };
    renderPresence();
    return true;
  }
  function flushPendingExpressions() {
    pendingExpressions.forEach(function (message, senderId) {
      if (message.expiresAt <= Date.now() || applyIncomingMessage(message)) pendingExpressions.delete(senderId);
    });
  }
  function renderPresence() {
    var surface = document.getElementById('together-presence-space');
    var expressionForm = document.getElementById('together-expression-form');
    var expressionFormTop = expressionForm ? expressionForm.getBoundingClientRect().top : NaN;
    var expressionLayoutChanged = false;
    var status = state.status || {};
    var room = status.room || {};
    var visible = !!(room.members && room.members.length && ['connected', 'reconnecting', 'disconnected'].includes(status.connectionState));
    setPresenceVisible(surface, visible);
    surface.dataset.connectionState = status.connectionState || 'idle';
    surface.dataset.playbackState = room.transition && room.transition.phase !== 'go' ? 'waiting' : (room.playing ? 'playing' : 'paused');
    if (!visible) return;
    var members = room.members.slice();
    members.sort(function (a, b) { return a.senderId === status.clientId ? -1 : (b.senderId === status.clientId ? 1 : 0); });
    document.querySelectorAll('[data-presence-slot]').forEach(function (slot, index) {
      var member = members[index];
      slot.classList.toggle('is-empty', !member);
      renderAvatar(slot.querySelector('[data-presence-avatar]'), member && member.avatar || (index ? 'default:mono' : 'default:signal'), member && member.name || (index ? '友' : '我'));
      slot.querySelector('[data-presence-name]').textContent = member ? member.name : (index ? '等待好友' : '等待连接');
      slot.querySelector('[data-presence-status]').textContent = member ? memberStatusText(member) : '未连接';
      var expression = slot.querySelector('[data-presence-expression]');
      var active = member && member.expression && Number(member.expression.expiresAt) > Date.now();
      if (expression.hidden === !!active) expressionLayoutChanged = true;
      expression.hidden = !active;
      var expressionKey = active ? [member.senderId, member.expression.time || member.expression.expiresAt, member.expression.text].join(':') : '';
      if (active && expression.dataset.expressionKey !== expressionKey) {
        expressionLayoutChanged = true;
        expression.textContent = member.expression.text;
        expression.dataset.expressionKey = expressionKey;
        expression.classList.remove('is-peer-expression');
        expression.style.animation = 'none'; void expression.offsetWidth; expression.style.animation = '';
        if (member.senderId !== status.clientId) {
          expression.style.setProperty('--together-expression-duration', Math.max(1200, Number(member.expression.expiresAt) - Date.now()) + 'ms');
          expression.classList.add('is-peer-expression');
        }
      } else if (!active) {
        expression.textContent = '';
        expression.dataset.expressionKey = '';
        expression.style.removeProperty('--together-expression-duration');
        expression.classList.remove('is-peer-expression');
      }
    });
    updateExpressionSpace(surface);
    if (expressionLayoutChanged) animateExpressionForm(expressionFormTop);
  }

  function renderProfile() {
    var profile = state.profile || { name: 'Mineradio 听众', avatar: 'default:signal' };
    document.getElementById('together-profile-name').value = profile.name || '';
    var badge = document.getElementById('together-profile-membership');
    if (badge) {
      badge.hidden = !(localAccountProfile && localAccountProfile.isVip);
      badge.textContent = localAccountProfile && localAccountProfile.vipLevel === 'svip' ? 'SVIP' : 'VIP';
    }
    state.selectedAvatar = profile.avatar || 'default:signal';
    renderAvatar(document.getElementById('together-profile-avatar'), state.selectedAvatar, profile.name);
    document.querySelectorAll('[data-avatar-preset]').forEach(function (button) { button.classList.toggle('is-selected', button.dataset.avatarPreset === state.selectedAvatar); });
  }

  function compressAvatar(file) {
    // The host avatar proxy preserves NetEase's image/jpg MIME alias.
    var hasSupportedType = file && /^image\/(?:png|jpe?g|webp)$/i.test(file.type || '');
    var hasSupportedName = file && /\.(?:png|jpe?g|webp)$/i.test(file.name || '');
    if (!file || (!hasSupportedType && !hasSupportedName)) return Promise.reject(new Error('请选择 PNG、JPEG 或 WebP 图片'));
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('头像原图不能超过 10 MB'));
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file); var image = new Image();
      image.onload = function () {
        try {
          var sizes = [96, 80, 64]; var qualities = [.78, .64, .5, .38, .28]; var data = '';
          for (var s = 0; s < sizes.length && (!data || data.length > 22000); s++) {
            var size = sizes[s]; var canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
            var ctx = canvas.getContext('2d'); var scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
            var width = image.naturalWidth * scale; var height = image.naturalHeight * scale;
            ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
            for (var i = 0; i < qualities.length; i++) { data = canvas.toDataURL('image/webp', qualities[i]); if (data.length <= 22000) break; }
          }
          URL.revokeObjectURL(url);
          if (!data || data.length > 24000) reject(new Error('头像压缩后仍然过大，请换一张图片')); else resolve(data);
        } catch (error) { URL.revokeObjectURL(url); reject(error); }
      };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('头像图片无法读取')); };
      image.src = url;
    });
  }

  function mountPanel() {
    if (control && panel && panel.parentNode !== control) control.appendChild(panel);
  }
  function open() {
    mountPanel();
    control.classList.add('open');
    panel.classList.add('show');
    panel.setAttribute('aria-hidden', 'false');
    entryButton.setAttribute('aria-expanded', 'true');
    refresh();
  }
  function close() {
    control.classList.remove('open');
    panel.classList.remove('show');
    panel.setAttribute('aria-hidden', 'true');
    entryButton.setAttribute('aria-expanded', 'false');
  }
  function togglePanel() { if (control.classList.contains('open')) close(); else open(); }

  function connectionUrlFromInputs() {
    var address = document.getElementById('together-address').value.trim();
    if (!address) throw new Error('请输入服务器地址');
    return address;
  }

  function authorizationCodeFromInput() {
    var code = document.getElementById('together-auth-code').value.trim();
    if (!code) return '';
    if (!/^\d{6}$/.test(code)) throw new Error('请输入开服端显示的 6 位授权码');
    return code;
  }

  function connectionOptions(extra) {
    return Object.assign({ authorizationCode: authorizationCodeFromInput() }, extra || {});
  }

  function diagnosticText(result) {
    if (!result) return '连接诊断不可用';
    function stage(name, value) { return name + '：' + (value && value.ok ? '成功' : ('失败' + (value && value.error ? ' (' + value.error + ')' : ''))); }
    var protocol = result.protocol || result.websocket;
    var protocolName = result.transport === 'tcp' ? '一起听 TCP 协议' : 'WebSocket';
    var parts = [stage('DNS', result.dns), stage('TCP', result.tcp), stage(protocolName, protocol)];
    if (Number(result.latencyMs) >= 0 && protocol && protocol.ok) parts.push('延迟：' + Math.round(Number(result.latencyMs)) + 'ms');
    var advice = {
      AUTHORIZATION_FAILED: '6 位授权码错误',
      NOT_MINERADIO_PORT: 'FRP localPort 没有指向开服面板的 TCP 端口',
      WEBSOCKET_UPGRADE_BLOCKED: '中转节点阻止了 WebSocket Upgrade',
      AUTHORIZATION_RATE_LIMIT: '授权码错误次数过多，请稍后再试',
      SAKURAFRP_PLAIN_WS_BLOCKED: 'TCP 隧道已通，但 SakuraFrp 节点策略拦截明文 WebSocket；请启用自动 HTTPS 后改用 wss://，或更换节点',
      WEBSOCKET_NOT_IMPLEMENTED: '中转入口不支持 WebSocket Upgrade',
      FRP_UPSTREAM_UNREACHABLE: 'frps 无法访问 frpc 后面的本机端口',
      ROOM_FULL_OR_UPSTREAM_UNAVAILABLE: '服务器已有两条连接，或 FRP 上游暂不可用',
      ECONNRESET: '连接被中转重置，请关闭 proxyProtocolVersion',
    };
    if (protocol && advice[protocol.error]) parts.push(advice[protocol.error]);
    return parts.join(' · ');
  }

  async function connectWithDiagnosis(address, options) {
    await window.MineradioTogetherPlaybackController.prepareSession();
    await syncAccountIdentity(true);
    try { return await bridge.connect(address, options); } catch (error) {
      if (/SAME_MUSIC_ACCOUNT/.test(String(error && error.message || error))) {
        throw new Error('检测到双方使用同一账号，无法一起听。请使用不同账号登录后再试。');
      }
      try {
        var diagnosis = await bridge.diagnoseConnection(address, options);
        throw new Error(diagnosticText(diagnosis) + ' · ' + String(error && error.message || error));
      } catch (diagnosticError) {
        if (String(diagnosticError && diagnosticError.message || '').indexOf('DNS：') === 0) throw diagnosticError;
        throw error;
      }
    }
  }

  function renderStatus() {
    var status = state.status || {};
    var connected = status.connectionState === 'connected';
    statusText.textContent = connected ? '已连接' : (status.connectionState === 'reconnecting' ? '重连中' : '一起听');
    statusText.classList.toggle('online', connected);
    renderPresence();
    transitionPanelView(connected);
    if (!connected) return;
    var room = status.room || {};
    var transition = room.transition;
    var memberCount = room.members ? room.members.length : 0;
    var phaseText = room.status || 'idle';
    if (transition && transition.phase === 'awaiting-end') phaseText = '等待双方结束 ' + (transition.endedSenderIds || []).length + '/' + memberCount;
    else if (transition && transition.phase === 'preparing') phaseText = '准备下一曲 ' + (transition.readySenderIds || []).length + '/' + memberCount;
    else if (transition && transition.phase === 'go') phaseText = '同步播放';
    document.getElementById('together-room-name').textContent = room.name || '一起听服务器';
    document.getElementById('together-room-state').textContent = memberCount + '/2 · ' + phaseText;
    var transport = status.transport || {};
    var quality = document.getElementById('together-network-quality');
    quality.dataset.quality = transport.quality || 'measuring';
    quality.innerHTML = '<i></i>' + esc(transport.label || '连接线路') + (Number(transport.latencyMs) > 0 ? (' · ' + Math.round(Number(transport.latencyMs)) + 'ms') : '') + ' · ' + esc(transport.qualityLabel || '检测中');
    document.getElementById('together-members').innerHTML = (room.members || []).map(function (member) { return '<span><i></i>' + esc(member.name) + '</span>'; }).join('') || '<span>等待成员</span>';
    var track = room.queue && room.currentIndex >= 0 ? room.queue[room.currentIndex] : null;
    document.getElementById('together-now-title').textContent = track ? track.name : '等待播放第一首歌';
    document.getElementById('together-now-artist').textContent = track ? track.artist : '请使用原播放器或原播放列表开始播放';
    var duration = track ? Number(track.duration) || 0 : 0;
    var position = Math.max(0, Number(room.position) || 0);
    document.getElementById('together-room-progress-fill').style.width = (duration ? Math.min(100, position / duration * 100) : 0) + '%';
    var host = status.host;
    var isHost = status.hosting === true && !!host;
    document.getElementById('together-host-info').hidden = !isHost;
    if (isHost) {
      var address = host.connectionAddresses && host.connectionAddresses[0] || host.localAddress || '';
      document.getElementById('together-share-address').textContent = address;
      document.getElementById('together-host-port').textContent = String(host.port || '');
      document.getElementById('together-frp-hint').textContent = 'FRP: type=tcp, localPort=' + String(host.port || '');
      document.getElementById('together-host-auth-code').textContent = host.authorizationCode || '------';
    } else {
      document.getElementById('together-share-address').textContent = '';
      document.getElementById('together-host-port').textContent = '';
      document.getElementById('together-host-auth-code').textContent = '------';
    }
  }

  function renderRooms() {
    var el = document.getElementById('together-lan-list');
    el.innerHTML = state.rooms.map(function (room, index) {
      return '<button class="together-server-row" data-server-address="' + esc(room.address) + '"><span><strong>' + esc(room.name) + '</strong><small>' + esc(room.address) + '</small></span><em>在线 · ' + Math.max(0, Number(room.latencyMs) || 0) + 'ms · ' + room.members + '/2</em></button>';
    }).join('') || '<div class="together-empty">未发现局域网服务器，可使用地址直连</div>';
  }

  function renderSaved() {
    document.getElementById('together-saved-list').innerHTML = state.saved.map(function (item) {
      var probe = state.probes[item.id];
      var live = probe && probe.online;
      var status = probe ? (live ? ('在线 · ' + probe.latencyMs + 'ms') : '离线') : '检测中';
      var authorization = item.requiresAuthorization ? '需授权码' : '局域网免码';
      return '<div class="together-saved-row"><button data-saved-connect="' + esc(item.id) + '"><strong>' + esc(item.name) + '</strong><small>' + esc(item.address) + ' · ' + authorization + ' · ' + status + ' · ' + formatTime(item.lastConnectedAt) + '</small></button><button data-saved-edit="' + esc(item.id) + '" title="编辑">✎</button><button data-saved-delete="' + esc(item.id) + '" title="删除">×</button></div>';
    }).join('') || '<div class="together-empty">尚未保存服务器</div>';
  }

  async function refresh() {
    try {
      state.status = await bridge.getStatus();
      state.saved = await bridge.listSavedServers();
      state.profile = await bridge.getProfile();
      renderStatus();
      renderSaved();
      renderProfile();
      Promise.all(state.saved.map(async function (item) {
        state.probes[item.id] = await bridge.probeServer(item.address);
        renderSaved();
      })).catch(function () {});
    } catch (error) { setMessage(String(error.message || error), 'error'); }
  }

  async function run(action) {
    if (state.busy) return;
    setBusy(true); setMessage('');
    try { await action(); await refresh(); } catch (error) {
      var message = String(error && error.message || error);
      setMessage(message, 'error');
      if (typeof showToast === 'function') showToast(message);
    } finally { setBusy(false); }
  }

  function savedConnectionOptions(item) {
    var addressInput = document.getElementById('together-address');
    var authorizationInput = document.getElementById('together-auth-code');
    addressInput.value = item.address;
    var code = authorizationInput.value.trim();
    if (item.requiresAuthorization && !/^\d{6}$/.test(code)) {
      authorizationInput.focus();
      throw new Error('远程保存地址需要先输入 6 位授权码');
    }
    return { savedServerId: item.id, authorizationCode: item.requiresAuthorization ? code : '' };
  }

  mountPanel();
  entryButton.addEventListener('click', function (event) { event.stopPropagation(); togglePanel(); });
  document.getElementById('together-close').addEventListener('click', close);
  panel.addEventListener('click', function (event) { if (event.target === panel) close(); });
  document.addEventListener('click', function (event) { if (control.classList.contains('open') && !control.contains(event.target)) close(); });
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && control.classList.contains('open')) close(); });
  document.getElementById('together-create').addEventListener('click', function () { run(async function () {
    await window.MineradioTogetherPlaybackController.prepareSession();
    await syncAccountIdentity(true);
    var name = document.getElementById('together-create-name').value.trim();
    var portValue = document.getElementById('together-create-port').value.trim();
    state.status = await bridge.createRoom({ name: name, port: portValue === '' ? 0 : Number(portValue) });
  }); });
  document.getElementById('together-connect').addEventListener('click', function () { run(async function () { state.status = await connectWithDiagnosis(connectionUrlFromInputs(), connectionOptions()); }); });
  document.getElementById('together-discover').addEventListener('click', function () { run(async function () { state.rooms = await bridge.discover(); renderRooms(); }); });
  document.getElementById('together-leave').addEventListener('click', function () { run(async function () { state.status = await window.MineradioTogetherPlaybackController.exitTogetherMode({ reason: 'manual', stopHost: !!(state.status && state.status.hosting) }); }); });
  document.getElementById('together-copy').addEventListener('click', function () { var value = document.getElementById('together-share-address').textContent; bridge.copyText(value); setMessage('连接地址已复制', 'ok'); });
  document.getElementById('together-copy-code').addEventListener('click', function () { var value = document.getElementById('together-host-auth-code').textContent; bridge.copyText(value); setMessage('6 位授权码已复制', 'ok'); });
  document.getElementById('together-save-current').addEventListener('click', function () { run(async function () {
    var address = connectionUrlFromInputs();
    await bridge.saveServer({ name: savedServerName(address), address: address });
    setMessage('地址已保存', 'ok');
  }); });
  document.getElementById('together-lan-list').addEventListener('click', function (event) { var row = event.target.closest('[data-server-address]'); if (row) run(async function () { state.status = await connectWithDiagnosis(row.dataset.serverAddress, connectionOptions()); }); });
  document.getElementById('together-saved-list').addEventListener('click', function (event) {
    var idValue = event.target.closest('[data-saved-connect],[data-saved-edit],[data-saved-delete]'); if (!idValue) return;
    var id = idValue.dataset.savedConnect || idValue.dataset.savedEdit || idValue.dataset.savedDelete;
    var item = state.saved.find(function (entry) { return entry.id === id; }); if (!item) return;
    if (idValue.dataset.savedConnect) run(async function () { state.status = await connectWithDiagnosis(item.address, savedConnectionOptions(item)); });
    else if (idValue.dataset.savedEdit) run(async function () { var name = prompt('服务器名称', item.name); if (name == null) return; var address = prompt('服务器地址', item.address); if (address == null) return; await bridge.saveServer({ id: item.id, name: name, address: address, lastConnectedAt: item.lastConnectedAt, lastStatus: item.lastStatus }); });
    else run(async function () { await bridge.deleteServer(item.id); });
  });

  document.addEventListener('mineradio-together-status', function (event) { state.status = event.detail; renderStatus(); });
  document.addEventListener('mineradio-together-state', function (event) { state.status = state.status || {}; state.status.connectionState = 'connected'; state.status.room = event.detail; flushPendingExpressions(); renderStatus(); });
  document.addEventListener('mineradio-together-error', function (event) {
    var code = String(event.detail.code || 'UNKNOWN_ERROR');
    var labels = { MESSAGE_RATE_LIMIT: '发送太快，请稍后再说', MESSAGE_TOO_LONG: '文字不能超过 50 字', MESSAGE_TOO_LARGE: '本次操作数据过大，未发送到房间', EMPTY_MESSAGE: '请输入文字', SAME_MUSIC_ACCOUNT: '检测到双方使用同一账号，无法一起听。请使用不同账号登录后再试。', ACCOUNT_CHECK_UNSUPPORTED: '中转服务器不支持账号校验，请更新中转服务器后再连接。', RECONNECT_EXHAUSTED: '重连 3 次失败，已清除当前连接', STATE_PAYLOAD_TOO_LARGE: '房间数据已达到同步上限，本次操作未生效' };
    var message = labels[code] || ('联机错误：' + code);
    setMessage(message, 'error');
    if (labels[code] && typeof showToast === 'function') showToast(message);
  });
  document.getElementById('together-auth-code').addEventListener('input', function (event) { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); });
  document.getElementById('together-expression-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = document.getElementById('together-expression-input'); var text = input.value.trim();
    if (!text || !state.status || state.status.connectionState !== 'connected') return;
    run(async function () { await bridge.sendOperation('MESSAGE_SEND', { text: Array.from(text).slice(0, 50).join(''), time: Date.now() }); input.value = ''; });
  });
  document.getElementById('together-expression-toggle').addEventListener('click', function (event) {
    event.preventDefault();
    expressionChatExpanded = !expressionChatExpanded;
    var controls = document.querySelector('.together-expression-controls');
    var button = event.currentTarget;
    controls.classList.toggle('is-collapsed', !expressionChatExpanded);
    button.textContent = expressionChatExpanded ? '∧' : '∨';
    button.title = expressionChatExpanded ? '收起聊天输入' : '展开聊天输入';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(expressionChatExpanded));
    if (expressionChatExpanded) document.getElementById('together-expression-input').focus();
  });
  bridge.onEvent(function (event) {
    if (!event || event.kind !== 'message') return;
    var message = event;
    applyIncomingMessage(message);
    if (state.status && message.userId && message.userId !== state.status.clientId) playMessageTone();
  });
  // Poll host display state; account endpoint requests have a separate cache and timeout.
  var accountTimer = setInterval(function () {
    syncAccountIdentity().then(syncAccountProfile).catch(function (error) { setMessage('账号关联失败：' + String(error.message || error), 'error'); });
  }, 1500);
  window.addEventListener('pagehide', function () { accountSyncClosed = true; clearInterval(accountTimer); accountApiControllers.forEach(function (controller) { controller.abort(); }); }, { once: true });
  refresh().then(syncAccountProfile).catch(function (error) { setMessage('账号关联失败：' + String(error.message || error), 'error'); });
})();
