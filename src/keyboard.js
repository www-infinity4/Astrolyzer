/**
 * keyboard.js – Key-to-note mapping and 6 preset tune definitions.
 *
 * Each physical key maps to a musical note. Six sound presets are available
 * (switchable with keys 1-6 or the preset buttons). All definitions are
 * placed on the global `Astrolyzer` namespace so no ES-module bundler is
 * required – the file works directly from file:// and any HTTP server.
 */

'use strict';

window.Astrolyzer = window.Astrolyzer || {};

/* ── Musical note frequencies (Hz) ─────────────────────────────────────── */
const NOTE_FREQ = {
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.00, A2: 110.00, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.26, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
  C6: 1046.50, D6: 1174.66, E6: 1318.51, F6: 1396.91, G6: 1567.98, A6: 1760.00,
  REST: 0,
};

/**
 * KEY_MAP – maps each physical keyboard key (event.key) to a note name.
 *
 * Layout (bottom → top rows):
 *   Z row  : C3 – G3  (low)
 *   A row  : A3 – E5  (mid-low)
 *   Q row  : F5 – E6  (mid-high)
 *   1 row  : F6 – C7 approx (high / percussion triggers)
 *   Space  : REST / breath
 */
const KEY_MAP = {
  // Number row  → very high / percussion
  '`': { note: 'C2', label: '`' },
  '1': null, '2': null, '3': null, '4': null, '5': null,
  '6': null, '7': null, '8': null, '9': null, '0': null,
  '-': { note: 'A6', label: '-' },
  '=': { note: 'G6', label: '=' },

  // Q row → high register
  q: { note: 'F5', label: 'Q' },
  w: { note: 'G5', label: 'W' },
  e: { note: 'A5', label: 'E' },
  r: { note: 'B5', label: 'R' },
  t: { note: 'C6', label: 'T' },
  y: { note: 'D6', label: 'Y' },
  u: { note: 'E6', label: 'U' },
  i: { note: 'F6', label: 'I' },
  o: { note: 'G6', label: 'O' },
  p: { note: 'A6', label: 'P' },
  '[': { note: 'B5', label: '[' },
  ']': { note: 'C6', label: ']' },

  // A row → mid register
  a: { note: 'A3', label: 'A' },
  s: { note: 'B3', label: 'S' },
  d: { note: 'C4', label: 'D' },
  f: { note: 'D4', label: 'F' },
  g: { note: 'E4', label: 'G' },
  h: { note: 'F4', label: 'H' },
  j: { note: 'G4', label: 'J' },
  k: { note: 'A4', label: 'K' },
  l: { note: 'B4', label: 'L' },
  ';': { note: 'C5', label: ';' },
  "'": { note: 'D5', label: "'" },

  // Z row → low register
  z: { note: 'C3', label: 'Z' },
  x: { note: 'D3', label: 'X' },
  c: { note: 'E3', label: 'C' },
  v: { note: 'F3', label: 'V' },
  b: { note: 'G3', label: 'B' },
  n: { note: 'A3', label: 'N' },
  m: { note: 'B3', label: 'M' },
  ',': { note: 'C4', label: ',' },
  '.': { note: 'D4', label: '.' },
  '/': { note: 'E4', label: '/' },

  // Space → breath/REST
  ' ': { note: 'REST', label: 'SPACE' },
};

/**
 * PRESETS – 6 sound presets, each with synthesis parameters consumed by
 * synthesizer.js. Every key plays with the currently selected preset.
 */
const PRESETS = [
  {
    id: 0,
    name: '✨ Cosmic',
    color: '#7b2fff',
    oscillatorType: 'sine',
    attack: 0.04,
    decay: 0.3,
    sustain: 0.6,
    release: 1.2,
    detune: 5,
    harmonics: [1, 0.5, 0.25],
    reverb: 0.6,
    delay: 0.3,
    filterFreq: 8000,
    filterQ: 2,
    lfoRate: 0.8,
    lfoDepth: 10,
  },
  {
    id: 1,
    name: '🎹 Piano',
    color: '#c8c8ff',
    oscillatorType: 'triangle',
    attack: 0.005,
    decay: 0.5,
    sustain: 0.4,
    release: 1.8,
    detune: 0,
    harmonics: [1, 0.6, 0.3, 0.15],
    reverb: 0.25,
    delay: 0.1,
    filterFreq: 12000,
    filterQ: 1,
    lfoRate: 0,
    lfoDepth: 0,
  },
  {
    id: 2,
    name: '🎸 Synth Lead',
    color: '#ff4ecd',
    oscillatorType: 'sawtooth',
    attack: 0.01,
    decay: 0.1,
    sustain: 0.8,
    release: 0.4,
    detune: 8,
    harmonics: [1, 0.8, 0.5],
    reverb: 0.2,
    delay: 0.15,
    filterFreq: 3000,
    filterQ: 8,
    lfoRate: 5,
    lfoDepth: 200,
  },
  {
    id: 3,
    name: '🎻 Strings',
    color: '#ffb347',
    oscillatorType: 'sawtooth',
    attack: 0.25,
    decay: 0.2,
    sustain: 0.9,
    release: 1.5,
    detune: 12,
    harmonics: [1, 0.7, 0.4, 0.2],
    reverb: 0.5,
    delay: 0.0,
    filterFreq: 5000,
    filterQ: 3,
    lfoRate: 5.5,
    lfoDepth: 6,
  },
  {
    id: 4,
    name: '🎺 Brass',
    color: '#ffd700',
    oscillatorType: 'square',
    attack: 0.08,
    decay: 0.15,
    sustain: 0.85,
    release: 0.6,
    detune: 0,
    harmonics: [1, 0.9, 0.7, 0.4, 0.2],
    reverb: 0.3,
    delay: 0.05,
    filterFreq: 4000,
    filterQ: 5,
    lfoRate: 0,
    lfoDepth: 0,
  },
  {
    id: 5,
    name: '🌊 Pad',
    color: '#00e5ff',
    oscillatorType: 'sine',
    attack: 0.6,
    decay: 0.4,
    sustain: 1.0,
    release: 3.0,
    detune: 15,
    harmonics: [1, 0.8, 0.6, 0.4, 0.2, 0.1],
    reverb: 0.85,
    delay: 0.5,
    filterFreq: 2000,
    filterQ: 1.5,
    lfoRate: 0.3,
    lfoDepth: 15,
  },
];

/**
 * Returns the frequency (Hz) for a given note name.
 * @param {string} note
 * @returns {number}
 */
function noteFreq(note) {
  return NOTE_FREQ[note] ?? 440;
}

/**
 * Returns the KEY_MAP entry for a given event.key value, or null if the key
 * is reserved (preset-switch keys 1–6, Escape, etc.) or not mapped.
 * @param {string} key  – event.key value (already lower-cased for letters)
 * @returns {{ note: string, label: string } | null}
 */
function keyEntry(key) {
  // Preset switch keys (1-6) are handled separately
  if (['1','2','3','4','5','6'].includes(key)) return null;
  const entry = KEY_MAP[key] ?? KEY_MAP[key.toLowerCase()];
  return entry ?? null;
}

// Expose on global namespace
Object.assign(window.Astrolyzer, { KEY_MAP, PRESETS, NOTE_FREQ, noteFreq, keyEntry });
