const audio = new Audio();

/** @type {string | null} 現在再生に使っている Object URL（revoke 用） */
let currentObjectUrl = null;

/** @type {() => void} 再生終了時に呼ばれるコールバック */
let onEndedCallback = () => {};

/**
 * @param {() => void} fn
 */
export function setOnEnded(fn) {
  onEndedCallback = fn;
}

/**
 * @param {string} url Object URL
 */
export function play(url) {
  if (currentObjectUrl === url) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  revokeCurrent();
  currentObjectUrl = url;
  audio.src = url;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function pause() {
  audio.pause();
}

export function getAudioElement() {
  return audio;
}

function revokeCurrent() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

audio.addEventListener('ended', () => {
  onEndedCallback();
});
