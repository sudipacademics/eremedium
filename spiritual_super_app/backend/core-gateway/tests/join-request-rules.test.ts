import { JoinRequestStatus, StaffRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { Permission, hasAnyPermission, permissionsFor } from '../src/auth/permissions.js';
import { describeStaffMutation } from '../src/services/audit.service.js';
import {
  APPLICATION_NO_PATTERN,
  canTransition,
  cleanList,
  csvCell,
  generateApplicationNo,
} from '../src/services/join-request-rules.js';
import { UploadError, decodeDataUrl, sniffMimeType } from '../src/services/upload-storage.js';

describe('application numbers', () => {
  it('encode the UTC date and five unambiguous characters', () => {
    const id = generateApplicationNo(new Date('2026-10-03T20:00:00Z'), () => 0);
    expect(id).toBe('VSJ-261003-22222');
    expect(APPLICATION_NO_PATTERN.test(id)).toBe(true);
  });

  it('never use characters that are easy to misread', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateApplicationNo().split('-')[2]).not.toMatch(/[01OIL]/);
    }
  });
});

describe('status transitions', () => {
  it('lets staff move open applications to any decision', () => {
    expect(canTransition(JoinRequestStatus.PENDING, JoinRequestStatus.APPROVED)).toBe(true);
    expect(canTransition(JoinRequestStatus.UNDER_REVIEW, JoinRequestStatus.MORE_INFO_REQUESTED)).toBe(true);
    expect(canTransition(JoinRequestStatus.MORE_INFO_REQUESTED, JoinRequestStatus.REJECTED)).toBe(true);
  });

  it('treats approval as final and only reopens a rejection for review', () => {
    expect(canTransition(JoinRequestStatus.APPROVED, JoinRequestStatus.REJECTED)).toBe(false);
    expect(canTransition(JoinRequestStatus.REJECTED, JoinRequestStatus.APPROVED)).toBe(false);
    expect(canTransition(JoinRequestStatus.REJECTED, JoinRequestStatus.UNDER_REVIEW)).toBe(true);
  });
});

describe('role permissions', () => {
  it('reserves staff management for the Super Admin', () => {
    expect(hasAnyPermission(StaffRole.SUPER_ADMIN, [Permission.STAFF])).toBe(true);
    expect(hasAnyPermission(StaffRole.ADMIN, [Permission.STAFF])).toBe(false);
  });

  it('keeps each specialist role inside its own area', () => {
    expect(permissionsFor(StaffRole.CONTENT_MANAGER)).toEqual([Permission.DASHBOARD, Permission.CONTENT]);
    expect(hasAnyPermission(StaffRole.FINANCE_MANAGER, [Permission.CONTENT])).toBe(false);
    expect(hasAnyPermission(StaffRole.SUPPORT, [Permission.JOIN_REQUESTS])).toBe(false);
    expect(hasAnyPermission(StaffRole.MANAGER, [Permission.JOIN_REQUESTS])).toBe(true);
  });

  it('accepts any one of several permissions', () => {
    expect(hasAnyPermission(StaffRole.FINANCE_MANAGER, [Permission.SUPPORT, Permission.FINANCE])).toBe(true);
  });
});

describe('uploads', () => {
  const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.7 test').toString('base64')}`;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  it('recognises files by their content', () => {
    expect(sniffMimeType(png)).toBe('image/png');
    expect(sniffMimeType(Buffer.from('%PDF-1.4'))).toBe('application/pdf');
    expect(sniffMimeType(Buffer.from('<html>'))).toBeNull();
  });

  it('accepts a real PDF', () => {
    const decoded = decodeDataUrl(pdf, { maxBytes: 1024, allowed: ['application/pdf'] });
    expect(decoded.mimeType).toBe('application/pdf');
  });

  it('rejects a file whose content does not match its declared type', () => {
    const disguised = `data:image/png;base64,${Buffer.from('%PDF-1.7 test').toString('base64')}`;
    expect(() => decodeDataUrl(disguised, { maxBytes: 1024, allowed: ['image/png', 'application/pdf'] })).toThrow(UploadError);
  });

  it('rejects oversized and disallowed files', () => {
    expect(() => decodeDataUrl(pdf, { maxBytes: 4, allowed: ['application/pdf'] })).toThrow(/larger than/);
    expect(() => decodeDataUrl(pdf, { maxBytes: 1024, allowed: ['image/jpeg'] })).toThrow(/Unsupported/);
  });
});

describe('helpers', () => {
  it('cleans lists of tags', () => {
    expect(cleanList(['  Vedic ', 'vedic', '', 'KP  System', 'Tarot'], 2)).toEqual(['Vedic', 'KP System']);
  });

  it('neutralises spreadsheet formulas and quotes CSV cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('Varanasi, UP')).toBe('"Varanasi, UP"');
    expect(csvCell(null)).toBe('');
  });

  it('derives an audit entry from a staff mutation without copying the body', () => {
    const entry = describeStaffMutation({
      method: 'PATCH',
      url: '/api/v1/content/admin/hero-slides/6f1c1b8e-6d7e-4c43-9a43-2b1d3f0f9a10',
      routeOptions: { url: '/api/v1/content/admin/hero-slides/:id' },
      params: { id: '6f1c1b8e-6d7e-4c43-9a43-2b1d3f0f9a10' },
      body: { title: 'New', imageData: 'data:image/png;base64,AAAA' },
    } as never);
    expect(entry).toMatchObject({
      action: 'PATCH /api/v1/content/admin/hero-slides/:id',
      entityType: 'content.hero-slides',
      entityId: '6f1c1b8e-6d7e-4c43-9a43-2b1d3f0f9a10',
      metadata: { bodyKeys: ['title', 'imageData'] },
    });
    expect(JSON.stringify(entry)).not.toContain('base64');
  });
});
