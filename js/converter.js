(function () {
'use strict';

// ---------------------------------------------------------------------------
// Robust JSONC parsing (comments + trailing commas)
// ---------------------------------------------------------------------------
function stripJsonComments(raw) {
  const out = [];
  let i = 0;
  const n = raw.length;
  let inStr = false;
  while (i < n) {
    const c = raw[i];
    if (inStr) {
      out.push(c);
      if (c === '\\' && i + 1 < n) { out.push(raw[i + 1]); i += 2; continue; }
      if (c === '"') inStr = false;
      i++; continue;
    }
    if (c === '"') { inStr = true; out.push(c); i++; continue; }
    if (c === '/' && i + 1 < n) {
      const nxt = raw[i + 1];
      if (nxt === '/') { while (i < n && raw[i] !== '\n') i++; continue; }
      if (nxt === '*') { i += 2; while (i + 1 < n && !(raw[i] === '*' && raw[i + 1] === '/')) i++; i += 2; continue; }
    }
    out.push(c); i++;
  }
  return out.join('');
}

function parseJsonc(raw) {
  let cleaned = stripJsonComments(raw);
  // Drop trailing commas repeatedly so nested cases collapse.
  let prev = null;
  const re = /,(\s*[}\]])/g;
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(re, '$1');
  }
  return JSON.parse(cleaned);
}

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
function rgba(c) {
  if (!c || typeof c !== 'string') return null;
  c = c.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(c)) return null;
  if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('') + 'FF';
  else if (c.length === 4) c = c.split('').map((ch) => ch + ch).join('');
  else if (c.length === 6) c += 'FF';
  else if (c.length === 8) { /* ok */ }
  else return null;
  return '#' + c.toUpperCase();
}

function channels(c) {
  c = rgba(c).slice(1);
  return [
    parseInt(c.slice(0, 2), 16),
    parseInt(c.slice(2, 4), 16),
    parseInt(c.slice(4, 6), 16),
    parseInt(c.slice(6, 8), 16),
  ];
}

function isTransparent(c) {
  const norm = rgba(c);
  if (!norm) return true;
  return norm.slice(-2) === '00';
}

function ensureVisible(c, minAlpha = 0x33) {
  const norm = rgba(c);
  if (!norm) return norm;
  const alpha = parseInt(norm.slice(-2), 16);
  if (alpha < minAlpha) {
    return norm.slice(0, -2) + minAlpha.toString(16).toUpperCase().padStart(2, '0');
  }
  return norm;
}

function relativeLuminance(c) {
  const [r, g, b] = channels(c);
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function mix(c, other, t) {
  const [r1, g1, b1, a1] = channels(c);
  const [r2, g2, b2] = channels(other);
  const f = (a, b) => Math.round(a + (b - a) * t);
  const h = (v) => v.toString(16).toUpperCase().padStart(2, '0');
  return `#${h(f(r1, r2))}${h(f(g1, g2))}${h(f(b1, b2))}${h(a1)}`;
}

const lighten = (c, t) => mix(c, '#FFFFFF', t);
const darken = (c, t) => mix(c, '#000000', t);

// ---------------------------------------------------------------------------
// Scope -> Zed syntax key mapping (longest segment-wise prefix wins)
// ---------------------------------------------------------------------------
const SCOPE_MAP = [
  ['string.escape', 'string.escape'],
  ['constant.character.escape', 'string.escape'],
  ['string.special.url', 'string.special.url'],
  ['string.regexp', 'string.special'],
  ['constant.regexp', 'string.special'],
  ['constant.character.character-class', 'string.special'],
  ['constant.other.character-class', 'string.special'],
  ['constant.character.set', 'string.special'],
  ['constant.other.placeholder', 'string.special'],
  ['string', 'string'],
  ['string.tag', 'string'],
  ['string.value', 'string'],
  ['meta.preprocessor', 'preproc'],
  ['entity.name.function.preprocessor', 'preproc'],
  ['comment', 'comment'],
  ['comment.doc', 'comment'],
  ['constant.numeric', 'constant.numeric'],
  ['constant.language', 'constant'],
  ['constant.other', 'constant'],
  ['constant.character', 'constant'],
  ['constant.sha', 'constant'],
  ['entity.name.tag', 'tag'],
  ['entity.other.attribute-name', 'attribute'],
  ['entity.name.function', 'function'],
  ['support.function', 'function'],
  ['entity.name.type', 'type'],
  ['entity.name.class', 'type'],
  ['entity.name.namespace', 'type'],
  ['entity.other.inherited-class', 'type'],
  ['support.class', 'type'],
  ['support.type.property-name', 'property'],
  ['support.type.vendored.property-name', 'property'],
  ['meta.object-literal.key', 'property'],
  ['support.type', 'type'],
  ['support.variable', 'variable'],
  ['entity.name.label', 'label'],
  ['keyword.operator', 'keyword.operator'],
  ['keyword.control', 'keyword'],
  ['keyword.other.unit', 'constant'],
  ['keyword', 'keyword'],
  ['storage.type', 'type'],
  ['storage.modifier', 'keyword'],
  ['storage', 'keyword'],
  ['variable.other.constant', 'constant'],
  ['variable.other.enummember', 'constant'],
  ['variable.other.property', 'variable.member'],
  ['variable.parameter', 'variable.parameter'],
  ['variable.language', 'variable.special'],
  ['variable', 'variable'],
  ['punctuation.definition.tag', 'punctuation.bracket'],
  ['punctuation.definition.template-expression', 'punctuation.special'],
  ['punctuation.section.embedded', 'punctuation.special'],
  ['punctuation.definition.group', 'punctuation.special'],
  ['punctuation.character.set', 'punctuation.special'],
  ['punctuation.definition.character-class', 'punctuation.special'],
  ['punctuation', 'punctuation'],
  ['markup.heading', 'heading'],
  ['markup.bold', 'strong'],
  ['markup.italic', 'emphasis'],
  ['markup.strikethrough', 'strikethrough'],
  ['markup.inline.raw', 'string.special'],
  ['markup.quote', 'text'],
  ['emphasis', 'emphasis'],
  ['strong', 'strong'],
  ['header', 'heading'],
  ['entity.name.section', 'heading'],
];

const SKIP_PREFIXES = ['source.', 'text.', 'meta.diff'];
const SKIP_SCOPES = new Set([
  'markup.inserted', 'markup.deleted', 'markup.changed',
  'meta.embedded', 'invalid', 'meta.diff.header',
  'constant.other.color.rgb-value', 'constant.other.rgb-value',
  'keyword.control.anchor.regexp', 'entity.other.inherited-class',
]);
const LANG_SEGMENTS = new Set([
  'python', 'markdown', 'php', 'java', 'css', 'less', 'scss', 'ruby', 'cpp',
  'c', 'go', 'rust', 'js', 'jsx', 'ts', 'tsx', 'sql', 'yaml', 'toml', 'json',
  'xml', 'html', 'groovy', 'handlebars', 'powershell', 'cs', 'git-rebase',
  'javascript', 'typescript', 'latex', 'ini', 'sh', 'bash', 'shell', 'makefile',
]);

function scopeToKey(scope) {
  if (scope.includes(' ') || SKIP_SCOPES.has(scope) || SKIP_PREFIXES.some((p) => scope.startsWith(p))) {
    return null;
  }
  const segs = scope.split('.');
  if (segs.some((seg) => LANG_SEGMENTS.has(seg))) return null;
  let best = null;
  for (const [pref, key] of SCOPE_MAP) {
    const p = pref.split('.');
    if (p.length <= segs.length && p.every((seg, idx) => segs[idx] === seg)) {
      if (!best || p.length > best[0]) best = [p.length, key];
    }
  }
  return best ? best[1] : null;
}

const specificity = (scope) => scope.split('.').length;

const _FONT_STYLE = { italic: 'italic', underline: 'underlined' };

function buildSyntax(tokens) {
  const result = new Map(); // key -> [spec, settings]
  for (const rule of tokens || []) {
    if (!rule || typeof rule !== 'object') continue;
    const settings = rule.settings || {};
    let scopes = rule.scope || [];
    if (typeof scopes === 'string') scopes = [scopes];
    for (let sc of scopes) {
      sc = sc.trim();
      const key = scopeToKey(sc);
      if (!key) continue;
      const spec = specificity(sc);
      const cur = result.get(key);
      if (!cur || spec >= cur[0]) {
        const merged = cur ? { ...cur[1] } : {};
        for (const [k, v] of Object.entries(settings)) if (v) merged[k] = v;
        result.set(key, [spec, merged]);
      }
    }
  }
  const syntax = {};
  for (const [key, [, s]] of result) {
    const entry = {};
    if ('foreground' in s) entry.color = s.foreground;
    const fs = String(s.fontStyle || '').split(/\s+/);
    for (const [token, mapped] of Object.entries(_FONT_STYLE)) {
      if (fs.includes(token)) entry.font_style = mapped;
    }
    if (fs.includes('bold')) entry.font_weight = 'bold';
    if (Object.keys(entry).length) syntax[key] = entry;
  }
  return syntax;
}

function normalizeSyntax(syntax) {
  const out = {};
  for (const [k, v] of Object.entries(syntax)) {
    const e = {};
    const col = rgba(v.color);
    if (col) e.color = col;
    e.font_style = v.font_style === 'italic' ? 'italic' : null;
    const fw = v.font_weight;
    e.font_weight = fw === 'bold' ? 700 : (Number.isInteger(fw) ? fw : null);
    out[k] = e;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Workbench colours -> Zed UI style
// ---------------------------------------------------------------------------
function pick(colors, keys, dflt = null) {
  for (const k of keys) {
    const v = colors[k];
    if (v && !isTransparent(v)) return v;
  }
  return dflt;
}

const DEFAULT_ANSI = [
  '#3B4252', '#BF616A', '#A3BE8C', '#EBCB8B',
  '#81A1C1', '#B48EAD', '#88C0D0', '#E5E9F0',
  '#4C566A', '#BF616A', '#A3BE8C', '#EBCB8B',
  '#81A1C1', '#B48EAD', '#8FBCBB', '#ECEFF4',
];

function buildStyle(colors, syntax, appearance, overrides = null) {
  const bg = rgba(pick(colors, ['editor.background'], '#181A1F'));
  const fg = rgba(pick(colors, ['editor.foreground'], '#DADDE5'));
  const panelBg = rgba(pick(colors, ['sideBar.background', 'statusBar.background'], '#24262B'));
  const inputBg = rgba(pick(colors, ['input.background', 'dropdown.background'], '#33363D'));
  const accent = rgba(pick(colors, ['activityBarBadge.background', 'button.background', 'tab.activeBorder'], '#387BFF'));
  const border = ensureVisible(pick(colors, ['sideBar.border', 'panel.border', 'editorGroup.border'], '#3A3D45'));
  const muted = rgba(pick(colors, ['sideBarTitle.foreground', 'descriptionForeground'], '#9599A6'));
  const sel = rgba(pick(colors, ['editor.selectionBackground', 'selection.background'], '#C2CAF229'));
  const hover = rgba(pick(colors, ['list.hoverBackground', 'editor.lineHighlightBackground'], '#C2CAF214'));
  const lineHl = rgba(pick(colors, ['editor.lineHighlightBackground'], '#C2CAF214'));
  const err = rgba(pick(colors, ['errorForeground'], '#CC4B53'));
  const warn = rgba('#EB9B61');
  const info = accent;
  const hint = muted;
  const link = rgba(pick(colors, ['textLink.foreground'], accent));

  // Tooltip / elevated surface.
  let tooltip = pick(colors, ['editorWidget.background', 'hoverWidget.background', 'peekViewEditor.background']);
  if (!tooltip) tooltip = appearance === 'dark' ? lighten(bg, 0.06) : darken(bg, 0.04);
  tooltip = rgba(tooltip);

  // Active tab: keep a clearly-different source colour, else nudge for contrast.
  const tabBar = ensureVisible(pick(colors, ['editorGroupHeader.tabsBackground', 'tab.inactiveBackground'], panelBg), 0x00);
  const tabInactive = rgba(pick(colors, ['tab.inactiveBackground'], panelBg));
  const tabActiveSrc = rgba(colors['tab.activeBackground']);
  let tabActive;
  if (tabActiveSrc && !isTransparent(tabActiveSrc) &&
      Math.abs(relativeLuminance(tabActiveSrc) - relativeLuminance(tabBar)) >= 0.04) {
    tabActive = tabActiveSrc;
  } else {
    tabActive = appearance === 'dark' ? lighten(tabBar, 0.12) : darken(tabBar, 0.08);
  }

  const statusBg = rgba(pick(colors, ['statusBar.background'], panelBg));

  const style = {
    border,
    'border.variant': ensureVisible(pick(colors, ['widget.border'], border)),
    'border.focused': accent,
    'border.selected': accent,
    'border.transparent': '#00000000',
    'border.disabled': border,
    'elevated_surface.background': tooltip,
    'surface.background': panelBg,
    background: bg,
    'element.background': inputBg,
    'element.hover': hover,
    'element.active': sel,
    'element.selected': sel,
    'element.disabled': inputBg,
    'drop_target.background': accent,
    'ghost_element.background': '#00000000',
    'ghost_element.hover': hover,
    'ghost_element.active': sel,
    'ghost_element.selected': sel,
    'ghost_element.disabled': panelBg,
    text: fg,
    'text.muted': muted,
    'text.placeholder': rgba(pick(colors, ['input.placeholderForeground'], muted)),
    'text.disabled': rgba(pick(colors, ['disabledForeground'], muted)),
    'text.accent': link,
    icon: fg,
    'icon.muted': muted,
    'icon.disabled': muted,
    'icon.placeholder': muted,
    'icon.accent': accent,
    'status_bar.background': statusBg,
    'title_bar.background': rgba(pick(colors, ['titleBar.activeBackground'], panelBg)),
    'title_bar.inactive_background': rgba(pick(colors, ['titleBar.inactiveBackground'], panelBg)),
    'toolbar.background': rgba(pick(colors, ['titleBar.activeBackground'], panelBg)),
    'tab_bar.background': tabBar,
    'tab.inactive_background': tabInactive,
    'tab.active_background': tabActive,
    'search.match_background': rgba(pick(colors, ['editor.findMatchHighlightBackground'], '#DADDE552')),
    'panel.background': rgba(pick(colors, ['panel.background'], panelBg)),
    'panel.focused_border': accent,
    'pane.focused_border': accent,
    'pane_group.border': border,
    'scrollbar.thumb.background': rgba(pick(colors, ['scrollbarSlider.background'], '#DDE2E940')),
    'scrollbar.thumb.hover_background': rgba(pick(colors, ['scrollbarSlider.hoverBackground'], '#DDE2E959')),
    'scrollbar.thumb.border': '#00000000',
    'scrollbar.track.background': '#00000000',
    'scrollbar.track.border': '#00000000',
    'editor.foreground': fg,
    'editor.background': bg,
    'editor.gutter.background': bg,
    'editor.subheader.background': panelBg,
    'editor.active_line.background': lineHl,
    'editor.highlighted_line.background': lineHl,
    'editor.line_number': rgba(pick(colors, ['editorLineNumber.foreground'], muted)),
    'editor.active_line_number': rgba(pick(colors, ['editorLineNumber.activeForeground'], fg)),
    'editor.invisible': muted,
    'editor.wrap_guide': border,
    'editor.active_wrap_guide': border,
    'editor.indent_guide': rgba(pick(colors, ['editorIndentGuide.background1'], border)),
    'editor.indent_guide_active': rgba(pick(colors, ['editorIndentGuide.background1'], border)),
    'editor.document_highlight.read_background': sel,
    'editor.document_highlight.write_background': sel,
    'terminal.background': bg,
    'terminal.foreground': fg,
    'link_text.hover': link,
    conflict: warn,
    'conflict.background': rgba('#EB9B6120'),
    'conflict.border': rgba('#EB9B6150'),
    created: '#82D99F',
    'created.background': rgba('#82D99F20'),
    'created.border': rgba('#82D99F50'),
    deleted: '#F2858C',
    'deleted.background': rgba('#F2858C20'),
    'deleted.border': rgba('#F2858C50'),
    error: err,
    'error.background': rgba('#CC4B5320'),
    'error.border': rgba('#CC4B5350'),
    hidden: muted,
    hint,
    'hint.background': rgba('#81CFE020'),
    'hint.border': rgba('#81CFE050'),
    ignored: muted,
    info,
    'info.background': rgba('#387BFF20'),
    'info.border': rgba('#387BFF50'),
    modified: '#DED47E',
    'modified.background': rgba('#DED47E20'),
    'modified.border': rgba('#DED47E50'),
    predictive: muted,
    renamed: link,
    success: '#82D99F',
    unreachable: muted,
    warning: warn,
    'warning.background': rgba('#EB9B6120'),
    'warning.border': rgba('#EB9B6150'),
    players: [
      { cursor: fg, background: fg, selection: sel },
      { cursor: '#80BBFF', background: '#80BBFF', selection: rgba('#80BBFF30') },
      { cursor: '#82D99F', background: '#82D99F', selection: rgba('#82D99F30') },
      { cursor: '#F48CCA', background: '#F48CCA', selection: rgba('#F48CCA30') },
      { cursor: '#EB9B61', background: '#EB9B61', selection: rgba('#EB9B6130') },
      { cursor: '#B38CFF', background: '#B38CFF', selection: rgba('#B38CFF30') },
      { cursor: '#81CFE0', background: '#81CFE0', selection: rgba('#81CFE030') },
    ],
    syntax,
  };

  // Terminal ANSI: prefer real colours from the source, else stable defaults.
  const ansiKeys = [
    'terminal.ansi.black', 'terminal.ansi.red', 'terminal.ansi.green', 'terminal.ansi.yellow',
    'terminal.ansi.blue', 'terminal.ansi.magenta', 'terminal.ansi.cyan', 'terminal.ansi.white',
    'terminal.ansi.bright_black', 'terminal.ansi.bright_red', 'terminal.ansi.bright_green',
    'terminal.ansi.bright_yellow', 'terminal.ansi.bright_blue', 'terminal.ansi.bright_magenta',
    'terminal.ansi.bright_cyan', 'terminal.ansi.bright_white',
  ];
  ansiKeys.forEach((key, i) => {
    style[key] = rgba(pick(colors, [key], DEFAULT_ANSI[i]));
  });

  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v != null) style[k] = String(v).startsWith('#') ? rgba(v) : v;
    }
  }
  return style;
}

// ---------------------------------------------------------------------------
// Include-chain loading (given a resolver that maps a relative path -> content)
// ---------------------------------------------------------------------------
function loadThemeColorsTokens(path, readFile, seen = new Set()) {
  const real = path;
  if (seen.has(real)) return { colors: {}, tokens: [] };
  seen.add(real);
  const text = readFile(path);
  if (text == null) return { colors: {}, tokens: [] };
  let t;
  try { t = parseJsonc(text); } catch { return { colors: {}, tokens: [] }; }
  if (!t || typeof t !== 'object') return { colors: {}, tokens: [] };
  const colors = {};
  let tokens = [];
  if (t.include) {
    const incPath = resolvePath(path, t.include);
    const sub = loadThemeColorsTokens(incPath, readFile, seen);
    Object.assign(colors, sub.colors);
    tokens = tokens.concat(sub.tokens);
  }
  Object.assign(colors, t.colors || {});
  tokens = tokens.concat(t.tokenColors || []);
  return { colors, tokens };
}

// Resolve a relative include path against a base file path, POSIX-style.
function resolvePath(baseFile, rel) {
  const baseDir = baseFile.split('/').slice(0, -1);
  const parts = rel.split('/');
  const stack = baseDir.slice();
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

// ---------------------------------------------------------------------------
// Appearance detection
// ---------------------------------------------------------------------------
const UI_THEME_APPEARANCE = {
  'vs-dark': 'dark', 'hc-black': 'dark',
  vs: 'light', 'hc-light': 'light', lightest: 'light',
};

function detectAppearance(theme, colors) {
  const t = String(theme.type || '').toLowerCase();
  if (t === 'dark' || t === 'light') return t;
  const ui = String(theme.uiTheme || '').toLowerCase();
  if (UI_THEME_APPEARANCE[ui]) return UI_THEME_APPEARANCE[ui];
  const bg = pick(colors, ['editor.background', 'sideBar.background']);
  if (bg) return relativeLuminance(bg) < 0.5 ? 'dark' : 'light';
  return 'dark';
}

function slug(s) {
  s = String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'theme';
}

// ---------------------------------------------------------------------------
// Convert one loaded theme (dict) + colours into a Zed theme entry
// ---------------------------------------------------------------------------
function convertTheme(theme, colors, author, overrides = null) {
  const appearance = detectAppearance(theme, colors);
  let tokens = theme.tokenColors || [];
  let syntax = buildSyntax(tokens);
  const defaultFg = pick(colors, ['editor.foreground'], '#DADDE5');
  if (!syntax.text) syntax.text = { color: defaultFg };
  if (!syntax.variable) syntax.variable = { color: defaultFg };
  syntax = normalizeSyntax(syntax);
  const style = buildStyle(colors, syntax, appearance, overrides);
  const name = theme.name || theme.label || 'Untitled';
  return { name, appearance, style };
}

// ---------------------------------------------------------------------------
// Top-level: convert a set of discovered sources into a family document.
// sources: [{ path, name?, uiTheme? }], readFile: (path) => string|null
// ---------------------------------------------------------------------------
function convertSources(sources, opts = {}) {
  const {
    name = null,
    author = 'auto',
    appearance = null,
    overrides = null,
    publisher = null,
  } = opts;

  const entries = [];
  for (const src of sources) {
    const text = readFileSafe(src.path);
    let theme;
    try { theme = parseJsonc(text); } catch { continue; }
    if (!theme || typeof theme !== 'object') continue;

    if (src.uiTheme && !theme.type) theme.type = UI_THEME_APPEARANCE[String(src.uiTheme).toLowerCase()];
    if (src.name && !theme.name) theme.name = src.name;

    const { colors, tokens } = loadThemeColorsTokens(src.path, readFileSafe);
    if (!theme.tokenColors || !theme.tokenColors.length) theme.tokenColors = tokens;

    const entry = convertTheme(theme, colors, author, overrides);
    if (appearance) entry.appearance = appearance;
    if (name && sources.length === 1) entry.name = name;
    entries.push(entry);
  }

  if (!entries.length) throw new Error('No convertible themes found');

  // Unique display names within the family.
  const seen = new Map();
  for (const e of entries) {
    const base = e.name;
    if (seen.has(base)) {
      seen.set(base, seen.get(base) + 1);
      e.name = `${base} ${seen.get(base)}`;
    } else seen.set(base, 1);
  }

  let finalAuthor = author;
  if (author === 'auto') finalAuthor = publisher ? `${publisher} (converted)` : 'converted';

  const familyName = name && entries.length > 1 ? name : null;
  return {
    $schema: 'https://zed.dev/schema/themes/v0.2.0.json',
    name: familyName || entries[0].name,
    author: finalAuthor,
    themes: entries,
  };
}

// readFileSafe is set by the host (app.js) to resolve paths within the
// uploaded archive / single file. Default returns null (no includes resolved).
let _readFileSafe = () => null;
function setReadFile(fn) { _readFileSafe = fn; }
function readFileSafe(p) { return _readFileSafe(p); }

// Expose as a global so the app works over file:// (no ES-module CORS).
window.ZedConvert = {
  stripJsonComments, parseJsonc, rgba, isTransparent, ensureVisible,
  relativeLuminance, mix, lighten, darken, SCOPE_MAP, scopeToKey,
  buildSyntax, normalizeSyntax, buildStyle, loadThemeColorsTokens,
  resolvePath, detectAppearance, slug, convertTheme, convertSources, setReadFile,
};
})();
