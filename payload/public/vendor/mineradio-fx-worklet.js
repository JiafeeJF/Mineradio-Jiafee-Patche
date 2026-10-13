/*!
 * Mineradio FX Worklet Processors
 * ---------------------------------------------------------------
 * Runs inside the AudioWorkletGlobalScope. Currently exports:
 *   - "mineradio-deesser": a program-dependent sibilance suppressor
 *     that uses a sidechain bandpass detector to drive a peaking
 *     notch on the main signal.
 *
 * Everything below runs on the audio thread — no DOM, no async,
 * no timers. Keep allocations out of `process()`.
 * --------------------------------------------------------------- */

'use strict';

class BiquadStereoRBJ {
  // Stereo Robert Bristow-Johnson biquad (peaking or bandpass).
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    // State for two channels
    this.z1L = 0; this.z2L = 0;
    this.z1R = 0; this.z2R = 0;
  }

  setPeaking(sampleRate, freq, Q, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(0.05, Q));
    const b0 = 1 + alpha * A;
    const b1 = -2 * cosw;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cosw;
    const a2 = 1 - alpha / A;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  setBandpass(sampleRate, freq, Q) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * Math.max(0.05, Q));
    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw;
    const a2 = 1 - alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  processMono(x, isLeft) {
    // Direct Form II Transposed
    const b0 = this.b0, b1 = this.b1, b2 = this.b2;
    const a1 = this.a1, a2 = this.a2;
    let z1 = isLeft ? this.z1L : this.z1R;
    let z2 = isLeft ? this.z2L : this.z2R;
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    if (isLeft) { this.z1L = z1; this.z2L = z2; }
    else { this.z1R = z1; this.z2R = z2; }
    return y;
  }
}

class DeEsserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'thresholdDb', defaultValue: -24, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'freq',        defaultValue: 6800, minValue: 2000, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'q',           defaultValue: 3.2,  minValue: 0.5,  maxValue: 8, automationRate: 'k-rate' },
      { name: 'maxReductionDb', defaultValue: -8, minValue: -18, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attackMs',    defaultValue: 3,   minValue: 0.3, maxValue: 30, automationRate: 'k-rate' },
      { name: 'releaseMs',   defaultValue: 60,  minValue: 5,   maxValue: 500, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Main-signal peaking notch (gain modulated per-block)
    this.notch = new BiquadStereoRBJ();
    // Sidechain bandpass (detects sibilance energy)
    this.detector = new BiquadStereoRBJ();
    // Envelope follower (mono, sums L+R energy)
    this.env = 0;
    // Cached last param snapshot to skip coeff recompute when unchanged
    this._lastFreq = 0;
    this._lastQ = 0;
    this._lastGain = 0;
    this._lastDetFreq = 0;
    this._lastDetQ = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    const numCh = Math.min(input.length, output.length);
    const blockSize = input[0].length;
    const sr = sampleRate; // global in AudioWorkletGlobalScope

    const thresholdDb = parameters.thresholdDb[0];
    const freq = parameters.freq[0];
    const q = parameters.q[0];
    const maxRedDb = parameters.maxReductionDb[0];
    const attackMs = parameters.attackMs[0];
    const releaseMs = parameters.releaseMs[0];

    // Sidechain bandpass tracks the sibilance band. Coefficients only
    // need to be updated when a parameter has actually changed.
    if (freq !== this._lastDetFreq || q !== this._lastDetQ) {
      this.detector.setBandpass(sr, freq, q);
      this._lastDetFreq = freq;
      this._lastDetQ = q;
    }

    // Envelope smoothing coefficients (one-pole)
    const attackCoeff = Math.exp(-1 / (Math.max(0.001, attackMs) * 0.001 * sr));
    const releaseCoeff = Math.exp(-1 / (Math.max(0.001, releaseMs) * 0.001 * sr));

    const threshold = Math.pow(10, thresholdDb / 20);

    // Detector loop: mix L+R, run through sidechain BPF, follow envelope.
    // We use per-sample envelope but a single peaking gain for the whole
    // block (block-based gain automation). This is standard practice for
    // de-essers and keeps the main path click-free.
    const chL = input[0];
    const chR = numCh > 1 ? input[1] : input[0];
    let peakEnv = this.env;
    for (let i = 0; i < blockSize; i++) {
      const mono = 0.5 * (chL[i] + chR[i]);
      const sc = this.detector.processMono(mono, true);
      const rectified = Math.abs(sc);
      const coeff = rectified > peakEnv ? attackCoeff : releaseCoeff;
      peakEnv = rectified + coeff * (peakEnv - rectified);
    }
    this.env = peakEnv;

    // Convert peakEnv to reduction. When peakEnv <= threshold: no cut.
    // Above threshold, map (envDb - thresholdDb) linearly onto 0..maxRedDb
    // using a soft-knee-ish 6dB range so it doesn't kick in abruptly.
    let reductionDb = 0;
    if (peakEnv > threshold) {
      const overDb = 20 * Math.log10(peakEnv / threshold);
      const kneeRange = 6; // dB
      const t = Math.min(1, overDb / kneeRange);
      reductionDb = maxRedDb * t;
    }

    if (freq !== this._lastFreq || q !== this._lastQ || reductionDb !== this._lastGain) {
      this.notch.setPeaking(sr, freq, q, reductionDb);
      this._lastFreq = freq;
      this._lastQ = q;
      this._lastGain = reductionDb;
    }

    // Main path: apply the (possibly-flat) peaking notch to each channel.
    for (let ch = 0; ch < numCh; ch++) {
      const inp = input[ch];
      const out = output[ch];
      const isLeft = ch === 0;
      for (let i = 0; i < blockSize; i++) {
        out[i] = this.notch.processMono(inp[i], isLeft);
      }
    }
    // If input has fewer channels than output (shouldn't happen with our
    // outputChannelCount [2] contract), fall back by copying channel 0.
    for (let ch = numCh; ch < output.length; ch++) {
      output[ch].set(output[0]);
    }
    return true;
  }
}

registerProcessor('mineradio-deesser', DeEsserProcessor);
