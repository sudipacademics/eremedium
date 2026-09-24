import { env } from '../config/env.js';
import { PdfPage, type Rgb } from '../lib/pdf.js';
import { money, prisma, Prisma } from '../lib/prisma.js';

export type InvoiceKind = 'TOPUP' | 'PUJA' | 'AYURVEDA' | 'CONSULTATION';

export interface InvoiceSummary {
  /** `<kind>-<source row uuid>`; opaque to clients. */
  id: string;
  number: string;
  kind: InvoiceKind;
  title: string;
  description: string;
  amount: string;
  currency: string;
  issuedAt: string;
  paymentMethod: string;
}

interface InvoiceDetail extends InvoiceSummary {
  quantityLabel: string;
  unitPrice: string;
  shipTo: string | null;
  reference: string | null;
}

export class InvoiceNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Invoice not found');
    this.name = 'InvoiceNotFoundError';
  }
}

const KIND_PREFIX: Record<InvoiceKind, string> = {
  TOPUP: 'TOP',
  PUJA: 'PUJ',
  AYURVEDA: 'AYU',
  CONSULTATION: 'CON',
};

const INVOICE_ID = /^(TOPUP|PUJA|AYURVEDA|CONSULTATION)-([0-9a-f-]{36})$/i;

const WALLET = 'Vedsutra wallet';
const LIST_LIMIT = 100;

function invoiceNumber(kind: InvoiceKind, id: string, issuedAt: Date): string {
  return `VS-${issuedAt.getUTCFullYear()}-${KIND_PREFIX[kind]}-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function amount(value: Prisma.Decimal): string {
  return money(value).toFixed(2);
}

/**
 * Every invoice is derived from a row that already records a completed payment, so nothing here can
 * disagree with the ledger. Queries are always scoped by userId: an invoice id alone never grants access.
 */
export const InvoiceService = {
  async list(userId: string): Promise<InvoiceSummary[]> {
    const [topups, pujas, orders, calls] = await Promise.all([
      prisma.paymentOrder.findMany({
        where: { userId, status: 'PAID' },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
      prisma.pujaBooking.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
        include: { temple: { select: { name: true, location: true } } },
      }),
      prisma.ayurvedaOrder.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
      }),
      prisma.callSession.findMany({
        where: { userId, totalDeducted: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        take: LIST_LIMIT,
        include: { astrologer: { select: { displayName: true } } },
      }),
    ]);

    const all: InvoiceDetail[] = [
      ...topups.map(topupDetail),
      ...pujas.map(pujaDetail),
      ...orders.map(ayurvedaDetail),
      ...calls.map(consultationDetail),
    ];
    return all
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .slice(0, LIST_LIMIT)
      .map(({ quantityLabel: _q, unitPrice: _u, shipTo: _s, reference: _r, ...summary }) => summary);
  },

  async renderPdf(userId: string, invoiceId: string): Promise<{ filename: string; pdf: Buffer }> {
    const detail = await findDetail(userId, invoiceId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, phone: true, email: true, address: true },
    });
    if (!user) throw new InvoiceNotFoundError();

    return {
      filename: `${detail.number}.pdf`,
      pdf: drawInvoice(detail, user),
    };
  },
} as const;

async function findDetail(userId: string, invoiceId: string): Promise<InvoiceDetail> {
  const match = INVOICE_ID.exec(invoiceId);
  if (!match) throw new InvoiceNotFoundError();
  const kind = match[1]!.toUpperCase() as InvoiceKind;
  const id = match[2]!.toLowerCase();

  switch (kind) {
    case 'TOPUP': {
      const row = await prisma.paymentOrder.findFirst({ where: { id, userId, status: 'PAID' } });
      if (row) return topupDetail(row);
      break;
    }
    case 'PUJA': {
      const row = await prisma.pujaBooking.findFirst({
        where: { id, userId },
        include: { temple: { select: { name: true, location: true } } },
      });
      if (row) return pujaDetail(row);
      break;
    }
    case 'AYURVEDA': {
      const row = await prisma.ayurvedaOrder.findFirst({ where: { id, userId } });
      if (row) return ayurvedaDetail(row);
      break;
    }
    case 'CONSULTATION': {
      const row = await prisma.callSession.findFirst({
        where: { id, userId, totalDeducted: { gt: 0 } },
        include: { astrologer: { select: { displayName: true } } },
      });
      if (row) return consultationDetail(row);
      break;
    }
  }
  throw new InvoiceNotFoundError();
}

function topupDetail(row: Prisma.PaymentOrderGetPayload<object>): InvoiceDetail {
  const issuedAt = row.paidAt ?? row.createdAt;
  return {
    id: `TOPUP-${row.id}`,
    number: invoiceNumber('TOPUP', row.id, issuedAt),
    kind: 'TOPUP',
    title: 'Wallet top-up',
    description: 'Credit added to your Vedsutra wallet',
    amount: amount(row.amount),
    currency: row.currency,
    issuedAt: issuedAt.toISOString(),
    paymentMethod: 'Razorpay',
    quantityLabel: '1',
    unitPrice: amount(row.amount),
    shipTo: null,
    reference: row.providerPaymentId ? `Payment ID ${row.providerPaymentId}` : null,
  };
}

function pujaDetail(
  row: Prisma.PujaBookingGetPayload<{ include: { temple: { select: { name: true; location: true } } } }>,
): InvoiceDetail {
  return {
    id: `PUJA-${row.id}`,
    number: invoiceNumber('PUJA', row.id, row.createdAt),
    kind: 'PUJA',
    title: row.pujaName,
    description: `E-Puja at ${row.temple.name}, ${row.temple.location} - sankalp for ${row.sankalpName}`,
    amount: amount(row.packagePrice),
    currency: 'INR',
    issuedAt: row.createdAt.toISOString(),
    paymentMethod: WALLET,
    quantityLabel: '1',
    unitPrice: amount(row.packagePrice),
    shipTo: null,
    reference: `Booking ${row.id.slice(0, 8).toUpperCase()}`,
  };
}

function ayurvedaDetail(row: Prisma.AyurvedaOrderGetPayload<object>): InvoiceDetail {
  return {
    id: `AYURVEDA-${row.id}`,
    number: invoiceNumber('AYURVEDA', row.id, row.createdAt),
    kind: 'AYURVEDA',
    title: row.productName,
    description: `Ayurveda shop - SKU ${row.productSku}`,
    amount: amount(row.unitPrice),
    currency: 'INR',
    issuedAt: row.createdAt.toISOString(),
    paymentMethod: WALLET,
    quantityLabel: '1',
    unitPrice: amount(row.unitPrice),
    shipTo: `${row.shippingName}, ${row.shippingAddress} (${row.shippingPhone})`,
    reference: `Order ${row.id.slice(0, 8).toUpperCase()}`,
  };
}

function consultationDetail(
  row: Prisma.CallSessionGetPayload<{ include: { astrologer: { select: { displayName: true } } } }>,
): InvoiceDetail {
  const issuedAt = row.endTime ?? row.startTime ?? row.createdAt;
  return {
    id: `CONSULTATION-${row.id}`,
    number: invoiceNumber('CONSULTATION', row.id, issuedAt),
    kind: 'CONSULTATION',
    title: `Consultation with ${row.astrologer.displayName}`,
    description: `${row.totalMinutes} billed minute${row.totalMinutes === 1 ? '' : 's'} at Rs. ${amount(row.ratePerMinute)}/min`,
    amount: amount(row.totalDeducted),
    currency: 'INR',
    issuedAt: issuedAt.toISOString(),
    paymentMethod: WALLET,
    quantityLabel: `${row.totalMinutes} min`,
    unitPrice: amount(row.ratePerMinute),
    shipTo: null,
    reference: `Session ${row.id.slice(0, 8).toUpperCase()}`,
  };
}

const GREEN: Rgb = [0.043, 0.31, 0.27];
const GOLD: Rgb = [0.69, 0.54, 0.2];
const INK: Rgb = [0.02, 0.16, 0.13];
const MUTED: Rgb = [0.4, 0.45, 0.43];
const RULE: Rgb = [0.85, 0.83, 0.78];
const CREAM: Rgb = [0.97, 0.96, 0.93];

/** Indian digit grouping (12,34,567.00); the PDF fonts have no rupee glyph, hence "Rs.". */
function rupees(value: string): string {
  const [whole = '0', fraction = '00'] = value.split('.');
  const grouped =
    whole.length <= 3
      ? whole
      : `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`;
  return `Rs. ${grouped}.${fraction}`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

function drawInvoice(
  detail: InvoiceDetail,
  user: { name: string; phone: string; email: string | null; address: string | null },
): Buffer {
  const page = new PdfPage();
  const left = 48;
  const right = PdfPage.WIDTH - 48;
  const domain = env.PUBLIC_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const docTitle = detail.kind === 'TOPUP' ? 'PAYMENT RECEIPT' : 'INVOICE';

  page.rect(0, 0, PdfPage.WIDTH, 96, GREEN);
  page.text(left, 52, 'Vedsutra', { size: 26, font: 'bold', color: [1, 1, 1] });
  page.text(left, 72, 'Astrology | Puja | Panchang | Ayurveda', { size: 9, color: [0.85, 0.92, 0.89] });
  page.text(right, 50, docTitle, { size: 16, font: 'bold', color: [1, 1, 1], align: 'right' });
  page.text(right, 70, domain, { size: 9, color: [0.85, 0.92, 0.89], align: 'right' });

  let y = 132;
  page.text(left, y, 'BILLED TO', { size: 8, font: 'bold', color: GOLD });
  page.text(right - 170, y, 'INVOICE DETAILS', { size: 8, font: 'bold', color: GOLD });
  y += 18;
  page.text(left, y, user.name, { size: 11, font: 'bold', color: INK });
  let billY = y + 16;
  page.text(left, billY, user.phone, { size: 9, color: MUTED });
  billY += 14;
  if (user.email) {
    page.text(left, billY, user.email, { size: 9, color: MUTED });
    billY += 14;
  }
  if (user.address) {
    billY = page.wrappedText(left, billY, user.address, 250, { size: 9, color: MUTED, lineHeight: 13 });
  }

  const metaX = right - 170;
  const meta: [string, string][] = [
    ['Number', detail.number],
    ['Date', formatDate(detail.issuedAt)],
    ['Paid via', detail.paymentMethod],
  ];
  if (detail.reference) meta.push(['Reference', detail.reference]);
  let metaY = y;
  for (const [label, value] of meta) {
    page.text(metaX, metaY, label, { size: 9, color: MUTED });
    page.text(right, metaY, value, { size: 9, font: 'bold', color: INK, align: 'right' });
    metaY += 16;
  }

  y = Math.max(billY, metaY) + 24;
  if (detail.shipTo) {
    page.text(left, y, 'SHIP TO', { size: 8, font: 'bold', color: GOLD });
    y = page.wrappedText(left, y + 16, detail.shipTo, right - left, { size: 9, color: MUTED, lineHeight: 13 }) + 12;
  }

  const colQty = right - 190;
  const colRate = right - 100;
  page.rect(left, y, right - left, 26, CREAM);
  page.text(left + 10, y + 17, 'Description', { size: 9, font: 'bold', color: INK });
  page.text(colQty, y + 17, 'Qty', { size: 9, font: 'bold', color: INK, align: 'right' });
  page.text(colRate, y + 17, 'Rate', { size: 9, font: 'bold', color: INK, align: 'right' });
  page.text(right - 10, y + 17, 'Amount', { size: 9, font: 'bold', color: INK, align: 'right' });
  y += 44;

  page.text(left + 10, y, detail.title, { size: 10, font: 'bold', color: INK });
  page.text(colQty, y, detail.quantityLabel, { size: 10, color: INK, align: 'right' });
  page.text(colRate, y, rupees(detail.unitPrice), { size: 10, color: INK, align: 'right' });
  page.text(right - 10, y, rupees(detail.amount), { size: 10, color: INK, align: 'right' });
  y = page.wrappedText(left + 10, y + 15, detail.description, colQty - left - 80, {
    size: 8.5,
    color: MUTED,
    lineHeight: 12,
  });
  y += 10;
  page.line(left, y, right, y, RULE);

  y += 26;
  page.text(right - 190, y, 'Total paid', { size: 11, font: 'bold', color: INK });
  page.text(right - 10, y, rupees(detail.amount), { size: 13, font: 'bold', color: GREEN, align: 'right' });
  y += 12;
  page.line(right - 190, y, right, y, GOLD, 1);

  page.line(left, PdfPage.HEIGHT - 70, right, PdfPage.HEIGHT - 70, RULE);
  page.text(left, PdfPage.HEIGHT - 52, 'This is a computer-generated document and does not require a signature.', {
    size: 8,
    color: MUTED,
  });
  page.text(right, PdfPage.HEIGHT - 52, `Amounts in ${detail.currency}`, { size: 8, color: MUTED, align: 'right' });

  return page.toBuffer(`${docTitle} ${detail.number}`);
}
