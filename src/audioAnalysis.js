import { guess } from 'web-audio-beat-detector';
import { updateItem } from './state.js';

/** BPM 解析中の id を保持（二重リクエスト防止） */
const analyzingBpmIds = new Set();
/** Key 解析中の id を保持 */
const analyzingKeyIds = new Set();
/** Essentia インスタンス（遅延初期化） */
let essentiaInstance = null;

/**
 * ファイルをデコードして AudioBuffer を取得
 * @param {File} file
 * @returns {Promise<AudioBuffer>}
 */
export function decodeToBuffer(file) {
  return new Promise((resolve, reject) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result;
      if (!(buf instanceof ArrayBuffer)) {
        reject(new Error('Failed to read file'));
        return;
      }
      ctx.decodeAudioData(buf).then((audioBuffer) => {
        ctx.close();
        resolve(audioBuffer);
      }).catch((err) => {
        ctx.close();
        reject(err);
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * 1件の BPM を非同期で取得して state に反映
 * @param {{ id: string; file: File; bpm: number | null }} item
 */
export function loadBpm(item) {
  if (item.bpm != null || analyzingBpmIds.has(item.id)) return;
  analyzingBpmIds.add(item.id);
  decodeToBuffer(item.file)
    .then((audioBuffer) => guess(audioBuffer, { minTempo: 60, maxTempo: 200 }))
    .then(({ bpm }) => {
      if (Number.isFinite(bpm) && bpm >= 1) updateItem(item.id, { bpm: Math.round(bpm) });
    })
    .catch(() => {})
    .finally(() => analyzingBpmIds.delete(item.id));
}

/**
 * スクリプトを1本読み込む
 * @param {string} src
 * @returns {Promise<void>}
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

/**
 * Essentia.js を CDN から非同期で読み込み、インスタンスを返す（ブラウザ用）
 * @returns {Promise<{ KeyExtractor: Function, arrayToVector: Function, audioBufferToMonoSignal: Function }>}
 */
async function getEssentia() {
  if (essentiaInstance) return essentiaInstance;
  const base = 'https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist';
  await loadScript(`${base}/essentia-wasm.web.js`);
  await loadScript(`${base}/essentia.js-core.js`);
  const wasm = await window.EssentiaWASM();
  essentiaInstance = new window.Essentia(wasm);
  return essentiaInstance;
}

/**
 * 1件の Key を非同期で取得して state に反映（Essentia.js 使用）
 * @param {{ id: string; file: File; key: string | null }} item
 */
export function loadKey(item) {
  if ((item.key != null && item.key !== '') || analyzingKeyIds.has(item.id)) return;
  analyzingKeyIds.add(item.id);
  getEssentia()
    .then((essentia) => decodeToBuffer(item.file).then((buf) => ({ essentia, buf })))
    .then(({ essentia, buf }) => {
      const mono = essentia.audioBufferToMonoSignal(buf);
      const vector = essentia.arrayToVector(mono);
      const result = essentia.KeyExtractor(
        vector,
        true,
        4096,
        4096,
        12,
        3500,
        60,
        25,
        0.2,
        'bgate',
        buf.sampleRate
      );
      const keyStr = [result.key, result.scale].filter(Boolean).join(' ') || null;
      if (keyStr) updateItem(item.id, { key: keyStr });
    })
    .catch(() => {
      updateItem(item.id, { key: '' });
    })
    .finally(() => analyzingKeyIds.delete(item.id));
}

const FRAME_SIZE = 4096;
const HOP_SIZE = 2048;

/**
 * モノラル信号から HPCP フレーム列を計算（Windowing → Spectrum → SpectralPeaks → HPCP）
 * @param {{ arrayToVector: Function, vectorToArray: Function, Windowing: Function, Spectrum: Function, SpectralPeaks: Function, HPCP: Function }} essentia
 * @param {Float32Array} mono
 * @param {number} sr
 * @returns {number[][]} 各フレームの HPCP 12次元ベクトルの配列
 */
function computeHPCPFrames(essentia, mono, sr) {
  const hpcpFrames = [];
  for (let start = 0; start + FRAME_SIZE <= mono.length; start += HOP_SIZE) {
    const frame = mono.slice(start, start + FRAME_SIZE);
    const frameVec = essentia.arrayToVector(frame);
    const windowed = essentia.Windowing(frameVec, false, FRAME_SIZE, 'hann', 0, true).frame;
    const spectrum = essentia.Spectrum(windowed, FRAME_SIZE).spectrum;
    const peaks = essentia.SpectralPeaks(spectrum, 0, 4500, 60, 80, 'frequency', sr);
    const hpcp = essentia.HPCP(
      peaks.frequencies,
      peaks.magnitudes,
      true,
      500,
      0,
      4500,
      false,
      80,
      false,
      'unitMax',
      440,
      sr,
      12,
      'squaredCosine',
      1
    ).hpcp;
    hpcpFrames.push(essentia.vectorToArray(hpcp));
  }
  return hpcpFrames;
}

/**
 * AudioBuffer の指定区間（秒）から Key を解析（リアルタイム表示用）
 * @param {AudioBuffer} audioBuffer
 * @param {number} startSec
 * @param {number} endSec
 * @returns {Promise<string | null>} "C major" など。解析失敗時は null
 */
export function analyzeKeyFromSegment(audioBuffer, startSec, endSec) {
  const sr = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample = Math.min(audioBuffer.length, Math.ceil(endSec * sr));
  if (endSample - startSample < sr * 1) return Promise.resolve(null); // 1秒未満は解析しない

  const ch0 = audioBuffer.getChannelData(0);
  const segment = ch0.slice(startSample, endSample);
  if (audioBuffer.numberOfChannels === 2) {
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < segment.length; i++) {
      segment[i] = (segment[i] + ch1[startSample + i]) / 2;
    }
  }

  return getEssentia()
    .then((essentia) => {
      const vector = essentia.arrayToVector(segment);
      const result = essentia.KeyExtractor(
        vector,
        true,
        4096,
        4096,
        12,
        3500,
        60,
        25,
        0.2,
        'bgate',
        sr
      );
      const keyPart = (result.key != null ? String(result.key).trim() : '') || '';
      const scalePart = (result.scale != null ? String(result.scale).trim() : '') || '';
      const k = keyPart === 'NaN' ? '' : keyPart;
      const sc = scalePart === 'NaN' ? '' : scalePart;
      const keyStr = [k, sc].filter(Boolean).join(' ') || null;
      return keyStr || null;
    })
    .catch(() => null);
}

/**
 * AudioBuffer の指定区間（秒）からコードを解析（リアルタイム表示用）。HPCP → ChordsDetection。
 * @param {AudioBuffer} audioBuffer
 * @param {number} startSec
 * @param {number} endSec
 * @returns {Promise<string | null>} "C" "Am" など。解析失敗時は null
 */
export function analyzeChordFromSegment(audioBuffer, startSec, endSec) {
  const sr = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(startSec * sr));
  const endSample = Math.min(audioBuffer.length, Math.ceil(endSec * sr));
  if (endSample - startSample < sr * 1.5) return Promise.resolve(null);

  const ch0 = audioBuffer.getChannelData(0);
  const segment = ch0.slice(startSample, endSample);
  if (audioBuffer.numberOfChannels === 2) {
    const ch1 = audioBuffer.getChannelData(1);
    for (let i = 0; i < segment.length; i++) {
      segment[i] = (segment[i] + ch1[startSample + i]) / 2;
    }
  }

  return getEssentia()
    .then((essentia) => {
      const hpcpFrames = computeHPCPFrames(essentia, segment, sr);
      if (hpcpFrames.length === 0) return null;
      // ChordsDetection へ HPCP 列を渡す（array of arrays または WASM の VectorVectorFloat）
      let pcpInput = hpcpFrames;
      if (essentia.module && typeof essentia.module.VectorVectorFloat !== 'undefined') {
        try {
          const vvf = new essentia.module.VectorVectorFloat();
          for (let i = 0; i < hpcpFrames.length; i++) {
            vvf.push_back(essentia.arrayToVector(hpcpFrames[i]));
          }
          pcpInput = vvf;
        } catch (_) {}
      }
      const result = essentia.ChordsDetection(pcpInput, HOP_SIZE, sr, 2);
      const chords = result.chords;
      if (!chords) return null;
      let lastChord = null;
      if (Array.isArray(chords) && chords.length > 0) {
        lastChord = chords[chords.length - 1];
      } else if (typeof chords.size === 'function' && chords.size() > 0) {
        try {
          const arr = essentia.vectorToArray ? essentia.vectorToArray(chords) : null;
          lastChord = arr && arr.length ? arr[arr.length - 1] : (chords.get ? chords.get(chords.size() - 1) : null);
        } catch (_) {
          lastChord = chords.get ? chords.get(chords.size() - 1) : null;
        }
      }
      const s = lastChord != null ? String(lastChord).trim() : '';
      return (s !== '' && s !== 'NaN') ? s : null;
    })
    .catch(() => null);
}
