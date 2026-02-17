/** @type {AudioContext | null} */
let audioContext = null;
/** @type {AnalyserNode | null} */
let analyser = null;
/** @type {Float32Array | null} */
let frequencyDataFloat = null;

const FFT_SIZE = 256;

/**
 * 再生開始前に呼ぶ。Audio を Web Audio API に接続し Analyser を用意する。
 * @param {HTMLMediaElement} audioElement
 */
export function start(audioElement) {
  if (analyser) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaElementSource(audioElement);
    const anal = ctx.createAnalyser();
    anal.fftSize = FFT_SIZE;
    anal.smoothingTimeConstant = 0.7;
    anal.minDecibels = -60;
    anal.maxDecibels = 0;
    source.connect(anal);
    anal.connect(ctx.destination);
    audioContext = ctx;
    analyser = anal;
    frequencyDataFloat = new Float32Array(anal.frequencyBinCount);
  } catch (_) {
    // Web Audio API が使えない環境では無視
  }
}

/** 無音時の dB（-Infinity の代わりに使う） */
const DB_SILENCE = -60;

/**
 * 配列内の最大 dB を返す。-Infinity / NaN は DB_SILENCE として扱う。
 * @param {Float32Array} arr
 * @param {number} start
 * @param {number} end
 * @returns {number}
 */
function maxDbInRange(arr, start, end) {
  let max = DB_SILENCE;
  for (let i = start; i < end; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v > max) max = v;
  }
  return max;
}

/**
 * 指定バンド数で周波数ビンを等分し、各バンドの最大 dB を返す。
 * 未初期化時は全バンド DB_SILENCE。
 * @param {number} numBands 3〜7
 * @returns {number[]}
 */
export function getLevelsBands(numBands) {
  const bands = Math.max(3, Math.min(7, Math.round(numBands)));
  if (!analyser || !frequencyDataFloat) {
    return new Array(bands).fill(DB_SILENCE);
  }
  if (audioContext?.state === 'suspended') {
    audioContext.resume?.();
  }
  analyser.getFloatFrequencyData(frequencyDataFloat);
  const n = frequencyDataFloat.length;
  const out = [];
  for (let i = 0; i < bands; i++) {
    const start = Math.floor((i * n) / bands);
    const end = Math.floor(((i + 1) * n) / bands);
    out.push(maxDbInRange(frequencyDataFloat, start, Math.max(start, end)));
  }
  return out;
}

/**
 * Low / Mid / Hi のレベルを 実際の dB で返す。未初期化時は DB_SILENCE。
 * @returns {{ low: number; mid: number; hi: number }}
 */
export function getLevels() {
  const [low, mid, hi] = getLevelsBands(3);
  return { low, mid, hi };
}
