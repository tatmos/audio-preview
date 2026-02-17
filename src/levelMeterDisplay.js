/** 1秒分 = 100サンプル（10ms間隔） */
const HISTORY_LEN = 100;
const SAMPLE_MS = 10;

/** バンド数 3〜7 に対応する履歴バッファの配列。bandsBuf[i] が i 番目のバンド */
let bandsBuf = [
  new Array(HISTORY_LEN).fill(0),
  new Array(HISTORY_LEN).fill(0),
  new Array(HISTORY_LEN).fill(0),
];
let writeIndex = 0;
/** 現在のバンド数（3〜7） */
let bandCount = 3;

/** @type {HTMLCanvasElement | null} */
let canvas = null;
/** @type {number} */
let animationId = 0;
/** @type {(numBands: number) => number[]} */
let getLevelsForBands = () => [];

/** 最大7バンド用の色（3バンド時は 0,1,2 を Low/Mid/Hi に相当） */
const BAND_COLORS = [
  '#2e7d32', // 0: Low
  '#1565c0', // 1: Mid
  '#c62828', // 2: Hi
  '#6a1b9a', // 3
  '#ef6c00', // 4
  '#00838f', // 5
  '#558b2f', // 6
];

const LOGICAL_WIDTH = 200;
const LOGICAL_HEIGHT = 60;
const AXIS_MARGIN = 34;

/** 表示する dB レンジ（getFloatFrequencyData の実際の dB をこの範囲で正規化） */
const DB_MIN = -60;
const DB_MAX = 0;

/** 縦軸の目盛り。実際の dB を表示。0=上、-60=下 */
const AXIS_TICKS = [
  { db: 0, label: '0 dB' },
  { db: -6, label: '-6 dB' },
  { db: -12, label: '-12 dB' },
  { db: -18, label: '-18 dB' },
  { db: -24, label: '-24 dB' },
  { db: -48, label: '-48 dB' },
  { db: -60, label: '-60 dB' },
];

/** dB を縦軸の正規化位置 0〜1 に変換（0 dB=1=上、DB_MIN=0=下） */
function dbToNorm(db) {
  const d = Number(db);
  if (!Number.isFinite(d) || d <= DB_MIN) return 0;
  if (d >= DB_MAX) return 1;
  return (d - DB_MIN) / (DB_MAX - DB_MIN);
}

/**
 * 縦軸の目盛りとラベルを描画（レベル値 dB）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} height
 */
function drawAxis(ctx, height) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (const { db, label } of AXIS_TICKS) {
    const norm = dbToNorm(db);
    const y = (1 - norm) * height;
    ctx.fillText(label, AXIS_MARGIN - 4, y);
    ctx.beginPath();
    ctx.moveTo(AXIS_MARGIN, y);
    ctx.lineTo(LOGICAL_WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 1本の履歴を線グラフで描画。縦軸は共通（0=上、1=下）。左=古い、右=新しい。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number[]} buf
 * @param {string} color
 * @param {number} graphWidth
 * @param {number} height
 * @param {number} offsetX
 */
function drawLineStrip(ctx, buf, color, graphWidth, height, offsetX) {
  const stepX = graphWidth / (HISTORY_LEN - 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < HISTORY_LEN; i++) {
    const idx = (writeIndex + 1 + i) % HISTORY_LEN;
    const norm = dbToNorm(buf[idx]);
    const x = offsetX + i * stepX;
    const y = (1 - norm) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** dB 値をバッファ用にクリップ（表示レンジ外は端に寄せる） */
function clampDb(db) {
  const d = Number(db);
  if (!Number.isFinite(d)) return DB_MIN;
  return Math.max(DB_MIN, Math.min(DB_MAX, d));
}

function tick() {
  const levels = getLevelsForBands(bandCount);
  for (let i = 0; i < bandCount; i++) {
    bandsBuf[i][writeIndex] = clampDb(levels[i] ?? -60);
  }
  writeIndex = (writeIndex + 1) % HISTORY_LEN;

  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = LOGICAL_WIDTH;
  const h = LOGICAL_HEIGHT;
  const graphWidth = w - AXIS_MARGIN;
  const offsetX = AXIS_MARGIN;

  ctx.clearRect(0, 0, w, h);
  drawAxis(ctx, h);
  for (let i = 0; i < bandCount; i++) {
    drawLineStrip(ctx, bandsBuf[i], BAND_COLORS[i], graphWidth, h, offsetX);
  }
}

function ensureBuffersForBands(n) {
  const num = Math.max(3, Math.min(7, Math.round(n)));
  if (bandsBuf.length !== num) {
    bandsBuf = Array.from({ length: num }, () => new Array(HISTORY_LEN).fill(0));
  }
  bandCount = num;
}

const BAND_LABELS_3 = ['Low', 'Mid', 'Hi'];

function renderLabels() {
  const labelRow = document.querySelector('.level-strip-labels');
  if (!labelRow) return;
  labelRow.innerHTML = '';
  for (let i = 0; i < bandCount; i++) {
    const span = document.createElement('span');
    span.className = 'level-legend';
    span.style.color = BAND_COLORS[i];
    span.textContent = bandCount === 3 ? BAND_LABELS_3[i] : String(i + 1);
    labelRow.appendChild(span);
  }
}

/**
 * ストリップ表示を開始。バンド数 3〜7 を選択可能。
 * @param {HTMLElement} container
 * @param {(numBands: number) => number[]} getLevelsFn
 */
export function init(container, getLevelsFn) {
  if (!container) return;

  getLevelsForBands = getLevelsFn;
  ensureBuffersForBands(3);

  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'level-strip-wrap';
  wrap.setAttribute('aria-label', 'レベルメーター（バンド数選択・過去1秒・共通縦軸）');

  const topRow = document.createElement('div');
  topRow.className = 'level-strip-top';
  const labelRow = document.createElement('div');
  labelRow.className = 'level-strip-labels';
  const selectWrap = document.createElement('div');
  selectWrap.className = 'level-strip-bands-select';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'バンド数');
  for (let n = 3; n <= 7; n++) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = `${n}バンド`;
    if (n === 3) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    const n = Number(select.value);
    ensureBuffersForBands(n);
    renderLabels();
  });
  selectWrap.appendChild(select);
  topRow.appendChild(labelRow);
  topRow.appendChild(selectWrap);
  wrap.appendChild(topRow);

  renderLabels();

  canvas = document.createElement('canvas');
  canvas.className = 'level-strip-canvas';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = LOGICAL_WIDTH * dpr;
  canvas.height = LOGICAL_HEIGHT * dpr;
  canvas.style.width = `${LOGICAL_WIDTH}px`;
  canvas.style.height = `${LOGICAL_HEIGHT}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.scale(dpr, dpr);
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  let last = 0;
  function loop(now) {
    if (now - last >= SAMPLE_MS) {
      last = now;
      tick();
    }
    animationId = requestAnimationFrame(loop);
  }
  animationId = requestAnimationFrame(loop);
}

export function destroy() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = 0;
  }
  canvas = null;
}
