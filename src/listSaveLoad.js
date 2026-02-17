import { formatMmSs, parseMmSs } from './utils.js';

/**
 * 1行をパース。フォーマット: name \t loop(0|1) \t max(MM:SS or empty)
 * ファイル名にタブが含まれる場合: 最後の2列が loop / max で、それより前を name とする。
 * @param {string} line
 * @returns {{ name: string; loop: boolean; maxLoopSeconds: number | null } | null}
 */
function parseLine(line) {
  const t = line.trim();
  if (!t) return null;
  const parts = t.split('\t');
  if (parts.length >= 3) {
    const name = parts.slice(0, -2).join('\t').trim();
    const loop = parts[parts.length - 2] === '1';
    const maxStr = parts[parts.length - 1].trim();
    const maxLoopSeconds = maxStr ? parseMmSs(maxStr) : null;
    return { name, loop, maxLoopSeconds };
  }
  if (parts.length === 2) {
    return {
      name: parts[0].trim(),
      loop: parts[1] === '1',
      maxLoopSeconds: null,
    };
  }
  if (parts.length === 1) {
    return { name: parts[0].trim(), loop: false, maxLoopSeconds: null };
  }
  return null;
}

/**
 * リスト内容をテキストに変換（タブ区切り、1行1曲）
 * @param {{ name: string; loop: boolean; maxLoopSeconds: number | null }[]} items
 * @returns {string}
 */
export function listToText(items) {
  return items
    .map(
      (it) =>
        `${it.name}\t${it.loop ? 1 : 0}\t${it.maxLoopSeconds != null ? formatMmSs(it.maxLoopSeconds) : ''}`
    )
    .join('\n');
}

/**
 * テキストをパースしてリストデータに変換
 * @param {string} text
 * @returns {{ name: string; loop: boolean; maxLoopSeconds: number | null }[]}
 */
export function textToList(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed && parsed.name) result.push(parsed);
  }
  return result;
}
