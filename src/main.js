import './styles.css';
import { initDropzone } from './dropzone.js';
import { initList } from './list.js';
import { getItems, setCurrentIndex, getCurrentIndex, getNextPlaybackAction, setCurrentTime, setPaused, getIsPaused, getStartedAt, setStartedAt, loadListData, setRealTimeKey, subscribeToRealtime, getRealTimeKey, getRealTimeChord } from './state.js';
import { play as audioPlay, pause as audioPause, setOnEnded, getAudioElement } from './audio.js';
import { decodeToBuffer, analyzeKeyFromSegment, analyzeChordFromSegment } from './audioAnalysis.js';
import { formatMmSs, getTrackLength, getListStartTimes } from './utils.js';
import * as levelMeter from './levelMeter.js';
import * as levelMeterDisplay from './levelMeterDisplay.js';
import { listToText, textToList } from './listSaveLoad.js';

/** 再生用に使っている Object URL（ループで再利用するため保持） */
let currentPlayUrl = null;
/** 再生中トラックのデコード済みバッファ（リアルタイム Key 用）。トラック変更・停止で null にする */
let currentPlayBuffer = null;
/** リアルタイム Key の更新間隔用タイマー ID */
let realtimeKeyTimerId = null;
/** 現在トラックでループにより既に再生した秒数（再生経過の加算用） */
let currentTrackLoopElapsed = 0;

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
  currentPlayBuffer = null;
  if (realtimeKeyTimerId != null) {
    clearInterval(realtimeKeyTimerId);
    realtimeKeyTimerId = null;
  }
  levelMeter.start(getAudioElement());
  audioPlay(currentPlayUrl);
  setCurrentIndex(index);
  setPaused(false);
  currentTrackLoopElapsed = 0;
  startRealtimeKeyUpdates();
  decodeToBuffer(item.file).then((buf) => {
    if (getCurrentIndex() !== index) return;
    currentPlayBuffer = buf;
    runRealtimeAnalysisOnce(index, buf);
  }).catch(() => {});
}

/**
 * getNextPlaybackAction() の結果に従って次曲へ／停止を実行する
 * @param {{ action: 'loop' | 'next' | 'stop'; index?: number }} action
 */
function performPlaybackAction(action) {
  if (action.action === 'loop') {
    const items = getItems();
    const idx = getCurrentIndex();
    if (idx !== null && idx < items.length) {
      currentTrackLoopElapsed += items[idx].duration ?? 0;
    }
    setPaused(false);
    audioPlay(currentPlayUrl);
    return;
  }
  if (action.action === 'next') {
    setCurrentIndex(action.index);
    setPaused(false);
    currentTrackLoopElapsed = 0;
    const items = getItems();
    const item = items[action.index];
    if (currentPlayUrl) URL.revokeObjectURL(currentPlayUrl);
    currentPlayUrl = URL.createObjectURL(item.file);
    currentPlayBuffer = null;
    audioPlay(currentPlayUrl);
    startRealtimeKeyUpdates();
    decodeToBuffer(item.file).then((buf) => {
      if (getCurrentIndex() !== action.index) return;
      currentPlayBuffer = buf;
      runRealtimeAnalysisOnce(action.index, buf);
    }).catch(() => {});
    return;
  }
  if (action.action === 'stop') {
    setCurrentIndex(null);
    currentPlayBuffer = null;
    if (realtimeKeyTimerId != null) {
      clearInterval(realtimeKeyTimerId);
      realtimeKeyTimerId = null;
    }
    if (currentPlayUrl) {
      URL.revokeObjectURL(currentPlayUrl);
      currentPlayUrl = null;
    }
  }
}

function handleEnded() {
  performPlaybackAction(getNextPlaybackAction());
}

function pausePlayback() {
  audioPause();
  setPaused(true);
}

function stopPlayback() {
  audioPause();
  setCurrentIndex(null);
  currentPlayBuffer = null;
  if (realtimeKeyTimerId != null) {
    clearInterval(realtimeKeyTimerId);
    realtimeKeyTimerId = null;
  }
  if (currentPlayUrl) {
    URL.revokeObjectURL(currentPlayUrl);
    currentPlayUrl = null;
  }
}

function runRealtimeAnalysisOnce(idx, buffer) {
  const items = getItems();
  const item = items[idx];
  const duration = item?.duration ?? buffer?.duration ?? 0;
  if (!(duration > 0)) return;
  const audio = getAudioElement();
  const t = audio.currentTime;
  const startSec = Math.max(0, t - 2);
  const endSec = Math.min(duration, t + 1);
  if (endSec <= startSec) return;
  Promise.all([
    analyzeKeyFromSegment(buffer, startSec, endSec),
    analyzeChordFromSegment(buffer, startSec, endSec),
  ]).then(([key, chord]) => {
    if (getCurrentIndex() === idx) setRealTimeKey(key, chord);
  });
}

function startRealtimeKeyUpdates() {
  if (realtimeKeyTimerId != null) return;
  realtimeKeyTimerId = setInterval(() => {
    const idx = getCurrentIndex();
    if (idx === null || !currentPlayBuffer || getIsPaused()) return;
    runRealtimeAnalysisOnce(idx, currentPlayBuffer);
  }, 1500);
}

function seekPlayback(seconds) {
  const audio = getAudioElement();
  const idx = getCurrentIndex();
  if (idx === null) return;
  const sec = Math.max(0, seconds);
  audio.currentTime = sec;
  setCurrentTime(sec);
}

/**
 * リスト全体の絶対時間（秒）でシークし、その位置から再生する
 * @param {number} listTimeSec
 */
function seekToAbsoluteListTime(listTimeSec) {
  const items = getItems();
  if (items.length === 0) return;
  const listStartTimes = getListStartTimes(items);
  const listTotal = items.reduce((s, it) => s + getTrackLength(it), 0);
  const t = Math.max(0, Math.min(listTimeSec, listTotal));
  let trackIndex = items.length - 1;
  let positionInTrack = getTrackLength(items[trackIndex]);
  for (let i = 0; i < items.length; i++) {
    const len = getTrackLength(items[i]);
    if (t < listStartTimes[i] + len) {
      trackIndex = i;
      positionInTrack = t - listStartTimes[i];
      break;
    }
  }
  const item = items[trackIndex];
  const duration = item.duration ?? 0;
  const loopElapsed = duration > 0 ? Math.floor(positionInTrack / duration) * duration : 0;
  const positionInCurrentLoop = duration > 0 ? positionInTrack % duration : 0;

  if (currentPlayUrl) URL.revokeObjectURL(currentPlayUrl);
  currentPlayUrl = URL.createObjectURL(item.file);
  currentPlayBuffer = null;
  if (realtimeKeyTimerId != null) {
    clearInterval(realtimeKeyTimerId);
    realtimeKeyTimerId = null;
  }
  currentTrackLoopElapsed = loopElapsed;
  setCurrentIndex(trackIndex);
  setPaused(false);
  setStartedAt(Date.now() - t * 1000);

  const audio = getAudioElement();
  audio.src = currentPlayUrl;
  const onReady = () => {
    audio.currentTime = positionInCurrentLoop;
    setCurrentTime(positionInCurrentLoop);
    audio.play().catch(() => {});
    levelMeter.start(audio);
    startRealtimeKeyUpdates();
    decodeToBuffer(item.file).then((buf) => {
      if (getCurrentIndex() === trackIndex) currentPlayBuffer = buf;
    }).catch(() => {});
  };
  if (audio.readyState >= 2) {
    onReady();
  } else {
    audio.addEventListener('canplay', onReady, { once: true });
  }
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
  const progressSegmentsEl = document.getElementById('elapsed-progress-segments');
  let lastSegmentCount = 0;
  let lastListTotal = 0;
  const btnNext = document.getElementById('btn-next');
  const levelMetersEl = document.getElementById('level-meters');
  const audio = getAudioElement();

  if (btnNext) btnNext.addEventListener('click', goToNext);

  if (levelMetersEl) {
    levelMeterDisplay.init(levelMetersEl, () => levelMeter.getLevels());
  }

  const realtimeKeyEl = document.getElementById('realtime-key');
  const realtimeChordEl = document.getElementById('realtime-chord');
  function updateRealtimeDisplay() {
    const fmt = (v) => (v != null && String(v) !== 'NaN' ? v : '—');
    if (realtimeKeyEl) realtimeKeyEl.textContent = fmt(getRealTimeKey());
    if (realtimeChordEl) realtimeChordEl.textContent = fmt(getRealTimeChord());
  }
  subscribeToRealtime(updateRealtimeDisplay);
  updateRealtimeDisplay();

  if (progressBarEl) {
    progressBarEl.addEventListener('click', (e) => {
      const items = getItems();
      if (items.length === 0) return;
      const listTotal = items.reduce((sum, it) => sum + getTrackLength(it), 0);
      if (listTotal <= 0) return;
      const rect = progressBarEl.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekToAbsoluteListTime(listTotal * ratio);
    });
    progressBarEl.style.cursor = 'pointer';
  }

  setInterval(() => {
    const items = getItems();
    const idx = getCurrentIndex();

    if (idx !== null && idx < items.length && !getIsPaused()) {
      const item = items[idx];
      const startedAt = getStartedAt();
      if (startedAt != null && item.loop && item.maxLoopSeconds != null && item.maxLoopSeconds > 0) {
        const elapsed = (Date.now() - startedAt) / 1000;
        if (elapsed >= item.maxLoopSeconds) {
          audioPause();
          performPlaybackAction(getNextPlaybackAction());
          return;
        }
      }
    }

    const listTotal = items.reduce((sum, it) => sum + getTrackLength(it), 0);
    let listElapsed = 0;
    if (idx !== null && idx >= 0) {
      const listStartTimes = getListStartTimes(items);
      listElapsed = listStartTimes[idx] + currentTrackLoopElapsed + audio.currentTime;
    }
    if (elapsedEl) {
      elapsedEl.textContent = `再生経過: ${formatMmSs(listElapsed)} / ${formatMmSs(listTotal)}`;
    }

    const pct = listTotal > 0 ? Math.min(100, (listElapsed / listTotal) * 100) : 0;
    if (progressFillEl) progressFillEl.style.width = `${pct}%`;
    if (progressBarEl) {
      progressBarEl.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
    if (progressSegmentsEl && (items.length !== lastSegmentCount || listTotal !== lastListTotal)) {
      lastSegmentCount = items.length;
      lastListTotal = listTotal;
      progressSegmentsEl.innerHTML = '';
      if (items.length > 0 && listTotal > 0) {
        items.forEach((item) => {
          const seg = document.createElement('div');
          seg.className = 'elapsed-progress-segment';
          seg.style.width = `${(getTrackLength(item) / listTotal) * 100}%`;
          progressSegmentsEl.appendChild(seg);
        });
      }
    }

    if (idx !== null) {
      const sec = audio.currentTime;
      setCurrentTime(sec);
    }
  }, 500);
}

init();
