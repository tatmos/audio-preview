import './styles.css';
import { initDropzone } from './dropzone.js';
import { initList } from './list.js';
import { getItems, setCurrentIndex, getCurrentIndex, getNextPlaybackAction, setCurrentTime, setPaused, loadListData } from './state.js';
import { play as audioPlay, pause as audioPause, setOnEnded, getAudioElement } from './audio.js';
import { formatMmSs } from './utils.js';
import * as levelMeter from './levelMeter.js';
import * as levelMeterDisplay from './levelMeterDisplay.js';
import { listToText, textToList } from './listSaveLoad.js';

/** 再生用に使っている Object URL（ループで再利用するため保持） */
let currentPlayUrl = null;

function playItemAtIndex(index) {
  const items = getItems();
  if (index < 0 || index >= items.length) return;
  const item = items[index];
  if (!currentPlayUrl) {
    currentPlayUrl = URL.createObjectURL(item.file);
  } else {
    URL.revokeObjectURL(currentPlayUrl);
    currentPlayUrl = URL.createObjectURL(item.file);
  }
  levelMeter.start(getAudioElement());
  audioPlay(currentPlayUrl);
  setCurrentIndex(index);
  setPaused(false);
}

function handleEnded() {
  const action = getNextPlaybackAction();
  if (action.action === 'loop') {
    setPaused(false);
    audioPlay(currentPlayUrl);
    return;
  }
  if (action.action === 'next') {
    setCurrentIndex(action.index);
    setPaused(false);
    const items = getItems();
    const item = items[action.index];
    if (currentPlayUrl) URL.revokeObjectURL(currentPlayUrl);
    currentPlayUrl = URL.createObjectURL(item.file);
    audioPlay(currentPlayUrl);
    return;
  }
  if (action.action === 'stop') {
    setCurrentIndex(null);
    if (currentPlayUrl) {
      URL.revokeObjectURL(currentPlayUrl);
      currentPlayUrl = null;
    }
  }
}

function pausePlayback() {
  audioPause();
  setPaused(true);
}

function stopPlayback() {
  audioPause();
  setCurrentIndex(null);
  if (currentPlayUrl) {
    URL.revokeObjectURL(currentPlayUrl);
    currentPlayUrl = null;
  }
}

function seekPlayback(seconds) {
  const audio = getAudioElement();
  const idx = getCurrentIndex();
  if (idx === null) return;
  const sec = Math.max(0, seconds);
  audio.currentTime = sec;
  setCurrentTime(sec);
}

/** 次の行に切り替えて再生。最後の行のときは停止。再生中でないときは先頭を再生。 */
function goToNext() {
  const items = getItems();
  const idx = getCurrentIndex();
  if (items.length === 0) return;
  if (idx === null) {
    playItemAtIndex(0);
    return;
  }
  const nextIndex = idx + 1;
  if (nextIndex >= items.length) {
    stopPlayback();
    return;
  }
  playItemAtIndex(nextIndex);
}

function saveList() {
  const items = getItems();
  if (!items.length) return;
  const text = listToText(items.map((it) => ({ name: it.name, loop: it.loop, maxLoopSeconds: it.maxLoopSeconds })));
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'audio-list.txt';
  a.click();
  URL.revokeObjectURL(url);
}

function loadList() {
  const input = document.getElementById('input-load-list');
  if (!input) return;
  input.value = '';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const parsed = textToList(text);
      if (parsed.length) loadListData(parsed);
    };
    reader.readAsText(file, 'UTF-8');
  };
  input.click();
}

function init() {
  initDropzone(document.getElementById('dropzone'));

  const btnSave = document.getElementById('btn-save-list');
  const btnLoad = document.getElementById('btn-load-list');
  if (btnSave) btnSave.addEventListener('click', saveList);
  if (btnLoad) btnLoad.addEventListener('click', loadList);

  initList(document.getElementById('list-container'), {
    onPlayRequest(index) {
      playItemAtIndex(index);
    },
    onPauseRequest: pausePlayback,
    onStopRequest: stopPlayback,
    onSeekRequest: seekPlayback,
  });

  setOnEnded(handleEnded);

  const elapsedEl = document.getElementById('elapsed-display');
  const progressFillEl = document.getElementById('elapsed-progress-fill');
  const progressBarEl = document.querySelector('.elapsed-progress-bar');
  const btnNext = document.getElementById('btn-next');
  const levelMetersEl = document.getElementById('level-meters');
  const audio = getAudioElement();

  if (btnNext) btnNext.addEventListener('click', goToNext);

  if (levelMetersEl) {
    levelMeterDisplay.init(levelMetersEl, () => levelMeter.getLevels());
  }

  setInterval(() => {
    const items = getItems();
    const idx = getCurrentIndex();

    const listTotal = items.reduce((sum, it) => sum + (it.duration ?? 0), 0);
    let listElapsed = 0;
    if (idx !== null && idx >= 0) {
      for (let i = 0; i < idx; i++) listElapsed += items[i].duration ?? 0;
      listElapsed += audio.currentTime;
    }
    if (elapsedEl) {
      elapsedEl.textContent = `再生経過: ${formatMmSs(listElapsed)} / ${formatMmSs(listTotal)}`;
    }

    const pct = listTotal > 0 ? Math.min(100, (listElapsed / listTotal) * 100) : 0;
    if (progressFillEl) progressFillEl.style.width = `${pct}%`;
    if (progressBarEl) {
      progressBarEl.setAttribute('aria-valuenow', String(Math.round(pct)));
    }

    if (idx !== null) {
      const sec = audio.currentTime;
      setCurrentTime(sec);
    }
  }, 500);
}

init();
