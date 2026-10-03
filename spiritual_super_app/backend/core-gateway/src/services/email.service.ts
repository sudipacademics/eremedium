import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  transporter = env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        ...(env.SMTP_USER && env.SMTP_PASS ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
      })
    : null;
  return transporter;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wraps plain paragraphs in the Vedsutra email frame. Inputs are escaped here. */
export function brandedHtml(title: string, paragraphs: readonly string[], cta?: { label: string; href: string }): string {
  const body = paragraphs.map((text) => `<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(text)}</p>`).join('');
  const button = cta
    ? `<p style="margin:22px 0 0"><a href="${escapeHtml(cta.href)}" style="background:#0b4f45;color:#fff;text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:600;display:inline-block">${escapeHtml(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:Arial,Helvetica,sans-serif;color:#063a33">
<div style="max-width:560px;margin:0 auto;padding:28px 18px">
<div style="background:#fff;border:1px solid #e8dcc0;border-radius:16px;padding:26px">
<p style="margin:0 0 6px;color:#a8862f;font-size:12px;letter-spacing:2px;text-transform:uppercase">Vedsutra</p>
<h1 style="margin:0 0 16px;font-size:22px;color:#063a33">${escapeHtml(title)}</h1>
${body}${button}
</div>
<p style="color:#7a8a84;font-size:12px;text-align:center;margin-top:14px">You are receiving this because you applied to join Vedsutra.</p>
</div></body></html>`;
}

/** Never throws: a mail outage must not undo the status change that triggered the email. */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const transport = getTransporter();
  if (!transport) {
    logger.info({ to: message.to, subject: message.subject }, 'Email not sent: SMTP is not configured');
    return false;
  }
  try {
    await transport.sendMail({ from: env.SMTP_FROM, ...message });
    return true;
  } catch (error) {
    logger.error({ err: error, subject: message.subject }, 'Email delivery failed');
    return false;
  }
}
