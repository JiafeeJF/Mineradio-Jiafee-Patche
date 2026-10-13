// ============================================================
//  Jiafee CoPlay v2 — Simplified UI Panel
//  ------------------------------------------------------------
//  Three operations only:
//    1. Create room (generates 4-digit code, LAN discoverable)
//    2. LAN room list (click to join)
//    3. Manual join (room code or IP:port)
//  Always equal control — no host_only / toggle modes.
// ============================================================
(function () {
  'use strict';
  if (window.__JIAFEE_COPLAY2_UI__) return;
  window.__JIAFEE_COPLAY2_UI__ = true;

  var api = window.jiafeeCoPlayV2;
  if (!api) {
    console.warn('[CoPlay2-UI] core runtime missing, skipping UI');
    return;
  }

  function $id(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function isWebBuild() { return !/Electron/i.test(navigator.userAgent || ''); }

  var ICON = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>'
    + '<circle cx="9" cy="7" r="4"/>'
    + '<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>'
    + '<path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  var PANEL_HTML = ''
    + '<button id="coplay2-btn" class="ctrl-btn" title="双人一起听" type="button">' + ICON + '<span id="coplay2-dot" class="coplay2-dot" aria-hidden="true"></span></button>'
    + '<div id="coplay2-popover" class="quality-popover coplay2-popover" onclick="event.stopPropagation()">'
      + '<div class="coplay2-head">'
        + '<span class="coplay2-title">一起听</span>'
        + '<span id="coplay2-status-pill" class="coplay2-status-pill">未连接</span>'
      + '</div>'
      + '<div class="coplay2-pane-stack">'
        + '<div class="coplay2-section">'
          + '<button id="coplay2-create" type="button" class="coplay2-btn primary" style="width:100%">创建房间</button>'
          + '<div id="coplay2-room-code" class="coplay2-host-info" style="display:none">'
            + '<div class="coplay2-host-line"><span class="k">房间码</span><span class="v code" id="coplay2-code-value">----</span></div>'
            + '<div class="coplay2-host-tip">分享给好友，好友在「手动加入」输入房间码即可加入</div>'
          + '</div>'
        + '</div>'
        + '<div class="coplay2-section">'
          + '<div class="coplay2-section-head"><span>局域网房间</span><button id="coplay2-refresh" type="button" class="coplay2-text-btn">刷新</button></div>'
          + '<div id="coplay2-lan-list" class="coplay2-lan-list"><div class="coplay2-empty">扫描中…</div></div>'
        + '</div>'
        + '<div class="coplay2-section">'
          + '<div class="coplay2-section-head"><span>手动加入</span></div>'
          + '<div class="coplay2-manual-grid">'
            + '<input id="coplay2-manual" type="text" spellcheck="false" autocomplete="off" placeholder="4位房间码 或 IP:端口">'
            + '<button id="coplay2-join" type="button" class="coplay2-btn primary">加入</button>'
          + '</div>'
        + '</div>'
        + '<div id="coplay2-session" class="coplay2-session" style="display:none">'
          + '<div class="coplay2-session-card">'
            + '<div class="coplay2-session-row"><span class="coplay2-session-label">已连接</span><strong id="coplay2-peer-name">--</strong></div>'
            + '<div class="coplay2-session-row"><span class="coplay2-session-label">正在播放</span><span id="coplay2-session-track">--</span></div>'
          + '</div>'
          + '<button id="coplay2-session-leave" type="button" class="coplay2-btn danger" style="width:100%;margin-top:8px">断开连接</button>'
        + '</div>'
      + '</div>'
    + '</div>';

  var host = null, popover = null, lanList = null, statusPill = null;
  var refreshTimer = null;

  // ==================================================================
  //  Mount
  // ==================================================================
  function ensureUi() {
    if ($id('coplay2-control')) return true;
    if (!document.body) return false;

    var mountMode = isWebBuild() ? 'float' : 'titlebar';
    var anchor = null;
    if (isWebBuild()) {
      anchor = document.body;
    } else {
      var tb = $id('desktop-titlebar');
      var wc = tb && tb.querySelector('.desktop-window-controls');
      anchor = wc || tb || ($id('next-btn') || document.body);
    }
    host = el('div', 'coplay2-control mount-' + mountMode, PANEL_HTML);
    host.id = 'coplay2-control';
    host.style.zIndex = '10000';
    popover = host.querySelector('#coplay2-popover');
    lanList = host.querySelector('#coplay2-lan-list');
    if (isWebBuild()) {
      document.body.appendChild(host);
    } else if (anchor && anchor.classList && anchor.classList.contains('desktop-window-controls')) {
      var diy = anchor.querySelector('#diy-mode-btn') || anchor.querySelector('.desktop-mode-btn');
      if (diy && diy.parentNode) diy.parentNode.insertBefore(host, diy);
      else anchor.appendChild(host);
    } else if (anchor && anchor.nextSibling) {
      anchor.parentNode.insertBefore(host, anchor.nextSibling);
    } else if (anchor) {
      anchor.parentNode.appendChild(host);
    }
    statusPill = host.querySelector('#coplay2-status-pill');
    wireUi();
    wireCoreEvents();
    refreshFromCore();
    return true;
  }

  // ==================================================================
  //  UI wiring
  // ==================================================================
  function wireUi() {
    var btn = host.querySelector('#coplay2-btn');
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var open = !host.classList.contains('open');
      host.classList.toggle('open', open);
      if (open) {
        positionPopover();
        if (popover) popover.getAnimations().forEach(function (a) { a.cancel(); });
      }
    });
    host.style.pointerEvents = 'auto';
    btn.style.pointerEvents = 'auto';
    document.addEventListener('click', function (ev) { if (host.classList.contains('open') && !host.contains(ev.target)) host.classList.remove('open'); });
    window.addEventListener('resize', function () { if (host.classList.contains('open')) positionPopover(); });

    // Create room
    $id('coplay2-create').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = '创建中…';
      api.createRoom().then(function (r) {
        btn.style.display = 'none';
        btn.disabled = false;
        if (r && r.code) {
          $id('coplay2-code-value').textContent = r.code;
          $id('coplay2-room-code').style.display = '';
        }
        refreshFromCore();
        toast('房间已创建，码: ' + r.code);
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = '创建房间';
        toast('创建失败: ' + (err && err.message || err));
      });
    });

    // Manual join
    var manual = $id('coplay2-manual');
    try { manual.value = localStorage.getItem('mineradio.coplay2.manual') || ''; } catch(_) {}
    manual.addEventListener('change', function () { try { localStorage.setItem('mineradio.coplay2.manual', manual.value.trim()); } catch(_) {} });
    manual.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') onJoin(); });
    $id('coplay2-join').addEventListener('click', onJoin);

    // LAN refresh
    $id('coplay2-refresh').addEventListener('click', function () { api.refreshLanDevices().then(renderLan); toast('已刷新'); });

    // Disconnect
    $id('coplay2-session-leave').addEventListener('click', function () { api.leave(); });

    startPolling();
  }

  // ==================================================================
  //  Core event wiring
  // ==================================================================
  function wireCoreEvents() {
    api.on('status', function (d) { refreshFromCore(); });
    api.on('lan:update', function (d) { renderLan(d); });
    api.on('lan:error', function (d) { if (d && d.msg) toast(d.msg); });
    api.on('sig:error', function (msg) { if (msg && msg.msg) toast(msg.msg); });
    api.on('dc:open', function () { toast('已连接'); refreshFromCore(); });
    api.on('dc:close', function () { toast('连接断开'); refreshFromCore(); });
    api.on('peer:joined', function () { toast('好友已加入'); refreshFromCore(); });
    api.on('peer:left', function () { toast('好友已离开'); refreshFromCore(); });
    api.on('host:left', function () { toast('房主已离开'); refreshFromCore(); });
    api.on('host:disconnected', function () { toast('房主暂时离开，等待重连…'); refreshFromCore(); });
    api.on('room:resumed', function () { toast('房主已恢复连接'); refreshFromCore(); });
  }

  // ==================================================================
  //  Join handler
  // ==================================================================
  function onJoin() {
    var raw = $id('coplay2-manual').value.trim();
    if (!raw) { toast('请输入房间码或地址'); return; }
    var code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (/^[A-Z0-9]{4}$/.test(code)) {
      api.joinRoom(code).then(function () { toast('已加入房间'); }).catch(function (err) { toast('加入失败: ' + (err && err.message || err)); });
    } else {
      api.connectDirect(raw).then(function () { toast('正在直连 ' + raw); }).catch(function (err) { toast('直连失败: ' + (err && err.message || err)); });
    }
  }

  // ==================================================================
  //  Refresh from core state
  // ==================================================================
  function refreshFromCore() {
    var s = api.getStatus();
    if (!s) return;

    // Status pill
    if (statusPill) {
      statusPill.className = 'coplay2-status-pill';
      if (s.connected) {
        statusPill.textContent = '已连接';
        statusPill.classList.add('status-connected');
      } else if (s.role === 'host') {
        statusPill.textContent = '等待加入';
        statusPill.classList.add('status-waiting');
      } else if (s.role === 'guest') {
        statusPill.textContent = '连接中';
        statusPill.classList.add('status-connecting');
      } else {
        statusPill.textContent = '未连接';
        statusPill.classList.add('status-idle');
      }
    }

    // Create room area: show button when idle, show code when hosting
    var createBtn = $id('coplay2-create');
    var codeDisplay = $id('coplay2-room-code');
    if (createBtn) createBtn.style.display = (s.role === 'host' || s.connected) ? 'none' : '';
    if (codeDisplay) codeDisplay.style.display = (s.role === 'host' && !s.connected) ? '' : 'none';
    if (s.role === 'host' && s.code && host.querySelector('#coplay2-code-value')) {
      host.querySelector('#coplay2-code-value').textContent = s.code;
    }

    // Session view
    var session = $id('coplay2-session');
    if (session) session.style.display = (s.connected || s.role) ? '' : 'none';
    var peerName = $id('coplay2-peer-name');
    if (peerName) {
      var name = s.peer ? (s.peer.name || '--') : (s.connected ? '对方' : '等待连接');
      peerName.textContent = name;
    }
    var trackEl = $id('coplay2-session-track');
    if (trackEl) {
      var track = s.peerTrack || {};
      trackEl.textContent = (track.name || '--') + (track.artist ? ' — ' + track.artist : '');
    }

    // Dot
    var dot = $id('coplay2-dot');
    if (dot) {
      dot.className = 'coplay2-dot';
      if (s.connected) dot.classList.add('status-connected');
      else if (s.role) dot.classList.add('status-connecting');
    }
  }

  // ==================================================================
  //  LAN list render
  // ==================================================================
  function renderLan(data) {
    if (!lanList) return;
    if (!data) {
      try { data = api.getStatus(); } catch(_) {}
      if (!data) return;
    }
    var peers = (data.peers || data.lanDevices || []);
    var self = data.self || data.lanSelf || null;
    var s = api.getStatus();
    if (!peers.length) {
      lanList.innerHTML = '<div class="coplay2-empty">未发现其他房间</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i];
      if (!p) continue;
      // Skip self entry
      if (self && p.id === self.id) continue;
      // Only show rooms that are actually hosting (mode === 'host')
      var mode = p.mode || 'idle';
      var name = esc(p.name || '未知设备');
      var ip = esc(p.ip || '');
      var port = p.port || 3000;
      var code = p.inviteCode ? esc(p.inviteCode) : '';
      var sub = ip + ':' + port + (code ? ' 码:' + code : '');
      // Build a capturable closure for the click handler
      html += '<button type="button" class="coplay2-lan-item" data-lanpeer="' + i + '">'
        + '<span class="coplay2-lan-name">' + name + '</span>'
        + '<span class="coplay2-lan-sub">' + sub + '</span>'
        + '</button>';
    }
    if (!html) {
      lanList.innerHTML = '<div class="coplay2-empty">未发现其他房间</div>';
      return;
    }
    lanList.innerHTML = html;
    lanList.querySelectorAll('.coplay2-lan-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(this.getAttribute('data-lanpeer'), 10);
        if (isNaN(idx) || idx < 0 || idx >= peers.length) return;
        var peer = peers[idx];
        if (!peer) return;
        toast('正在连接 ' + (peer.name || peer.ip || '设备'));
        api.connectLanPeer(peer).then(function () {
          toast('已连接');
        }).catch(function (err) {
          toast('连接失败: ' + (err && err.message || err));
        });
      });
    });
  }

  // ==================================================================
  //  Polling
  // ==================================================================
  function startPolling() {
    if (refreshTimer) return;
    refreshTimer = setInterval(function () {
      api.refreshLanDevices().then(renderLan);
    }, 6000);
    api.refreshLanDevices().then(renderLan);
  }

  // ==================================================================
  //  Popover positioning
  // ==================================================================
  function positionPopover() {
    if (!host || !popover) return;
    var btn = host.querySelector('#coplay2-btn');
    if (!btn) return;
    var rect = btn.getBoundingClientRect();
    var panelW = popover.offsetWidth || 420;
    var panelH = popover.offsetHeight || 520;
    if (host.classList.contains('mount-float')) {
      popover.style.position = 'fixed';
      var left = Math.max(10, window.innerWidth - panelW - 18);
      var top = Math.max(10, window.innerHeight - panelH - 74);
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
      popover.style.right = 'auto';
      popover.style.bottom = 'auto';
      return;
    }
    popover.style.position = 'fixed';
    popover.style.right = Math.max(4, window.innerWidth - rect.right) + 'px';
    var top = Math.max(4, rect.bottom + 8);
    if (top + panelH > window.innerHeight - 4) top = Math.max(4, window.innerHeight - panelH - 4);
    popover.style.top = top + 'px';
    popover.style.left = 'auto';
    popover.style.bottom = 'auto';
  }

  // ==================================================================
  //  Toast
  // ==================================================================
  function toast(text) {
    var existing = document.querySelector('.coplay2-toast');
    if (existing) { existing.classList.add('out'); setTimeout(function () { if (existing && existing.parentNode) existing.parentNode.removeChild(existing); }, 350); }
    var t = el('div', 'coplay2-toast', esc(text));
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350); }, 3000);
  }

  // ==================================================================
  //  Boot
  // ==================================================================
  function boot() { if (!ensureUi()) { var retries = 0; var t = setInterval(function () { retries++; if (ensureUi() || retries > 60) clearInterval(t); }, 300); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();