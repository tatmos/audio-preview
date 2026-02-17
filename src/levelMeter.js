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
 * Low / Mid / Hi のレベルを 実際の dB で返す。未初期化時は DB_SILENCE。
 * getFloatFrequencyData は 20*log10(magnitude) なので、0 dB = フルスケールを超えない。
 * @returns {{ low: number; mid: number; hi: number }}
 */
export function getLevels() {
  if (!analyser || !frequencyDataFloat) {
    return { low: DB_SILENCE, mid: DB_SILENCE, hi: DB_SILENCE };
  }
  if (audioContext?.state === 'suspended') {
    audioContext.resume?.();
  }
  analyser.getFloatFrequencyData(frequencyDataFloat);
  const n = frequencyDataFloat.length;
  const lowEnd = Math.min(3, n);
  const midEnd = Math.min(Math.floor(n * 0.4), n);
  return {
    low: maxDbInRange(frequencyDataFloat, 0, lowEnd),
    mid: maxDbInRange(frequencyDataFloat, lowEnd, midEnd),
    hi: maxDbInRange(frequencyDataFloat, midEnd, n),
  };
}
