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
