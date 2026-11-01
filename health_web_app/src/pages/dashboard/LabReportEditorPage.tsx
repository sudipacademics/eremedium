import {
  Fragment,
  ReactNode,
  Ref,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { hasAnyRole, ROLES } from '../../auth/roles';
import {
  ABNORMAL_FLAGS,
  ABNORMAL_FLAG_LABELS,
  CommentPresetRow,
  LabReportDetail,
  LabReportParam,
  LabReportParamEdit,
  LabReportQueueRow,
} from '../../types/labReport';
import type { BookingLifecycleDetail } from '../../types/bookingLifecycle';
import { formatPatientAge } from '../../utils/patientAge';
import { ReportDispatchActions } from '../../components/ReportDispatchActions';
import './lab-tech-v2.css';
import './lab-result-entry-v2.css';

const LOCKED_STATUSES = ['Authorized', 'Printed'];
const PRESET_KEY = 'hec_re2_comment_presets';
const METHOD_DEFAULT_KEY = 'hec_re2_method_group';
const PRESET_CATEGORIES = ['All', 'General', 'Technical', 'Interpretation', 'Critical', 'Sample issue'] as const;

type CommentTab = 'general' | 'interpretation';
type PresetCategory = (typeof PRESET_CATEGORIES)[number];

type CommentPreset = {
  id: string;
  title?: string;
  category: Exclude<PresetCategory, 'All'>;
  text: string;
  plain?: string;
};

type PresetDraft = {
  mode: 'create' | 'edit';
  id?: string;
  title: string;
  category: Exclude<PresetCategory, 'All'>;
  text: string;
};

type ParamGroup = {
  key: string;
  layout: string;
  title: string;
  rows: LabReportParam[];
};

type InfoTile = {
  key: string;
  label: string;
  value: string;
  tone?: 'teal' | 'blue' | 'amber' | 'violet';
  icon: ReactNode;
};

const STARTER_PRESETS: CommentPreset[] = [
  { id: 'starter-1', category: 'General', text: 'Result is within normal reference range.' },
  { id: 'starter-2', category: 'Interpretation', text: 'Results are suggestive of hypothyroidism.' },
  { id: 'starter-3', category: 'Interpretation', text: 'Results are suggestive of hyperthyroidism.' },
  { id: 'starter-4', category: 'General', text: 'Please correlate clinically.' },
  { id: 'starter-5', category: 'Sample issue', text: 'Repeat sample is recommended.' },
  { id: 'starter-6', category: 'Sample issue', text: 'Sample is unsatisfactory for analysis.' },
  { id: 'starter-7', category: 'Sample issue', text: 'Hemolyzed sample. Repeat sample recommended.' },
];

function Re2Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ICON_DOC = (
  <>
    <path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
    <path d="M14 3.5V9h5.5M8 13h8M8 16.5h6" />
  </>
);
const ICON_PERSON = <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm-7 9a7 7 0 0 1 14 0" />;
const ICON_FILE = (
  <>
    <path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
    <path d="M14 3.5V9h5.5" />
  </>
);
const ICON_CAL = (
  <>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>
);
const ICON_FLASK = <path d="M9 3h6M10 3v6L5 18.5A2 2 0 0 0 6.8 21h10.4a2 2 0 0 0 1.8-2.5L14 9V3M7.5 15h9" />;
const ICON_SAVE = (
  <>
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M8 4v5h8M8 20v-6h8v6" />
  </>
);
const ICON_IMPORT = (
  <>
    <path d="M12 3v12" />
    <path d="m8 11 4 4 4-4" />
    <path d="M5 19h14" />
  </>
);
const ICON_CALC = (
  <>
    <rect x="5" y="3.5" width="14" height="17" rx="2" />
    <path d="M8 8h8M8 12h3M13 12h3M8 16h3M13 16h3" />
  </>
);
const ICON_PDF = (
  <>
    <path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z" />
    <path d="M14 3.5V9h5.5M8 14h3M8 17h5" />
  </>
);
const ICON_SEND = <path d="M4 12 20 4l-6 16-2.5-6.5L4 12z" />;
const ICON_TRASH = (
  <>
    <path d="M5 7h14M9 7V5h6v2M8 7l.7 12h6.6L16 7" />
  </>
);
const ICON_PENCIL = (
  <>
    <path d="M4 20h4l10.5-10.5-4-4L4 16v4z" />
    <path d="M12.5 7.5l4 4" />
  </>
);

function isAbnormalFlag(flag?: string | null) {
  const f = (flag || '').trim().toUpperCase();
  return !!f && f !== 'N' && f !== 'NORMAL' && f !== '-' && f !== '—';
}

function flagFromNumeric(row: LabReportParam, value: string) {
  const raw = (value || '').trim();
  if (!raw) return '';
  const n = Number(raw);
  if (Number.isNaN(n)) return '';
  const lo = row.lower_range;
  const hi = row.upper_range;
  if (lo != null && hi != null && lo === 0 && hi === 0) return '';
  if (lo == null && hi == null) return '';
  if (lo != null && n < Number(lo)) return 'L';
  if (hi != null && n > Number(hi)) return 'H';
  return 'N';
}

function rangeLabel(row: LabReportParam) {
  if (row.reference_range_label) return row.reference_range_label;
  const lo = row.lower_range;
  const hi = row.upper_range;
  if (lo != null && hi != null && !(lo === 0 && hi === 0)) return `${lo} – ${hi}`;
  if (lo != null && lo !== 0) return `≥ ${lo}`;
  if (hi != null && hi !== 0) return `≤ ${hi}`;
  return '—';
}

function choiceList(row: LabReportParam) {
  return (row.choice_options || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inputType(row: LabReportParam) {
  return (row.result_input_type || 'Numeric').trim();
}

function present(value: unknown) {
  if (value == null) return '';
  const text = String(value).trim();
  return text && text !== 'null' && text !== 'undefined' ? text : '';
}

function formatWhen(raw?: string | null) {
  const text = present(raw);
  if (!text) return '';
  const d = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return text;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

const FONT_FACES = ['Arial', 'Times New Roman', 'Georgia', 'Calibri', 'Verdana', 'Courier New'];
const FONT_SIZES = ['10', '11', '12', '14', '16', '18', '24'];
const COMMENT_ALLOWED = new Set(['B', 'I', 'U', 'S', 'STRONG', 'EM', 'STRIKE', 'P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'A', 'SPAN', 'FONT']);

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function looksLikeHtml(text: string) {
  return /<\/?(?:b|i|u|s|strong|em|strike|p|div|br|ul|ol|li|span|font|a)\b/i.test(text);
}

function toEditorHtml(text: string) {
  if (!text) return '';
  if (looksLikeHtml(text) || /&[a-zA-Z#0-9]+;/.test(text)) return text;
  return escapeHtml(text).replace(/\r\n|\n|\r/g, '<br>');
}

function htmlToPlainText(html: string) {
  if (!html) return '';
  const box = document.createElement('div');
  box.innerHTML = html;
  return (box.innerText || box.textContent || '').replace(/\u00a0/g, ' ');
}

function isBlankHtml(html: string) {
  return !htmlToPlainText(html).trim();
}

function sanitizeCommentHtml(html: string) {
  if (!html || isBlankHtml(html)) return '';
  const parsed = new DOMParser().parseFromString(`<div id="re2-root">${html}</div>`, 'text/html');
  const root = parsed.getElementById('re2-root');
  if (!root) return htmlToPlainText(html).trim();
  const walk = (parent: Element) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) continue;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.parentNode?.removeChild(node);
        continue;
      }
      const el = node as HTMLElement;
      if (!COMMENT_ALLOWED.has(el.tagName)) {
        const frag = parsed.createDocumentFragment();
        while (el.firstChild) frag.appendChild(el.firstChild);
        el.replaceWith(frag);
        walk(parent);
        return;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const keep =
          (el.tagName === 'A' && (name === 'href' || name === 'target' || name === 'rel')) ||
          (el.tagName === 'FONT' && (name === 'face' || name === 'size' || name === 'color')) ||
          name === 'style';
        if (!keep) el.removeAttribute(attr.name);
      }
      if (el.tagName === 'A') {
        const href = el.getAttribute('href') || '';
        if (!/^(https?:|mailto:|#)/i.test(href)) el.removeAttribute('href');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      const style = el.getAttribute('style');
      if (style) {
        const safe = style
          .split(';')
          .map((part) => part.trim())
          .filter((part) => /^(color|background-color|font-size|font-family|text-align|text-decoration)\s*:/i.test(part))
          .join('; ');
        if (safe) el.setAttribute('style', safe);
        else el.removeAttribute('style');
      }
      walk(el);
    }
  };
  walk(root);
  return root.innerHTML;
}

function persistComments(html: string) {
  const clean = sanitizeCommentHtml(html);
  return isBlankHtml(clean) ? '' : clean;
}

function persistReportNote(html: string) {
  return htmlToPlainText(html).replace(/\s+\n/g, '\n').trim();
}

function wordCount(text: string) {
  const plain = htmlToPlainText(text).trim();
  return plain ? plain.split(/\s+/).length : 0;
}

function charCount(text: string) {
  return htmlToPlainText(text).replace(/\s/g, ' ').length;
}

function formatDraftClock(d = new Date()) {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export type CommentRichEditorHandle = {
  insertText: (text: string) => void;
  clear: () => void;
  getHtml: () => string;
};

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function runEditorCommand(command: string, value?: string) {
  document.execCommand(command, false, value);
}

const CommentRichEditor = forwardRef<
  CommentRichEditorHandle,
  {
    value: string;
    disabled: boolean;
    placeholder: string;
    onChange: (html: string) => void;
  }
>(function CommentRichEditor({ value, disabled, placeholder, onChange }, ref) {
  const boxRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [face, setFace] = useState('Arial');
  const [size, setSize] = useState('11');
  const [draftAt, setDraftAt] = useState<string | null>(null);

  const emit = useCallback(() => {
    const html = boxRef.current?.innerHTML || '';
    onChange(html);
    setDraftAt(formatDraftClock());
  }, [onChange]);

  const restoreSelection = useCallback(() => {
    const el = boxRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
      return;
    }
    if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) {
      placeCaretAtEnd(el);
    }
  }, []);

  const saveSelection = useCallback(() => {
    const el = boxRef.current;
    const sel = window.getSelection();
    if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return;
    savedRange.current = sel.getRangeAt(0).cloneRange();
  }, []);

  const command = useCallback(
    (name: string, val?: string) => {
      if (disabled) return;
      restoreSelection();
      runEditorCommand(name, val);
      emit();
    },
    [disabled, emit, restoreSelection],
  );

  const applyFontSize = useCallback(
    (px: string) => {
      if (disabled) return;
      restoreSelection();
      runEditorCommand('fontSize', '7');
      const el = boxRef.current;
      el?.querySelectorAll('font[size="7"]').forEach((node) => {
        node.removeAttribute('size');
        (node as HTMLElement).style.fontSize = `${px}px`;
      });
      setSize(px);
      emit();
    },
    [disabled, emit, restoreSelection],
  );

  const insertLink = useCallback(() => {
    if (disabled) return;
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;
    command('createLink', url);
  }, [command, disabled]);

  useImperativeHandle(
    ref,
    () => ({
      insertText(text: string) {
        const el = boxRef.current;
        if (!el || disabled || !text) return;
        el.focus();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) {
          placeCaretAtEnd(el);
        }
        const html = looksLikeHtml(text) ? sanitizeCommentHtml(text) : '';
        if (html) runEditorCommand('insertHTML', html);
        else runEditorCommand('insertText', text);
        emit();
      },
      clear() {
        const el = boxRef.current;
        if (!el) return;
        el.innerHTML = '';
        onChange('');
        setDraftAt(formatDraftClock());
      },
      getHtml() {
        return boxRef.current?.innerHTML || '';
      },
    }),
    [disabled, emit, onChange],
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const next = value || '';
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  useEffect(() => {
    try {
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* ignore */
    }
  }, []);

  const empty = isBlankHtml(value);

  return (
    <div className="re2-wysiwyg">
      <div className="re2-comment-toolbar" data-re2-writing-tools="1" role="toolbar" aria-label="Comment writing tools">
        <button type="button" className="re2-tb-btn" title="Undo" aria-label="Undo" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('undo')}>
          ↺
        </button>
        <button type="button" className="re2-tb-btn" title="Redo" aria-label="Redo" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('redo')}>
          ↻
        </button>
        <span className="re2-tb-sep" aria-hidden />
        <select
          className="re2-tb-select"
          aria-label="Font family"
          disabled={disabled}
          value={face}
          onMouseDown={saveSelection}
          onChange={(e) => {
            setFace(e.target.value);
            command('fontName', e.target.value);
          }}
        >
          {FONT_FACES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="re2-tb-select is-size"
          aria-label="Font size"
          disabled={disabled}
          value={size}
          onMouseDown={saveSelection}
          onChange={(e) => applyFontSize(e.target.value)}
        >
          {FONT_SIZES.map((px) => (
            <option key={px} value={px}>
              {px}
            </option>
          ))}
        </select>
        <span className="re2-tb-sep" aria-hidden />
        <button type="button" className="re2-tb-btn is-mark" title="Bold" aria-label="Bold" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('bold')}>
          <b>B</b>
        </button>
        <button type="button" className="re2-tb-btn is-mark" title="Italic" aria-label="Italic" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('italic')}>
          <i>I</i>
        </button>
        <button type="button" className="re2-tb-btn is-mark" title="Underline" aria-label="Underline" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('underline')}>
          <u>U</u>
        </button>
        <button type="button" className="re2-tb-btn is-mark" title="Strikethrough" aria-label="Strikethrough" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('strikeThrough')}>
          <s>S</s>
        </button>
        <label className="re2-tb-color" title="Text color">
          <span aria-hidden>A</span>
          <input
            type="color"
            aria-label="Text color"
            disabled={disabled}
            defaultValue="#0f172a"
            onMouseDown={saveSelection}
            onChange={(e) => command('foreColor', e.target.value)}
          />
        </label>
        <label className="re2-tb-color is-hl" title="Highlight">
          <span aria-hidden>▮</span>
          <input
            type="color"
            aria-label="Highlight color"
            disabled={disabled}
            defaultValue="#fff59d"
            onMouseDown={saveSelection}
            onChange={(e) => command('hiliteColor', e.target.value)}
          />
        </label>
        <span className="re2-tb-sep" aria-hidden />
        <button type="button" className="re2-tb-btn" title="Align left" aria-label="Align left" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('justifyLeft')}>
          ⬅
        </button>
        <button type="button" className="re2-tb-btn" title="Align center" aria-label="Align center" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('justifyCenter')}>
          ↔
        </button>
        <button type="button" className="re2-tb-btn" title="Align right" aria-label="Align right" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('justifyRight')}>
          ➡
        </button>
        <button type="button" className="re2-tb-btn" title="Bulleted list" aria-label="Bulleted list" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('insertUnorderedList')}>
          •
        </button>
        <button type="button" className="re2-tb-btn" title="Numbered list" aria-label="Numbered list" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => command('insertOrderedList')}>
          1.
        </button>
        <button type="button" className="re2-tb-btn" title="Insert link" aria-label="Insert link" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={insertLink}>
          🔗
        </button>
      </div>
      <div
        ref={boxRef}
        className={`re2-wysiwyg-surface${empty ? ' is-empty' : ''}`}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label="Comments and notes"
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={saveSelection}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
      />
      <div className="re2-words">
        <span>
          Words: {wordCount(value)} &nbsp; Characters: {charCount(value)}
        </span>
        <span>{draftAt ? `Draft saved · ${draftAt}` : 'Draft ready'}</span>
      </div>
    </div>
  );
});

function loadLocalPresets(): CommentPreset[] {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CommentPreset[];
    if (!Array.isArray(parsed) || !parsed.length) return [];
    return parsed.filter((p) => p && p.id && p.text);
  } catch {
    return [];
  }
}

function saveLocalPresets(list: CommentPreset[]) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function presetPlain(preset: Pick<CommentPreset, 'text' | 'plain'>) {
  return (preset.plain || htmlToPlainText(preset.text) || preset.text || '').trim();
}

function presetTitle(preset: CommentPreset) {
  return (preset.title || presetPlain(preset).split('\n')[0] || 'Untitled preset').trim();
}

function normalizePresetCategory(raw?: string): Exclude<PresetCategory, 'All'> {
  return PRESET_CATEGORIES.includes(raw as PresetCategory) && raw !== 'All'
    ? (raw as Exclude<PresetCategory, 'All'>)
    : 'General';
}

function fromApiPreset(row: CommentPresetRow): CommentPreset {
  return {
    id: row.id || row.name || '',
    title: row.title || '',
    category: normalizePresetCategory(row.category),
    text: row.text || row.plain || '',
    plain: row.plain || htmlToPlainText(row.text || ''),
  };
}

function groupParameters(rows: LabReportParam[]): ParamGroup[] {
  const groups: ParamGroup[] = [];
  for (const row of rows) {
    const layout = row.result_layout || (inputType(row) === 'Descriptive Text' ? 'Descriptive' : 'Numeric Profile');
    const key = `${layout}::${row.diagnostic_test || row.test_name || 'test'}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, layout, title: row.test_name || row.diagnostic_test || 'Results', rows: [row] });
  }
  return groups;
}

function ResultInput({
  row,
  locked,
  onChange,
  onCommit,
}: {
  row: LabReportParam;
  locked: boolean;
  onChange: (value: string) => void;
  onCommit?: (value: string) => void;
}) {
  const rtype = inputType(row);
  if (rtype === 'Heading' || rtype === 'Spacer') return null;
  if (rtype === 'Choice List') {
    const opts = choiceList(row);
    return (
      <select
        className="re2-input"
        value={row.result_value || ''}
        disabled={locked || !!row.is_calculated}
        onChange={(e) => {
          onChange(e.target.value);
          onCommit?.(e.target.value);
        }}
      >
        <option value="">Select…</option>
        {opts.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (rtype === 'Descriptive Text') {
    return (
      <textarea
        className="re2-input is-wide"
        rows={3}
        value={row.result_value}
        disabled={locked || !!row.is_calculated}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
      />
    );
  }
  if (rtype === 'Date') {
    return (
      <input
        className="re2-input"
        type="date"
        value={row.result_value}
        disabled={locked || !!row.is_calculated}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
      />
    );
  }
  return (
    <input
      className="re2-input is-result"
      value={row.result_value}
      disabled={locked || !!row.is_calculated}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onCommit?.(e.target.value)}
    />
  );
}

function InfoStrip({ tiles }: { tiles: InfoTile[] }) {
  if (!tiles.length) return null;
  return (
    <section className="re2-strip" aria-label="Patient and booking details">
      {tiles.map((tile) => (
        <div className="re2-tile" key={tile.key}>
          <span className={`re2-tile-icon${tile.tone === 'teal' || !tile.tone ? '' : ` is-${tile.tone}`}`}>
            <Re2Icon size={16}>{tile.icon}</Re2Icon>
          </span>
          <span>
            <small>{tile.label}</small>
            <b>{tile.value}</b>
          </span>
        </div>
      ))}
    </section>
  );
}

function PasswordChallenge({
  title,
  summary,
  userLabel,
  pwd,
  pwdErr,
  pwdBusy,
  onPwd,
  onCancel,
  onSubmit,
}: {
  title: string;
  summary: string;
  userLabel: string;
  pwd: string;
  pwdErr: string | null;
  pwdBusy: boolean;
  onPwd: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="re2-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="abnormal-ack-title">
      <div className="re2-modal">
        <h2 id="abnormal-ack-title">{title}</h2>
        <p>{summary}</p>
        <p className="muted">
          Signed in as <strong>{userLabel}</strong>
        </p>
        <label className="lt-field">
          Password
          <input
            className="re2-input"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={pwd}
            disabled={pwdBusy}
            onChange={(e) => onPwd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onSubmit();
              }
              if (e.key === 'Escape') onCancel();
            }}
            style={{ width: '100%', height: 40, marginTop: 4 }}
          />
        </label>
        {pwdErr ? <div className="error">{pwdErr}</div> : null}
        <div className="re2-modal-actions">
          <button type="button" className="lt-action is-ghost" disabled={pwdBusy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="lt-action" disabled={pwdBusy} onClick={onSubmit}>
            {pwdBusy ? 'Checking…' : 'Accept with password'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ParametersCard({
  groups,
  locked,
  methodGroup,
  methodOptions,
  testCount,
  onMethodGroup,
  onSetDefault,
  onInclude,
  onResultChange,
  onResultCommit,
  onFlagChange,
  onClear,
}: {
  groups: ParamGroup[];
  locked: boolean;
  methodGroup: string;
  methodOptions: string[];
  testCount: number;
  onMethodGroup: (value: string) => void;
  onSetDefault: () => void;
  onInclude: (name: string, include: boolean) => void;
  onResultChange: (name: string, value: string) => void;
  onResultCommit: (name: string, value: string) => void;
  onFlagChange: (name: string, flag: string) => void;
  onClear: (name: string) => void;
}) {
  return (
    <section className="re2-card">
      <div className="re2-card-head">
        <div className="re2-card-title">
          <Re2Icon size={18}>{ICON_FLASK}</Re2Icon>
          Test parameters
          <span className="re2-count">
            {testCount} {testCount === 1 ? 'test' : 'tests'}
          </span>
        </div>
        <div className="re2-card-tools">
          <label className="lt-field">
            <span>Method group</span>
            <select className="re2-input" value={methodGroup} onChange={(e) => onMethodGroup(e.target.value)}>
              <option value="">All</option>
              {methodOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="lt-action is-ghost" onClick={onSetDefault}>
            Set default
          </button>
        </div>
      </div>
      {!groups.length ? (
        <p className="re2-empty">No parameters on this report yet.</p>
      ) : (
        groups.map((group) => {
          const matrix = group.layout === 'Table Matrix';
          let lastHeading = '';
          return (
            <div key={group.key} className="re2-table-wrap">
              {groups.length > 1 || matrix ? (
                <h3 className="re2-group-title">
                  {group.title}
                  {matrix ? <span className="lt-badge tone-muted">table matrix</span> : null}
                </h3>
              ) : null}
              <table className="lt-table">
                <thead>
                  <tr>
                    <th className="lt-col-check"> </th>
                    <th>#</th>
                    <th>Parameter</th>
                    <th>Result</th>
                    <th>Unit</th>
                    <th>Reference range</th>
                    <th>Category</th>
                    <th>Flag</th>
                    <th>Method</th>
                    <th>Machine</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, idx) => {
                    const rtype = inputType(row);
                    if (rtype === 'Spacer') return null;
                    const heading = (row.before_heading || '').trim();
                    const headingRow =
                      heading && heading !== lastHeading ? (
                        <tr key={`${row.name}-h`} className="re2-heading-row">
                          <td colSpan={11}>{heading}</td>
                        </tr>
                      ) : null;
                    if (heading) lastHeading = heading;
                    if (rtype === 'Heading') {
                      return (
                        <tr key={row.name} className="re2-heading-row">
                          <td colSpan={11}>{row.description}</td>
                        </tr>
                      );
                    }
                    return (
                      <Fragment key={row.name}>
                        {headingRow}
                        <tr className={row.is_calculated ? 're2-calc-row' : undefined}>
                          <td className="lt-col-check">
                            <input
                              type="checkbox"
                              checked={!!row.include_in_report}
                              disabled={locked}
                              onChange={(e) => onInclude(row.name, e.target.checked)}
                            />
                          </td>
                          <td>{idx + 1}</td>
                          <td>
                            <div className="re2-param-name">
                              <strong>{row.description}</strong>
                              {row.parameter_code ? <span>{row.parameter_code}</span> : null}
                              {row.is_calculated ? <span className="lt-badge tone-blue">calc</span> : null}
                            </div>
                          </td>
                          <td>
                            <ResultInput
                              row={row}
                              locked={locked}
                              onChange={(value) => onResultChange(row.name, value)}
                              onCommit={(value) => onResultCommit(row.name, value)}
                            />
                          </td>
                          <td className="re2-muted">{row.unit || '—'}</td>
                          <td className="re2-range">{rangeLabel(row)}</td>
                          <td className="re2-muted">{row.clinical_category || '—'}</td>
                          <td>
                            <select
                              className="re2-input"
                              value={row.abnormal_flag || ''}
                              disabled={locked}
                              onChange={(e) => onFlagChange(row.name, e.target.value)}
                            >
                              {ABNORMAL_FLAGS.map((f) => (
                                <option key={f || 'none'} value={f}>
                                  {ABNORMAL_FLAG_LABELS[f]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="re2-muted">{row.method || '—'}</td>
                          <td className="re2-muted">{row.machine_name || '—'}</td>
                          <td>
                            <button
                              type="button"
                              className="re2-icon-btn"
                              disabled={locked || !!row.is_calculated}
                              aria-label={`Clear ${row.description || row.parameter_code}`}
                              onClick={() => onClear(row.name)}
                            >
                              <Re2Icon size={15}>{ICON_TRASH}</Re2Icon>
                            </button>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </section>
  );
}

function PreviousResultsCard() {
  return (
    <section className="re2-card re2-prev-card">
      <div className="re2-card-head">
        <div className="re2-card-title">
          <Re2Icon size={18}>
            <path d="M4 6h16M4 12h10M4 18h13" />
          </Re2Icon>
          Previous results
        </div>
      </div>
      <p className="re2-empty re2-no-prior-results-on-file">
        No previous results on file for this patient.
      </p>
    </section>
  );
}

function CommentsCard({
  tab,
  general,
  interpretation,
  locked,
  selectedPreset,
  presets,
  busy,
  presetBusy,
  editorRef,
  onTab,
  onGeneral,
  onInterpretation,
  onPreset,
  onInsert,
  onClear,
  onSave,
  onSavePreset,
}: {
  tab: CommentTab;
  general: string;
  interpretation: string;
  locked: boolean;
  selectedPreset: string;
  presets: CommentPreset[];
  busy: boolean;
  presetBusy: boolean;
  editorRef: Ref<CommentRichEditorHandle>;
  onTab: (tab: CommentTab) => void;
  onGeneral: (value: string) => void;
  onInterpretation: (value: string) => void;
  onPreset: (id: string) => void;
  onInsert: () => void;
  onClear: () => void;
  onSave: () => void;
  onSavePreset: () => void;
}) {
  const text = tab === 'general' ? general : interpretation;
  return (
    <section className="re2-card">
      <div className="re2-card-head">
        <div className="re2-card-title">
          <Re2Icon size={18}>{ICON_DOC}</Re2Icon>
          Comments / Notes
        </div>
      </div>
      <div className="re2-tabs" role="tablist">
        <button type="button" className={`re2-tab${tab === 'general' ? ' is-active' : ''}`} onClick={() => onTab('general')}>
          General note
        </button>
        <button
          type="button"
          className={`re2-tab${tab === 'interpretation' ? ' is-active' : ''}`}
          onClick={() => onTab('interpretation')}
        >
          Interpretation
        </button>
      </div>
      <div className="re2-comment-body">
        <CommentRichEditor
          key={tab}
          ref={editorRef}
          value={text}
          disabled={locked}
          placeholder={tab === 'general' ? 'General comment printed on the report…' : 'Interpretation / report note…'}
          onChange={tab === 'general' ? onGeneral : onInterpretation}
        />
      </div>
      <div className="re2-comment-foot">
        <div className="re2-comment-actions">
          <select className="re2-input" value={selectedPreset} onChange={(e) => onPreset(e.target.value)} aria-label="Insert preset">
            <option value="">Insert preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {presetTitle(p)}
              </option>
            ))}
          </select>
          <button type="button" className="lt-action is-ghost" disabled={locked || !selectedPreset} onClick={onInsert}>
            Add to editor
          </button>
          <button type="button" className="lt-action is-ghost" disabled={locked || isBlankHtml(text) || presetBusy} onClick={onSavePreset}>
            Save as Preset
          </button>
          <button type="button" className="lt-action is-ghost" disabled={locked} onClick={onClear}>
            Clear
          </button>
        </div>
        <button type="button" className="lt-action" disabled={locked || busy} onClick={onSave}>
          {busy ? 'Saving…' : 'Save comment'}
        </button>
      </div>
    </section>
  );
}

function PresetLibrary({
  presets,
  search,
  category,
  locked,
  busy,
  onSearch,
  onCategory,
  onInsert,
  onEdit,
  onDelete,
}: {
  presets: CommentPreset[];
  search: string;
  category: PresetCategory;
  locked: boolean;
  busy: boolean;
  onSearch: (value: string) => void;
  onCategory: (value: PresetCategory) => void;
  onInsert: (preset: CommentPreset) => void;
  onEdit: (preset: CommentPreset) => void;
  onDelete: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const q = search.trim().toLowerCase();
  const visible = presets.filter((p) => {
    if (category !== 'All' && p.category !== category) return false;
    if (!q) return true;
    const hay = `${presetTitle(p)} ${presetPlain(p)} ${p.category}`.toLowerCase();
    return hay.includes(q);
  });

  function scrollBy(dir: number) {
    listRef.current?.scrollBy({ top: dir * 132, behavior: 'smooth' });
  }

  return (
    <section className="re2-card re2-preset-card">
      <div className="re2-card-head">
        <div className="re2-card-title">
          <Re2Icon size={18}>{ICON_DOC}</Re2Icon>
          Preset Library
        </div>
        <span className="re2-count">{visible.length}</span>
      </div>
      <div className="re2-preset-toolbar">
        <label className="re2-search">
          <Re2Icon size={16}>
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </Re2Icon>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search comments by keyword…"
            aria-label="Search comment presets"
          />
        </label>
      </div>
      <div className="lt-chips re2-preset-chips">
        {PRESET_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`lt-chip${category === c ? ' is-active' : ''}`}
            onClick={() => onCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="re2-preset-carousel-wrap">
        <div className="re2-preset-carousel" ref={listRef} role="list">
          {visible.length ? (
            visible.map((p) => (
              <article className="re2-preset-slide" key={p.id} role="listitem">
                <div className="re2-preset-slide-top">
                  <strong>{presetTitle(p)}</strong>
                  <span>{p.category}</span>
                </div>
                <p className="re2-preset-preview">{presetPlain(p)}</p>
                <div className="re2-preset-slide-actions">
                  <button type="button" className="lt-action" disabled={locked} onClick={() => onInsert(p)}>
                    Use / Insert
                  </button>
                  <button
                    type="button"
                    className="re2-icon-btn"
                    aria-label="Edit preset"
                    disabled={busy}
                    onClick={() => onEdit(p)}
                  >
                    <Re2Icon size={15}>{ICON_PENCIL}</Re2Icon>
                  </button>
                  <button
                    type="button"
                    className="re2-icon-btn"
                    aria-label="Delete preset"
                    disabled={busy}
                    onClick={() => onDelete(p.id)}
                  >
                    <Re2Icon size={15}>{ICON_TRASH}</Re2Icon>
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="re2-empty">No presets match this search.</p>
          )}
        </div>
        <div className="re2-preset-nav">
          <button type="button" className="re2-icon-btn" aria-label="Previous presets" onClick={() => scrollBy(-1)}>
            ▲
          </button>
          <button type="button" className="re2-icon-btn" aria-label="Next presets" onClick={() => scrollBy(1)}>
            ▼
          </button>
        </div>
      </div>
    </section>
  );
}

function SavePresetModal({
  draft,
  busy,
  error,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: PresetDraft;
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<PresetDraft>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const preview = presetPlain({ text: draft.text });
  return (
    <div className="re2-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="re2-modal"
        role="dialog"
        aria-labelledby="re2-preset-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="re2-preset-title">{draft.mode === 'edit' ? 'Edit preset' : 'Save as Preset'}</h2>
        <p>This comment will stay in your Preset Library for future Result Entry reports.</p>
        <label className="re2-field">
          <span>Title</span>
          <input
            className="re2-input"
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Short name for this preset"
          />
        </label>
        <label className="re2-field">
          <span>Category</span>
          <select
            className="re2-input"
            value={draft.category}
            onChange={(e) => onChange({ category: e.target.value as Exclude<PresetCategory, 'All'> })}
          >
            {PRESET_CATEGORIES.filter((c) => c !== 'All').map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {draft.mode === 'edit' ? (
          <label className="re2-field">
            <span>Preset text</span>
            <textarea
              className="re2-input"
              rows={5}
              value={draft.text}
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </label>
        ) : (
          <div className="re2-field">
            <span>Preview</span>
            <p className="re2-preset-modal-preview">{preview || '—'}</p>
          </div>
        )}
        {error ? <p className="re2-empty">{error}</p> : null}
        <div className="re2-modal-actions">
          <button type="button" className="lt-action is-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="lt-action" onClick={onSubmit} disabled={busy || !preview}>
            {busy ? 'Saving…' : draft.mode === 'edit' ? 'Update preset' : 'Save preset'}
          </button>
        </div>
      </div>
    </div>
  );
}

function buildInfoTiles(
  detail: LabReportDetail,
  booking: BookingLifecycleDetail['booking'] | null,
  rows: LabReportParam[],
  receivedFallback = '',
): InfoTile[] {
  const gender = present(detail.gender ?? booking?.gender);
  const ageGender = [
    formatPatientAge({
      age: detail.age ?? booking?.age,
      age_months: detail.age_months ?? booking?.age_months,
      age_days: detail.age_days ?? booking?.age_days,
    }),
    gender,
  ].filter(Boolean).join(' / ');
  const bookingNo = present(detail.appointment_no) || present(detail.bill_no);
  const sampleId = present(detail.unique_barcode) || present(booking?.barcode);
  const collected = formatWhen(detail.sample_date) || formatWhen(detail.collection_slot) || formatWhen(booking?.collection_slot);
  const received = formatWhen(detail.lab_receipt_date) || formatWhen(receivedFallback);
  const testsFromRows = Array.from(new Set(rows.map((r) => present(r.test_name)).filter(Boolean)));
  const tests =
    testsFromRows.join(', ') ||
    (booking?.test_labels || []).filter(Boolean).join(', ') ||
    present(detail.test_required);
  const machines = Array.from(new Set(rows.map((r) => present(r.machine_name)).filter(Boolean))).join(', ');
  const tiles: InfoTile[] = [];
  const add = (tile: InfoTile) => {
    if (tile.value) tiles.push(tile);
  };
  add({ key: 'patient', label: 'Patient name', value: present(detail.patient_name) || present(booking?.patient_name), icon: ICON_PERSON });
  add({ key: 'age', label: 'Age / Gender', value: ageGender, tone: 'blue', icon: ICON_PERSON });
  add({ key: 'booking', label: 'Booking no.', value: bookingNo, tone: 'blue', icon: ICON_FILE });
  add({ key: 'sample', label: 'Sample ID', value: sampleId, tone: 'blue', icon: ICON_FILE });
  add({ key: 'specimen', label: 'Sample type', value: present(detail.specimen), tone: 'blue', icon: ICON_FILE });
  add({ key: 'collected', label: 'Collection date', value: collected, tone: 'amber', icon: ICON_CAL });
  add({ key: 'received', label: 'Received at lab', value: received, tone: 'amber', icon: ICON_CAL });
  add({ key: 'doctor', label: 'Ref. doctor', value: present(detail.referral_doctor), tone: 'amber', icon: ICON_PERSON });
  add({ key: 'tests', label: 'Requested tests', value: tests, tone: 'violet', icon: ICON_FLASK });
  add({ key: 'instrument', label: 'Instrument', value: machines, tone: 'violet', icon: ICON_FLASK });
  return tiles;
}

export function LabReportEditorPage() {
  const { trfId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [detail, setDetail] = useState<LabReportDetail | null>(null);
  const [rows, setRows] = useState<LabReportParam[]>([]);
  const [booking, setBooking] = useState<BookingLifecycleDetail['booking'] | null>(null);
  const [receivedAt, setReceivedAt] = useState('');
  const [queue, setQueue] = useState<LabReportQueueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [comments, setComments] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [commentTab, setCommentTab] = useState<CommentTab>('general');
  const [methodGroup, setMethodGroup] = useState('');
  const [presets, setPresets] = useState<CommentPreset[]>(STARTER_PRESETS);
  const [presetSearch, setPresetSearch] = useState('');
  const [presetCategory, setPresetCategory] = useState<PresetCategory>('All');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [presetDraft, setPresetDraft] = useState<PresetDraft | null>(null);
  const [presetErr, setPresetErr] = useState<string | null>(null);
  const migratedPresetsRef = useRef(false);
  const [letterheadPlain, setLetterheadPlain] = useState(() => {
    try {
      return localStorage.getItem('hec_nabl_letterhead_plain') === '1';
    } catch {
      return false;
    }
  });
  const [challenge, setChallenge] = useState<{ title: string; summary: string } | null>(null);
  const [pwd, setPwd] = useState('');
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);
  const challengeResolver = useRef<((password: string | null) => void) | null>(null);
  const verifiedPwdRef = useRef('');
  const ackedRef = useRef<Set<string>>(new Set());
  const lastGoodRef = useRef<Record<string, { result_value: string; abnormal_flag: string }>>({});
  const rowsRef = useRef<LabReportParam[]>([]);
  const commentEditorRef = useRef<CommentRichEditorHandle | null>(null);

  const canAuthorize = hasAnyRole(user?.roles || [], [
    ROLES.PATHOLOGIST,
    ROLES.ADMIN,
    ROLES.SYSTEM_MANAGER,
  ]);

  const applyDetail = useCallback((d: LabReportDetail) => {
    setDetail(d);
    setRows(d.parameters);
    rowsRef.current = d.parameters;
    for (const row of d.parameters) {
      lastGoodRef.current[row.name] = { result_value: row.result_value, abnormal_flag: row.abnormal_flag };
    }
    setComments(toEditorHtml(d.comments || ''));
    setReportNote(toEditorHtml(d.report_note || ''));
    setDirty(false);
  }, []);

  function promptPassword(title: string, summary: string, opts?: { reuse?: boolean }): Promise<string | null> {
    if (opts?.reuse && verifiedPwdRef.current) return Promise.resolve(verifiedPwdRef.current);
    setPwd('');
    setPwdErr(null);
    setChallenge({ title, summary });
    return new Promise((resolve) => {
      challengeResolver.current = resolve;
    });
  }

  async function submitPassword() {
    if (!pwd.trim()) {
      setPwdErr('Enter your password to accept abnormal results.');
      return;
    }
    setPwdBusy(true);
    setPwdErr(null);
    try {
      await api.verifyLabUserPassword(pwd);
      verifiedPwdRef.current = pwd;
      challengeResolver.current?.(pwd);
      challengeResolver.current = null;
      setChallenge(null);
      setPwd('');
    } catch (err) {
      setPwdErr(err instanceof Error ? err.message : 'Incorrect password');
    } finally {
      setPwdBusy(false);
    }
  }

  function cancelPassword() {
    challengeResolver.current?.(null);
    challengeResolver.current = null;
    setChallenge(null);
    setPwd('');
    setPwdErr(null);
  }

  async function acknowledgeAbnormal(row: LabReportParam, value: string, flag: string) {
    const key = `${row.name}|${value}|${flag}`;
    if (ackedRef.current.has(key)) return true;
    const password = await promptPassword(
      'Abnormal value',
      `${row.description || row.parameter_code}: ${value || '—'} ${row.unit || ''}  (${flag})\nReference: ${rangeLabel(row)}\n\nEnter your password to accept this abnormal result.`,
      { reuse: true },
    );
    if (!password) return false;
    ackedRef.current.add(key);
    lastGoodRef.current[row.name] = { result_value: value, abnormal_flag: flag };
    return true;
  }

  const load = useCallback(async () => {
    const res = await api.getLabReportDetail({ trf_id: trfId });
    applyDetail(res.data);
  }, [trfId, applyDetail]);

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load report'));
  }, [load]);

  useEffect(() => {
    api
      .getLabReportQueue(200)
      .then((res) => setQueue(res.data?.queue || []))
      .catch(() => undefined);
    if (!trfId) return;
    api
      .getBookingLifecycleDetail(trfId)
      .then((res) => {
        setBooking(res.data?.booking || null);
        const rec = (res.data?.tubes || []).map((t) => t.received_at).find(Boolean) || '';
        setReceivedAt(rec);
      })
      .catch(() => undefined);
  }, [trfId]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(METHOD_DEFAULT_KEY) || '';
      if (saved) setMethodGroup(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const applyPresetList = useCallback((list: CommentPreset[]) => {
    setPresets(list);
    saveLocalPresets(list);
  }, []);

  const loadPresetsFromServer = useCallback(async () => {
    const localBefore = loadLocalPresets();
    const res = await api.listCommentPresets();
    const remote = (res.data?.presets || []).map(fromApiPreset).filter((p) => p.id && p.text);
    if (!remote.length) {
      applyPresetList(localBefore.length ? localBefore : STARTER_PRESETS);
      return remote;
    }
    if (!migratedPresetsRef.current) {
      migratedPresetsRef.current = true;
      const known = new Set(remote.map((p) => presetPlain(p).toLowerCase()));
      const extras = localBefore.filter((p) => {
        const plain = presetPlain(p).toLowerCase();
        return plain && !known.has(plain) && !String(p.id).startsWith('starter-');
      });
      for (const extra of extras) {
        try {
          const saved = await api.saveCommentPreset({
            title: extra.title || presetTitle(extra),
            category: extra.category,
            text: extra.text,
          });
          remote.unshift(fromApiPreset(saved.data));
        } catch {
          /* keep local extra if migrate fails */
        }
      }
    }
    applyPresetList(remote);
    return remote;
  }, [applyPresetList]);

  useEffect(() => {
    void loadPresetsFromServer().catch(() => {
      const local = loadLocalPresets();
      if (local.length) applyPresetList(local);
    });
  }, [loadPresetsFromServer, applyPresetList]);

  const locked = useMemo(
    () => (detail ? LOCKED_STATUSES.includes(detail.report_status) : false),
    [detail],
  );

  function updateRow(name: string, patch: Partial<LabReportParam>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.name === name ? { ...r, ...patch } : r));
      rowsRef.current = next;
      return next;
    });
    setDirty(true);
    setNotice(null);
  }

  async function onResultCommit(name: string, value: string) {
    const row = rowsRef.current.find((r) => r.name === name);
    if (!row) return;
    if (row.uses_interpretation_bands) {
      lastGoodRef.current[name] = { result_value: value, abnormal_flag: row.abnormal_flag };
      return;
    }
    const computed = flagFromNumeric(row, value);
    const flag = isAbnormalFlag(row.abnormal_flag) ? row.abnormal_flag : computed;
    if (!isAbnormalFlag(flag) && !isAbnormalFlag(computed)) {
      lastGoodRef.current[name] = { result_value: value, abnormal_flag: row.abnormal_flag };
      return;
    }
    const useFlag = isAbnormalFlag(flag) ? flag : computed;
    const ok = await acknowledgeAbnormal(row, value, useFlag);
    if (!ok) {
      const prev = lastGoodRef.current[name] || { result_value: '', abnormal_flag: '' };
      updateRow(name, prev);
      return;
    }
    if (computed && row.abnormal_flag !== computed) {
      updateRow(name, { abnormal_flag: computed });
    }
  }

  async function onFlagChange(name: string, flag: string) {
    const row = rowsRef.current.find((r) => r.name === name);
    if (!row) return;
    if (!isAbnormalFlag(flag)) {
      updateRow(name, { abnormal_flag: flag });
      lastGoodRef.current[name] = { result_value: row.result_value, abnormal_flag: flag };
      return;
    }
    const ok = await acknowledgeAbnormal(row, row.result_value, flag);
    if (!ok) return;
    updateRow(name, { abnormal_flag: flag });
  }

  function editPayload(): LabReportParamEdit[] {
    return rows.map((r) => ({
      name: r.name,
      result_value: r.result_value,
      abnormal_flag: r.abnormal_flag,
      interpretation: r.interpretation,
      include_in_report: r.include_in_report,
    }));
  }

  function notePayload() {
    const live = commentEditorRef.current?.getHtml();
    const general = commentTab === 'general' && live != null ? live : comments;
    const interpretation = commentTab === 'interpretation' && live != null ? live : reportNote;
    return {
      comments: persistComments(general),
      report_note: persistReportNote(interpretation),
    };
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!detail) return;
    await run('save', async () => {
      const res = await api.saveLabReportParameters(detail.lab_report, editPayload(), notePayload());
      applyDetail(res.data);
      setNotice('Results saved.');
    });
  }

  async function saveComment() {
    if (!detail) return;
    await run('comment', async () => {
      const res = await api.saveLabReportParameters(detail.lab_report, editPayload(), notePayload());
      applyDetail(res.data);
      setNotice('Comment saved.');
    });
  }

  async function importMachine() {
    if (!detail) return;
    await run('import', async () => {
      const res = await api.importMachineResults(detail.lab_report);
      setNotice(`Imported ${res.data.imported} machine result(s).`);
      await load();
    });
  }

  async function recalc() {
    if (!detail) return;
    await run('recalc', async () => {
      await api.recalculateLabReport(detail.lab_report);
      setNotice('Calculated parameters updated.');
      await load();
    });
  }

  async function finalize() {
    if (!detail) return;
    let snapshot = rowsRef.current;
    if (dirty) {
      setBusy('save');
      try {
        const saved = await api.saveLabReportParameters(detail.lab_report, editPayload(), notePayload());
        applyDetail(saved.data);
        snapshot = saved.data.parameters;
        setNotice('Results saved.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed');
        setBusy(null);
        return;
      }
      setBusy(null);
    }
    const abnormals = snapshot.filter((p) => isAbnormalFlag(p.abnormal_flag));
    let confirmPassword = verifiedPwdRef.current;
    if (abnormals.length) {
      const summary = abnormals
        .slice(0, 8)
        .map((p) => `${p.description || p.parameter_code}: ${p.result_value || ''} (${p.abnormal_flag})`)
        .join('\n');
      const password = await promptPassword(
        'NABL abnormal check',
        `${abnormals.length} abnormal / flagged result(s):\n\n${summary}${
          abnormals.length > 8 ? '\n…' : ''
        }\n\nEnter your password to finalize and send for pathologist review.`,
      );
      if (!password) return;
      confirmPassword = password;
    }
    await run('finalize', async () => {
      try {
        const res = await api.finalizeLabReport(detail.lab_report, confirmPassword);
        verifiedPwdRef.current = '';
        setNotice(
          res.data.complete
            ? 'Report finalized and sent for pathologist review.'
            : 'Report sent for review (some expected results still missing).',
        );
        await load();
      } catch (err) {
        verifiedPwdRef.current = '';
        throw err;
      }
    });
  }

  async function preview() {
    if (!detail) return;
    await run('preview', async () => {
      const html = await api.getLabReportPreviewHtml(detail.lab_report, letterheadPlain);
      const win = window.open('', '_blank');
      if (win) {
        win.document.write(html);
        win.document.close();
      } else {
        setError('Popup blocked — allow popups to preview the report.');
      }
    });
  }

  async function authorize() {
    if (!detail?.care_journey) {
      setError('No linked care journey to authorize.');
      return;
    }
    const abnormals = rowsRef.current.filter((p) => isAbnormalFlag(p.abnormal_flag));
    if (abnormals.length) {
      const summary = abnormals
        .slice(0, 8)
        .map((p) => `${p.description || p.parameter_code}: ${p.result_value || ''} (${p.abnormal_flag})`)
        .join('\n');
      const password = await promptPassword(
        'NABL abnormal authorize',
        `${abnormals.length} flagged result(s):\n\n${summary}${
          abnormals.length > 8 ? '\n…' : ''
        }\n\nEnter your password to authorize and release the NABL PDF.`,
      );
      if (!password) return;
    }
    const notes = window.prompt('Pathologist notes (optional):', '') ?? undefined;
    await run('authorize', async () => {
      await api.authorizeLabReport({ journey_id: detail.care_journey!, pathologist_notes: notes });
      setNotice('Report authorized — use Send to WhatsApp or Download Report.');
      await load();
    });
  }

  const methodOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => present(r.method)).filter(Boolean))).sort(),
    [rows],
  );
  const visibleRows = useMemo(
    () => (methodGroup ? rows.filter((r) => present(r.method) === methodGroup || inputType(r) === 'Heading' || inputType(r) === 'Spacer') : rows),
    [rows, methodGroup],
  );
  const groups = useMemo(() => groupParameters(visibleRows), [visibleRows]);
  const testCount = useMemo(
    () => visibleRows.filter((r) => {
      const t = inputType(r);
      return t !== 'Heading' && t !== 'Spacer';
    }).length,
    [visibleRows],
  );
  const tiles = useMemo(
    () => (detail ? buildInfoTiles(detail, booking, rows, receivedAt) : []),
    [detail, booking, rows, receivedAt],
  );
  const queueIndex = useMemo(() => queue.findIndex((r) => r.trf_id === trfId), [queue, trfId]);
  const prevTrf = queueIndex > 0 ? queue[queueIndex - 1]?.trf_id : '';
  const nextTrf = queueIndex >= 0 && queueIndex < queue.length - 1 ? queue[queueIndex + 1]?.trf_id : '';

  function insertPresetText(text: string) {
    if (!text) return;
    commentEditorRef.current?.insertText(text);
    setDirty(true);
  }

  function currentCommentHtml() {
    const live = commentEditorRef.current?.getHtml();
    return commentTab === 'general' ? live ?? comments : live ?? reportNote;
  }

  function openCreatePreset() {
    const html = persistComments(currentCommentHtml());
    if (isBlankHtml(html)) {
      setNotice('Write a comment or note before saving it as a preset.');
      return;
    }
    const plain = htmlToPlainText(html).trim();
    setPresetErr(null);
    setPresetDraft({
      mode: 'create',
      title: plain.split('\n')[0].slice(0, 140),
      category: commentTab === 'interpretation' ? 'Interpretation' : 'General',
      text: html,
    });
  }

  function openEditPreset(preset: CommentPreset) {
    setPresetErr(null);
    setPresetDraft({
      mode: 'edit',
      id: preset.id,
      title: presetTitle(preset),
      category: preset.category,
      text: presetPlain(preset),
    });
  }

  async function submitPresetDraft() {
    if (!presetDraft) return;
    const text = presetDraft.mode === 'edit' ? toEditorHtml(presetDraft.text) : persistComments(presetDraft.text);
    if (isBlankHtml(text)) {
      setPresetErr('Preset text cannot be empty.');
      return;
    }
    setBusy('preset');
    setPresetErr(null);
    try {
      if (presetDraft.mode === 'edit' && presetDraft.id && !String(presetDraft.id).startsWith('starter-')) {
        const res = await api.updateCommentPreset({
          preset_id: presetDraft.id,
          title: presetDraft.title,
          category: presetDraft.category,
          text,
        });
        const next = presets.map((p) => (p.id === presetDraft.id ? fromApiPreset(res.data) : p));
        applyPresetList(next);
      } else {
        const res = await api.saveCommentPreset({
          title: presetDraft.title,
          category: presetDraft.category,
          text,
        });
        applyPresetList([fromApiPreset(res.data), ...presets.filter((p) => p.id !== presetDraft.id)]);
      }
      setPresetDraft(null);
      setNotice(presetDraft.mode === 'edit' ? 'Preset updated.' : 'Preset saved to your library.');
    } catch (err) {
      setPresetErr(err instanceof Error ? err.message : 'Could not save preset');
    } finally {
      setBusy(null);
    }
  }

  async function deletePreset(id: string) {
    const hit = presets.find((p) => p.id === id);
    if (!hit) return;
    if (!window.confirm(`Delete preset “${presetTitle(hit)}”?`)) return;
    setBusy('preset');
    try {
      if (!String(id).startsWith('starter-')) {
        await api.deleteCommentPreset(id);
      }
      const next = presets.filter((p) => p.id !== id);
      applyPresetList(next);
      if (selectedPreset === id) setSelectedPreset('');
      setNotice('Preset deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete preset');
    } finally {
      setBusy(null);
    }
  }

  if (!detail && !error) {
    return (
      <div className="lt-page re2-page re2-result-entry-form">
        <p className="re2-empty">Loading lab report…</p>
      </div>
    );
  }

  return (
    <div className="lt-page re2-page re2-result-entry-form">
      <section className="re2-hero">
        <div className="re2-hero-main">
          <span className="re2-hero-icon">
            <Re2Icon size={28}>{ICON_DOC}</Re2Icon>
          </span>
          <div>
            <h2>Lab report — {detail?.patient_name || trfId}</h2>
            <p>
              {detail ? (
                <>
                  {detail.lab_report}
                  {detail.department ? ` · ${detail.department}` : ''}
                  {detail.report_status ? ` · ${detail.report_status}` : ''}
                  {detail.customer_trf ? ` · TRF ${detail.customer_trf}` : ''}
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="re2-hero-aside">
          {detail?.report_status ? (
            <span className="re2-status-pill">
              <i />
              {detail.report_status}
            </span>
          ) : null}
          {prevTrf || nextTrf ? (
            <>
              <button
                type="button"
                className="re2-nav-btn"
                disabled={!prevTrf}
                aria-label="Previous report in queue"
                onClick={() => prevTrf && navigate(`/dashboard/lab-reports/${encodeURIComponent(prevTrf)}`)}
              >
                <Re2Icon size={16}>
                  <path d="M15 6l-6 6 6 6" />
                </Re2Icon>
              </button>
              <button
                type="button"
                className="re2-nav-btn"
                disabled={!nextTrf}
                aria-label="Next report in queue"
                onClick={() => nextTrf && navigate(`/dashboard/lab-reports/${encodeURIComponent(nextTrf)}`)}
              >
                <Re2Icon size={16}>
                  <path d="M9 6l6 6-6 6" />
                </Re2Icon>
              </button>
            </>
          ) : null}
        </div>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}
      {locked ? (
        <div className="notice">This report is {detail?.report_status.toLowerCase()} — results are read-only.</div>
      ) : null}
      {locked && detail?.care_journey ? (
        <div className="re2-share">
          <ReportDispatchActions journeyId={detail.care_journey} trfId={detail.customer_trf} />
        </div>
      ) : null}

      {detail ? <InfoStrip tiles={tiles} /> : null}

      <div className="re2-actions">
        <button type="button" className="lt-action is-ghost" disabled={locked || busy === 'save'} onClick={() => void save()}>
          <Re2Icon size={15}>{ICON_SAVE}</Re2Icon>
          {busy === 'save' ? 'Saving…' : 'Save results'}
        </button>
        <button type="button" className="lt-action is-ghost" disabled={locked || busy === 'import'} onClick={() => void importMachine()}>
          <Re2Icon size={15}>{ICON_IMPORT}</Re2Icon>
          {busy === 'import' ? 'Importing…' : 'Import machine results'}
        </button>
        <button type="button" className="lt-action is-ghost" disabled={locked || busy === 'recalc'} onClick={() => void recalc()}>
          <Re2Icon size={15}>{ICON_CALC}</Re2Icon>
          {busy === 'recalc' ? 'Working…' : 'Recalculate derived'}
        </button>
        <label className="re2-letterhead">
          <input
            type="checkbox"
            checked={letterheadPlain}
            onChange={(e) => {
              const on = e.target.checked;
              setLetterheadPlain(on);
              try {
                localStorage.setItem('hec_nabl_letterhead_plain', on ? '1' : '0');
              } catch {
                /* ignore */
              }
            }}
          />
          Headerless / footerless (letterhead print)
        </label>
        <button type="button" className="lt-action is-ghost" disabled={busy === 'preview'} onClick={() => void preview()}>
          <Re2Icon size={15}>{ICON_PDF}</Re2Icon>
          {busy === 'preview' ? 'Opening…' : 'Preview NABL PDF'}
        </button>
        {canAuthorize && detail?.report_status === 'Verified' ? (
          <button type="button" className="lt-action is-ghost" disabled={busy === 'authorize'} onClick={() => void authorize()}>
            {busy === 'authorize' ? 'Authorizing…' : 'Authorize report'}
          </button>
        ) : null}
        <button
          type="button"
          className="lt-action re2-actions-end"
          disabled={locked || busy === 'finalize'}
          onClick={() => void finalize()}
        >
          <Re2Icon size={15}>{ICON_SEND}</Re2Icon>
          {busy === 'finalize' ? 'Finalizing…' : 'Finalize & send for review'}
        </button>
      </div>

      <div className="re2-main">
        <ParametersCard
          groups={groups}
          locked={locked}
          methodGroup={methodGroup}
          methodOptions={methodOptions}
          testCount={testCount}
          onMethodGroup={setMethodGroup}
          onSetDefault={() => {
            try {
              localStorage.setItem(METHOD_DEFAULT_KEY, methodGroup);
              setNotice(methodGroup ? `Default method group set to ${methodGroup}.` : 'Default method group cleared.');
            } catch {
              setNotice('Could not save the default method group in this browser.');
            }
          }}
          onInclude={(name, include) => updateRow(name, { include_in_report: include ? 1 : 0 })}
          onResultChange={(name, value) => updateRow(name, { result_value: value })}
          onResultCommit={(name, value) => void onResultCommit(name, value)}
          onFlagChange={(name, flag) => void onFlagChange(name, flag)}
          onClear={(name) => updateRow(name, { result_value: '', abnormal_flag: '' })}
        />
        <PreviousResultsCard />
      </div>

      <div className="re2-bottom">
        <CommentsCard
          tab={commentTab}
          general={comments}
          interpretation={reportNote}
          locked={locked}
          selectedPreset={selectedPreset}
          presets={presets}
          busy={busy === 'comment'}
          presetBusy={busy === 'preset'}
          editorRef={commentEditorRef}
          onTab={setCommentTab}
          onGeneral={(value) => {
            setComments(value);
            setDirty(true);
          }}
          onInterpretation={(value) => {
            setReportNote(value);
            setDirty(true);
          }}
          onPreset={setSelectedPreset}
          onInsert={() => {
            const hit = presets.find((p) => p.id === selectedPreset);
            if (hit) insertPresetText(hit.text);
          }}
          onClear={() => {
            commentEditorRef.current?.clear();
            if (commentTab === 'general') setComments('');
            else setReportNote('');
            setDirty(true);
          }}
          onSave={() => void saveComment()}
          onSavePreset={openCreatePreset}
        />
        <PresetLibrary
          presets={presets}
          search={presetSearch}
          category={presetCategory}
          locked={locked}
          busy={busy === 'preset'}
          onSearch={setPresetSearch}
          onCategory={setPresetCategory}
          onInsert={(preset) => insertPresetText(preset.text)}
          onEdit={openEditPreset}
          onDelete={(id) => void deletePreset(id)}
        />
      </div>

      <p className="re2-back">
        <button type="button" className="lt-action is-ghost" onClick={() => navigate('/dashboard/lab-reports')}>
          ← Back to lab reports
        </button>
        <Link to={`/dashboard/all-bookings?trf=${encodeURIComponent(trfId)}`}>View TRF</Link>
      </p>

      {challenge ? (
        <PasswordChallenge
          title={challenge.title}
          summary={challenge.summary}
          userLabel={user?.fullName || user?.user || ''}
          pwd={pwd}
          pwdErr={pwdErr}
          pwdBusy={pwdBusy}
          onPwd={setPwd}
          onCancel={cancelPassword}
          onSubmit={() => void submitPassword()}
        />
      ) : null}

      {presetDraft ? (
        <SavePresetModal
          draft={presetDraft}
          busy={busy === 'preset'}
          error={presetErr}
          onChange={(patch) => setPresetDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
          onCancel={() => {
            setPresetDraft(null);
            setPresetErr(null);
          }}
          onSubmit={() => void submitPresetDraft()}
        />
      ) : null}
    </div>
  );
}
