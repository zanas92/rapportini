'use strict';

// ---- Impostazioni ----
const STORAGE_KEY = 'rapportini.v1';
const STEP = 0.25;  // passo del selettore (0.25 = quarto d'ora, 0.5 = mezz'ora)
const MAX_HOURS = 16;

// ---- Dati ----
// Formato: { version: 1, hours: { "2026-11-21": 8.5 }, notes: { "2026-11-21": "testo" }, lastBackup }
let data = loadData();

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && typeof parsed.hours === 'object') {
      if (!parsed.notes || typeof parsed.notes !== 'object') parsed.notes = {};
      return parsed;
    }
  } catch (e) { /* dati assenti o corrotti */ }
  return { version: 1, hours: {}, notes: {} };
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
    if (wd === 0 || wd === 6) li.classList.add('weekend');
    if (wd === 1) li.classList.add('monday');
    if (key === todayKey) li.classList.add('today');

    li.innerHTML = `
      <button type="button" class="date" data-key="${key}"
              aria-label="Nota del ${d} ${monthYear.format(date)}">
        <span class="line">
          <span class="num">${d}</span>
          <span class="wd">${weekdayShort.format(date).replace('.', '')}</span>
          <span class="note-icon" aria-hidden="true">✎</span>
        </span>
        ${note ? `<span class="note">${escapeHtml(note)}</span>` : ''}
      </button>
      <select class="hours" data-key="${key}"
              aria-label="Ore del ${d} ${monthYear.format(date)}">${OPTIONS_HTML}</select>`;

    const sel = li.querySelector('select');
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
  const total = entries.reduce((s, [, v]) => s + v, 0);
  $('total').textContent = total ? formatHours(total) : '0 h';
  $('days-worked').textContent = entries.length;
}

// ---- Eventi ----
daysEl.addEventListener('change', e => {
  const sel = e.target;
  if (!sel.matches('select.hours')) return;
  const key = sel.dataset.key;
  if (sel.value === '') delete data.hours[key];
  else data.hours[key] = parseFloat(sel.value);
  sel.classList.toggle('filled', sel.value !== '');
  saveData();
  updateSummary();
});

// ---- Note ----
const noteDialog = $('note-dialog');
const noteText = $('note-text');
let noteKey = null;

daysEl.addEventListener('click', e => {
  const btn = e.target.closest('button.date');
  if (!btn) return;
  noteKey = btn.dataset.key;
  const t = weekdayLong.format(parseKey(noteKey)) + ' ' +
    parseKey(noteKey).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  $('note-title').textContent = t;
  noteText.value = data.notes[noteKey] || '';
  noteDialog.showModal();
  noteText.focus();
});

function setNote(text) {
  text = text.trim();
  if (text) data.notes[noteKey] = text;
  else delete data.notes[noteKey];
  saveData();
  noteDialog.close();
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

$('note-save').addEventListener('click', () => setNote(noteText.value));
$('note-delete').addEventListener('click', () => setNote(''));

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
  menu.showModal();
});

async function deliverFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  // Su telefono usa il pannello di condivisione (Salva su File, Mail, WhatsApp...).
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare) {
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

// Giorni con ore o nota, in ordine; prefix opzionale per filtrare un mese.
function exportKeys(prefix = '') {
  const keys = new Set([
    ...Object.keys(data.hours).filter(k => data.hours[k] > 0),
    ...Object.keys(data.notes),
  ]);
  return [...keys].filter(k => k.startsWith(prefix)).sort();
}

const csvCell = s => /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;

function buildCsv(keys) {
  // Separatore ";" e virgola decimale: si apre correttamente in Excel italiano.
  const rows = ['Data;Giorno;Ore;Note'];
  let total = 0;
  for (const k of keys) {
    const date = parseKey(k);
    const h = data.hours[k] || 0;
    const note = csvCell(data.notes[k] || '');
    rows.push(`${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()};` +
              `${weekdayLong.format(date)};${h ? decimalIt(h) : ''};${note}`);
    total += h;
  }
  rows.push(`Totale;;${decimalIt(total)};`);
  return '﻿' + rows.join('\r\n') + '\r\n';
}

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
    { version: 1, exported: t.toISOString(), hours: data.hours, notes: data.notes }, null, 1);
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
    const inHours = {}, inNotes = {};
    for (const [k, v] of Object.entries(parsed.hours || {})) {
      if (isKey(k) && typeof v === 'number' && v > 0 && v <= 24) inHours[k] = v;
    }
    for (const [k, v] of Object.entries(parsed.notes || {})) {
      if (isKey(k) && typeof v === 'string' && v.trim()) inNotes[k] = v.trim();
    }
    const n = new Set([...Object.keys(inHours), ...Object.keys(inNotes)]).size;
    if (!n) return alert('Il file non contiene dati validi.');
    if (!confirm(`Il backup contiene ${n} giorni. Unirli ai dati attuali? ` +
                 `(I giorni presenti in entrambi verranno sovrascritti dal backup.)`)) return;
    Object.assign(data.hours, inHours);
    Object.assign(data.notes, inNotes);
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
  if (!confirm('Sei sicuro? Tutte le ore e le note verranno eliminate.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(PIN_KEY);
  data = { version: 1, hours: {}, notes: {} };
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
