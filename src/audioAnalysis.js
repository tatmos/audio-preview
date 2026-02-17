import { guess } from 'web-audio-beat-detector';
import { updateItem } from './state.js';

/** BPM 解析中の id を保持（二重リクエスト防止） */
const analyzingBpmIds = new Set();

/**
 * ファイルをデコードして AudioBuffer を取得
 * @param {File} file
 * @returns {Promise<AudioBuffer>}
 */
function decodeToBuffer(file) {
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
 * Key は Essentia.js 等の専用ライブラリが必要なため未実装。
 * 必要なら item.key を別モジュールで updateItem(id, { key }) する。
 */
