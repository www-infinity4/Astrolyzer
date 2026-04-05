/**
 * main.js – Application bootstrap and event-handling glue.
 *
 * Responsibilities:
 *   • Build the on-screen virtual keyboard from KEY_MAP / PRESETS
 *   • Handle physical keyboard events (keydown/keyup)
 *   • Handle mouse/touch clicks on the virtual keyboard
 *   • Manage preset switching (keys 1-6 or preset buttons)
 *   • Feed tokens into the AI composer
 *   • Update UI state (active keys, token counter, composer status)
 *   • Trigger particle + starfield bursts on key-press
 */

'use strict';

import { KEY_MAP, PRESETS, keyEntry } from './keyboard.js';
import { playNote, setMasterVolume, buildFxChain } from './synthesizer.js';
import { token as composerToken, reset as composerReset, onCompose, onComposerStop } from './composer.js';
import { initStarfield, initVisualizer, starBurst, visPulse } from './visualizer.js';

/* ── Boot ────────────────────────────────────────────────────────────── */

let activePreset   = 0;
let tokenCount     = 0;
let isRecording    = false;
let recordedNotes  = [];
let detectedBPM    = null;

// Active physical keys (prevent repeat-fire while held)
const heldKeys = new Set();

// Key → stop-function (for noteOff while key held)
const activeVoices = {};

/* DOM refs */
const presetContainer  = document.getElementById('presets');
const tokenCountEl     = document.getElementById('token-count');
const tokenProgressEl  = document.getElementById('token-progress');
const tempoLabelEl     = document.getElementById('tempo-label');
const songDisplayEl    = document.getElementById('song-display');
const composerDotEl    = document.getElementById('composer-dot');
const composerLabelEl  = document.getElementById('composer-label');
const btnCompose       = document.getElementById('btn-compose');
const btnRecord        = document.getElementById('btn-record');
const btnReset         = document.getElementById('btn-reset');
const volSlider        = document.getElementById('vol-slider');

/* ── Virtual keyboard layout ─────────────────────────────────────────── */

// Physical QWERTY rows we render (in order)
const KB_ROWS = [
  { id: 'row-num', keys: ['`','1','2','3','4','5','6','7','8','9','0','-','='] },
  { id: 'row-q',   keys: ['q','w','e','r','t','y','u','i','o','p','[',']'] },
  { id: 'row-a',   keys: ['a','s','d','f','g','h','j','k','l',";","'"] },
  { id: 'row-z',   keys: ['z','x','c','v','b','n','m',',','.','/'] },
];

function buildKeyboard() {
  KB_ROWS.forEach(({ id, keys }) => {
    const row = document.getElementById(id);
    keys.forEach(k => {
      const entry = KEY_MAP[k];
      const el = document.createElement('div');
      el.className = 'key';
      el.dataset.key = k;

      const labelEl = document.createElement('span');
      labelEl.className = 'kb-label';
      labelEl.textContent = entry ? entry.label : k.toUpperCase();

      const noteEl = document.createElement('span');
      noteEl.className = 'note-label';
      noteEl.textContent = entry ? entry.note : '';

      el.appendChild(labelEl);
      el.appendChild(noteEl);
      row.appendChild(el);

      // Mouse events
      el.addEventListener('mousedown', () => triggerKey(k, el));
      el.addEventListener('mouseup',   () => releaseKey(k));
      el.addEventListener('mouseleave', () => releaseKey(k));
      el.addEventListener('touchstart', e => { e.preventDefault(); triggerKey(k, el); }, { passive: false });
      el.addEventListener('touchend',   e => { e.preventDefault(); releaseKey(k); },   { passive: false });
    });
  });

  // Space bar row
  const spaceRow = document.getElementById('row-space');
  const spaceEl  = document.createElement('div');
  spaceEl.className   = 'key space';
  spaceEl.dataset.key = ' ';
  const spaceLabel = document.createElement('span');
  spaceLabel.className   = 'kb-label';
  spaceLabel.textContent = 'SPACE';
  const spaceNote = document.createElement('span');
  spaceNote.className   = 'note-label';
  spaceNote.textContent = 'REST';
  spaceEl.appendChild(spaceLabel);
  spaceEl.appendChild(spaceNote);
  spaceRow.appendChild(spaceEl);
  spaceEl.addEventListener('mousedown', () => triggerKey(' ', spaceEl));
  spaceEl.addEventListener('mouseup',   () => releaseKey(' '));
  spaceEl.addEventListener('mouseleave', () => releaseKey(' '));
}

/* ── Preset buttons ──────────────────────────────────────────────────── */

function buildPresets() {
  PRESETS.forEach((preset, i) => {
    const btn = document.createElement('button');
    btn.className   = `preset-btn${i === activePreset ? ' selected' : ''}`;
    btn.dataset.idx = i;
    btn.textContent = `${i + 1}  ${preset.name}`;
    btn.style.setProperty('--preset-color', preset.color);
    btn.addEventListener('click', () => selectPreset(i));
    presetContainer.appendChild(btn);
  });
}

function selectPreset(idx) {
  activePreset = idx;
  document.querySelectorAll('.preset-btn').forEach((b, i) => {
    b.classList.toggle('selected', i === idx);
  });
}

/* ── Key trigger / release ───────────────────────────────────────────── */

function triggerKey(k, domEl) {
  if (heldKeys.has(k)) return;
  heldKeys.add(k);

  // Resume audio context on first user gesture
  buildFxChain();

  const entry = keyEntry(k);
  if (!entry) return;

  const preset = PRESETS[activePreset];
  const stopFn  = playNote(entry.note, preset);
  activeVoices[k] = stopFn;

  // Visual feedback
  const el = domEl ?? document.querySelector(`.key[data-key="${CSS.escape(k)}"]`);
  if (el) el.classList.add('active');

  // Burst effect
  if (el) {
    const rect = el.getBoundingClientRect();
    const cx   = rect.left + rect.width / 2;
    const cy   = rect.top  + rect.height / 2;
    starBurst(cx, cy, preset.color);
    spawnParticles(cx, cy, preset.color);
  }
  visPulse();

  // Token / composer
  addToken(entry.note, preset);
}

function releaseKey(k) {
  if (!heldKeys.has(k)) return;
  heldKeys.delete(k);

  if (activeVoices[k]) {
    activeVoices[k]();
    delete activeVoices[k];
  }

  const el = document.querySelector(`.key[data-key="${CSS.escape(k)}"]`);
  if (el) el.classList.remove('active');
}

/* ── Token management ────────────────────────────────────────────────── */

function addToken(noteName, preset) {
  tokenCount++;
  tokenCountEl.textContent = tokenCount;
  tokenProgressEl.value    = tokenCount % 16;

  // Song display
  const span = document.createElement('span');
  span.textContent = noteName;
  span.style.borderColor = preset.color;
  songDisplayEl.appendChild(span);
  songDisplayEl.scrollTop = songDisplayEl.scrollHeight;

  if (isRecording) recordedNotes.push({ note: noteName, preset: preset.id, time: performance.now() });

  composerToken(noteName);
}

/* ── Composer callbacks ──────────────────────────────────────────────── */

onCompose(({ bpm }) => {
  detectedBPM = bpm;
  tempoLabelEl.textContent = `♩ ${bpm} BPM`;
  composerDotEl.classList.add('active');
  composerLabelEl.classList.add('active');
  composerLabelEl.textContent = `AI Composer playing at ${bpm} BPM…`;

  // Highlight a few keys on the virtual keyboard to show composer activity
  const keys = ['a','s','d','f','g'];
  keys.forEach((k, i) => {
    setTimeout(() => {
      const el = document.querySelector(`.key[data-key="${k}"]`);
      if (el) {
        el.classList.add('composer-active');
        setTimeout(() => el.classList.remove('composer-active'), 400);
      }
    }, i * 120);
  });
});

onComposerStop(() => {
  composerDotEl.classList.remove('active');
  composerLabelEl.classList.remove('active');
  composerLabelEl.textContent = 'AI Composer listening…';

  // Add composer token markers
  const span = document.createElement('span');
  span.className   = 'composer';
  span.textContent = '🎵';
  songDisplayEl.appendChild(span);
  songDisplayEl.scrollTop = songDisplayEl.scrollHeight;
});

/* ── Physical keyboard events ────────────────────────────────────────── */

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  // Preset switch: 1–6
  if (['1','2','3','4','5','6'].includes(e.key)) {
    selectPreset(parseInt(e.key, 10) - 1);
    return;
  }
  if (e.key === 'Escape') {
    resetAll();
    return;
  }

  const k = e.key === ' ' ? ' ' : e.key.toLowerCase();
  e.preventDefault();
  triggerKey(k, null);
});

document.addEventListener('keyup', e => {
  const k = e.key === ' ' ? ' ' : e.key.toLowerCase();
  releaseKey(k);
});

/* ── Control buttons ─────────────────────────────────────────────────── */

btnCompose.addEventListener('click', () => {
  // Force compose immediately
  import('./composer.js').then(({ token: t }) => {
    // trigger a fake extra token to push the composer over the threshold
    t('A4');
  });
});

btnRecord.addEventListener('click', () => {
  isRecording = !isRecording;
  btnRecord.textContent = isRecording ? '⏹ Stop' : '⏺ Record';
  btnRecord.classList.toggle('primary', isRecording);
  if (!isRecording && recordedNotes.length) {
    exportRecording(recordedNotes);
    recordedNotes = [];
  }
});

btnReset.addEventListener('click', resetAll);

function resetAll() {
  composerReset();
  tokenCount = 0;
  tokenCountEl.textContent = '0';
  tokenProgressEl.value    = 0;
  tempoLabelEl.textContent = '♩ — BPM';
  songDisplayEl.innerHTML  = '';
  heldKeys.forEach(k => releaseKey(k));
}

/* ── Volume slider ───────────────────────────────────────────────────── */

volSlider.addEventListener('input', () => {
  setMasterVolume(parseFloat(volSlider.value));
});

/* ── Recording export ────────────────────────────────────────────────── */

function exportRecording(notes) {
  const json = JSON.stringify(notes, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `astrolyzer-recording-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Particle burst effect ───────────────────────────────────────────── */

function spawnParticles(cx, cy, color) {
  const rgb = hexToRgb(color) ?? '123,47,255';
  for (let i = 0; i < 8; i++) {
    const el = document.createElement('div');
    el.className = 'particle';
    const angle = (i / 8) * Math.PI * 2;
    const dist  = 30 + Math.random() * 40;
    el.style.cssText = `
      left: ${cx}px; top: ${cy}px;
      width: ${3 + Math.random() * 4}px;
      height: ${3 + Math.random() * 4}px;
      background: rgb(${rgb});
      --dx: ${Math.cos(angle) * dist}px;
      --dy: ${Math.sin(angle) * dist}px;
    `;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }
}

function hexToRgb(hex) {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return null;
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

/* ── Initialise ──────────────────────────────────────────────────────── */

buildPresets();
buildKeyboard();
initStarfield(document.getElementById('starfield'));
initVisualizer(document.getElementById('visualizer'));
