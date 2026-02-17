import {
  getItems,
  getCurrentIndex,
  getCurrentTime,
  getIsPaused,
  updateItem,
  moveItem,
  subscribe,
  subscribeToTime,
} from './state.js';
import { formatMmSs, parseMmSs } from './utils.js';
import { loadBpm } from './audioAnalysis.js';

/** @type {HTMLElement | null} */
let containerEl = null;

/** @type {(index: number) => void} */
let onPlayRequest = () => {};
/** @type {() => void} */
let onPauseRequest = () => {};
/** @type {() => void} */
let onStopRequest = () => {};
/** @type {(seconds: number) => void} */
let onSeekRequest = () => {};

/** 長さ取得中の id を保持（二重リクエスト防止） */
const loadingDurationIds = new Set();

/**
 * 1件の duration を非同期で取得して state に反映
 * @param {{ id: string; file: File; duration: number | null }} item
 */
function loadDuration(item) {
  if (item.duration != null || loadingDurationIds.has(item.id)) return;
  loadingDurationIds.add(item.id);
  const url = URL.createObjectURL(item.file);
  const audio = new Audio();
  audio.addEventListener('loadedmetadata', () => {
    const d = audio.duration;
    if (Number.isFinite(d)) updateItem(item.id, { duration: d });
    URL.revokeObjectURL(url);
    loadingDurationIds.delete(item.id);
  });
  audio.addEventListener('error', () => {
    URL.revokeObjectURL(url);
    loadingDurationIds.delete(item.id);
  });
  audio.src = url;
}

/**
 * @param {HTMLElement} container
 * @param {{ onPlayRequest?: (index: number) => void; onPauseRequest?: () => void; onStopRequest?: () => void; onSeekRequest?: (seconds: number) => void }} opts
 */
export function initList(container, opts = {}) {
  containerEl = container;
  if (opts.onPlayRequest) onPlayRequest = opts.onPlayRequest;
  if (opts.onPauseRequest) onPauseRequest = opts.onPauseRequest;
  if (opts.onStopRequest) onStopRequest = opts.onStopRequest;
  if (opts.onSeekRequest) onSeekRequest = opts.onSeekRequest;

  subscribe(() => {
    renderList();
  });
  subscribeToTime(updatePositionDisplay);
  renderList();
}

/** 再生位置のみ DOM で更新（リスト全体を再描画しないので入力中フォーカスが外れない） */
function updatePositionDisplay() {
  if (!containerEl) return;
  const row = containerEl.querySelector('.audio-list tbody tr.playing');
  if (!row) return;
  const timeEl = row.querySelector('.position-time');
  const fillEl = row.querySelector('.progress-bar-fill');
  if (!timeEl || !fillEl) return;
  const items = getItems();
  const idx = getCurrentIndex();
  if (idx === null || idx >= items.length) return;
  const item = items[idx];
  const duration = item.duration;
  if (duration == null || duration <= 0) return;
  const pos = Math.min(getCurrentTime(), duration);
  timeEl.textContent = `${formatMmSs(pos)} / ${formatMmSs(duration)}`;
  fillEl.style.width = `${(pos / duration) * 100}%`;
}

export function renderList() {
  if (!containerEl) return;
  const items = getItems();
  const currentIndex = getCurrentIndex();
  const currentTime = getCurrentTime();
  const isPaused = getIsPaused();

  containerEl.innerHTML = '';
  if (items.length === 0) {
    return;
  }

  const table = document.createElement('table');
  table.className = 'audio-list';
  table.innerHTML = `
    <thead>
      <tr>
        <th class="col-grip"></th>
        <th class="col-name">ファイル名</th>
        <th class="col-duration">素材の長さ</th>
        <th class="col-bpm">BPM</th>
        <th class="col-key">Key</th>
        <th class="col-loop">ループ</th>
        <th class="col-max">最大再生時間</th>
        <th class="col-controls">再生</th>
        <th class="col-position">再生位置</th>
        <th class="col-playing"></th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  items.forEach((item, index) => {
    if (item.duration === null) loadDuration(item);
    if (item.bpm === null) loadBpm(item);

    const tr = document.createElement('tr');
    tr.dataset.index = String(index);
    tr.draggable = true;
    if (currentIndex === index) tr.classList.add('playing');

    const grip = document.createElement('td');
    grip.className = 'col-grip';
    grip.innerHTML = '<span class="grip" aria-label="並び替え">⋮⋮</span>';
    grip.addEventListener('mousedown', (e) => e.stopPropagation());

    const nameCell = document.createElement('td');
    nameCell.className = 'col-name';
    nameCell.textContent = item.name;

    const durationCell = document.createElement('td');
    durationCell.className = 'col-duration';
    durationCell.textContent = item.duration != null ? formatMmSs(item.duration) : '…';

    const bpmCell = document.createElement('td');
    bpmCell.className = 'col-bpm';
    bpmCell.textContent = item.bpm != null ? String(item.bpm) : '…';

    const keyCell = document.createElement('td');
    keyCell.className = 'col-key';
    keyCell.textContent = item.key != null && item.key !== '' ? item.key : '—';

    const loopCell = document.createElement('td');
    loopCell.className = 'col-loop';
    const loopBtn = document.createElement('button');
    loopBtn.type = 'button';
    loopBtn.className = 'loop-btn';
    loopBtn.setAttribute('aria-label', 'ループ');
    loopBtn.innerHTML = item.loop
      ? '<span class="loop-icon loop-on" title="ループON">↻</span>'
      : '<span class="loop-icon loop-off" title="ループOFF">↻</span>';
    loopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateItem(item.id, { loop: !item.loop });
    });
    loopCell.appendChild(loopBtn);

    const maxCell = document.createElement('td');
    maxCell.className = 'col-max';
    if (item.loop) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '0:00';
      input.value = item.maxLoopSeconds != null ? formatMmSs(item.maxLoopSeconds) : '';
      input.className = 'max-time-input';
      input.setAttribute('inputmode', 'numeric');
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('change', () => {
        const sec = parseMmSs(input.value.trim());
        updateItem(item.id, { maxLoopSeconds: sec });
      });
      maxCell.appendChild(input);
    }

    const controlsCell = document.createElement('td');
    controlsCell.className = 'col-controls';
    const isActiveRow = currentIndex === index;
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'control-btn control-play' + (isActiveRow && isPaused ? ' is-active' : '');
    playBtn.setAttribute('aria-label', '再生');
    playBtn.innerHTML = '<svg class="control-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPlayRequest(index);
    });
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'control-btn control-pause' + (isActiveRow && !isPaused ? ' is-active' : '');
    pauseBtn.setAttribute('aria-label', 'ポーズ');
    pauseBtn.innerHTML = '<svg class="control-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>';
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onPauseRequest();
    });
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'control-btn control-stop';
    stopBtn.setAttribute('aria-label', '停止');
    stopBtn.innerHTML = '<svg class="control-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6h12v12H6z"/></svg>';
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onStopRequest();
    });
    controlsCell.append(playBtn, pauseBtn, stopBtn);

    const positionCell = document.createElement('td');
    positionCell.className = 'col-position';
    if (currentIndex === index && item.duration != null && item.duration > 0) {
      const duration = item.duration;
      const pos = Math.min(currentTime, duration);
      const pct = (pos / duration) * 100;
      const timeText = document.createElement('span');
      timeText.className = 'position-time';
      timeText.textContent = `${formatMmSs(pos)} / ${formatMmSs(duration)}`;
      const barWrap = document.createElement('div');
      barWrap.className = 'progress-bar';
      barWrap.setAttribute('role', 'slider');
      barWrap.setAttribute('aria-label', '再生位置をクリックでシーク');
      barWrap.setAttribute('aria-valuenow', String(pos));
      barWrap.setAttribute('aria-valuemin', '0');
      barWrap.setAttribute('aria-valuemax', String(duration));
      const barFill = document.createElement('div');
      barFill.className = 'progress-bar-fill';
      barFill.style.width = `${pct}%`;
      barWrap.appendChild(barFill);
      barWrap.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = barWrap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const ratio = Math.max(0, Math.min(1, x / rect.width));
        const sec = ratio * duration;
        onSeekRequest(sec);
      });
      positionCell.append(timeText, barWrap);
    } else {
      positionCell.textContent = '—';
    }

    const playingCell = document.createElement('td');
    playingCell.className = 'col-playing';
    if (currentIndex === index) {
      playingCell.innerHTML = '<span class="playing-mark">▶</span>';
    }

    tr.append(grip, nameCell, durationCell, bpmCell, keyCell, loopCell, maxCell, controlsCell, positionCell, playingCell);

    tr.addEventListener('click', (e) => {
      if ((e.target.closest('button') || e.target.closest('input') || e.target.closest('.col-position')) !== null) return;
      onPlayRequest(index);
    });

    tr.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.effectAllowed = 'move';
      tr.classList.add('dragging');
    });
    tr.addEventListener('dragend', () => tr.classList.remove('dragging'));
    tr.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isNaN(from) || from === index) return;
      tbody.querySelectorAll('tr').forEach((r) => r.classList.remove('drop-target'));
      tr.classList.add('drop-target');
    });
    tr.addEventListener('dragleave', () => tr.classList.remove('drop-target'));
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      tr.classList.remove('drop-target');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (Number.isNaN(from) || from === index) return;
      moveItem(from, index);
    });

    tbody.appendChild(tr);
  });

  containerEl.appendChild(table);
}
