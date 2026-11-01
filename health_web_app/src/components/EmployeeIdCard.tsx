import qrcode from './qrcode-generator.js';
import './employee-id-card.css';

export type EmployeeIdCardFields = {
  name: string;
  empId: string;
  designation: string;
  department: string;
  managerName: string;
  photoUrl: string;
  bloodGroup?: string;
  wing?: string;
  division?: string;
  position?: string;
  dateOfJoining?: string;
  unit?: string;
  profileUrl?: string;
};

const COMPANY = 'Smilecure Lifestyle Pvt Ltd';
const CARD_TITLE = 'EMPLOYEE ID CARD';
const FOOTER = 'Smilecure Lifestyle Pvt Ltd • Employee Portal';

export function profilePhotoUrl(emp?: object | null) {
  if (!emp) return '';
  const rec = emp as { photo?: string | null; image?: string | null };
  return String(rec.photo || rec.image || '').trim();
}

export function employeeProfileUrl(empId?: string | null) {
  const id = encodeURIComponent(String(empId || '').trim());
  const base = 'https://people.e-remedium.in/people/profile';
  return id ? `${base}?employee=${id}` : base;
}

function shown(value?: string | null) {
  const text = String(value || '').trim();
  if (!text || text === '—' || text === '-') return 'DEMO';
  return text;
}

function joiningLabel(value?: string | null) {
  const text = String(value || '').trim();
  if (!text || text === '—' || text === '-') return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return text;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function cleanDepartment(value?: string | null) {
  let text = String(value || '').trim();
  if (text.includes(' — ')) text = text.split(' — ').pop() || text;
  return text.replace(/\s+-\s+[A-Z0-9]{2,8}$/, '').trim();
}

function cardRows(fields: EmployeeIdCardFields): Array<[string, string]> {
  const rows: Array<[string, string | null | undefined]> = [
    ['Employee ID', fields.empId],
    ['Wing', fields.wing],
    ['Division', fields.division],
    ['Department', cleanDepartment(fields.department)],
    ['Position', fields.position || fields.designation],
    ['Unit / Centre', fields.unit],
    ['Manager Name', fields.managerName],
    ['Date of Joining', joiningLabel(fields.dateOfJoining)],
  ];
  return rows.filter(([, value]) => shown(value) !== 'DEMO').map(([label, value]) => [label, String(value).trim()]);
}

function cardInitials(name?: string | null) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function employeeQrDataUrl(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(8, 2);
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

async function paintVerticalIdCard(fields: EmployeeIdCardFields) {
  const rows = cardRows(fields);
  const w = 760;
  const headerH = 250;
  const rowsTop = 430;
  const rowH = 78;
  const rowGap = 12;
  const rowsBottom = rowsTop + rows.length * (rowH + rowGap);
  const qrSize = 250;
  const qrY = rowsBottom + 16;
  const h = qrY + qrSize + 150;
  const canvas = document.createElement('canvas');
  const scale = 2;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);

  ctx.save();
  drawRoundedRect(ctx, 0, 0, w, h, 36);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#0f766e');
  grad.addColorStop(0.46, '#0e8a8a');
  grad.addColorStop(1, '#0b6fc2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, headerH);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '600 28px Segoe UI, sans-serif';
  ctx.fillText(COMPANY, w / 2, 92, w - 80);
  ctx.font = '800 32px Segoe UI, sans-serif';
  ctx.fillText(CARD_TITLE, w / 2, 138);

  const cx = w / 2;
  const cy = headerH;
  ctx.beginPath();
  ctx.arc(cx, cy, 86, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 76, 0, Math.PI * 2);
  ctx.fillStyle = '#e7f6f3';
  ctx.fill();

  const photo = await loadImage(fields.photoUrl);
  if (photo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 76, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(photo, cx - 76, cy - 76, 152, 152);
    ctx.restore();
  } else {
    const letters = cardInitials(fields.name);
    if (letters) {
      ctx.fillStyle = '#0f766e';
      ctx.font = '800 42px Segoe UI, sans-serif';
      ctx.fillText(letters, cx, cy + 14);
    }
  }

  ctx.fillStyle = '#0f172a';
  ctx.font = '800 40px Segoe UI, sans-serif';
  if (shown(fields.name) !== 'DEMO') ctx.fillText(shown(fields.name), w / 2, 390, w - 80);

  rows.forEach((row, index) => {
    const y = rowsTop + index * (rowH + rowGap);
    ctx.fillStyle = '#f4fbfb';
    drawRoundedRect(ctx, 48, y, w - 96, rowH, 16);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748b';
    ctx.font = '700 16px Segoe UI, sans-serif';
    ctx.fillText(row[0].toUpperCase(), 68, y + 28);
    ctx.fillStyle = row[1] === 'DEMO' ? '#94a3b8' : '#0f172a';
    ctx.font = row[1] === 'DEMO' ? '700 20px Segoe UI, sans-serif' : '700 26px Segoe UI, sans-serif';
    ctx.fillText(row[1], 68, y + 58, w - 150);
  });

  ctx.strokeStyle = '#d5e3e8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(80, qrY - 8);
  ctx.lineTo(w - 80, qrY - 8);
  ctx.stroke();

  const qrX = (w - qrSize) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#d5e3e8';
  drawRoundedRect(ctx, qrX, qrY + 12, qrSize, qrSize, 18);
  ctx.fill();
  ctx.stroke();
  const profileUrl = fields.profileUrl || employeeProfileUrl(fields.empId);
  const qr = await loadImage(employeeQrDataUrl(profileUrl));
  if (qr) ctx.drawImage(qr, qrX + 18, qrY + 30, qrSize - 36, qrSize - 36);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '600 20px Segoe UI, sans-serif';
  ctx.fillText('Scan to view employee profile', w / 2, qrY + qrSize + 52);
  ctx.fillStyle = '#7c8b99';
  ctx.font = '600 18px Segoe UI, sans-serif';
  ctx.fillText(FOOTER, w / 2, qrY + qrSize + 92, w - 64);
  ctx.restore();
  return canvas;
}

/** Paints the same vertical card used on screen, for download and print-quality PNG. */
export function downloadEmployeeIdCard(fields: EmployeeIdCardFields) {
  void paintVerticalIdCard(fields).then((canvas) => {
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fields.empId || 'employee'}-id-card.png`;
    a.click();
  });
}

export function EmployeeIdCard({ fields }: { fields: EmployeeIdCardFields }) {
  const letters = cardInitials(fields.name);
  const name = shown(fields.name);
  const profileUrl = fields.profileUrl || employeeProfileUrl(fields.empId);
  const qrSrc = employeeQrDataUrl(profileUrl);
  return (
    <article className="eidc-card eidc-card-v2" data-built="react" aria-label={`Employee ID card for ${name}`}>
      <header className="eidc-header">
        <span className="eidc-kicker">{COMPANY}</span>
        <span className="eidc-title">{CARD_TITLE}</span>
      </header>
      <div className="eidc-body">
        <div className="eidc-photo" aria-hidden>
          {fields.photoUrl ? <img src={fields.photoUrl} alt="" /> : letters}
        </div>
        {name === 'DEMO' ? null : <p className="eidc-name">{name}</p>}
        <dl className="eidc-rows">
          {cardRows(fields).map(([label, value]) => (
            <div className="eidc-row" key={label}>
              <dt>{label}</dt>
              <dd className={value === 'DEMO' ? 'eidc-demo' : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="eidc-divider" />
        <div className="eidc-qr-wrap">
          <img className="eidc-qr-img" src={qrSrc} alt="QR code linking to the employee HRMS profile" />
          <p className="eidc-qr-cap">Scan to view employee profile</p>
        </div>
        <p className="eidc-footer">{FOOTER}</p>
      </div>
    </article>
  );
}
