import './styles.css';
import { initDropzone } from './dropzone.js';
import { initList } from './list.js';
import { getItems, setCurrentIndex, getCurrentIndex, getCurrentTime, getNextPlaybackAction, setCurrentTime, setPaused, getIsPaused, getPlaybackRate, setPlaybackRate, getStartedAt, setStartedAt, loadListData, setRealTimeKey, subscribeToRealtime, getRealTimeKey, getRealTimeChord } from './state.js';
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

function applyPlaybackRate() {
  const el = getAudioElement();
  if (el) el.playbackRate = getPlaybackRate();
}

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
  applyPlaybackRate();
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
    applyPlaybackRate();
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
    applyPlaybackRate();
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
    applyPlaybackRate();
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

/** 前の曲へ、または再生中なら曲の頭に戻る（約3秒以上経過時は頭に戻すだけ） */
function goToPrevious() {
  const items = getItems();
  const idx = getCurrentIndex();
  if (items.length === 0) return;
  const audio = getAudioElement();
  if (idx !== null && getCurrentTime() >= 3) {
    seekPlayback(0);
    if (getIsPaused()) audio.play().catch(() => {});
    setPaused(false);
    return;
  }
  if (idx !== null && idx > 0) {
    playItemAtIndex(idx - 1);
    return;
  }
  if (idx === 0) {
    seekPlayback(0);
    if (getIsPaused()) audio.play().catch(() => {});
    setPaused(false);
  }
}

/** 再生／一時停止をトグル。停止中なら先頭を再生。 */
function togglePlayPause() {
  const items = getItems();
  const idx = getCurrentIndex();
  if (items.length === 0) return;
  if (idx === null) {
    playItemAtIndex(0);
    return;
  }
  if (getIsPaused()) {
    applyPlaybackRate();
    getAudioElement().play().catch(() => {});
    setPaused(false);
  } else {
    pausePlayback();
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
  const btnPrev = document.getElementById('btn-prev');
  const btnPlayPause = document.getElementById('btn-play-pause');
  const btnNext = document.getElementById('btn-next');
  const levelMetersEl = document.getElementById('level-meters');
  const audio = getAudioElement();

  if (btnPrev) btnPrev.addEventListener('click', goToPrevious);
  if (btnPlayPause) btnPlayPause.addEventListener('click', togglePlayPause);
  if (btnNext) btnNext.addEventListener('click', goToNext);

  const transportSpeedEl = document.querySelector('.transport-speed');
  if (transportSpeedEl) {
    transportSpeedEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.transport-speed-btn');
      if (!btn) return;
      const rate = parseFloat(btn.dataset.rate);
      if (!Number.isFinite(rate)) return;
      setPlaybackRate(rate);
      applyPlaybackRate();
      transportSpeedEl.querySelectorAll('.transport-speed-btn').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
    });
  }

  if (levelMetersEl) {
    levelMeterDisplay.init(levelMetersEl, (numBands) => levelMeter.getLevelsBands(numBands));
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
    const listTotal = items.reduce((sum, it) => sum + getTrackLength(it), 0);
    let listElapsed = 0;
    if (idx !== null && idx >= 0) {
      const listStartTimes = getListStartTimes(items);
      listElapsed = listStartTimes[idx] + currentTrackLoopElapsed + audio.currentTime;
    }

    if (idx !== null && idx < items.length && !getIsPaused()) {
      const item = items[idx];
      if (item.loop && item.maxLoopSeconds != null && item.maxLoopSeconds > 0 && audio.currentTime >= item.maxLoopSeconds) {
        audioPause();
        performPlaybackAction(getNextPlaybackAction());
        return;
      }
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

    if (btnPlayPause) {
      const isPlaying = idx !== null && !getIsPaused();
      const playIcon = btnPlayPause.querySelector('.transport-icon-play');
      const pauseIcon = btnPlayPause.querySelector('.transport-icon-pause');
      btnPlayPause.setAttribute('aria-label', isPlaying ? '一時停止' : '再生');
      if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'block';
      if (pauseIcon) pauseIcon.style.display = isPlaying ? 'block' : 'none';
    }
  }, 500);
}

init();
