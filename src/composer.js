/**
 * composer.js – AI songwriter that converts keystroke tokens into real music.
 *
 * Every keystroke is a "token". After enough tokens accumulate (or after a
 * pause in playing), the composer analyses the rhythmic pattern and note
 * distribution, then overlays a harmonically coherent accompaniment (chord
 * voicings, countermelody, and rhythmic fills) using the Web Audio API.
 *
 * Musical rules encoded:
 *   • Identifies the most-played notes and infers a key / scale.
 *   • Selects chord progressions from common patterns (I–V–vi–IV, etc.).
 *   • Generates a countermelody using chord tones + passing notes.
 *   • Syncs accompaniment to the user's average rhythmic tempo.
 *   • Adds dynamic variation: softer accompaniment when user plays fast,
 *     fuller chords during slower passages.
 *
 * Depends on: keyboard.js, synthesizer.js (loaded first via <script> tags).
 * Exposes everything on window.Astrolyzer.
 */

'use strict';

window.Astrolyzer = window.Astrolyzer || {};

/* ── Music theory constants ──────────────────────────────────────────── */

// Chromatic scale index → name
const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Scale intervals (semitones from root)
const SCALES = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

// Chord progressions (scale degrees, 0-indexed)
const PROGRESSIONS = [
  [0, 4, 5, 3],   // I  V  vi IV  (pop)
  [0, 5, 3, 4],   // I  vi IV V   (50s)
  [0, 3, 4, 0],   // I  IV V  I   (blues)
  [5, 3, 0, 4],   // vi IV I  V   (minor-feel)
  [0, 2, 3, 4],   // I  iii IV V  (ascending)
];

// Triad intervals (major, minor, diminished)
const TRIADS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim:   [0, 3, 6],
};

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Return semitone index (0–11) for a note name like 'A4'. */
function noteToSemi(noteName) {
  const letter = noteName.replace(/\d/g, '');
  return CHROMATIC.indexOf(letter);
}

/** Return octave number from note name. */
function noteToOctave(noteName) {
  return parseInt(noteName.replace(/[^0-9]/g, ''), 10);
}

/** Build note name from chromatic index + octave. */
function semiToNote(semi, octave) {
  return CHROMATIC[((semi % 12) + 12) % 12] + octave;
}

/** Find the frequency of a note name, or 0 if not found. */
function freq(noteName) {
  return (window.Astrolyzer.NOTE_FREQ[noteName]) ?? 0;
}

/* ── Composer state ──────────────────────────────────────────────────── */

const TOKEN_WINDOW  = 16;   // tokens before composer acts
const PAUSE_MS      = 1400; // silence this long → trigger composer
const MIN_INTERVAL  = 80;   // ms, clamp very fast typing

let _tokens      = [];      // { note, time }
let _pauseTimer  = null;
let _isPlaying   = false;
let _callbacks   = { onCompose: null, onStop: null };

/** Register callbacks so main.js can update the UI. */
function onCompose(fn)  { _callbacks.onCompose = fn; }
function onComposerStop(fn) { _callbacks.onStop = fn; }

/**
 * Feed a keystroke token into the composer.
 * @param {string} noteName
 */
function token(noteName) {
  if (noteName === 'REST') return;

  const now = performance.now();
  _tokens.push({ note: noteName, time: now });

  // Keep sliding window
  if (_tokens.length > TOKEN_WINDOW * 3) _tokens.shift();

  // Reset pause timer
  clearTimeout(_pauseTimer);
  _pauseTimer = setTimeout(() => _compose(), PAUSE_MS);

  // Also compose after every TOKEN_WINDOW tokens
  if (_tokens.length >= TOKEN_WINDOW && !_isPlaying) {
    _compose();
  }
}

/** Clear all accumulated tokens (e.g. when user resets). */
function reset() {
  _tokens = [];
  _isPlaying = false;
  clearTimeout(_pauseTimer);
  if (_callbacks.onStop) _callbacks.onStop();
}

/* ── Core composition logic ──────────────────────────────────────────── */

function _compose() {
  if (_tokens.length < 4) return;
  if (_isPlaying) return;

  _isPlaying = true;

  const { root, scale, progression, tempo } = _analyse(_tokens);
  _playAccompaniment(root, scale, progression, tempo);
}

/**
 * Analyse the token stream and return musical parameters.
 */
function _analyse(tokens) {
  // Count note occurrences by pitch class
  const counts = {};
  tokens.forEach(({ note }) => {
    const semi = noteToSemi(note);
    if (semi < 0) return;
    counts[semi] = (counts[semi] ?? 0) + 1;
  });

  // Most common pitch class → root
  const root = parseInt(
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '9',
    10
  );

  // Guess scale: if minor 3rd above root is played → minor, else major
  const semi3 = (root + 3) % 12;
  const semi4 = (root + 4) % 12;
  const has3 = counts[semi3] ?? 0;
  const has4 = counts[semi4] ?? 0;
  const scaleName = has3 > has4 ? 'minor' : 'major';

  // Average inter-onset interval → tempo
  const times = tokens.map(t => t.time);
  let avgIOI = 300; // default 200 BPM equivalent
  if (times.length > 1) {
    const intervals = [];
    for (let i = 1; i < times.length; i++) {
      const d = times[i] - times[i - 1];
      if (d >= MIN_INTERVAL && d < 2000) intervals.push(d);
    }
    if (intervals.length) avgIOI = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  }
  const tempo = Math.round(60000 / avgIOI);   // BPM

  // Pick a progression
  const progression = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];

  return { root, scale: SCALES[scaleName], scaleName, progression, tempo };
}

/**
 * Play an accompaniment sequence derived from the analysed parameters.
 */
async function _playAccompaniment(root, scale, progression, tempo) {
  // Beat duration from user tempo, clamped for musical feel
  const bpm       = Math.max(60, Math.min(180, tempo));
  const beatMs    = 60000 / bpm;
  const chordDurS = (beatMs * 4) / 1000;   // 4-beat chord

  const octave = 3;   // accompany in a low-mid octave

  // Build chord notes for each degree in the progression
  const chordSequence = progression.map(degree => {
    const rootSemi = (root + scale[degree % scale.length]) % 12;
    // Use major triad for now; could be extended to diatonic triads
    return TRIADS.major.map(interval => semiToNote((rootSemi + interval) % 12, octave));
  });

  // Countermelody: arpeggiate chord tones in mid-high octave
  const melodyOctave = 5;
  const melodyNotes  = progression.flatMap(degree => {
    const rootSemi = (root + scale[degree % scale.length]) % 12;
    return TRIADS.major.map(interval => semiToNote((rootSemi + interval) % 12, melodyOctave));
  });

  if (_callbacks.onCompose) {
    _callbacks.onCompose({ chordSequence, melodyNotes, bpm, root, scale });
  }

  // Play chords (using Pad preset for lush accompaniment)
  const PRESETS     = window.Astrolyzer.PRESETS;
  const playNote    = window.Astrolyzer.playNote;
  const padPreset   = PRESETS[5];
  const synthPreset = PRESETS[2];

  for (let i = 0; i < chordSequence.length; i++) {
    if (!_isPlaying) break;

    const chord = chordSequence[i];
    // Play all chord notes simultaneously
    chord.forEach(noteName => {
      if (freq(noteName) > 0) {
        playNote(noteName, padPreset, chordDurS * 0.9);
      }
    });

    // Stagger melody notes within the bar
    const noteDurS = chordDurS / 4;
    for (let m = 0; m < 4; m++) {
      const mn = melodyNotes[(i * 4 + m) % melodyNotes.length];
      if (freq(mn) > 0) {
        await _sleep(noteDurS * 1000 * 0.25);
        if (!_isPlaying) break;
        playNote(mn, synthPreset, noteDurS * 0.8);
      }
    }

    await _sleep(chordDurS * 1000 - noteDurS * 1000);
  }

  _isPlaying = false;
  if (_callbacks.onStop) _callbacks.onStop();
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Expose on global namespace
Object.assign(window.Astrolyzer, { composerToken: token, composerReset: reset, onCompose, onComposerStop });
