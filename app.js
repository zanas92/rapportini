'use strict';

// ---- Impostazioni ----
const STORAGE_KEY = 'rapportini.v1';
const STEP = 0.5;   // passo del selettore (0.5 = mezz'ora, 0.25 = quarto d'ora)
const MAX_HOURS = 16;

// Regole straordinari (modificabili dal menu):
// - dailyHours: ore ordinarie al giorno; oltre = straordinario feriale
// - saturdayWorking: false = settimana lun-ven, le ore del sabato sono straordinario
// - patron: santo patrono "gg/mm" (festivo come le feste nazionali), vuoto se non usato
const DEFAULT_SETTINGS = { dailyHours: 8, saturdayWorking: false, patron: '' };
const FIRST_OVERTIME_HOURS = 2;  // le prime 2 ore di straordinario hanno la maggiorazione più bassa

// Voci di straordinario come in busta paga (CCNL Metalmeccanici Industria, non turnisti).
const OT_CATS = [
  { id: 'str1',    label: 'Straordinario 25%',          short: 'Straord. 25%' },
  { id: 'str2',    label: 'Straordinario 30%',          short: 'Straord. 30%' },
  { id: 'fest',    label: 'Festivo 50%',                short: 'Festivo 50%' },
  { id: 'strFest', label: 'Straordinario festivo 55%',  short: 'Str. festivo 55%' },
];

// Assenze: "fullDay" = giornata intera (vale le ore ordinarie), altrimenti si scelgono le ore.
const ABSENCE_TYPES = {
  ferie:    { label: 'Ferie',    fullDay: true },
  permesso: { label: 'Permesso', fullDay: false },
  malattia: { label: 'Malattia', fullDay: true },
};

function normalizeSettings(s = {}) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = k in s ? s[k] : DEFAULT_SETTINGS[k];
  return out;
}

// ---- Dati ----
// Formato: { version: 1, hours: { "2026-11-21": 8.5 }, notes: { "2026-11-21": "testo" },
//            absences: { "2026-11-21": { type: "ferie" | "permesso" | "malattia", hours: 8 } },
//            settings: {...}, lastBackup }
let data = loadData();

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && typeof parsed.hours === 'object') {
      if (!parsed.notes || typeof parsed.notes !== 'object') parsed.notes = {};
      if (!parsed.absences || typeof parsed.absences !== 'object') parsed.absences = {};
      parsed.settings = normalizeSettings(parsed.settings);
      return parsed;
    }
  } catch (e) { /* dati assenti o corrotti */ }
  return { version: 1, hours: {}, notes: {}, absences: {}, settings: normalizeSettings() };
}

function saveData() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    alert('Impossibile salvare i dati sul dispositivo: ' + e.message);
  }
}

// Chiede al browser di non cancellare i dati in automatico.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// ---- Utilità ----
const pad = n => String(n).padStart(2, '0');
const dateKey = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function formatHours(h) {
  if (!h) return '—';
  const whole = Math.floor(h);
  const min = Math.round((h - whole) * 60);
  return min ? `${whole} h ${pad(min)}` : `${whole} h`;
}

const decimalIt = h => String(h).replace('.', ',');

const escapeHtml = s => s.replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const parseKey = k => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// ---- Festività e straordinari ----
function easterSunday(y) {
  // Algoritmo di Gauss/Meeus per il calendario gregoriano.
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(y, month - 1, day);
}

const holidayCache = {};
function holidaysOf(y) {
  if (holidayCache[y]) return holidayCache[y];
  const list = {
    '01-01': 'Capodanno',
    '01-06': 'Epifania',
    '04-25': 'Liberazione',
    '05-01': 'Festa del lavoro',
    '06-02': 'Festa della Repubblica',
    '08-15': 'Ferragosto',
    '11-01': 'Ognissanti',
    '12-08': 'Immacolata',
    '12-25': 'Natale',
    '12-26': 'Santo Stefano',
  };
  if (y >= 2026) list['10-04'] = 'San Francesco';  // festa nazionale dal 2026
  const em = easterSunday(y);
  em.setDate(em.getDate() + 1);
  list[`${pad(em.getMonth() + 1)}-${pad(em.getDate())}`] = 'Pasquetta';
  return (holidayCache[y] = list);
}

function holidayName(key) {
  const [y, mm, dd] = key.split('-');
  const name = holidaysOf(Number(y))[`${mm}-${dd}`];
  if (name) return name;
  const p = (data.settings.patron || '').match(/^(\d{1,2})\/(\d{1,2})$/);
  if (p && pad(p[1]) === dd && pad(p[2]) === mm) return 'Santo patrono';
  return '';
}

// Divide le ore di un giorno nelle categorie del CCNL (non turnisti, lavoro diurno):
// - feriale: ordinarie fino alla soglia, poi straordinario (prime 2 h / successive)
// - sabato non lavorativo: tutto straordinario feriale
// - festività infrasettimanale: festivo fino alla soglia, oltre straordinario festivo
// - domenica: tutto straordinario festivo (fuori dall'orario normale)
function classify(key, h) {
  const r = { ord: 0, str1: 0, str2: 0, fest: 0, strFest: 0, str: 0, festTot: 0 };
  if (!h) return r;
  const wd = parseKey(key).getDay();
  const thr = data.settings.dailyHours;
  if (wd === 0) {
    r.strFest = h;
  } else if (holidayName(key)) {
    r.fest = Math.min(h, thr);
    r.strFest = h - r.fest;
  } else {
    r.ord = (wd === 6 && !data.settings.saturdayWorking) ? 0 : Math.min(h, thr);
    const over = h - r.ord;
    r.str1 = Math.min(over, FIRST_OVERTIME_HOURS);
    r.str2 = over - r.str1;
  }
  r.str = r.str1 + r.str2;
  r.festTot = r.fest + r.strFest;
  return r;
}

function dayTags(key) {
  const hol = holidayName(key);
  const c = classify(key, data.hours[key]);
  const abs = data.absences[key];
  let html = hol ? `<span class="tag hol">${hol}</span>` : '';
  if (abs) {
    const t = ABSENCE_TYPES[abs.type];
    html += `<span class="tag abs">${t.label.toLowerCase()}` +
            `${t.fullDay ? '' : ' ' + formatHours(abs.hours)}</span>`;
  }
  // Una etichetta per ogni voce di straordinario del giorno, es. "+2 h 25%" "+1 h 30%".
  for (const cat of OT_CATS) {
    if (!c[cat.id]) continue;
    const cls = cat.id === 'fest' || cat.id === 'strFest' ? 'fest' : 'str';
    html += `<span class="tag ${cls}">+${formatHours(c[cat.id])} ${cat.label.match(/\d+%/)[0]}</span>`;
  }
  return html;
}

const weekdayShort = new Intl.DateTimeFormat('it-IT', { weekday: 'short' });
const weekdayLong = new Intl.DateTimeFormat('it-IT', { weekday: 'long' });
const monthYear = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

// Opzioni del selettore, generate una sola volta.
const OPTIONS_HTML = (() => {
  let html = '<option value="">—</option>';
  for (let v = STEP; v <= MAX_HOURS + 1e-9; v += STEP) {
    const val = Math.round(v * 100) / 100;
    html += `<option value="${val}">${formatHours(val)}</option>`;
  }
  return html;
})();

// ---- Stato vista ----
const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();

const $ = id => document.getElementById(id);
const daysEl = $('days');

function render() {
  const first = new Date(viewYear, viewMonth, 1);
  $('month-title').textContent = monthYear.format(first);

  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const frag = document.createDocumentFragment();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(viewYear, viewMonth, d);
    const key = dateKey(viewYear, viewMonth, d);
    const wd = date.getDay();
    const h = data.hours[key];
    const note = data.notes[key] || '';

    const li = document.createElement('li');
    li.className = 'day';
    if (wd === 0 || wd === 6 || holidayName(key)) li.classList.add('weekend');
    if (wd === 1) li.classList.add('monday');
    if (key === todayKey) li.classList.add('today');

    li.innerHTML = `
      <div class="date">
        <span class="line">
          <span class="num">${d}</span>
          <span class="wd">${weekdayShort.format(date).replace('.', '')}</span>
          <span class="tags">${dayTags(key)}</span>
        </span>
        ${note ? `<span class="note">${escapeHtml(note)}</span>` : ''}
      </div>
      <button type="button" class="desc-btn${note ? ' has' : ''}" data-key="${key}"
              aria-label="Descrizione del ${d} ${monthYear.format(date)}">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <select class="hours" data-key="${key}"
              aria-label="Ore del ${d} ${monthYear.format(date)}">${OPTIONS_HTML}</select>`;

    const sel = li.querySelector('select');
    // Valori salvati con un passo diverso (es. 8 h 15): li mostra comunque.
    if (h && !sel.querySelector(`option[value="${h}"]`)) {
      sel.add(new Option(formatHours(h), String(h)), 1);
    }
    sel.value = h ? String(h) : '';
    sel.classList.toggle('filled', !!h);
    frag.appendChild(li);
  }
  daysEl.replaceChildren(frag);
  updateSummary();

  // Nel mese corrente porta in vista il giorno di oggi.
  const todayEl = daysEl.querySelector('.today');
  if (todayEl) todayEl.scrollIntoView({ block: 'center' });
  else window.scrollTo(0, 0);
}

function monthEntries(y, m) {
  const prefix = `${y}-${pad(m + 1)}-`;
  return Object.entries(data.hours)
    .filter(([k, v]) => k.startsWith(prefix) && v > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

function updateSummary() {
  const entries = monthEntries(viewYear, viewMonth);
  const sum = { tot: 0, ord: 0, str1: 0, str2: 0, fest: 0, strFest: 0 };
  const abs = { ferie: 0, permesso: 0, malattia: 0 };
  const prefix = `${viewYear}-${pad(viewMonth + 1)}-`;
  for (const [k, a] of Object.entries(data.absences)) {
    if (!k.startsWith(prefix)) continue;
    abs[a.type] += ABSENCE_TYPES[a.type].fullDay ? 1 : a.hours;
  }
  const days = n => n === 1 ? '1 g' : `${n} g`;
  $('sum-ferie').textContent = days(abs.ferie);
  $('sum-perm').textContent = abs.permesso ? formatHours(abs.permesso) : '0 h';
  $('sum-mal').textContent = days(abs.malattia);
  $('tile-mal').hidden = !abs.malattia;
  for (const [k, v] of entries) {
    const c = classify(k, v);
    sum.tot += v;
    for (const f of Object.keys(sum)) if (f !== 'tot') sum[f] += c[f];
  }
  const fmt = h => h ? formatHours(h) : '0 h';
  $('total').textContent = fmt(sum.tot);
  $('days-worked').textContent = entries.length === 1 ? '1 giorno' : `${entries.length} giorni`;
  $('sum-ord').textContent = fmt(sum.ord);
  for (const cat of OT_CATS) $('sum-' + cat.id).textContent = fmt(sum[cat.id]);
}

// ---- Eventi ----
daysEl.addEventListener('change', e => {
  const sel = e.target;
  if (!sel.matches('select.hours')) return;
  const key = sel.dataset.key;
  if (sel.value === '') delete data.hours[key];
  else data.hours[key] = parseFloat(sel.value);
  sel.classList.toggle('filled', sel.value !== '');
  sel.closest('.day').querySelector('.tags').innerHTML = dayTags(key);
  saveData();
  updateSummary();
});

// ---- Note ----
const noteDialog = $('note-dialog');
const noteText = $('note-text');
let noteKey = null;

daysEl.addEventListener('click', e => {
  const btn = e.target.closest('button.desc-btn');
  if (!btn) return;
  noteKey = btn.dataset.key;
  const t = weekdayLong.format(parseKey(noteKey)) + ' ' +
    parseKey(noteKey).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  $('note-title').textContent = t;
  noteText.value = data.notes[noteKey] || '';
  const a = data.absences[noteKey];
  $('abs-type').value = a ? a.type : '';
  $('abs-hours').value = a && !ABSENCE_TYPES[a.type].fullDay ? String(a.hours) : '1';
  updateAbsHours();
  noteDialog.showModal();
});

function updateAbsHours() {
  const type = $('abs-type').value;
  $('abs-hours-row').hidden = !type || ABSENCE_TYPES[type].fullDay;
}
$('abs-type').addEventListener('change', updateAbsHours);

function saveDay() {
  const text = noteText.value.trim();
  if (text) data.notes[noteKey] = text;
  else delete data.notes[noteKey];
  const type = $('abs-type').value;
  if (type) {
    data.absences[noteKey] = {
      type,
      hours: ABSENCE_TYPES[type].fullDay ? data.settings.dailyHours
                                         : parseFloat($('abs-hours').value),
    };
  } else {
    delete data.absences[noteKey];
  }
  saveData();
  noteDialog.close();
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

$('note-save').addEventListener('click', saveDay);

// ---- Impostazioni orario ----
const dailySel = $('set-daily');
for (let v = 4; v <= 10; v += 0.5) dailySel.add(new Option(formatHours(v), String(v)));

function fillSettings() {
  dailySel.value = String(data.settings.dailyHours);
  $('set-saturday').checked = !!data.settings.saturdayWorking;
  $('set-patron').value = data.settings.patron || '';
}

function saveSettings() {
  const patron = $('set-patron').value.trim();
  if (patron && !/^\d{1,2}\/\d{1,2}$/.test(patron)) {
    alert('Scrivi il santo patrono nel formato gg/mm, es. 24/06.');
    return;
  }
  data.settings = {
    dailyHours: parseFloat(dailySel.value),
    saturdayWorking: $('set-saturday').checked,
    patron,
  };
  saveData();
  render();
}
['set-daily', 'set-saturday', 'set-patron'].forEach(id =>
  $(id).addEventListener('change', saveSettings));

$('prev').addEventListener('click', () => {
  if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
  render();
});
$('next').addEventListener('click', () => {
  if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
  render();
});
$('month-title').addEventListener('click', () => {
  const t = new Date();
  viewYear = t.getFullYear();
  viewMonth = t.getMonth();
  render();
});

// ---- Esportazione ----
const menu = $('menu');

function updateLastBackup() {
  $('last-backup').textContent = data.lastBackup
    ? 'Ultimo backup: ' + new Date(data.lastBackup).toLocaleDateString('it-IT')
    : 'Nessun backup ancora salvato.';
}

$('menu-btn').addEventListener('click', () => {
  updateLastBackup();
  fillSettings();
  menu.showModal();
});

const IS_ANDROID = /Android/i.test(navigator.userAgent);
// iPhone e iPad (anche iPadOS che si presenta come Mac, ma con schermo touch).
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3500);
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// iPhone: pannello di condivisione ("Salva su File", iCloud Drive, Mail...).
// Android e PC: scarica direttamente nella cartella Download.
async function deliverFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  if (IS_IOS && navigator.canShare) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
      }
    }
  }
  downloadFile(blob, filename);
  toast(IS_ANDROID || !IS_IOS ? `Salvato in Download: ${filename}` : `File pronto: ${filename}`);
  return true;
}

// Giorni con ore o descrizione, in ordine; prefix opzionale per filtrare un mese.
function exportKeys(prefix = '') {
  const keys = new Set([
    ...Object.keys(data.hours).filter(k => data.hours[k] > 0),
    ...Object.keys(data.notes),
    ...Object.keys(data.absences),
  ]);
  return [...keys].filter(k => k.startsWith(prefix)).sort();
}

const csvCell = s => /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

function buildCsv(keys) {
  // Separatore ";" e virgola decimale: si apre correttamente in Excel italiano.
  const head = ['Data', 'Giorno', 'Festività', 'Ore', 'Ordinarie',
    ...OT_CATS.map(cat => cat.label), 'Assenza', 'Ore assenza', 'Descrizione'];
  const rows = [head.join(';')];
  const tot = { h: 0, ord: 0, str1: 0, str2: 0, fest: 0, strFest: 0 };
  const num = v => v ? decimalIt(v) : '';
  for (const k of keys) {
    const date = parseKey(k);
    const h = data.hours[k] || 0;
    const c = classify(k, h);
    const a = data.absences[k];
    rows.push([
      `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
      weekdayLong.format(date), holidayName(k), num(h), num(c.ord),
      ...OT_CATS.map(cat => num(c[cat.id])),
      a ? ABSENCE_TYPES[a.type].label : '', a ? decimalIt(a.hours) : '',
      csvCell(data.notes[k] || ''),
    ].join(';'));
    tot.h += h; tot.ord += c.ord;
    for (const cat of OT_CATS) tot[cat.id] += c[cat.id];
  }
  rows.push(['Totale', '', '', decimalIt(tot.h), decimalIt(tot.ord),
    ...OT_CATS.map(cat => decimalIt(tot[cat.id])), '', '', ''].join(';'));
  return '\uFEFF' + rows.join('\r\n') + '\r\n';
}

// ---- PDF del mese ----
// La libreria jsPDF si carica solo quando serve (ed è in cache per l'uso offline).
let pdfLibPromise = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('impossibile caricare ' + src));
    document.head.appendChild(el);
  });
}
function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = loadScript('vendor/jspdf.umd.min.js')
      .then(() => loadScript('vendor/jspdf.plugin.autotable.min.js'))
      .catch(e => { pdfLibPromise = null; throw e; });
  }
  return pdfLibPromise;
}

const capitalize = t => t.charAt(0).toUpperCase() + t.slice(1);

function buildPdf(y, m) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const title = capitalize(monthYear.format(new Date(y, m, 1)));
  const hh = v => v ? formatHours(v) : '';

  doc.setFontSize(16);
  doc.text(`Rapportino ore - ${title}`, 10, 15);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Generato il ${new Date().toLocaleDateString('it-IT')}`, 10, 21);
  doc.setTextColor(0);

  const body = [], shaded = [];
  const tot = { h: 0, ord: 0, str1: 0, str2: 0, fest: 0, strFest: 0 };
  const abs = { ferie: 0, permesso: 0, malattia: 0 };
  const days = new Date(y, m + 1, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const key = dateKey(y, m, d);
    const date = new Date(y, m, d);
    const wd = date.getDay();
    const h = data.hours[key] || 0;
    const c = classify(key, h);
    const a = data.absences[key];
    const hol = holidayName(key);
    let absText = '';
    if (a) {
      const t = ABSENCE_TYPES[a.type];
      absText = t.label + (t.fullDay ? '' : ' ' + formatHours(a.hours));
      abs[a.type] += t.fullDay ? 1 : a.hours;
    }
    body.push([
      `${pad(d)}/${pad(m + 1)}`,
      weekdayShort.format(date).replace('.', '') + (hol ? `\n${hol}` : ''),
      hh(h), hh(c.ord), ...OT_CATS.map(cat => hh(c[cat.id])),
      absText, data.notes[key] || '',
    ]);
    shaded.push(wd === 0 || wd === 6 || !!hol);
    tot.h += h; tot.ord += c.ord;
    for (const cat of OT_CATS) tot[cat.id] += c[cat.id];
  }

  doc.autoTable({
    startY: 25,
    margin: { left: 10, right: 10 },
    theme: 'grid',
    head: [['Data', 'Giorno', 'Ore', 'Ordin.', 'Str. 25%', 'Str. 30%', 'Fest. 50%',
            'Str. fest. 55%', 'Assenza', 'Descrizione']],
    body,
    foot: [['Totale', '', hh(tot.h) || '0 h', hh(tot.ord), ...OT_CATS.map(cat => hh(tot[cat.id])), '', '']],
    styles: { fontSize: 7.5, cellPadding: 1.1, valign: 'middle', lineColor: [210, 214, 220] },
    headStyles: { fillColor: [31, 95, 191], textColor: 255, fontSize: 7.5 },
    footStyles: { fillColor: [227, 236, 250], textColor: 20, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 11 }, 1: { cellWidth: 19 },
      2: { cellWidth: 13, halign: 'right' }, 3: { cellWidth: 13, halign: 'right' },
      4: { cellWidth: 13, halign: 'right' }, 5: { cellWidth: 13, halign: 'right' },
      6: { cellWidth: 13, halign: 'right' }, 7: { cellWidth: 15, halign: 'right' },
      8: { cellWidth: 19 }, 9: { cellWidth: 'auto' },
    },
    didParseCell: cell => {
      if (cell.section === 'body' && shaded[cell.row.index]) cell.cell.styles.fillColor = [240, 241, 244];
      if (cell.section === 'foot' && cell.column.index >= 2 && cell.column.index <= 7) {
        cell.cell.styles.halign = 'right';
      }
    },
  });

  // Riepilogo e firma
  let yy = doc.lastAutoTable.finalY + 8;
  if (yy > 255) { doc.addPage(); yy = 20; }
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text('Riepilogo', 10, yy);
  doc.setFont(undefined, 'normal');
  const giorni = n => n === 1 ? '1 giorno' : `${n} giorni`;
  const lines = [
    ['Ore lavorate', hh(tot.h) || '0 h'],
    ['Ordinarie', hh(tot.ord) || '0 h'],
    ...OT_CATS.map(cat => [cat.label, hh(tot[cat.id]) || '0 h']),
    ['Ferie', giorni(abs.ferie)],
    ['Permessi', hh(abs.permesso) || '0 h'],
    ['Malattia', giorni(abs.malattia)],
  ];
  lines.forEach(([k, v], i) => {
    doc.text(k, 10, yy + 6 + i * 5);
    doc.text(v, 75, yy + 6 + i * 5, { align: 'right' });
  });
  const sy = yy + 6 + lines.length * 5 + 10;
  doc.text('Firma', 120, sy - 12);
  doc.line(120, sy, 200, sy);
  return doc.output('arraybuffer');
}

$('export-pdf').addEventListener('click', async () => {
  const btn = $('export-pdf');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparo il PDF…';
  try {
    await loadPdfLib();
    const pdf = buildPdf(viewYear, viewMonth);
    await deliverFile(`rapportino-${viewYear}-${pad(viewMonth + 1)}.pdf`, pdf, 'application/pdf');
  } catch (e) {
    alert('Impossibile creare il PDF: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

$('export-month').addEventListener('click', () => {
  const keys = exportKeys(`${viewYear}-${pad(viewMonth + 1)}-`);
  if (!keys.length) return alert('Nessun dato inserito in questo mese.');
  deliverFile(`ore-${viewYear}-${pad(viewMonth + 1)}.csv`, buildCsv(keys), 'text/csv');
});

$('export-all').addEventListener('click', () => {
  const keys = exportKeys();
  if (!keys.length) return alert('Nessun dato inserito.');
  deliverFile('ore-tutte.csv', buildCsv(keys), 'text/csv');
});

$('backup').addEventListener('click', async () => {
  const t = new Date();
  const name = `rapportini-backup-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}.json`;
  const payload = JSON.stringify(
    { version: 1, exported: t.toISOString(), hours: data.hours, notes: data.notes,
      absences: data.absences, settings: data.settings }, null, 1);
  if (await deliverFile(name, payload, 'application/json')) {
    data.lastBackup = t.toISOString();
    saveData();
    updateLastBackup();
  }
});

$('restore').addEventListener('click', () => $('restore-file').click());

$('restore-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const isKey = k => /^\d{4}-\d{2}-\d{2}$/.test(k);
    const inHours = {}, inNotes = {}, inAbs = {};
    for (const [k, v] of Object.entries(parsed.hours || {})) {
      if (isKey(k) && typeof v === 'number' && v > 0 && v <= 24) inHours[k] = v;
    }
    for (const [k, v] of Object.entries(parsed.notes || {})) {
      if (isKey(k) && typeof v === 'string' && v.trim()) inNotes[k] = v.trim();
    }
    for (const [k, v] of Object.entries(parsed.absences || {})) {
      if (isKey(k) && v && ABSENCE_TYPES[v.type] && typeof v.hours === 'number') inAbs[k] = v;
    }
    const n = new Set([...Object.keys(inHours), ...Object.keys(inNotes),
                       ...Object.keys(inAbs)]).size;
    if (!n) return alert('Il file non contiene dati validi.');
    if (!confirm(`Il backup contiene ${n} giorni. Unirli ai dati attuali? ` +
                 `(I giorni presenti in entrambi verranno sovrascritti dal backup.)`)) return;
    Object.assign(data.hours, inHours);
    Object.assign(data.notes, inNotes);
    Object.assign(data.absences, inAbs);
    if (parsed.settings) data.settings = normalizeSettings(parsed.settings);
    saveData();
    menu.close();
    render();
    alert('Backup ripristinato.');
  } catch (err) {
    alert('File non valido: ' + err.message);
  }
});

// ---- PIN ----
// Il PIN non è salvato in chiaro: si conserva solo l'impronta SHA-256 (con salt).
const PIN_KEY = 'rapportini.pin';
const PIN_LEN = 4;
const LOCK_AFTER_MS = 60 * 1000;  // richiede il PIN se l'app resta in background oltre 1 minuto
const MAX_ATTEMPTS = 5;
const BLOCK_MS = 30 * 1000;

let pinMode = null;      // 'unlock' | 'set' | 'confirm'
let pinBuffer = '';
let pinFirst = '';
let failCount = 0;
let blockedUntil = 0;

function getPin() {
  try { return JSON.parse(localStorage.getItem(PIN_KEY)); } catch (e) { return null; }
}

async function hashPin(pin, salt) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + pin));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function lockMessage(text, isError = false) {
  const el = $('lock-msg');
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function updateDots() {
  $('pin-dots').querySelectorAll('span')
    .forEach((s, i) => s.classList.toggle('on', i < pinBuffer.length));
}

function showLock(mode, message) {
  pinMode = mode;
  pinBuffer = '';
  if (mode === 'set') pinFirst = '';
  if (menu.open) menu.close();
  if (noteDialog.open) noteDialog.close();
  const defaults = {
    unlock: 'Inserisci il PIN',
    set: `Scegli un PIN di ${PIN_LEN} cifre`,
    confirm: 'Ripeti il PIN',
  };
  lockMessage(message || defaults[mode], !!message && mode !== 'confirm');
  $('lock-cancel').hidden = mode === 'unlock';
  $('lock-forgot').hidden = mode !== 'unlock';
  updateDots();
  document.documentElement.classList.add('locked');
}

function hideLock() {
  pinMode = null;
  pinBuffer = '';
  document.documentElement.classList.remove('locked');
}

function pinError(text) {
  pinBuffer = '';
  updateDots();
  lockMessage(text, true);
  const dots = $('pin-dots');
  dots.classList.remove('shake');
  void dots.offsetWidth;  // riavvia l'animazione
  dots.classList.add('shake');
}

async function checkPin() {
  const entered = pinBuffer;
  if (pinMode === 'unlock') {
    const stored = getPin();
    if (!stored || await hashPin(entered, stored.salt) === stored.hash) {
      failCount = 0;
      hideLock();
      return;
    }
    if (++failCount >= MAX_ATTEMPTS) {
      failCount = 0;
      blockedUntil = Date.now() + BLOCK_MS;
      pinError(`Troppi tentativi. Riprova tra ${BLOCK_MS / 1000} secondi.`);
    } else {
      pinError('PIN errato');
    }
  } else if (pinMode === 'set') {
    pinFirst = entered;
    showLock('confirm');
  } else if (pinMode === 'confirm') {
    if (entered !== pinFirst) {
      showLock('set', 'I PIN non coincidono, riprova.');
      return;
    }
    const salt = [...crypto.getRandomValues(new Uint8Array(16))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: await hashPin(entered, salt) }));
    hideLock();
    alert('PIN impostato. Verrà chiesto a ogni apertura dell\'app.');
  }
}

function pressDigit(d) {
  if (!pinMode || pinBuffer.length >= PIN_LEN) return;
  if (Date.now() < blockedUntil) return;
  pinBuffer += d;
  updateDots();
  if (pinBuffer.length === PIN_LEN) setTimeout(checkPin, 120);
}

function pressDelete() {
  pinBuffer = pinBuffer.slice(0, -1);
  updateDots();
}

$('keypad').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.digit) pressDigit(btn.dataset.digit);
  else if (btn.id === 'pin-del') pressDelete();
});

document.addEventListener('keydown', e => {
  if (!pinMode) return;
  if (/^[0-9]$/.test(e.key)) pressDigit(e.key);
  else if (e.key === 'Backspace') pressDelete();
});

$('lock-cancel').addEventListener('click', hideLock);

$('lock-forgot').addEventListener('click', () => {
  if (!confirm('Senza PIN l\'unico modo per entrare è CANCELLARE TUTTI I DATI salvati su ' +
               'questo dispositivo. Potrai poi ripristinarli da un backup. Continuare?')) return;
  if (!confirm('Sei sicuro? Tutte le ore e le descrizioni verranno eliminate.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PIN_KEY);
  data = { version: 1, hours: {}, notes: {}, absences: {}, settings: normalizeSettings() };
  hideLock();
  render();
});

function updatePinButtons() {
  const has = !!getPin();
  $('pin-set').textContent = has ? 'Cambia PIN' : 'Imposta PIN';
  $('pin-remove').hidden = !has;
}

$('menu-btn').addEventListener('click', updatePinButtons);
$('pin-set').addEventListener('click', () => showLock('set'));
$('pin-remove').addEventListener('click', () => {
  if (!confirm('Rimuovere il PIN? L\'app si aprirà senza protezione.')) return;
  localStorage.removeItem(PIN_KEY);
  updatePinButtons();
});

// Richiede di nuovo il PIN quando si torna all'app dopo un po'.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
  } else if (getPin() && !pinMode && Date.now() - hiddenAt > LOCK_AFTER_MS) {
    showLock('unlock');
  }
});

// ---- Avvio ----
render();
if (getPin()) showLock('unlock');

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
