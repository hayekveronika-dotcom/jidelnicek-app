// PDF jídelníčku ve formátu A4 bez externích knihoven:
// tabulka se vykreslí do canvasu (diakritika řeší prohlížeč) a JPEG se zabalí do minimálního PDF.

const A4 = { w: 595.28, h: 841.89 };            // body PDF
const PX = { w: 1240, h: 1754 };                 // 150 dpi
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const C = { text: '#1c1c1a', muted: '#6d6d68', line: '#d9d9d4', green: '#2e7d4f', greenSoft: '#e6f2ea', off: '#f3f3f0' };

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// rows: [{ label: 'Pondělí', date: '5. 10.', cells: { snidane: [..názvy], ... }, slots: ['snidane',...] }]
export function drawPlanCanvas({ title, subtitle, footer, meals, rows }) {
  const cv = document.createElement('canvas');
  cv.width = PX.w; cv.height = PX.h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PX.w, PX.h);
  const m = 80;
  ctx.textBaseline = 'top';

  ctx.fillStyle = C.text; ctx.font = `700 46px ${FONT}`;
  ctx.fillText(title, m, m);
  ctx.fillStyle = C.muted; ctx.font = `400 26px ${FONT}`;
  ctx.fillText(subtitle, m, m + 62);

  const top = m + 120, headH = 52, footH = 70;
  const dayW = 170;
  const colW = (PX.w - 2 * m - dayW) / meals.length;
  const rowH = (PX.h - top - headH - footH - m / 2) / rows.length;

  // hlavička
  ctx.fillStyle = C.greenSoft; ctx.fillRect(m, top, PX.w - 2 * m, headH);
  ctx.fillStyle = C.green; ctx.font = `700 22px ${FONT}`;
  meals.forEach((ml, i) => ctx.fillText(ml.label.toUpperCase(), m + dayW + i * colW + 14, top + 15));

  rows.forEach((r, ri) => {
    const y = top + headH + ri * rowH;
    // den
    ctx.fillStyle = C.text; ctx.font = `700 24px ${FONT}`;
    ctx.fillText(r.label, m + 12, y + 14);
    ctx.fillStyle = C.muted; ctx.font = `400 21px ${FONT}`;
    ctx.fillText(r.date, m + 12, y + 46);
    meals.forEach((ml, ci) => {
      const x = m + dayW + ci * colW;
      if (!r.slots.includes(ml.key)) { ctx.fillStyle = C.off; ctx.fillRect(x, y, colW, rowH); return; }
      const items = r.cells[ml.key] || [];
      if (!items.length) return;
      // zmenšuj písmo, dokud se obsah nevejde
      for (let size = 21; size >= 13; size--) {
        ctx.font = `400 ${size}px ${FONT}`;
        const lh = size * 1.28;
        const blocks = items.map(t => wrap(ctx, t, colW - 34));
        const total = blocks.reduce((n, b) => n + b.length, 0) * lh + (items.length - 1) * size * 0.35;
        if (total <= rowH - 22 || size === 13) {
          let ty = y + 13;
          ctx.fillStyle = C.text;
          for (const b of blocks) {
            b.forEach((ln, li) => {
              if (ty + lh > y + rowH - 6) return;
              if (li === 0) { ctx.fillStyle = C.green; ctx.fillText('•', x + 12, ty); ctx.fillStyle = C.text; }
              ctx.fillText(ln, x + 26, ty);
              ty += lh;
            });
            ty += size * 0.35;
          }
          break;
        }
      }
    });
  });

  // mřížka
  ctx.strokeStyle = C.line; ctx.lineWidth = 2;
  const tableBottom = top + headH + rows.length * rowH;
  ctx.strokeRect(m, top, PX.w - 2 * m, tableBottom - top);
  for (let i = 0; i <= rows.length; i++) {
    const y = top + headH + i * rowH;
    ctx.beginPath(); ctx.moveTo(m, y); ctx.lineTo(PX.w - m, y); ctx.stroke();
  }
  for (let i = 0; i < meals.length; i++) {
    const x = m + dayW + i * colW;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, tableBottom); ctx.stroke();
  }

  ctx.fillStyle = C.muted; ctx.font = `400 19px ${FONT}`;
  ctx.fillText(footer, m, PX.h - m / 2 - footH / 2);
  return cv;
}

const enc = s => new TextEncoder().encode(s);
function concat(parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// Minimální PDF s jednou stránkou A4 a JPEG obrázkem přes celou plochu
export function jpegToPdf(jpeg, imgW, imgH, title = 'Jídelníček') {
  const parts = [];
  const offsets = [];
  let pos = 0;
  const push = b => { parts.push(b); pos += b.length; };
  const obj = (n, body) => { offsets[n] = pos; push(enc(`${n} 0 obj\n`)); body.forEach(push); push(enc('\nendobj\n')); };
  // název v metadatech jako UTF-16BE hex (kvůli diakritice)
  const hexTitle = 'FEFF' + [...title].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
  const content = `q ${A4.w} 0 0 ${A4.h} 0 0 cm /Im0 Do Q`;

  push(enc('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'));
  obj(1, [enc('<< /Type /Catalog /Pages 2 0 R >>')]);
  obj(2, [enc('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')]);
  obj(3, [enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`)]);
  obj(4, [enc(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)]);
  obj(5, [enc(`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, enc('\nendstream')]);
  obj(6, [enc(`<< /Title <${hexTitle}> /Producer (Jidelnicek App) >>`)]);
  const xref = pos;
  let x = `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(enc(x));
  push(enc(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Blob([concat(parts)], { type: 'application/pdf' });
}

export async function canvasToPdf(canvas, title) {
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  return jpegToPdf(jpeg, canvas.width, canvas.height, title);
}
