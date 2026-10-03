import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { env } from '../config/env.js';

export class UploadError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

const EXTENSIONS: Record<UploadMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const DATA_URL_PATTERN = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/;
const STORAGE_KEY_PATTERN = /^[a-z0-9-]+\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

/** The declared type is the client's claim; the leading bytes are what the file actually is. */
export function sniffMimeType(bytes: Buffer): UploadMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export interface DecodedUpload {
  mimeType: UploadMimeType;
  bytes: Buffer;
}

export function decodeDataUrl(
  dataUrl: string,
  options: { maxBytes: number; allowed: readonly UploadMimeType[] },
): DecodedUpload {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) throw new UploadError('File must be sent as a base64 data URL');
  const declared = match[1] as string;
  const bytes = Buffer.from(match[2] as string, 'base64');
  if (bytes.length === 0) throw new UploadError('File is empty');
  if (bytes.length > options.maxBytes) {
    throw new UploadError(`File is larger than ${(options.maxBytes / 1_048_576).toFixed(1)} MB`);
  }
  const actual = sniffMimeType(bytes);
  if (!actual || !options.allowed.includes(actual) || actual !== declared) {
    throw new UploadError(`Unsupported file type; allowed: ${options.allowed.map((type) => EXTENSIONS[type].toUpperCase()).join(', ')}`);
  }
  return { mimeType: actual, bytes };
}

function resolveKey(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new UploadError('Invalid storage key');
  return path.join(env.UPLOAD_DIR, ...storageKey.split('/'));
}

export async function storeUpload(folder: string, upload: DecodedUpload): Promise<string> {
  const now = new Date();
  const key = `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${EXTENSIONS[upload.mimeType]}`;
  const target = resolveKey(key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, upload.bytes, { mode: 0o600 });
  return key;
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  return readFile(resolveKey(storageKey));
}

export async function removeUpload(storageKey: string): Promise<void> {
  await rm(resolveKey(storageKey), { force: true });
}
