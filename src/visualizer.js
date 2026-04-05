/**
 * visualizer.js – Frequency-spectrum canvas visualizer + cosmic starfield.
 *
 * Two independent render loops:
 *   1. Starfield (background) – procedural stars with twinkle + burst effects.
 *   2. Spectrum visualizer (foreground panel) – FFT bars coloured by
 *      frequency range (sub-bass → ultrasonic).
 *
 * Both loops receive burst signals when a key is pressed so they can react
 * to user interaction.
 */

'use strict';

import { getAnalyser } from './synthesizer.js';

/* ── Starfield ───────────────────────────────────────────────────────── */

const NUM_STARS  = 260;
const STAR_SPEED = 0.012;

let _sfCanvas = null;
let _sfCtx    = null;
let _stars    = [];
let _bursts   = [];  // { x, y, r, alpha, color }

function initStarfield(canvas) {
  _sfCanvas = canvas;
  _sfCtx    = canvas.getContext('2d');
  _resizeSf();
  window.addEventListener('resize', _resizeSf);

  for (let i = 0; i < NUM_STARS; i++) {
    _stars.push(_makeStar(true));
  }
  _animateSf();
}

function _resizeSf() {
  _sfCanvas.width  = window.innerWidth;
  _sfCanvas.height = window.innerHeight;
}

function _makeStar(randomPos = false) {
  const z = Math.random();
  return {
    x: Math.random() * window.innerWidth,
    y: randomPos ? Math.random() * window.innerHeight : -2,
    r: 0.4 + z * 2,
    speed: STAR_SPEED + z * 0.04,
    alpha: 0.3 + z * 0.7,
    twinklePhase: Math.random() * Math.PI * 2,
    twinkleSpeed: 0.02 + Math.random() * 0.04,
    hue: Math.random() < 0.15 ? 280 + Math.random() * 60 : 0,  // most white, some purple
    burst: false,
  };
}

function starBurst(x, y, color) {
  for (let i = 0; i < 12; i++) {
    _bursts.push({
      x, y,
      dx: (Math.random() - 0.5) * 4,
      dy: (Math.random() - 0.5) * 4,
      r:  1 + Math.random() * 3,
      alpha: 1,
      color,
    });
  }
}

function _animateSf() {
  requestAnimationFrame(_animateSf);
  const ctx = _sfCtx;
  ctx.fillStyle = 'rgba(5,5,16,0.25)';
  ctx.fillRect(0, 0, _sfCanvas.width, _sfCanvas.height);

  _stars.forEach(s => {
    s.y += s.speed;
    s.twinklePhase += s.twinkleSpeed;
    const alpha = s.alpha * (0.7 + 0.3 * Math.sin(s.twinklePhase));

    if (s.hue) {
      ctx.fillStyle = `hsla(${s.hue},80%,80%,${alpha})`;
    } else {
      ctx.fillStyle = `rgba(220,220,255,${alpha})`;
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();

    if (s.y > _sfCanvas.height + 4) Object.assign(s, _makeStar(false));
  });

  _bursts = _bursts.filter(b => {
    b.x += b.dx;
    b.y += b.dy;
    b.alpha -= 0.035;
    if (b.alpha <= 0) return false;
    ctx.fillStyle = b.color.replace(')', `,${b.alpha})`).replace('rgb(', 'rgba(');
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    return true;
  });
}

/* ── Spectrum visualizer ─────────────────────────────────────────────── */

let _visCanvas   = null;
let _visCtx      = null;
let _pulseAlpha  = 0;

// Frequency band colour stops (for the gradient)
const BAND_COLORS = [
  { pos: 0.0,  color: '#7b2fff' },  // sub-bass
  { pos: 0.15, color: '#ff4ecd' },  // bass
  { pos: 0.35, color: '#00e5ff' },  // mid
  { pos: 0.6,  color: '#39ff14' },  // high-mid
  { pos: 0.8,  color: '#ffd700' },  // presence
  { pos: 1.0,  color: '#ff4444' },  // ultrasonic (above hearing)
];

function initVisualizer(canvas) {
  _visCanvas = canvas;
  _visCtx    = canvas.getContext('2d');
  _resizeVis();
  window.addEventListener('resize', _resizeVis);
  _animateVis();
}

function _resizeVis() {
  _visCanvas.width  = _visCanvas.offsetWidth;
  _visCanvas.height = _visCanvas.offsetHeight;
}

function visPulse() {
  _pulseAlpha = 1;
}

function _animateVis() {
  requestAnimationFrame(_animateVis);
  const ctx     = _visCtx;
  const analyser = getAnalyser();

  const W = _visCanvas.width;
  const H = _visCanvas.height;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#0d0d2b';
  ctx.fillRect(0, 0, W, H);

  if (!analyser) return;

  const bufLen = analyser.frequencyBinCount;
  const data   = new Uint8Array(bufLen);
  analyser.getByteFrequencyData(data);

  const barW   = W / bufLen * 2.5;
  const numBars = Math.floor(W / (barW + 1));

  // Build gradient
  const grad = ctx.createLinearGradient(0, H, 0, 0);
  BAND_COLORS.forEach(({ pos, color }) => grad.addColorStop(pos, color));

  ctx.fillStyle = grad;

  for (let i = 0; i < numBars; i++) {
    const idx   = Math.floor((i / numBars) * bufLen);
    const value = data[idx] / 255;
    const barH  = value * H;
    const x     = i * (barW + 1);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, H - barH, barW, barH);
  }

  // Waveform overlay
  analyser.getByteTimeDomainData(data);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#7b2fff';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  const sliceW = W / bufLen;
  let x = 0;
  for (let i = 0; i < bufLen; i++) {
    const v = data[i] / 128.0;
    const y = (v * H) / 2;
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
    x += sliceW;
  }
  ctx.stroke();

  // Pulse flash on key press
  if (_pulseAlpha > 0) {
    ctx.globalAlpha = _pulseAlpha * 0.25;
    ctx.fillStyle   = '#7b2fff';
    ctx.fillRect(0, 0, W, H);
    _pulseAlpha -= 0.06;
  }

  ctx.globalAlpha = 1;
}

export { initStarfield, initVisualizer, starBurst, visPulse };
