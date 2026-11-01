import { ChangeEvent, DragEvent, KeyboardEvent, useId, useRef, useState } from 'react';
import './file-upload.css';

export type UploadedFile = {
  file: File;
  name: string;
  size: number;
  type: string;
  /** Base64 body without the `data:...;base64,` prefix (what upload endpoints expect). */
  base64: string;
};

export const DEFAULT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Base64 body of a file, without the data-URL prefix. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function matchesAccept(file: File, accept?: string) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule);
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns an error message, or null when the file is acceptable. */
export function validateUploadFile(file: File, accept?: string, maxBytes = DEFAULT_MAX_UPLOAD_BYTES): string | null {
  if (!matchesAccept(file, accept)) return `${file.name}: file type not allowed`;
  if (file.size > maxBytes) return `${file.name}: larger than ${formatBytes(maxBytes)}`;
  if (file.size === 0) return `${file.name}: file is empty`;
  return null;
}

type Props = {
  onFiles: (files: UploadedFile[]) => void;
  accept?: string;
  maxBytes?: number;
  multiple?: boolean;
  maxFiles?: number;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /** Capture from camera on phones (e.g. "environment" for a prescription photo). */
  capture?: 'environment' | 'user';
};

export function FileUpload({
  onFiles,
  accept = 'image/*,application/pdf',
  maxBytes = DEFAULT_MAX_UPLOAD_BYTES,
  multiple = false,
  maxFiles = 5,
  label = 'Drop a file here or click to choose',
  hint,
  disabled = false,
  capture,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function handle(list: FileList | null) {
    if (!list || disabled) return;
    const picked = Array.from(list).slice(0, multiple ? maxFiles : 1);
    const problems: string[] = [];
    if (multiple && list.length > maxFiles) problems.push(`Only the first ${maxFiles} files were taken`);
    const ok = picked.filter((f) => {
      const err = validateUploadFile(f, accept, maxBytes);
      if (err) problems.push(err);
      return !err;
    });
    setErrors(problems);
    if (!ok.length) return;
    setBusy(true);
    try {
      const out = await Promise.all(
        ok.map(async (file) => ({ file, name: file.name, size: file.size, type: file.type, base64: await fileToBase64(file) })),
      );
      onFiles(out);
    } catch (e) {
      setErrors((prev) => [...prev, e instanceof Error ? e.message : 'Could not read file']);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    void handle(e.dataTransfer.files);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <div className="fu">
      <div
        className={`fu-zone${dragging ? ' fu-drag' : ''}${disabled ? ' fu-disabled' : ''}`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-describedby={hint ? `${inputId}-hint` : undefined}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={onKeyDown}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="fu-label">{busy ? 'Reading file…' : label}</span>
        <span className="fu-limits">
          Max {formatBytes(maxBytes)}
          {multiple ? ` · up to ${maxFiles} files` : ''}
        </span>
      </div>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        className="fu-input"
        accept={accept}
        multiple={multiple}
        capture={capture}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => void handle(e.target.files)}
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="fu-hint">
          {hint}
        </p>
      ) : null}
      {errors.length ? (
        <ul className="fu-errors">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
