/* ===== Config ===== */
const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycby069h1-N5Gxo64l8LXrPyH0VbOTcuDK3ij8QSzyY9Ex-ZsnkO_ZCAqAW2pTVncY2np/exec';   // Apps Script web app (entry-api.gs)
const TABS = ['3.2(A)', '3.2(B)', '3.2(C)', '3.2(D)', '4.1(A)', '4.1(B)', '4.1(C)', '4.1(D)'];
const STD1 = 7000, STD2 = 3000;   // standard installment amounts (warns if you change them)

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const taka = n => '৳' + Math.round(n).toLocaleString('en-US');

/* ===== Helpers ===== */
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const toStamp = v => v.replace('T', ' ') + ':00';                 // "2026-11-04T14:35" -> "2026-11-04 14:35:00"
const fromStamp = s => (s || '').slice(0, 16).replace(' ', ' ');
const store = {
  get: k => { try { return sessionStorage.getItem(k) || ''; } catch (e) { return ''; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { } }
};

async function api(body) {
  const res = await fetch(WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // simple request: no CORS preflight
    body: JSON.stringify(body)
  });
  return res.json();
}

/* ===== Init ===== */
$('#tab').innerHTML = TABS.map(t => `<option value="${t}">${t.replace('(', ' · ').replace(')', '')}</option>`).join('');
$('#tab').value = store.get('tab') || TABS[0];
$('#pin').value = store.get('pin');
$('#t1').value = nowLocal();
$('#t2').value = nowLocal();
if (!WEB_APP_URL) $('#setup').classList.add('show');

/* ===== Installment blocks ===== */
let locked = { 1: false, 2: false };      // true when the server says it's already recorded

function syncBlock(n) {
  const on = $('#c' + n).checked && !locked[n];
  $('#b' + n).classList.toggle('off', !on);
  $('#b' + n).classList.toggle('locked', locked[n]);
  const std = n === 1 ? STD1 : STD2, v = Number($('#a' + n).value);
  $('#w' + n).textContent = locked[n] ? 'Already recorded for this student — can’t be entered again.'
    : (on && v && v !== std ? `Standard amount is ${taka(std)}.` : '');
}
[1, 2].forEach(n => {
  $('#c' + n).addEventListener('change', () => { if ($('#c' + n).checked) $('#t' + n).value = nowLocal(); syncBlock(n); });
  $('#a' + n).addEventListener('input', () => syncBlock(n));
});

/* ===== Live duplicate check when the ID is typed ===== */
let lookupTimer = 0, lookupSeq = 0;

function setLock(n, isLocked) {
  locked[n] = isLocked;
  if (isLocked) $('#c' + n).checked = false;
  $('#c' + n).disabled = isLocked;
  syncBlock(n);
}

function showStatus(html) { $('#idstat').innerHTML = html; }

async function lookup() {
  const id = $('#sid').value.trim(), pin = $('#pin').value;
  setLock(1, false); setLock(2, false);
  if (id.length < 3 || !WEB_APP_URL) { showStatus(''); return; }
  if (!pin) { showStatus('<span style="color:rgba(255,255,255,.55)">Enter the PIN to check this ID.</span>'); return; }
  const seq = ++lookupSeq;
  showStatus('<span style="color:rgba(255,255,255,.55)">Checking…</span>');
  try {
    const r = await api({ action: 'lookup', pin, id });
    if (seq !== lookupSeq) return;                         // a newer lookup is running
    if (!r.ok) { showStatus(`<span class="chip o">${esc(r.error)}</span>`); return; }
    if (!r.found) { showStatus('<span class="chip c">New ID</span> not registered yet.'); return; }
    const e = r.entry;
    setLock(1, e.hasFirst); setLock(2, e.hasSecond);
    if (e.hasSecond && !$('#c2').checked) $('#c2').checked = false;
    if (!e.hasFirst && !$('#c1').checked) { $('#c1').checked = true; syncBlock(1); }
    const same = e.tab === $('#tab').value;
    showStatus(`<span class="chip ${same ? 's' : 'o'}">Already registered</span> ${esc(e.name)} · ${esc(e.tab)} · 1st ${e.hasFirst ? '✓' : '—'} · 2nd ${e.hasSecond ? '✓' : '—'}` +
      (same ? '' : `<br><span style="color:var(--coral)">This ID belongs to ${esc(e.tab)} — switch the section tab.</span>`));
    if (same && !$('#name').value.trim()) $('#name').value = e.name;
  } catch (err) {
    if (seq === lookupSeq) showStatus('<span class="chip o">Couldn’t reach the entry service.</span>');
  }
}
$('#sid').addEventListener('input', () => { clearTimeout(lookupTimer); lookupTimer = setTimeout(lookup, 450); });
$('#pin').addEventListener('change', () => { store.set('pin', $('#pin').value); lookup(); });
$('#tab').addEventListener('change', () => { store.set('tab', $('#tab').value); lookup(); });

/* ===== Submit ===== */
const logItems = [];
function showRes(kind, html) { const r = $('#res'); r.className = 'res show ' + kind; r.innerHTML = html; }

function renderLog() {
  $('#log').innerHTML = logItems.length ? logItems.map(i =>
    `<li><b>${esc(i.name)}</b><small>${esc(i.id)} · ${esc(i.tab)} · Slr ${esc(i.slr)} · ${i.added.join(' + ')} installment · ${i.time}</small></li>`).join('')
    : '<li class="empty">Nothing yet.</li>';
}

async function submit(force) {
  const name = $('#name').value.trim(), id = $('#sid').value.trim(), pin = $('#pin').value, tab = $('#tab').value;
  if (!WEB_APP_URL) return showRes('bad', 'Not connected yet — paste the web app URL into <code>WEB_APP_URL</code> in entry.js.');
  if (!name || !id) return showRes('bad', 'Name and ID are both required.');
  if (!pin) return showRes('bad', 'Enter the organizer PIN.');

  const use1 = $('#c1').checked && !locked[1], use2 = $('#c2').checked && !locked[2];
  if (!use1 && !use2) return showRes('bad', 'Tick at least one installment to record.');
  const part = n => {
    const amount = Number($('#a' + n).value), at = $('#t' + n).value;
    if (!(amount > 0)) throw new Error(`${n === 1 ? '1st' : '2nd'} installment: enter an amount.`);
    if (!at) throw new Error(`${n === 1 ? '1st' : '2nd'} installment: pick the paid date and time.`);
    return { amount, at: toStamp(at) };
  };
  let first = null, second = null;
  try { if (use1) first = part(1); if (use2) second = part(2); } catch (e) { return showRes('bad', esc(e.message)); }

  const btn = $('#go'); btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await api({ action: 'save', pin, tab, name, id, first, second, force: !!force });
    if (r.ok) {
      showRes('ok', `✔ Saved <b>${esc(r.name)}</b> in <b>${esc(r.tab)}</b> (Slr ${esc(r.slr)}) — ${r.added.join(' + ')} installment${r.added.length > 1 ? 's' : ''}.`);
      logItems.unshift({ name: r.name, id: r.id, tab: r.tab, slr: r.slr, added: r.added, time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) });
      renderLog();
      $('#name').value = ''; $('#sid').value = ''; showStatus('');
      setLock(1, false); setLock(2, false);
      $('#c1').checked = true; $('#c2').checked = false; syncBlock(1); syncBlock(2);
      $('#t1').value = nowLocal(); $('#t2').value = nowLocal();
      $('#name').focus();
    } else if (r.needConfirm && !force) {
      if (confirm(r.error + '\n\nSave anyway as a new student?')) { btn.disabled = false; btn.textContent = 'Save entry'; return submit(true); }
      showRes('bad', esc(r.error) + ' — not saved.');
    } else {
      showRes('bad', esc(r.error || 'Could not save.'));
    }
  } catch (err) {
    showRes('bad', 'Couldn’t reach the entry service. Check the web app URL and your internet, then try again.');
  } finally { btn.disabled = false; btn.textContent = 'Save entry'; }
}

$('#f').addEventListener('submit', e => { e.preventDefault(); submit(false); });
syncBlock(1); syncBlock(2);