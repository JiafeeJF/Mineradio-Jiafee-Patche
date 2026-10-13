/*!
 * Mineradio FX Engine v2
 * ------------------------------------------------------------
 * Effect rack with true crossfade between presets (no zero-signal
 * gap during switching) and optional AudioWorklet-based de-esser
 * for transparent sibilance control.
 *
 * Preset shape (see public/fx-presets.json):
 *   {
 *     id: string,
 *     name: string,
 *     tagline?: string,
 *     category?: 'signature' | 'spatial' | 'tone' | 'vintage',
 *     input?:  { trimDb },
 *     hp?:     { freq, Q? },
 *     lp?:     { freq, Q? },
 *     eq?:     [{ type, freq, gainDb, Q? }],
 *     drive?:  { amount, mixDb },
 *     reverb?: { decaySec, preDelayMs?, dampHz?, wetDb, dryDb?, stereoSpread? },
 *     widener?: { amount },
 *     pan?:     { rateHz, depth, shape },   // auto-panning LFO (8D surround)
 *     deEsser?: { thresholdDb, freq, Q, maxReductionDb, attackMs, releaseMs },
 *     compressor?: { threshold, knee, ratio, attack, release, makeupDb },
 *     output?: { trimDb }
 *   }
 * ------------------------------------------------------------ */
(function (root) {
  'use strict';

  var CROSSFADE_MS = 320;
  var IR_SAMPLE_CACHE = new Map();
  function dbToGain(db) {
    if (db == null || !isFinite(db)) return 1;
    return Math.pow(10, db / 20);
  }

  // Synthesize a stereo reverb impulse response (dependency-free).
  //  decaySec:     tail length
  //  preDelayMs:   initial silence gap (spatial cue for distance)
  //  dampHz:       one-pole LP smoothing frequency (HF roll-off)
  //  stereoSpread: 0..1, decorrelates L/R decay for width
  function buildImpulseResponse(ctx, opts) {
    var decay = Math.max(0.05, Math.min(8, opts.decaySec || 1.2));
    var preDelayMs = Math.max(0, Math.min(200, opts.preDelayMs || 0));
    var damp = Math.max(500, Math.min(20000, opts.dampHz || 8000));
    var spread = Math.max(0, Math.min(1, opts.stereoSpread != null ? opts.stereoSpread : 0.35));
    var sampleRate = ctx.sampleRate || 44100;
    var key = 'ir:' + sampleRate + ':' + decay.toFixed(3) + ':' + preDelayMs + ':' + damp + ':' + spread.toFixed(2);
    if (IR_SAMPLE_CACHE.has(key)) return IR_SAMPLE_CACHE.get(key);
    var length = Math.floor(sampleRate * (decay + preDelayMs / 1000));
    var buffer = ctx.createBuffer(2, length, sampleRate);
    var preDelaySamples = Math.floor(sampleRate * preDelayMs / 1000);
    var dampCoeff = Math.exp(-2 * Math.PI * damp / sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var data = buffer.getChannelData(ch);
      var chDecay = decay * (1 + (ch === 0 ? -spread * 0.15 : spread * 0.15));
      var prev = 0;
      for (var i = 0; i < length; i++) {
        if (i < preDelaySamples) { data[i] = 0; continue; }
        var t = (i - preDelaySamples) / sampleRate;
        var env = Math.pow(1 - Math.min(1, t / chDecay), 2.4);
        var noise = (Math.random() * 2 - 1) * env;
        prev = noise * (1 - dampCoeff) + prev * dampCoeff;
        data[i] = prev;
      }
    }
    IR_SAMPLE_CACHE.set(key, buffer);
    return buffer;
  }

  function buildDriveCurve(amount) {
    var n = 2048;
    var k = Math.max(0, Math.min(1, amount || 0)) * 24;
    var curve = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
    }
    return curve;
  }

  // ---- AudioWorklet loader (idempotent per context) ----
  var WORKLET_LOAD_PROMISE = new WeakMap();
  function ensureDeEsserWorklet(ctx) {
    if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') {
      return Promise.reject(new Error('AudioWorklet not supported'));
    }
    var cached = WORKLET_LOAD_PROMISE.get(ctx);
    if (cached) return cached;
    var url = (root.MineradioFXWorkletURL) || '/vendor/mineradio-fx-worklet.js';
    var p = ctx.audioWorklet.addModule(url).catch(function (err) {
      WORKLET_LOAD_PROMISE.delete(ctx);
      throw err;
    });
    WORKLET_LOAD_PROMISE.set(ctx, p);
    return p;
  }

  // ---- Rack (a self-contained chain built from a preset) ----
  // A rack owns its own inputGain/outputGain so multiple racks can be
  // crossfaded in parallel during preset switching. When the outputGain
  // reaches 0, the caller disposes the rack to free CPU.
  function Rack(ctx, preset, opts) {
    this.ctx = ctx;
    this.preset = preset;
    this.workletReady = !!(opts && opts.workletReady);
    this.inputGain = ctx.createGain();
    this.outputGain = ctx.createGain();
    this.inputGain.gain.value = 1;
    this.outputGain.gain.value = 0; // caller ramps up
    this.nodes = null;
    this._build();
    this._wire();
  }

  Rack.prototype._build = function () {
    var ctx = this.ctx;
    var preset = this.preset;
    var nodes = { eqChain: [] };

    nodes.inTrim = ctx.createGain();
    nodes.inTrim.gain.value = dbToGain(preset.input && preset.input.trimDb);

    if (preset.hp) {
      nodes.hp = ctx.createBiquadFilter();
      nodes.hp.type = 'highpass';
      nodes.hp.frequency.value = preset.hp.freq || 20;
      if (preset.hp.Q != null) nodes.hp.Q.value = preset.hp.Q;
    }
    if (preset.lp) {
      nodes.lp = ctx.createBiquadFilter();
      nodes.lp.type = 'lowpass';
      nodes.lp.frequency.value = preset.lp.freq || 20000;
      if (preset.lp.Q != null) nodes.lp.Q.value = preset.lp.Q;
    }

    if (Array.isArray(preset.eq)) {
      preset.eq.forEach(function (band) {
        if (!band || !band.freq) return;
        var bq = ctx.createBiquadFilter();
        bq.type = band.type || 'peaking';
        bq.frequency.value = band.freq;
        if (band.gainDb != null) bq.gain.value = band.gainDb;
        if (band.Q != null) bq.Q.value = band.Q;
        nodes.eqChain.push(bq);
      });
    }

    if (preset.drive && preset.drive.amount > 0) {
      nodes.driveIn = ctx.createGain();
      nodes.driveShaper = ctx.createWaveShaper();
      nodes.driveShaper.curve = buildDriveCurve(preset.drive.amount);
      nodes.driveShaper.oversample = '4x';
      nodes.driveWet = ctx.createGain();
      nodes.driveDry = ctx.createGain();
      nodes.driveMix = ctx.createGain();
      nodes.driveWet.gain.value = dbToGain(preset.drive.mixDb != null ? preset.drive.mixDb : -6);
      nodes.driveDry.gain.value = 1;
    }

    if (preset.reverb && preset.reverb.decaySec > 0) {
      nodes.reverbIn = ctx.createGain();
      nodes.reverbNode = ctx.createConvolver();
      nodes.reverbNode.normalize = true;
      nodes.reverbNode.buffer = buildImpulseResponse(ctx, {
        decaySec: preset.reverb.decaySec,
        preDelayMs: preset.reverb.preDelayMs,
        dampHz: preset.reverb.dampHz,
        stereoSpread: preset.reverb.stereoSpread
      });
      nodes.reverbWet = ctx.createGain();
      nodes.reverbDry = ctx.createGain();
      nodes.reverbMix = ctx.createGain();
      nodes.reverbWet.gain.value = dbToGain(preset.reverb.wetDb != null ? preset.reverb.wetDb : -9);
      nodes.reverbDry.gain.value = dbToGain(preset.reverb.dryDb != null ? preset.reverb.dryDb : 0);
    }

    if (preset.widener && preset.widener.amount > 0) {
      nodes.widenerSplit = ctx.createChannelSplitter(2);
      nodes.widenerMerge = ctx.createChannelMerger(2);
      nodes.widenerMid = ctx.createGain();
      nodes.widenerSide = ctx.createGain();
      var amt = Math.max(0, Math.min(1, preset.widener.amount));
      nodes.widenerMid.gain.value = 1 - amt * 0.30;
      nodes.widenerSide.gain.value = 1 + amt * 0.85;
    }

    if (preset.pan) {
      var pp = preset.pan;
      var rate = Math.max(0.02, Math.min(4, pp.rateHz != null ? pp.rateHz : 0.12));
      var mode = (pp.mode || 'stereo').toLowerCase();

      if (mode === 'orbit' && typeof ctx.createPanner === 'function') {
        // HRTF orbit driven by a scheduled parameter sweep on both
        // positionX and positionZ. Instead of relying on two independent
        // oscillators (whose phase relationship drifts due to k-rate
        // rounding + implementation-specific PeriodicWave phase origins),
        // we compute every scheduled sample from a single shared phase and
        // write it to both AudioParams at the exact same audio-clock time.
        // Result: X and Z can never fall out of sync, so the trajectory is
        // an ideal circle for as long as the rack lives.
        //
        // Distance attenuation is disabled (rolloffFactor=0) so the loudness
        // stays flat across the whole orbit; the directional cue comes
        // entirely from HRTF filtering.
        nodes.pan = ctx.createPanner();
        nodes.pan.panningModel = 'HRTF';
        nodes.pan.distanceModel = 'inverse';
        nodes.pan.refDistance = 1;
        nodes.pan.maxDistance = 10000;
        nodes.pan.rolloffFactor = 0;

        var radius = Math.max(0.5, Math.min(4, pp.radius != null ? pp.radius : 1.6));

        if (nodes.pan.positionX && ctx.listener && ctx.listener.forwardX) {
          try {
            ctx.listener.forwardX.value = 0;
            ctx.listener.forwardY.value = 0;
            ctx.listener.forwardZ.value = -1;
            ctx.listener.upX.value = 0;
            ctx.listener.upY.value = 1;
            ctx.listener.upZ.value = 0;
          } catch (_) { /* older engines expose setter methods only */ }

          var pan = nodes.pan;
          var t0 = ctx.currentTime + 0.05;    // let the graph settle first
          // Update at 200 Hz. Web Audio's HRTF panner swaps its head-related
          // impulse response at the update rate; at 50 Hz that produces an
          // audible zipper (energy peaks around 50 Hz + harmonics). 200 Hz
          // pushes the discretisation artefact above the range where our
          // ear picks it up as a distinct hiss, and linearRampToValueAtTime
          // smooths everything in between.
          var stepSec = 0.005;
          var horizonSec = 0.30;              // schedule this far ahead
          var refillSec = 0.10;               // top up every ~100 ms
          var scheduledUntil = t0;

          // Seed initial position exactly on the orbit at phase 0 so the
          // very first sample lines up with what the scheduler will write.
          pan.positionX.setValueAtTime(0, t0);
          pan.positionY.setValueAtTime(0, t0);
          pan.positionZ.setValueAtTime(-radius, t0);

          var writeUntil = function (targetTime) {
            while (scheduledUntil < targetTime) {
              scheduledUntil += stepSec;
              var phase = 2 * Math.PI * rate * (scheduledUntil - t0);
              var x = radius * Math.sin(phase);
              var z = -radius * Math.cos(phase);
              try {
                pan.positionX.linearRampToValueAtTime(x, scheduledUntil);
                pan.positionZ.linearRampToValueAtTime(z, scheduledUntil);
              } catch (_) {
                pan.positionX.setValueAtTime(x, scheduledUntil);
                pan.positionZ.setValueAtTime(z, scheduledUntil);
              }
            }
          };

          // Prime the first horizon worth of samples.
          writeUntil(t0 + horizonSec);

          // Keep refilling on a main-thread timer. Since we schedule against
          // ctx.currentTime rather than performance.now(), timer jitter is
          // absorbed by the audio clock; the samples always land at the
          // exact times we asked for.
          nodes.panTimer = setInterval(function () {
            try {
              writeUntil(ctx.currentTime + horizonSec);
            } catch (_) { /* rack disposed */ }
          }, Math.floor(refillSec * 1000));
        }
      } else if (typeof ctx.createStereoPanner === 'function' && (pp.depth == null || pp.depth > 0)) {
        var depth = Math.max(0, Math.min(1, pp.depth != null ? pp.depth : 0.9));
        var shape = (pp.shape || 'sine').toLowerCase();
        nodes.pan = ctx.createStereoPanner();
        nodes.panLfo = ctx.createOscillator();
        nodes.panLfoDepth = ctx.createGain();
        nodes.panLfo.type = (shape === 'triangle' || shape === 'square' || shape === 'sawtooth')
          ? shape : 'sine';
        nodes.panLfo.frequency.value = rate;
        nodes.panLfoDepth.gain.value = depth;
        nodes.panLfo.connect(nodes.panLfoDepth);
        nodes.panLfoDepth.connect(nodes.pan.pan);
        try { nodes.panLfo.start(); } catch (_) { /* already started */ }
      }
    }

    if (preset.deEsser && this.workletReady) {
      try {
        nodes.deEsser = new AudioWorkletNode(ctx, 'mineradio-deesser', {
          numberOfInputs: 1, numberOfOutputs: 1,
          outputChannelCount: [2]
        });
        var d = preset.deEsser;
        if (nodes.deEsser.parameters) {
          var setParam = function (name, value) {
            if (value == null) return;
            var p = nodes.deEsser.parameters.get(name);
            if (p) p.value = value;
          };
          setParam('thresholdDb', d.thresholdDb);
          setParam('freq', d.freq);
          setParam('q', d.Q);
          setParam('maxReductionDb', d.maxReductionDb);
          setParam('attackMs', d.attackMs);
          setParam('releaseMs', d.releaseMs);
        }
      } catch (err) {
        nodes.deEsser = null;
      }
    }

    if (preset.compressor) {
      var c = preset.compressor;
      nodes.compressor = ctx.createDynamicsCompressor();
      if (c.threshold != null) nodes.compressor.threshold.value = c.threshold;
      if (c.knee != null) nodes.compressor.knee.value = c.knee;
      if (c.ratio != null) nodes.compressor.ratio.value = c.ratio;
      if (c.attack != null) nodes.compressor.attack.value = c.attack;
      if (c.release != null) nodes.compressor.release.value = c.release;
      nodes.makeup = ctx.createGain();
      nodes.makeup.gain.value = dbToGain(c.makeupDb || 0);
    }

    nodes.outTrim = ctx.createGain();
    nodes.outTrim.gain.value = dbToGain(preset.output && preset.output.trimDb);

    this.nodes = nodes;
  };

  Rack.prototype._wire = function () {
    var nodes = this.nodes;
    var cursor = nodes.inTrim;
    this.inputGain.connect(cursor);

    if (nodes.hp) { cursor.connect(nodes.hp); cursor = nodes.hp; }
    if (nodes.lp) { cursor.connect(nodes.lp); cursor = nodes.lp; }

    if (nodes.eqChain && nodes.eqChain.length) {
      nodes.eqChain.forEach(function (bq) {
        cursor.connect(bq);
        cursor = bq;
      });
    }

    if (nodes.deEsser) {
      cursor.connect(nodes.deEsser);
      cursor = nodes.deEsser;
    }

    if (nodes.driveShaper) {
      cursor.connect(nodes.driveIn);
      nodes.driveIn.connect(nodes.driveDry);
      nodes.driveIn.connect(nodes.driveShaper);
      nodes.driveShaper.connect(nodes.driveWet);
      nodes.driveDry.connect(nodes.driveMix);
      nodes.driveWet.connect(nodes.driveMix);
      cursor = nodes.driveMix;
    }

    if (nodes.reverbNode) {
      cursor.connect(nodes.reverbIn);
      nodes.reverbIn.connect(nodes.reverbDry);
      nodes.reverbIn.connect(nodes.reverbNode);
      nodes.reverbNode.connect(nodes.reverbWet);
      nodes.reverbDry.connect(nodes.reverbMix);
      nodes.reverbWet.connect(nodes.reverbMix);
      cursor = nodes.reverbMix;
    }

    if (nodes.widenerSplit) {
      cursor.connect(nodes.widenerSplit);
      nodes.widenerSplit.connect(nodes.widenerMid, 0);
      nodes.widenerSplit.connect(nodes.widenerSide, 1);
      nodes.widenerMid.connect(nodes.widenerMerge, 0, 0);
      nodes.widenerSide.connect(nodes.widenerMerge, 0, 1);
      cursor = nodes.widenerMerge;
    }

    if (nodes.pan) {
      cursor.connect(nodes.pan);
      cursor = nodes.pan;
    }

    if (nodes.compressor) {
      cursor.connect(nodes.compressor);
      nodes.compressor.connect(nodes.makeup);
      cursor = nodes.makeup;
    }

    cursor.connect(nodes.outTrim);
    nodes.outTrim.connect(this.outputGain);
  };

  Rack.prototype.dispose = function () {
    var nodes = this.nodes;
    try { this.inputGain.disconnect(); } catch (_) { /* noop */ }
    try { this.outputGain.disconnect(); } catch (_) { /* noop */ }
    if (nodes) {
      var toDisconnect = [
        nodes.inTrim, nodes.hp, nodes.lp,
        nodes.driveIn, nodes.driveShaper, nodes.driveWet, nodes.driveDry, nodes.driveMix,
        nodes.reverbIn, nodes.reverbNode, nodes.reverbWet, nodes.reverbDry, nodes.reverbMix,
        nodes.widenerSplit, nodes.widenerMerge, nodes.widenerMid, nodes.widenerSide,
        nodes.pan, nodes.panLfo, nodes.panLfoDepth,
        nodes.panLfoX, nodes.panLfoDepthX,
        nodes.panLfoY, nodes.panLfoDepthY,
        nodes.panLfoZ, nodes.panLfoDepthZ,
        nodes.deEsser, nodes.compressor, nodes.makeup, nodes.outTrim
      ];
      ['panLfo','panLfoX','panLfoY','panLfoZ'].forEach(function(k){
        if (nodes[k]) { try { nodes[k].stop(); } catch (_) { /* noop */ } }
      });
      if (nodes.panTimer) { try { clearInterval(nodes.panTimer); } catch (_) { /* noop */ } nodes.panTimer = null; }
      if (nodes.eqChain) toDisconnect.push.apply(toDisconnect, nodes.eqChain);
      toDisconnect.forEach(function (n) {
        if (!n) return;
        try { n.disconnect(); } catch (_) { /* noop */ }
      });
    }
    this.nodes = null;
  };

  // ---- MineradioFX (owns input/output terminals + crossfading racks) ----
  function MineradioFX(audioCtx) {
    if (!audioCtx) throw new Error('MineradioFX requires an AudioContext');
    this.ctx = audioCtx;
    this.input = audioCtx.createGain();
    this.output = audioCtx.createGain();
    this.input.gain.value = 1;
    this.output.gain.value = 1;
    this.currentPresetId = null;
    this.currentPreset = null;
    this._activeRack = null;    // rack that's fully faded in
    this._pendingRack = null;   // rack fading in (mid-crossfade)
    this._bypassBridge = null;  // direct gain node used when no rack is active
    this._workletReady = false;
    // Start in bypass: input -> bypassBridge -> output
    this._enableBypassBridge();
    // Try to load the DSP worklet in the background.
    var self = this;
    ensureDeEsserWorklet(audioCtx).then(function () {
      self._workletReady = true;
    }).catch(function (err) {
      console.warn('[FX] AudioWorklet unavailable, de-esser disabled:', err && err.message);
      self._workletReady = false;
    });
  }

  MineradioFX.prototype._enableBypassBridge = function () {
    if (this._bypassBridge) return;
    var bridge = this.ctx.createGain();
    bridge.gain.value = 1;
    this.input.connect(bridge);
    bridge.connect(this.output);
    this._bypassBridge = bridge;
  };

  MineradioFX.prototype._disableBypassBridge = function () {
    if (!this._bypassBridge) return;
    try { this._bypassBridge.disconnect(); } catch (_) { /* noop */ }
    try { this.input.disconnect(this._bypassBridge); } catch (_) { /* noop */ }
    this._bypassBridge = null;
  };

  MineradioFX.prototype._attachRack = function (rack) {
    this.input.connect(rack.inputGain);
    rack.outputGain.connect(this.output);
  };

  MineradioFX.prototype._detachRack = function (rack) {
    try { this.input.disconnect(rack.inputGain); } catch (_) { /* noop */ }
    try { rack.outputGain.disconnect(this.output); } catch (_) { /* noop */ }
  };

  MineradioFX.prototype.applyPreset = function (preset) {
    if (!preset || preset.bypass === true || preset.id === 'bypass' || preset.id === 'off') {
      return this.bypass();
    }
    if (this.currentPresetId === preset.id && !this._pendingRack) return;

    var ctx = this.ctx;
    var t0 = ctx.currentTime;
    var fadeSec = CROSSFADE_MS / 1000;

    var newRack = new Rack(ctx, preset, { workletReady: this._workletReady });
    this._attachRack(newRack);

    // Schedule fade-in on the new rack starting from 0.
    try {
      newRack.outputGain.gain.cancelScheduledValues(t0);
      newRack.outputGain.gain.setValueAtTime(0.0001, t0);
      newRack.outputGain.gain.linearRampToValueAtTime(1, t0 + fadeSec);
    } catch (_) { /* noop */ }

    // Fade out whoever is currently sounding: the active rack, the pending
    // rack (if a fast retrigger happens mid-fade), or the bypass bridge.
    var self = this;
    var oldRack = this._activeRack;
    var oldPending = this._pendingRack;
    var oldBridge = this._bypassBridge;
    if (oldRack) {
      try {
        oldRack.outputGain.gain.cancelScheduledValues(t0);
        oldRack.outputGain.gain.setValueAtTime(oldRack.outputGain.gain.value, t0);
        oldRack.outputGain.gain.linearRampToValueAtTime(0.0001, t0 + fadeSec);
      } catch (_) { /* noop */ }
    }
    if (oldPending && oldPending !== newRack) {
      try {
        oldPending.outputGain.gain.cancelScheduledValues(t0);
        oldPending.outputGain.gain.setValueAtTime(oldPending.outputGain.gain.value, t0);
        oldPending.outputGain.gain.linearRampToValueAtTime(0.0001, t0 + fadeSec);
      } catch (_) { /* noop */ }
    }
    if (oldBridge) {
      try {
        oldBridge.gain.cancelScheduledValues(t0);
        oldBridge.gain.setValueAtTime(oldBridge.gain.value, t0);
        oldBridge.gain.linearRampToValueAtTime(0.0001, t0 + fadeSec);
      } catch (_) { /* noop */ }
    }

    this._pendingRack = newRack;
    this.currentPresetId = preset.id;
    this.currentPreset = preset;

    // After crossfade finishes, promote newRack to active and dispose the
    // rest. Extra buffer (60ms) lets convolver tails settle before teardown.
    var teardownDelay = CROSSFADE_MS + 60;
    setTimeout(function () {
      if (self._pendingRack === newRack) {
        // Only promote/tear down if a newer switch has not superseded us.
        self._pendingRack = null;
        self._activeRack = newRack;
        if (oldRack && oldRack !== newRack) {
          self._detachRack(oldRack);
          oldRack.dispose();
        }
        if (oldPending && oldPending !== newRack && oldPending !== oldRack) {
          self._detachRack(oldPending);
          oldPending.dispose();
        }
        if (oldBridge && oldBridge === self._bypassBridge) {
          self._disableBypassBridge();
        }
      }
    }, teardownDelay);
  };

  MineradioFX.prototype.bypass = function () {
    if (!this.currentPresetId && !this._activeRack && !this._pendingRack) return;
    var ctx = this.ctx;
    var t0 = ctx.currentTime;
    var fadeSec = CROSSFADE_MS / 1000;

    // Fresh bypass bridge starts silent then fades in.
    this._disableBypassBridge();
    var bridge = ctx.createGain();
    bridge.gain.value = 0.0001;
    this.input.connect(bridge);
    bridge.connect(this.output);
    this._bypassBridge = bridge;
    try {
      bridge.gain.cancelScheduledValues(t0);
      bridge.gain.setValueAtTime(0.0001, t0);
      bridge.gain.linearRampToValueAtTime(1, t0 + fadeSec);
    } catch (_) { /* noop */ }

    var self = this;
    var oldRack = this._activeRack;
    var oldPending = this._pendingRack;
    [oldRack, oldPending].forEach(function (r) {
      if (!r) return;
      try {
        r.outputGain.gain.cancelScheduledValues(t0);
        r.outputGain.gain.setValueAtTime(r.outputGain.gain.value, t0);
        r.outputGain.gain.linearRampToValueAtTime(0.0001, t0 + fadeSec);
      } catch (_) { /* noop */ }
    });

    this._activeRack = null;
    this._pendingRack = null;
    this.currentPresetId = null;
    this.currentPreset = null;

    setTimeout(function () {
      [oldRack, oldPending].forEach(function (r) {
        if (!r) return;
        self._detachRack(r);
        r.dispose();
      });
    }, CROSSFADE_MS + 60);
  };

  MineradioFX.prototype.dispose = function () {
    if (this._activeRack) { this._detachRack(this._activeRack); this._activeRack.dispose(); }
    if (this._pendingRack) { this._detachRack(this._pendingRack); this._pendingRack.dispose(); }
    this._activeRack = null;
    this._pendingRack = null;
    this._disableBypassBridge();
    try { this.input.disconnect(); } catch (_) { /* noop */ }
    try { this.output.disconnect(); } catch (_) { /* noop */ }
  };

  root.MineradioFX = MineradioFX;
})(typeof window !== 'undefined' ? window : this);
