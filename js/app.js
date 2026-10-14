// app.js — UI glue: file handling, VSIX extraction, convert + download.
(function () {
'use strict';

const {
  setReadFile, convertSources, parseJsonc, resolvePath, slug, rgba,
} = window.ZedConvert;

const $ = (sel) => document.querySelector(sel);
const dropzone = $('#dropzone');
const fileInput = $('#fileInput');
const result = $('#result');
const options = $('#options');
const status = $('#status');

let currentDoc = null;   // converted family document
let currentMeta = null;  // { sources, files, publisher, filename, baseStyle }

// --- Style-overrides palette editor state ---------------------------------
let colorKeys = [];      // [{ key, base }] — every colour key from the base theme
let ovState = {};        // { '#key': '#RRGGBBAA' } — only the keys the user changed
let rowRefs = {};        // key -> { row, color, hex } DOM handles

// ---------------------------------------------------------------------------
// File intake
// ---------------------------------------------------------------------------
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('over'); }));

dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});

function setStatus(msg, kind = '') {
  status.textContent = msg || '';
  status.className = 'status' + (kind ? ' ' + kind : '');
}

async function handleFile(file) {
  currentDoc = null;
  result.hidden = true;
  options.hidden = true;
  try {
    setStatus('Reading ' + file.name + ' …');
    const name = file.name.toLowerCase();
    if (name.endsWith('.vsix')) {
      currentMeta = await discoverFromVsix(file);
    } else if (name.endsWith('.json')) {
      currentMeta = await discoverFromJson(file);
    } else {
      throw new Error('Please drop a .vsix or .json theme file.');
    }
    if (!currentMeta.sources.length) {
      throw new Error('No themes found inside the file.');
    }
    // Base conversion (no overrides) so we can show the theme's full palette.
    setReadFile((p) => (currentMeta.files.has(p) ? currentMeta.files.get(p) : null));
    const baseDoc = convertSources(currentMeta.sources, { publisher: currentMeta.publisher });
    currentMeta.baseStyle = baseDoc.themes[0].style;

    showOptions(currentMeta);
    setStatus(`Found ${currentMeta.sources.length} theme(s) in ${file.name}. Adjust options and Convert.`, 'ok');
  } catch (err) {
    setStatus('Error: ' + err.message, 'err');
  }
}

// ---------------------------------------------------------------------------
// Discovery: VSIX (zip) and single JSON
// ---------------------------------------------------------------------------
async function discoverFromVsix(file) {
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const files = new Map();
  const jsonPaths = [];
  zip.forEach((relativePath, entry) => {
    if (!entry.dir && relativePath.toLowerCase().endsWith('.json') && !relativePath.endsWith('/')) {
      jsonPaths.push(relativePath);
    }
  });
  for (const p of jsonPaths) {
    files.set(p, await zip.file(p).async('string'));
  }

  let pkgPath = null;
  if (files.has('extension/package.json')) pkgPath = 'extension/package.json';
  else if (files.has('package.json')) pkgPath = 'package.json';

  const sources = [];
  let publisher = null;
  if (pkgPath) {
    try {
      const pkg = parseJsonc(files.get(pkgPath));
      publisher = pkg.publisher || null;
      for (const th of (pkg.contributes && pkg.contributes.themes) || []) {
        if (!th.path) continue;
        sources.push({ path: resolvePath(pkgPath, th.path), name: th.label, uiTheme: th.uiTheme });
      }
    } catch { /* ignore malformed manifest */ }
  }
  if (!sources.length) {
    // Fallback: any json under a themes/ folder.
    for (const p of jsonPaths) {
      if (/(^|\/)themes\//.test(p)) sources.push({ path: p });
    }
  }
  return { sources, files, publisher, filename: file.name };
}

async function discoverFromJson(file) {
  const text = await file.text();
  const files = new Map();
  files.set(file.name, text);
  return { sources: [{ path: file.name }], files, publisher: null, filename: file.name };
}

// ---------------------------------------------------------------------------
// Options panel
// ---------------------------------------------------------------------------
function showOptions(meta) {
  // Default name from first detected theme.
  let firstName = meta.sources[0].name || '';
  if (!firstName) {
    try { firstName = parseJsonc(meta.files.get(meta.sources[0].path)).name || ''; } catch {}
  }
  $('#optName').value = meta.sources.length > 1 ? '' : (firstName || '');
  $('#optName').placeholder = meta.sources.length > 1 ? '(family name)' : '(theme name)';
  $('#optAuthor').value = meta.publisher ? `${meta.publisher} (converted)` : '';
  $('#optAppearance').value = '';
  buildOverridesList(meta.baseStyle || {});
  options.hidden = false;
}

// ---------------------------------------------------------------------------
// Style-overrides palette editor
// ---------------------------------------------------------------------------
function buildOverridesList(baseStyle) {
  colorKeys = Object.entries(baseStyle)
    .filter(([, v]) => typeof v === 'string' && v.startsWith('#'))
    .map(([key, base]) => ({ key, base }));
  ovState = {};
  rowRefs = {};
  renderOverrides();
  updateOvCount();
  syncTextarea();
}

function renderOverrides() {
  const list = $('#overridesList');
  list.innerHTML = '';
  if (!colorKeys.length) {
    list.innerHTML = '<div class="ov-empty">No colours found in this theme.</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const { key, base } of colorKeys) {
    const row = document.createElement('div');
    row.className = 'ov-row';
    row.dataset.key = key;

    const keyEl = document.createElement('span');
    keyEl.className = 'ov-key';
    keyEl.textContent = key;
    keyEl.title = key;

    // The colour square doubles as a native picker (click to open).
    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'ov-color';
    color.value = toRgbHex(base);
    color.title = 'Pick a colour';

    const hex = document.createElement('input');
    hex.type = 'text';
    hex.className = 'ov-hex';
    hex.value = base;
    hex.spellcheck = false;
    hex.title = 'Hex value (#RRGGBBAA)';

    row.append(keyEl, color, hex);
    frag.appendChild(row);
    rowRefs[key] = { row, color, hex };

    color.addEventListener('input', () => {
      const alpha = currentColor(key).slice(-2) || 'FF';
      setOverride(key, (color.value + alpha).toUpperCase());
    });
    hex.addEventListener('input', () => {
      let v = hex.value.trim();
      if (v && !v.startsWith('#')) v = '#' + v;
      if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
        setOverride(key, v.toUpperCase());
      }
    });
    hex.addEventListener('blur', () => updateRow(key)); // snap back if invalid
  }
  list.appendChild(frag);
}

function baseOf(key) {
  const found = colorKeys.find((c) => c.key === key);
  return found ? found.base : '#000000FF';
}
function currentColor(key) {
  return ovState[key] || baseOf(key);
}

function setOverride(key, value) {
  if (value === baseOf(key).toUpperCase()) delete ovState[key];
  else ovState[key] = value;
  updateRow(key);
  syncTextarea();
  updateOvCount();
}

function updateRow(key) {
  const ref = rowRefs[key];
  if (!ref) return; // custom key from raw textarea — no row
  const cur = currentColor(key);
  ref.color.value = toRgbHex(cur);
  if (document.activeElement !== ref.hex) ref.hex.value = cur;
  ref.row.classList.toggle('changed', !!ovState[key]);
}

function refreshAllRows() {
  for (const { key } of colorKeys) updateRow(key);
  updateOvCount();
}

// Keep the raw textarea in sync with the structured overrides.
function syncTextarea() {
  const ta = $('#optOverrides');
  if (!ta || document.activeElement === ta) return;
  const lines = Object.keys(ovState).sort().map((k) => `${k}=${ovState[k]}`);
  ta.value = lines.join('\n');
}

function updateOvCount() {
  const n = Object.keys(ovState).length;
  $('#ovCount').textContent = `${n} overridden`;
}

// '#RRGGBBAA' -> '#rrggbb' (native colour inputs are RGB-only).
function toRgbHex(c) {
  c = (c || '').replace('#', '').toLowerCase();
  if (c.length === 8) c = c.slice(0, 6);
  if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('');
  if (c.length !== 6 || /[^0-9a-f]/.test(c)) c = '000000';
  return '#' + c;
}

// Reset / raw-textarea wiring.
$('#ovReset').addEventListener('click', () => {
  ovState = {};
  refreshAllRows();
  syncTextarea();
});
$('#optOverrides').addEventListener('input', () => {
  ovState = parseOverrides($('#optOverrides').value) || {};
  refreshAllRows();
});

// ---------------------------------------------------------------------------
// Convert + Download
// ---------------------------------------------------------------------------
$('#convertBtn').addEventListener('click', () => {
  if (!currentMeta) { setStatus('Load a theme file first.', 'err'); return; }
  try {
    setReadFile((p) => (currentMeta.files.has(p) ? currentMeta.files.get(p) : null));

    const nameVal = $('#optName').value.trim();
    const authorVal = $('#optAuthor').value.trim() || 'auto';
    const appearanceVal = $('#optAppearance').value || null;
    const overrides = Object.keys(ovState).length ? { ...ovState } : null;

    currentDoc = convertSources(currentMeta.sources, {
      name: nameVal || null,
      author: authorVal,
      appearance: appearanceVal,
      overrides,
      publisher: currentMeta.publisher,
    });

    renderPreview(currentDoc);
    window._lastDoc = currentDoc; // debug/inspection hook
    result.hidden = false;
    setStatus(`Converted ${currentDoc.themes.length} theme(s): ` +
      currentDoc.themes.map((t) => `${t.name} [${t.appearance}]`).join(', '), 'ok');
  } catch (err) {
    setStatus('Conversion error: ' + err.message, 'err');
  }
});

$('#downloadBtn').addEventListener('click', () => {
  if (!currentDoc) return;
  const fname = slug(currentDoc.name) + '.json';
  const blob = new Blob([JSON.stringify(currentDoc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Parse "key=#value" lines into an overrides object.
function parseOverrides(text) {
  const out = {};
  for (const line of (text || '').split('\n')) {
    const s = line.trim();
    if (!s || !s.includes('=')) continue;
    const idx = s.indexOf('=');
    const k = s.slice(0, idx).trim();
    const v = s.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------
function renderPreview(doc) {
  const themesEl = $('#themes');
  themesEl.innerHTML = '';
  for (const th of doc.themes) {
    const s = th.style;
    const card = document.createElement('div');
    card.className = 'theme-card';
    card.style.background = rgba(s.background);
    card.style.color = rgba(s.text);
    card.style.borderColor = rgba(s.border);

    const title = document.createElement('div');
    title.className = 'theme-title';
    title.textContent = `${th.name}  ·  ${th.appearance}`;
    title.style.color = rgba(s.text);

    // Mini editor mock with a few syntax colours.
    const editor = document.createElement('div');
    editor.className = 'theme-editor';
    editor.style.background = rgba(s['editor.background']);
    editor.style.color = rgba(s['editor.foreground']);
    const line = document.createElement('div');
    line.className = 'theme-line';
    line.style.background = rgba(s['editor.active_line.background']);
    line.innerHTML = [
      span('comment', '// ' + th.name),
      span('keyword', 'fn'),
      span('function', ' convert'),
      span('text', '(theme: &'),
      span('type', 'str'),
      span('text', ') -> '),
      span('type', 'ZedTheme'),
      span('punctuation', ' {'),
    ].join('');
    const line2 = document.createElement('div');
    line2.className = 'theme-line';
    line2.innerHTML = [
      span('keyword', '    let'),
      span('text', ' accent = '),
      span('string', '"#88C0D0"'),
      span('punctuation', ';'),
    ].join('');
    editor.appendChild(line);
    editor.appendChild(line2);

    // Colour swatches for key UI surfaces.
    const sw = document.createElement('div');
    sw.className = 'swatches';
    const keys = ['background', 'surface.background', 'tab.active_background',
      'status_bar.background', 'icon.accent'];
    for (const k of keys) {
      const chip = document.createElement('span');
      chip.className = 'swatch';
      chip.style.background = rgba(s[k]);
      chip.title = `${k}: ${s[k]}`;
      sw.appendChild(chip);
    }

    card.appendChild(title);
    card.appendChild(editor);
    card.appendChild(sw);
    themesEl.appendChild(card);
  }
}

function span(cls, text) {
  return `<span class="tok-${cls}">${escapeHtml(text)}</span>`;
}
function escapeHtml(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
})();
