/**
 * synthesizer.js – Web Audio API engine.
 *
 * Plays notes using additive synthesis (stacked oscillators per harmonic),
 * an ADSR envelope, a biquad low-pass filter, an LFO for vibrato/wobble,
 * a convolution reverb, and a delay line. Parameters are driven by the
 * currently selected PRESET from keyboard.js.
 *
 * Depends on: keyboard.js (loaded first via <script> tag).
 * Exposes everything on window.Astrolyzer.
 */

'use strict';

window.Astrolyzer = window.Astrolyzer || {};

let _ctx = null;

/** Lazily create / resume AudioContext on first user gesture. */
function getCtx() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

/* ── Shared FX chain (created once, reused) ──────────────────────────── */
let _masterGain = null;
let _reverbNode = null;
let _reverbGain = null;
let _dryGain   = null;
let _analyser  = null;
let _fxReady   = false;

async function buildFxChain() {
  if (_fxReady) return;
  const ctx = getCtx();

  _masterGain = ctx.createGain();
  _masterGain.gain.value = 0.75;

  // Analyser for visualizer
  _analyser = ctx.createAnalyser();
  _analyser.fftSize = 2048;
  _analyser.smoothingTimeConstant = 0.82;

  // Simple synthetic reverb using a noise-based impulse response
  _reverbNode = ctx.createConvolver();
  _reverbNode.buffer = buildImpulse(ctx, 2.5, 2.0);

  _reverbGain = ctx.createGain();
  _reverbGain.gain.value = 0;        // controlled per preset
  _dryGain    = ctx.createGain();
  _dryGain.gain.value = 1;

  // Routing: masterGain → dry+reverb branches → analyser → destination
  _masterGain.connect(_dryGain);
  _masterGain.connect(_reverbNode);
  _reverbNode.connect(_reverbGain);
  _dryGain.connect(_analyser);
  _reverbGain.connect(_analyser);
  _analyser.connect(ctx.destination);

  _fxReady = true;
}

/**
 * Build a synthetic impulse response buffer for the convolver reverb.
 * Uses exponentially decaying white noise.
 */
function buildImpulse(ctx, durationSec, decay) {
  const len    = Math.floor(ctx.sampleRate * durationSec);
  const buf    = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/** Expose the analyser node for the visualizer. */
function getAnalyser() { return _analyser; }

/** Adjust the master output volume (0–1). */
function setMasterVolume(v) {
  if (_masterGain) _masterGain.gain.value = Math.max(0, Math.min(1, v));
}

/**
 * Play a note using the given preset.
 *
 * @param {string}  noteName   – e.g. 'A4'
 * @param {object}  preset     – one of PRESETS from keyboard.js
 * @param {number}  [duration] – optional forced duration in seconds; if omitted
 *                               the note plays and releases naturally
 * @returns {function} stopFn – call to trigger release early
 */
function playNote(noteName, preset, duration) {
  if (noteName === 'REST') return () => {};

  const ctx = getCtx();
  buildFxChain();           // idempotent

  const freq = window.Astrolyzer.noteFreq(noteName);
  const now  = ctx.currentTime;

  // Update reverb wet/dry per preset
  _reverbGain.gain.setValueAtTime(preset.reverb, now);
  _dryGain.gain.setValueAtTime(1 - preset.reverb * 0.5, now);

  // Per-voice gain (envelope)
  const voiceGain = ctx.createGain();
  voiceGain.gain.setValueAtTime(0, now);
  voiceGain.gain.linearRampToValueAtTime(0.7, now + preset.attack);
  voiceGain.gain.linearRampToValueAtTime(0.7 * preset.sustain, now + preset.attack + preset.decay);

  // Filter
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = preset.filterFreq;
  filter.Q.value = preset.filterQ;

  // LFO (vibrato / filter wobble)
  let lfo = null, lfoGain = null;
  if (preset.lfoRate > 0 && preset.lfoDepth > 0) {
    lfo     = ctx.createOscillator();
    lfoGain = ctx.createGain();
    lfo.frequency.value = preset.lfoRate;
    lfoGain.gain.value  = preset.lfoDepth;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(now);
  }

  // Delay
  let delayNode = null;
  if (preset.delay > 0) {
    delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = preset.delay;
    const delayFb = ctx.createGain();
    delayFb.gain.value = 0.35;
    delayNode.connect(delayFb);
    delayFb.connect(delayNode);
    voiceGain.connect(delayNode);
    delayNode.connect(_masterGain);
  }

  // Additive oscillators (harmonics)
  const oscs = preset.harmonics.map((amp, idx) => {
    const osc = ctx.createOscillator();
    osc.type    = preset.oscillatorType;
    osc.frequency.value = freq * (idx + 1);
    osc.detune.value    = preset.detune * (idx % 2 === 0 ? 1 : -1);
    const oscGain = ctx.createGain();
    oscGain.gain.value  = amp;
    osc.connect(oscGain);
    oscGain.connect(filter);
    osc.start(now);
    return osc;
  });

  filter.connect(voiceGain);
  voiceGain.connect(_masterGain);

  // Auto-release after duration if provided
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const t = ctx.currentTime;
    voiceGain.gain.cancelScheduledValues(t);
    voiceGain.gain.setValueAtTime(voiceGain.gain.value, t);
    voiceGain.gain.linearRampToValueAtTime(0, t + preset.release);
    const cleanAt = t + preset.release + 0.1;
    oscs.forEach(o => o.stop(cleanAt));
    if (lfo) lfo.stop(cleanAt);
  };

  if (duration != null) {
    const releaseAt = now + preset.attack + preset.decay + Math.max(0, duration - preset.attack - preset.decay);
    voiceGain.gain.setValueAtTime(voiceGain.gain.value, releaseAt);
    voiceGain.gain.linearRampToValueAtTime(0, releaseAt + preset.release);
    const cleanAt = releaseAt + preset.release + 0.1;
    oscs.forEach(o => o.stop(cleanAt));
    if (lfo) lfo.stop(cleanAt);
    stopped = true;
  }

  return stop;
}

// Expose on global namespace
Object.assign(window.Astrolyzer, { getCtx, buildFxChain, getAnalyser, setMasterVolume, playNote });
