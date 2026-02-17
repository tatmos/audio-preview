import { addFiles, loadListData } from './state.js';
import { textToList } from './listSaveLoad.js';

/**
 * ファイル一覧をオーディオとリスト用txtに分ける
 * @param {File[]} files
 * @returns {{ audioFiles: File[]; txtFiles: File[] }}
 */
function splitFiles(files) {
  const audioFiles = [];
  const txtFiles = [];
  for (const f of files) {
    if (f.type.startsWith('audio/')) audioFiles.push(f);
    else if (f.name.toLowerCase().endsWith('.txt') || f.type === 'text/plain') txtFiles.push(f);
  }
  return { audioFiles, txtFiles };
}

/**
 * リスト用txtを1件読み込んで loadListData を実行
 * @param {File} file
 * @param {() => void} done
 */
function loadOneTxt(file, done) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : '';
    const parsed = textToList(text);
    if (parsed.length) loadListData(parsed);
    done();
  };
  reader.onerror = done;
  reader.readAsText(file, 'UTF-8');
}

/**
 * オーディオ追加とリストtxtの適用（txtは1つだけ、最初のものを使用）
 * @param {File[]} files
 */
function processFiles(files) {
  const { audioFiles, txtFiles } = splitFiles(Array.from(files));
  if (audioFiles.length) addFiles(audioFiles);
  const txtFile = txtFiles[0];
  if (txtFile) {
    loadOneTxt(txtFile, () => {});
  }
}

/**
 * @param {HTMLElement} el
 */
export function initDropzone(el) {
  const label = document.createElement('span');
  label.textContent = 'オーディオファイル・リストtxtをドラッグ＆ドロップ または クリックして選択';
  label.className = 'dropzone-label';
  el.appendChild(label);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*,.txt,text/plain';
  input.multiple = true;
  input.style.display = 'none';
  el.appendChild(input);

  el.addEventListener('click', () => input.click());

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('dragover');
  });

  el.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('dragover');
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files?.length) processFiles(Array.from(files));
  });

  input.addEventListener('change', () => {
    const files = input.files;
    if (files?.length) processFiles(Array.from(files));
    input.value = '';
  });
}
