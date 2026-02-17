/** @typedef {{ id: string; file: File; name: string; loop: boolean; maxLoopSeconds: number | null; duration: number | null }} ListItem */

/** @type {ListItem[]} */
let items = [];

/** @type {number | null} 再生中のインデックス（IDで追う場合は getCurrentIndex() で解決） */
let currentIndex = null;

/** @type {number | null} 再生開始時刻（ループ＋最大時間判定用） */
let startedAt = null;

/** @type {number} 現在の再生位置（秒）。停止中は 0 */
let currentTime = 0;

/** @type {boolean} 一時停止中か（currentIndex が有効なときのみ意味を持つ） */
let isPaused = false;

/** @type {(items: ListItem[], currentIndex: number | null) => void} */
let onUpdate = () => {};

/** @type {() => void} 再生位置のみ更新（リスト全体の再描画を避ける） */
let onTimeUpdate = () => {};

/**
 * @param {(items: ListItem[], currentIndex: number | null) => void} fn
 */
export function subscribe(fn) {
  onUpdate = fn;
}

/**
 * 再生位置（currentTime）変更時のみ呼ばれる。リスト再描画ではなく再生位置表示の部分更新用。
 * @param {() => void} fn
 */
export function subscribeToTime(fn) {
  onTimeUpdate = fn;
}

function notify() {
  onUpdate([...items], currentIndex);
}

/**
 * @returns {ListItem[]}
 */
export function getItems() {
  return [...items];
}

/**
 * @returns {number | null}
 */
export function getCurrentIndex() {
  return currentIndex;
}

/**
 * @returns {number | null}
 */
export function getStartedAt() {
  return startedAt;
}

/**
 * @returns {number}
 */
export function getCurrentTime() {
  return currentTime;
}

/**
 * @returns {boolean}
 */
export function getIsPaused() {
  return isPaused;
}

/**
 * @param {boolean} value
 */
export function setPaused(value) {
  isPaused = value;
  notify();
}

/**
 * @param {number} sec
 */
export function setCurrentTime(sec) {
  currentTime = Math.max(0, sec);
  onTimeUpdate();
}

/**
 * @param {File[]} files
 */
export function addFiles(files) {
  const audioFiles = Array.from(files).filter((f) => f.type.startsWith('audio/'));
  for (const file of audioFiles) {
    items.push({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      loop: false,
      maxLoopSeconds: null,
      duration: null,
    });
  }
  notify();
}

/**
 * @param {number} index
 */
export function setCurrentIndex(index) {
  currentIndex = index >= 0 && index < items.length ? index : null;
  startedAt = currentIndex !== null ? Date.now() : null;
  currentTime = 0;
  isPaused = currentIndex === null;
  notify();
}

/**
 * 再生開始時刻をリセット（ループで同じ曲を再度再生するときに呼ぶ）
 */
export function resetStartedAt() {
  startedAt = Date.now();
  notify();
}

/**
 * 次に再生すべきインデックスを算出。
 * ループONかつ最大時間内なら null（同じ曲を続ける）、そうでなければ次のインデックス or null（終了）。
 * @returns {{ action: 'loop' } | { action: 'next'; index: number } | { action: 'stop' }}
 */
export function getNextPlaybackAction() {
  if (currentIndex === null || currentIndex >= items.length) {
    return { action: 'stop' };
  }
  const item = items[currentIndex];
  const elapsed = startedAt !== null ? (Date.now() - startedAt) / 1000 : 0;

  if (item.loop && item.maxLoopSeconds != null && item.maxLoopSeconds > 0) {
    if (elapsed >= item.maxLoopSeconds) {
      const nextIndex = currentIndex + 1;
      if (nextIndex < items.length) {
        return { action: 'next', index: nextIndex };
      }
      return { action: 'stop' };
    }
    return { action: 'loop' };
  }

  if (item.loop && (item.maxLoopSeconds == null || item.maxLoopSeconds <= 0)) {
    return { action: 'loop' };
  }

  const nextIndex = currentIndex + 1;
  if (nextIndex < items.length) {
    return { action: 'next', index: nextIndex };
  }
  return { action: 'stop' };
}

/**
 * @param {number} fromIndex
 * @param {number} toIndex
 */
export function moveItem(fromIndex, toIndex) {
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return;
  const [removed] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, removed);
  if (currentIndex === fromIndex) {
    currentIndex = toIndex;
  } else if (currentIndex !== null) {
    if (fromIndex < currentIndex && toIndex >= currentIndex) currentIndex--;
    else if (fromIndex > currentIndex && toIndex <= currentIndex) currentIndex++;
  }
  notify();
}

/**
 * @param {string} id
 * @param {{ loop?: boolean; maxLoopSeconds?: number | null; duration?: number | null }} patch
 */
export function updateItem(id, patch) {
  const i = items.findIndex((it) => it.id === id);
  if (i === -1) return;
  if (patch.loop !== undefined) items[i].loop = patch.loop;
  if (patch.maxLoopSeconds !== undefined) items[i].maxLoopSeconds = patch.maxLoopSeconds;
  if (patch.duration !== undefined) items[i].duration = patch.duration;
  notify();
}

/**
 * 並び順とループ・最大再生時間をテキストから復元。ファイル名で現在のリストと照合し、順序と設定を適用する。
 * @param {{ name: string; loop: boolean; maxLoopSeconds: number | null }[]} parsed
 */
export function loadListData(parsed) {
  if (!parsed.length) return;
  const current = [...items];
  const used = new Set();
  const newItems = [];
  for (const p of parsed) {
    const idx = current.findIndex((it) => it.name === p.name && !used.has(it.id));
    if (idx >= 0) {
      const item = { ...current[idx], loop: p.loop, maxLoopSeconds: p.maxLoopSeconds };
      used.add(current[idx].id);
      newItems.push(item);
    }
  }
  for (const it of current) {
    if (!used.has(it.id)) newItems.push(it);
  }
  const playingId = currentIndex !== null && currentIndex < current.length ? current[currentIndex].id : null;
  items = newItems;
  currentIndex = playingId !== null ? items.findIndex((it) => it.id === playingId) : null;
  if (currentIndex === -1) currentIndex = null;
  notify();
}
