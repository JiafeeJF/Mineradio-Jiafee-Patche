// ============================================================
//  Jiafee Sound Effect Runtime (v2.0.x port)
//  ------------------------------------------------------------
//  Adds a sound-effect popover to the bottom control strip plus
//  a 10-band graphic EQ that can take over the pipeline. All logic
//  lives in this module so index.html + audio-graph-controls.js
//  from upstream stay unmodified; the FX rack is inserted lazily
//  by patching gainNode -> destination into
//    gainNode -> MineradioFX.input, MineradioFX.output -> destination.
// ============================================================
var SOUND_EFFECT_STATE = { loaded: false, loading: false, list: [], source: '', activeId: null };
var SOUND_EFFECT_STORE_KEY = 'mineradio.soundEffect.selected';

var USER_EQ_BANDS = [
  { freq: 31,    label: '31'   },
  { freq: 63,    label: '63'   },
  { freq: 125,   label: '125'  },
  { freq: 250,   label: '250'  },
  { freq: 500,   label: '500'  },
  { freq: 1000,  label: '1k'   },
  { freq: 2000,  label: '2k'   },
  { freq: 4000,  label: '4k'   },
  { freq: 8000,  label: '8k'   },
  { freq: 16000, label: '16k'  }
];
var USER_EQ_STORE_KEY = 'mineradio.userEq.v1';
var USER_EQ_STATE = { enabled: false, gains: null };

var SE_CATEGORY_META = {
  signature: { label: '招牌', cls: 'cat-signature' },
  spatial:   { label: '空间', cls: 'cat-spatial'   },
  tone:      { label: '音色', cls: 'cat-tone'      },
  vintage:   { label: '复古', cls: 'cat-vintage'   }
};

var mineradioFx = null;
var mineradioFxAttached = false;
var mineradioFxLastGain = null;

try {
  var savedSe = localStorage.getItem(SOUND_EFFECT_STORE_KEY);
  if (savedSe) SOUND_EFFECT_STATE.activeId = String(savedSe);
} catch (e) {}

function makeZeroGains() { return USER_EQ_BANDS.map(function(){ return 0; }); }
function sanitizeGains(arr) {
  if (!Array.isArray(arr) || arr.length !== USER_EQ_BANDS.length) return null;
  return arr.map(function(v){ return Math.max(-12, Math.min(12, Number(v) || 0)); });
}
function loadUserEqState() {
  try {
    var raw = localStorage.getItem(USER_EQ_STORE_KEY);
    if (!raw) return;
    var data = JSON.parse(raw);
    var g = data && sanitizeGains(data.gains);
    if (g) USER_EQ_STATE.gains = g;
    if (data && typeof data.enabled === 'boolean') USER_EQ_STATE.enabled = data.enabled;
  } catch (e) { /* noop */ }
}
function persistUserEqState() {
  try {
    localStorage.setItem(USER_EQ_STORE_KEY, JSON.stringify({
      enabled: !!USER_EQ_STATE.enabled,
      gains: USER_EQ_STATE.gains || makeZeroGains()
    }));
  } catch (e) { /* noop */ }
}
function userEqHasEffect() { return !!USER_EQ_STATE.enabled; }
function userEqCurveIsFlat() {
  if (!USER_EQ_STATE.gains) return true;
  return !USER_EQ_STATE.gains.some(function(v){ return Math.abs(v) > 0.05; });
}
function buildEqBandsFromUser() {
  var gains = USER_EQ_STATE.gains;
  if (!gains) return [];
  var bands = [];
  for (var i = 0; i < USER_EQ_BANDS.length; i++) {
    var g = Number(gains[i]) || 0;
    if (Math.abs(g) <= 0.05) continue;
    var band = { type: 'peaking', freq: USER_EQ_BANDS[i].freq, gainDb: g, Q: 1.4 };
    if (i === 0) { band.type = 'lowshelf'; delete band.Q; }
    else if (i === USER_EQ_BANDS.length - 1) { band.type = 'highshelf'; delete band.Q; }
    bands.push(band);
  }
  return bands;
}
function buildUserEqPreset() {
  var gains = USER_EQ_STATE.gains || makeZeroGains();
  var sig = gains.map(function(v){ return (Math.round(Number(v) * 10) / 10).toFixed(1); }).join(',');
  return {
    id: 'user-eq:' + sig,
    name: '自定义均衡器',
    category: 'signature',
    eq: buildEqBandsFromUser(),
    output: { trimDb: -1.0 }
  };
}
loadUserEqState();
if (!USER_EQ_STATE.gains) USER_EQ_STATE.gains = makeZeroGains();

function escapeHtmlSafe(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ------- Sound-effect popover UI + list loading -------
function toggleSoundEffectPanel(e) {
  if (e) e.stopPropagation();
  var wrap = document.getElementById('sound-effect-control');
  if (!wrap) return;
  var opened = wrap.classList.toggle('open');
  if (opened && !SOUND_EFFECT_STATE.loaded && !SOUND_EFFECT_STATE.loading) loadSoundEffectList();
}

// v2.0.1 server has no /api/sound-effect/list route; the presets ship as a
// static JSON next to index.html. Fetching the plain file lets the runtime
// module stay purely front-end.
function loadSoundEffectList() {
  SOUND_EFFECT_STATE.loading = true;
  renderSoundEffectList();
  fetch('fx-presets.json', { cache: 'no-cache' }).then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(list){
    SOUND_EFFECT_STATE.loading = false;
    SOUND_EFFECT_STATE.loaded = true;
    SOUND_EFFECT_STATE.list = Array.isArray(list) ? list : [];
    SOUND_EFFECT_STATE.source = 'mineradio';
    if (SOUND_EFFECT_STATE.activeId && !SOUND_EFFECT_STATE.list.some(function(x){ return String(x.id) === String(SOUND_EFFECT_STATE.activeId); })) {
      var fallback = SOUND_EFFECT_STATE.list.find(function(x){ return x && x.bypass === true; }) || SOUND_EFFECT_STATE.list[0];
      SOUND_EFFECT_STATE.activeId = fallback ? String(fallback.id || '') : null;
      try {
        if (SOUND_EFFECT_STATE.activeId) localStorage.setItem(SOUND_EFFECT_STORE_KEY, SOUND_EFFECT_STATE.activeId);
        else localStorage.removeItem(SOUND_EFFECT_STORE_KEY);
      } catch (e) {}
    }
    renderSoundEffectList();
    syncSoundEffectButtonLabel();
    applyPendingSoundEffect();
  }).catch(function(err){
    SOUND_EFFECT_STATE.loading = false;
    SOUND_EFFECT_STATE.loaded = true;
    SOUND_EFFECT_STATE.list = [];
    SOUND_EFFECT_STATE.source = 'error';
    console.warn('[SoundEffect] load failed', err);
    renderSoundEffectList();
  });
}

function renderSoundEffectList() {
  var host = document.getElementById('sound-effect-list');
  var srcEl = document.getElementById('sound-effect-source');
  if (!host) return;
  if (srcEl) srcEl.textContent = SOUND_EFFECT_STATE.source === 'error' ? '离线' : 'Jiafee 自制';
  if (SOUND_EFFECT_STATE.loading) {
    host.innerHTML = '<div class="sound-effect-empty">加载中…</div>';
    return;
  }
  var list = SOUND_EFFECT_STATE.list || [];
  if (!list.length) {
    host.innerHTML = '<div class="sound-effect-empty">暂无音效数据</div>';
    return;
  }
  var activeId = SOUND_EFFECT_STATE.activeId;
  var html = list.map(function(item){
    var id = String(item.id || '');
    var cat = String(item.category || 'signature').toLowerCase();
    var catMeta = SE_CATEGORY_META[cat] || SE_CATEGORY_META.signature;
    var active = id && id === activeId;
    var classes = ['sound-effect-item'];
    if (active) classes.push('active');
    var title = escapeHtmlSafe(item.name || '未命名');
    var sub = escapeHtmlSafe(item.tagline || '');
    return '<button type="button" class="' + classes.join(' ') + '" data-id="' + escapeHtmlSafe(id) + '">'
      + '<span class="se-main">'
        + '<span class="se-title">' + title + '</span>'
        + (sub ? '<span class="se-sub">' + sub + '</span>' : '')
      + '</span>'
      + '<span class="se-tag ' + catMeta.cls + '">' + catMeta.label + '</span>'
    + '</button>';
  }).join('');
  host.innerHTML = html;
  Array.prototype.forEach.call(host.querySelectorAll('.sound-effect-item'), function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-id') || '';
      selectSoundEffect(id);
    });
  });
}

function selectSoundEffect(id) {
  var stringId = String(id || '');
  var item = (SOUND_EFFECT_STATE.list || []).find(function(x){ return String(x.id) === stringId; });
  if (!item) return;
  SOUND_EFFECT_STATE.activeId = stringId;
  try { localStorage.setItem(SOUND_EFFECT_STORE_KEY, stringId); } catch (e) {}
  if (userEqHasEffect()) {
    USER_EQ_STATE.enabled = false;
    persistUserEqState();
    if (typeof updateUserEqToolbar === 'function') updateUserEqToolbar();
    if (typeof updateSoundEffectEqBadge === 'function') updateSoundEffectEqBadge();
  }
  renderSoundEffectList();
  syncSoundEffectButtonLabel(item);
  applyPresetToFx(item);
  if (typeof showToast === 'function') showToast('已切换 · ' + (item.name || '音效'));
}

function syncSoundEffectButtonLabel(item) {
  var label = document.getElementById('sound-effect-btn-label');
  if (!label) return;
  if (typeof userEqHasEffect === 'function' && userEqHasEffect()) { label.textContent = 'EQ'; return; }
  if (!item) {
    var id = SOUND_EFFECT_STATE.activeId;
    if (id) item = (SOUND_EFFECT_STATE.list || []).find(function(x){ return String(x.id) === String(id); });
  }
  if (item) label.textContent = String(item.shortName || item.name || '音效').slice(0, 2);
  else label.textContent = '音效';
}

// ------- FX rack apply / bypass / debounced reapply -------
function isFxPipelineReady() {
  return !!(mineradioFx && mineradioFxAttached && typeof audioReady !== 'undefined' && audioReady);
}
function applyPresetToFx(preset) {
  if (!preset) return;
  if (!isFxPipelineReady()) return;
  try {
    if (userEqHasEffect()) { mineradioFx.applyPreset(buildUserEqPreset()); return; }
    if (preset.bypass === true || preset.id === 'bypass') mineradioFx.bypass();
    else mineradioFx.applyPreset(preset);
  } catch (err) { console.warn('[FX] apply preset failed', err); }
}

var USER_EQ_APPLY_TIMER = null;
function scheduleFxReapply(delayMs) {
  if (USER_EQ_APPLY_TIMER) { clearTimeout(USER_EQ_APPLY_TIMER); USER_EQ_APPLY_TIMER = null; }
  var wait = typeof delayMs === 'number' ? delayMs : 90;
  USER_EQ_APPLY_TIMER = setTimeout(function(){
    USER_EQ_APPLY_TIMER = null;
    doFxReapply();
  }, wait);
}
function doFxReapply() {
  if (!isFxPipelineReady()) return;
  if (userEqHasEffect()) {
    try { mineradioFx.applyPreset(buildUserEqPreset()); } catch (err) { console.warn('[FX] apply eq failed', err); }
    return;
  }
  var id = SOUND_EFFECT_STATE.activeId;
  var list = SOUND_EFFECT_STATE.list || [];
  var preset = id ? list.find(function(x){ return String(x.id) === String(id); }) : null;
  if (!preset) preset = list.find(function(x){ return x && x.bypass === true; });
  if (!preset && list.length) preset = list[0];
  if (!preset) { try { mineradioFx.bypass(); } catch (_) {} return; }
  try {
    if (preset.bypass === true || preset.id === 'bypass') mineradioFx.bypass();
    else mineradioFx.applyPreset(preset);
  } catch (err) { console.warn('[FX] apply preset failed', err); }
}
function reapplyCurrentPresetToFx() { doFxReapply(); }

function applyPendingSoundEffect() {
  if (!isFxPipelineReady()) return;
  var list = SOUND_EFFECT_STATE.list || [];
  if (!list.length) return;
  if (userEqHasEffect()) {
    try { mineradioFx.applyPreset(buildUserEqPreset()); } catch (err) { console.warn('[FX] apply eq failed', err); }
    return;
  }
  var id = SOUND_EFFECT_STATE.activeId;
  var preset = id ? list.find(function(x){ return String(x.id) === String(id); }) : null;
  if (!preset) {
    preset = list.find(function(x){ return x && x.bypass === true; }) || list[0];
    SOUND_EFFECT_STATE.activeId = preset ? String(preset.id || '') : null;
    try {
      if (SOUND_EFFECT_STATE.activeId) localStorage.setItem(SOUND_EFFECT_STORE_KEY, SOUND_EFFECT_STATE.activeId);
      else localStorage.removeItem(SOUND_EFFECT_STORE_KEY);
    } catch (e) {}
    syncSoundEffectButtonLabel(preset);
    renderSoundEffectList();
  }
  if (!preset) return;
  syncSoundEffectButtonLabel(preset);
  applyPresetToFx(preset);
}

// ------- Graphic EQ grid + auto-save toolbar -------
function formatEqValue(g) {
  var v = Number(g) || 0;
  if (Math.abs(v) < 0.05) return '0';
  var s = v > 0 ? '+' : '';
  return s + v.toFixed(1);
}
function buildUserEqBandDom(idx, band) {
  var g = USER_EQ_STATE.gains ? USER_EQ_STATE.gains[idx] : 0;
  var wrap = document.createElement('div');
  wrap.className = 'usereq-band' + (Math.abs(g) > 0.05 ? ' touched' : '');
  wrap.setAttribute('data-idx', String(idx));
  wrap.innerHTML = '<div class="usereq-slider-wrap">'
    + '<input type="range" class="usereq-slider" min="-12" max="12" step="0.5" value="' + Number(g).toFixed(1) + '" aria-label="' + band.label + ' Hz">'
    + '</div>'
    + '<span class="usereq-band-label">' + band.label + '</span>'
    + '<span class="usereq-band-value">' + formatEqValue(g) + '</span>';
  var input = wrap.querySelector('input');
  input.addEventListener('input', function(){ onUserEqSlider(idx, Number(input.value)); });
  input.addEventListener('dblclick', function(){ onUserEqSlider(idx, 0); input.value = '0'; });
  return wrap;
}
function renderUserEqGrid() {
  var host = document.getElementById('usereq-grid');
  if (!host) return;
  host.innerHTML = '';
  var scale = document.createElement('div');
  scale.className = 'usereq-scale';
  scale.innerHTML = '<span>+12dB</span><span>0dB</span><span>-12dB</span>';
  host.appendChild(scale);
  USER_EQ_BANDS.forEach(function(band, idx){
    host.appendChild(buildUserEqBandDom(idx, band));
  });
}
var USER_EQ_PERSIST_TIMER = null;
function schedulePersistUserEq() {
  if (USER_EQ_PERSIST_TIMER) clearTimeout(USER_EQ_PERSIST_TIMER);
  USER_EQ_PERSIST_TIMER = setTimeout(function(){
    USER_EQ_PERSIST_TIMER = null;
    persistUserEqState();
    if (typeof updateUserEqToolbar === 'function') updateUserEqToolbar(true);
  }, 240);
}
function onUserEqSlider(idx, value) {
  if (!USER_EQ_STATE.gains) USER_EQ_STATE.gains = makeZeroGains();
  var v = Math.max(-12, Math.min(12, Number(value) || 0));
  USER_EQ_STATE.gains[idx] = v;
  var host = document.getElementById('usereq-grid');
  if (host) {
    var band = host.querySelector('[data-idx="' + idx + '"]');
    if (band) {
      band.classList.toggle('touched', Math.abs(v) > 0.05);
      var valEl = band.querySelector('.usereq-band-value');
      if (valEl) valEl.textContent = formatEqValue(v);
    }
  }
  schedulePersistUserEq();
  updateUserEqToolbar();
  updateSoundEffectEqBadge();
  scheduleFxReapply(90);
}
var USER_EQ_STATUS_TIMER = null;
function updateUserEqToolbar(justSaved) {
  var status = document.getElementById('usereq-status');
  if (!status) return;
  if (justSaved) {
    status.textContent = '已保存';
    if (USER_EQ_STATUS_TIMER) clearTimeout(USER_EQ_STATUS_TIMER);
    USER_EQ_STATUS_TIMER = setTimeout(function(){
      var s = document.getElementById('usereq-status');
      if (s) s.textContent = '调节自动保存';
    }, 900);
  } else if (!status.textContent) {
    status.textContent = '调节自动保存';
  }
}
function onUserEqResetClick() {
  USER_EQ_STATE.gains = makeZeroGains();
  persistUserEqState();
  renderUserEqGrid();
  updateUserEqToolbar();
  updateSoundEffectEqBadge();
  scheduleFxReapply(0);
}
function toggleUserEqEnabled() {
  var next = !USER_EQ_STATE.enabled;
  USER_EQ_STATE.enabled = next;
  persistUserEqState();
  updateUserEqToolbar();
  updateSoundEffectEqBadge();
  if (next) {
    if (SOUND_EFFECT_STATE.activeId) {
      SOUND_EFFECT_STATE.activeId = null;
      try { localStorage.removeItem(SOUND_EFFECT_STORE_KEY); } catch (_) {}
      renderSoundEffectList();
    }
    scheduleFxReapply(0);
    if (typeof showToast === 'function') showToast('自定义均衡器已开启');
  } else {
    var list = SOUND_EFFECT_STATE.list || [];
    var fallback = null;
    if (list.length) fallback = list.find(function(x){ return x && x.bypass === true; }) || list[0];
    if (fallback) {
      SOUND_EFFECT_STATE.activeId = String(fallback.id || '');
      try { localStorage.setItem(SOUND_EFFECT_STORE_KEY, SOUND_EFFECT_STATE.activeId); } catch (_) {}
      renderSoundEffectList();
      syncSoundEffectButtonLabel(fallback);
    }
    scheduleFxReapply(0);
    if (typeof showToast === 'function') showToast('已切回内置音效');
  }
}
function updateSoundEffectEqBadge() {
  var state = document.getElementById('se-eq-state');
  var sw = document.getElementById('se-eq-switch');
  var block = document.getElementById('se-eq-block');
  var enabled = !!USER_EQ_STATE.enabled;
  if (state) {
    state.textContent = enabled ? '开启' : '关闭';
    state.classList.toggle('on', enabled);
  }
  if (sw) sw.setAttribute('aria-checked', enabled ? 'true' : 'false');
  if (block) block.classList.toggle('on', enabled);
  var wrap = block ? block.querySelector('.se-eq-body-wrap') : null;
  if (wrap) wrap.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  syncSoundEffectButtonLabel();
}
function onUserEqHeadClick(evt) {
  if (!evt) return;
  var t = evt.target;
  if (t && (t.closest && t.closest('.usereq-switch'))) return;
  toggleUserEqEnabled();
}

// ------- Audio graph hook: patch gainNode -> destination into
//         gainNode -> MineradioFX.input, MineradioFX.output -> destination.
//         We do this idempotently every time we see audioCtx/gainNode
//         change (v2.0.1's audio-graph-controls.js can rebuild the graph
//         for track switches, capture fallback, or context recovery). -------
function attachMineradioFxToGraph() {
  if (typeof audioCtx === 'undefined' || !audioCtx) return false;
  if (typeof gainNode === 'undefined' || !gainNode) return false;
  if (typeof audioReady === 'undefined' || !audioReady) return false;
  if (typeof window.MineradioFX !== 'function') return false;
  if (mineradioFx && mineradioFxAttached && mineradioFxLastGain === gainNode && mineradioFx.ctx === audioCtx) return true;
  // Dispose any old rack tied to a stale context/gainNode before re-wiring.
  if (mineradioFx) {
    try { mineradioFx.dispose(); } catch (e) {}
    mineradioFx = null;
    mineradioFxAttached = false;
  }
  try {
    mineradioFx = new window.MineradioFX(audioCtx);
    // Break the default gainNode -> destination direct connect that v2.0.1
    // established, then splice the FX rack in place.
    try { gainNode.disconnect(); } catch (_) {}
    gainNode.connect(mineradioFx.input);
    mineradioFx.output.connect(audioCtx.destination);
    mineradioFxAttached = true;
    mineradioFxLastGain = gainNode;
    return true;
  } catch (err) {
    console.warn('[FX] rack attach failed, falling back to direct output', err);
    mineradioFx = null;
    mineradioFxAttached = false;
    mineradioFxLastGain = null;
    // Restore the direct route so audio still plays without FX.
    try { gainNode.connect(audioCtx.destination); } catch (_) {}
    return false;
  }
}

// Wrap the upstream initAudio so we always splice the FX rack back in
// whenever the audio graph is rebuilt.
function patchInitAudioForSoundEffect() {
  if (typeof window.initAudio !== 'function' || window.initAudio.__mineradioFxWrapped) return;
  var originalInitAudio = window.initAudio;
  var wrapped = function () {
    var result = originalInitAudio.apply(this, arguments);
    try {
      if (attachMineradioFxToGraph()) applyPendingSoundEffect();
    } catch (err) { console.warn('[FX] post-init attach failed', err); }
    return result;
  };
  wrapped.__mineradioFxWrapped = true;
  window.initAudio = wrapped;
  // Also expose the local reference so callers inside the same closure keep
  // the wrapped version. v2.0.1 calls initAudio() directly, so this is enough
  // for the entry points to route through us.
  try { initAudio = wrapped; } catch (_) { /* eslint-disable-line */ }
}

// ------- Bottom-strip UI + EQ popover injection -------
function ensureSoundEffectControlDom() {
  if (document.getElementById('sound-effect-control')) return true;
  // Anchor next to the like/collect buttons instead of the quality pill that
  // lives inside #control-title. Sharing #control-title with the quality
  // popover makes the hover regions overlap and lets clicks on the sound-effect
  // button bubble into the "open song detail" handler on the title.
  var anchor = document.getElementById('collect-btn')
    || document.getElementById('heart-btn')
    || document.getElementById('quality-control');
  if (!anchor || !anchor.parentNode) return false;
  var host = document.createElement('div');
  host.id = 'sound-effect-control';
  // Piggyback on `.quality-control` so the v2.0.1 CSS visibility rules
  // (.quality-control.open .quality-popover -> opacity 1, pointer-events auto)
  // pick up the popover for free. We DO NOT add `.control-quality-chip` here,
  // because that class is sized (15px) for the inline pill inside the song
  // title; standalone in the collect cluster we want a normal ctrl-btn size.
  host.className = 'sound-effect-control quality-control';
  host.innerHTML = ''
    + '<button id="sound-effect-btn" class="ctrl-btn" onclick="toggleSoundEffectPanel(event)" title="音效">'
      + '<span id="sound-effect-btn-label">音效</span>'
    + '</button>'
    + '<div class="quality-popover sound-effect-popover has-eq" onclick="event.stopPropagation()">'
      + '<div class="sound-effect-head">'
        + '<span class="sound-effect-title">音效</span>'
        + '<span id="sound-effect-source" class="sound-effect-source"></span>'
      + '</div>'
      + '<div id="sound-effect-list" class="sound-effect-list"><div class="sound-effect-empty">加载中…</div></div>'
      + '<div id="se-eq-block" class="se-eq-block">'
        + '<div class="se-eq-head" onclick="onUserEqHeadClick(event)">'
          + '<span class="se-eq-title">自定义均衡器</span>'
          + '<span id="se-eq-state" class="se-eq-state">关闭</span>'
          + '<button type="button" id="se-eq-switch" class="usereq-switch" role="switch" aria-checked="false" aria-label="启用自定义均衡器" onclick="event.stopPropagation();toggleUserEqEnabled()"></button>'
        + '</div>'
        + '<div class="se-eq-body-wrap" aria-hidden="true">'
          + '<div class="se-eq-body">'
            + '<div id="usereq-grid" class="usereq-grid"></div>'
            + '<div class="usereq-toolbar">'
              + '<button type="button" class="usereq-btn" onclick="onUserEqResetClick()">全部归零</button>'
              + '<span id="usereq-status" class="usereq-status">调节自动保存</span>'
            + '</div>'
          + '</div>'
        + '</div>'
      + '</div>'
      + '<div class="sound-effect-foot">Jiafee 自制音效 · 享受别样听感</div>'
    + '</div>';
  // Insert immediately after the anchor button so the sound-effect pill
  // sits at the end of the like/collect cluster.
  anchor.parentNode.insertBefore(host, anchor.nextSibling);
  return true;
}

function bindSoundEffectControl() {
  if (!ensureSoundEffectControlDom()) return false;
  var wrap = document.getElementById('sound-effect-control');
  if (wrap && !wrap.__mineradioBound) {
    wrap.__mineradioBound = true;
    wrap.addEventListener('mouseenter', function(){
      wrap.classList.add('open');
      if (!SOUND_EFFECT_STATE.loaded && !SOUND_EFFECT_STATE.loading) loadSoundEffectList();
    });
    wrap.addEventListener('mouseleave', function(){
      setTimeout(function(){ if (!wrap.matches(':hover')) wrap.classList.remove('open'); }, 260);
    });
    document.addEventListener('click', function(e){
      if (wrap && !wrap.contains(e.target)) wrap.classList.remove('open');
    });
  }
  renderUserEqGrid();
  updateUserEqToolbar();
  updateSoundEffectEqBadge();
  if (!SOUND_EFFECT_STATE.loaded && !SOUND_EFFECT_STATE.loading) loadSoundEffectList();
  return true;
}

// Try to bind immediately; if the bottom strip isn't in the DOM yet (module
// runs before HTML fully parsed), retry on DOMContentLoaded, then again on a
// short retry loop for cases where the strip is rendered by a later script.
(function scheduleSoundEffectBoot(){
  function boot() {
    patchInitAudioForSoundEffect();
    if (!bindSoundEffectControl()) {
      var tries = 0;
      var timer = setInterval(function(){
        tries++;
        if (bindSoundEffectControl() || tries > 40) clearInterval(timer);
      }, 200);
    }
    // v2.0.1's audio-graph-controls can adopt a prepared graph without
    // routing through initAudio (see resetPlaybackAudioGraphForSourceSwitch).
    // A low-frequency monitor keeps our FX rack attached to whatever the
    // active gainNode/audioCtx currently are.
    setInterval(function(){
      try {
        if (typeof audioReady === 'undefined' || !audioReady) return;
        if (typeof gainNode === 'undefined' || !gainNode) return;
        if (typeof audioCtx === 'undefined' || !audioCtx) return;
        if (gainNode === mineradioFxLastGain && mineradioFx && mineradioFx.ctx === audioCtx && mineradioFxAttached) return;
        if (attachMineradioFxToGraph()) applyPendingSoundEffect();
      } catch (e) { /* noop */ }
    }, 700);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();

// Publish everything the injected HTML's inline handlers reach for. This
// keeps oncclick="toggleSoundEffectPanel(event)" etc. wired without wrapping
// every function in another closure.
window.SOUND_EFFECT_STATE = SOUND_EFFECT_STATE;
window.USER_EQ_STATE = USER_EQ_STATE;
window.USER_EQ_BANDS = USER_EQ_BANDS;
window.toggleSoundEffectPanel = toggleSoundEffectPanel;
window.selectSoundEffect = selectSoundEffect;
window.toggleUserEqEnabled = toggleUserEqEnabled;
window.onUserEqSlider = onUserEqSlider;
window.onUserEqResetClick = onUserEqResetClick;
window.onUserEqHeadClick = onUserEqHeadClick;
window.updateSoundEffectEqBadge = updateSoundEffectEqBadge;
window.renderUserEqGrid = renderUserEqGrid;
window.updateUserEqToolbar = updateUserEqToolbar;
window.reapplyCurrentPresetToFx = reapplyCurrentPresetToFx;
window.applyPendingSoundEffect = applyPendingSoundEffect;
window.mineradioFxDebug = function(){ return { fx: mineradioFx, attached: mineradioFxAttached, state: SOUND_EFFECT_STATE, eq: USER_EQ_STATE }; };
