/**
 * 秒数を "M:SS" または "MM:SS" にフォーマット
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatMmSs(totalSeconds) {
  if (totalSeconds == null || Number.isNaN(totalSeconds) || totalSeconds < 0) return '0:00';
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * "M:SS" / "MM:SS" 形式の文字列を秒数にパース。無効な場合は null
 * @param {string} str
 * @returns {number | null}
 */
export function parseMmSs(str) {
  const t = str.trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length !== 2) return null;
  const m = parseInt(parts[0], 10);
  const s = parseInt(parts[1], 10);
  if (Number.isNaN(m) || Number.isNaN(s) || m < 0 || s < 0 || s >= 60) return null;
  return m * 60 + s;
}

/**
 * リスト上の「1トラックの長さ」を秒で返す。
 * 最大再生時間が指定されていればその秒数、未指定なら素材の長さ。
 * @param {{ duration: number | null; maxLoopSeconds: number | null }} item
 * @returns {number}
 */
export function getTrackLength(item) {
  if (item.maxLoopSeconds != null && item.maxLoopSeconds > 0) return item.maxLoopSeconds;
  return item.duration ?? 0;
}

/**
 * 各トラックのリスト先頭からの再生開始時刻（秒）の配列を返す。
 * @param {{ duration: number | null; maxLoopSeconds: number | null }[]} items
 * @returns {number[]}
 */
export function getListStartTimes(items) {
  const out = [];
  let t = 0;
  for (let i = 0; i < items.length; i++) {
    out.push(t);
    t += getTrackLength(items[i]);
  }
  return out;
}
