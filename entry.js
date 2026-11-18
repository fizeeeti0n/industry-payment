
/* =========================================================
   CONFIGURATION
========================================================= */

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyU9mk3eb-Wz557BoRG4Vj7FOj5WP6ccCLvZQmcRBOz79wx9bkES_9czrsisfE41rQk/exec';

const TABS = [
  '3.2(A)', '3.2(B)', '3.2(C)', '3.2(D)',
  '4.1(A)', '4.1(B)', '4.1(C)', '4.1(D)'
];

const STD1 = 7000;
const STD2 = 3000;

const GUEST_STD1 = 7000;
const GUEST_STD2 = 3000;

const RELATIONS = ['Mother', 'Father', 'Brother','Wife','Sister'];

/* =========================================================
   HELPERS
========================================================= */

const $ = selector => document.querySelector(selector);

const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

const taka = amount =>
  '৳' + Math.round(amount).toLocaleString('en-US');

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const toStamp = value => value.replace('T', ' ') + ':00';

const store = {
  get(key) {
    try {
      return sessionStorage.getItem(key) || '';
    } catch {
      return '';
    }
  },

  set(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {}
  }
};

/* =========================================================
   API
========================================================= */

async function api(body) {
  if (!WEB_APP_URL) {
    throw new Error('Google Apps Script URL is missing.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(WEB_APP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result || typeof result !== 'object') {
      throw new Error('Invalid server response.');
    }

    return result;

  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

/* =========================================================
   STATE
========================================================= */

let mode = 'student';

let locked = {
  1: false,
  2: false
};

let studentInfo = null;

let lookupTimer = null;
let lookupSeq = 0;
let submitting = false;

const logItems = [];

const isGuest = () => mode === 'guest';

const stdOf = n =>
  isGuest()
    ? (n === 1 ? GUEST_STD1 : GUEST_STD2)
    : (n === 1 ? STD1 : STD2);

/* =========================================================
   STATUS
========================================================= */

function showStatus(html) {
  const el = $('#idstat');
  if (el) el.innerHTML = html;
}

function showRes(kind, html) {
  const el = $('#res');

  if (!el) return;

  el.className = 'res show ' + kind;
  el.innerHTML = html;
}

const muted = text =>
  `<span style="color:rgba(255,255,255,.55)">${text}</span>`;

/* =========================================================
   INSTALLMENT BLOCKS
========================================================= */

function syncBlock(n) {
  const checkbox = $('#c' + n);
  const block = $('#b' + n);
  const amount = $('#a' + n);
  const warning = $('#w' + n);

  if (!checkbox || !block || !amount) return;

  const on = checkbox.checked && !locked[n];

  block.classList.toggle('off', !on);
  block.classList.toggle('locked', locked[n]);

  if (warning) {
    const standard = stdOf(n);
    const value = Number(amount.value);

    warning.textContent = locked[n]
      ? 'Already recorded — cannot be entered again.'
      : (on && value && value !== standard
          ? `Standard amount is ${taka(standard)}.`
          : '');
  }

  // Keep inactive fields out of keyboard navigation.
  amount.disabled = !on;

  const custom = $('#cd' + n);
  const time = $('#t' + n);
  const note = $('#n' + n);

  if (custom) custom.disabled = !on;

  const useCustom = Boolean(custom && custom.checked && on);

  if (time) {
    time.hidden = !useCustom;
    time.disabled = !useCustom;
    time.max = nowLocal();
  }

  if (note) note.hidden = useCustom;
}

function resetCustomDates() {
  [1, 2].forEach(n => {
    const custom = $('#cd' + n);
    if (custom) custom.checked = false;
    const time = $('#t' + n);
    if (time) time.value = nowLocal();
  });
}

function setLock(n, value) {
  locked[n] = Boolean(value);

  const checkbox = $('#c' + n);

  if (!checkbox) return;

  if (locked[n]) checkbox.checked = false;

  checkbox.disabled = locked[n];

  syncBlock(n);
}

/* =========================================================
   LOOKUP
========================================================= */

async function lookup() {
  const id = $('#sid')?.value.trim() || '';
  const pin = $('#pin')?.value || '';

  setLock(1, false);
  setLock(2, false);

  if (id.length < 3) {
    showStatus('');
    return;
  }

  if (!pin) {
    showStatus(muted('Enter the PIN to check this ID.'));
    return;
  }

  const seq = ++lookupSeq;

  showStatus(muted('Checking student ID...'));

  try {
    const r = await api({
      action: 'lookup',
      pin,
      id
    });

    if (seq !== lookupSeq || isGuest()) return;

    if (!r.ok) {
      showStatus(`<span class="chip o">${esc(r.error)}</span>`);
      return;
    }

    if (!r.found) {
      showStatus('<span class="chip c">New ID</span> Not registered yet.');
      return;
    }

    const entry = r.entry;

    if (!entry) {
      throw new Error('Student entry is missing.');
    }

    setLock(1, entry.hasFirst);
    setLock(2, entry.hasSecond);

    const same = entry.tab === $('#tab')?.value;

    showStatus(
      `<span class="chip ${same ? 's' : 'o'}">Already registered</span>
      ${esc(entry.name)} · ${esc(entry.tab)}
      · 1st ${entry.hasFirst ? '✓' : '—'}
      · 2nd ${entry.hasSecond ? '✓' : '—'}` +
      (same
        ? ''
        : `<br><span style="color:var(--coral)">
            This ID belongs to ${esc(entry.tab)}.
            Switch the section tab.
          </span>`)
    );

    if (!$('#name').value.trim()) {
      $('#name').value = entry.name;
    }

    if (!entry.hasFirst && same) {
      $('#c1').checked = true;
      syncBlock(1);
    }

  } catch (error) {
    if (seq === lookupSeq) {
      showStatus(
        `<span class="chip o">${esc(error.message || 'Could not reach entry service.')}</span>`
      );
    }
  }
}

/* =========================================================
   GUEST LOOKUP
========================================================= */

function setStudentFields(entry) {
  const name = $('#gsname');
  const section = $('#gssec');

  if (name) name.value = entry?.name || '';
  if (section) section.value = entry?.tab || '';
}

async function guestCheck() {
  const id = $('#gsid')?.value.trim() || '';
  const relation = $('#grel')?.value || '';
  const pin = $('#pin')?.value || '';

  studentInfo = null;
  setStudentFields(null);

  setLock(1, false);
  setLock(2, false);

  if (id.length < 3) {
    showStatus('');
    return;
  }

  if (!pin) {
    showStatus(muted('Enter the PIN to verify this student ID.'));
    return;
  }

  const seq = ++lookupSeq;

  showStatus(muted('Verifying student...'));

  try {
    const s = await api({
      action: 'lookup',
      pin,
      id
    });

    if (seq !== lookupSeq || !isGuest()) return;

    if (!s.ok) {
      showStatus(`<span class="chip o">${esc(s.error)}</span>`);
      return;
    }

    if (!s.found || !s.entry) {
      showStatus('<span class="chip o">Student not found.</span> Register the student first.');
      return;
    }

    studentInfo = s.entry;

    setStudentFields(studentInfo);

    let html =
      `<span class="chip s">Student verified</span>
      ${esc(studentInfo.name)} · ${esc(studentInfo.tab)}`;

    if (relation) {
      const g = await api({
        action: 'lookupGuest',
        pin,
        id,
        relation
      });

      if (seq !== lookupSeq || !isGuest()) return;

      if (!g.ok) {
        showStatus(`<span class="chip o">${esc(g.error)}</span>`);
        return;
      }

      if (g.found && g.entry) {
        const entry = g.entry;

        setLock(1, entry.hasFirst);
        setLock(2, entry.hasSecond);

        if (!entry.hasFirst) {
          $('#c1').checked = true;
          syncBlock(1);
        }

        html +=
          `<br><span class="chip o">Already registered</span>
          ${esc(entry.guestName)} (${esc(relation)})
          · 1st ${entry.hasFirst ? '✓' : '—'}
          · 2nd ${entry.hasSecond ? '✓' : '—'}`;

        if (!$('#gname').value.trim()) {
          $('#gname').value = entry.guestName;
        }

      } else {
        html += `<br><span class="chip c">New guest</span> ${esc(relation)} not registered yet.`;
      }
    }

    showStatus(html);

  } catch (error) {
    if (seq === lookupSeq) {
      showStatus(
        `<span class="chip o">${esc(error.message)}</span>`
      );
    }
  }
}

/* =========================================================
   REFRESH / DEBOUNCE
========================================================= */

function refresh() {
  return isGuest() ? guestCheck() : lookup();
}

function debounced() {
  clearTimeout(lookupTimer);

  lookupTimer = setTimeout(refresh, 450);
}

/* =========================================================
   MODE SWITCH
========================================================= */

function setMode(newMode) {
  mode = newMode;

  lookupSeq++;

  clearTimeout(lookupTimer);

  $('#studentFields').hidden = isGuest();
  $('#guestFields').hidden = !isGuest();

  $('#formTitle').textContent =
    isGuest() ? 'Guest entry' : 'Student entry';

  $('#formSub').textContent = isGuest()
    ? 'Saved into the guest tab. One guest per relation per student.'
    : 'Saved directly into the selected section tab.';

  const result = $('#res');

  if (result) result.className = 'res';

  studentInfo = null;
  setStudentFields(null);

  showStatus('');

  setLock(1, false);
  setLock(2, false);

  $('#a1').value = stdOf(1);
  $('#a2').value = stdOf(2);

  $('#c1').checked = true;
  $('#c2').checked = false;

  $('#t1').value = nowLocal();
  $('#t2').value = nowLocal();
  resetCustomDates();

  syncBlock(1);
  syncBlock(2);

  refresh();
}

/* =========================================================
   VALIDATION
========================================================= */

function readParts() {
  const use1 = $('#c1').checked && !locked[1];
  const use2 = $('#c2').checked && !locked[2];

  if (!use1 && !use2) {
    throw new Error('Tick at least one installment to record.');
  }

  const part = n => {
    const amount = Number($('#a' + n).value);
    const custom = $('#cd' + n).checked;
    const at = custom ? $('#t' + n).value : nowLocal();

    if (custom && at > nowLocal()) {
      throw new Error(`${n === 1 ? '1st' : '2nd'} installment: the custom date can't be in the future.`);
    }

    if (!(amount > 0)) {
      throw new Error(`${n === 1 ? '1st' : '2nd'} installment: enter a valid amount.`);
    }

    if (!at) {
      throw new Error(`${n === 1 ? '1st' : '2nd'} installment: select the payment date and time.`);
    }

    return {
      amount,
      at: toStamp(at)
    };
  };

  return {
    first: use1 ? part(1) : null,
    second: use2 ? part(2) : null
  };
}

/* =========================================================
   SESSION LOG
========================================================= */

function renderLog() {
  const el = $('#log');

  if (!el) return;

  el.innerHTML = logItems.length
    ? logItems.map(item =>
        `<li>
          <b>${esc(item.name)}</b>
          <small>
            ${esc(item.id)} · ${esc(item.tab)}
            · Slr ${esc(item.slr)}
            · ${item.added.map(esc).join(' + ')} installment
            · ${esc(item.time)}
          </small>
        </li>`
      ).join('')
    : '<li class="empty">Nothing yet.</li>';
}

/* =========================================================
   SUBMIT BUTTON
========================================================= */

function setButton(loading) {
  const btn = $('#go');

  if (!btn) return;

  btn.disabled = loading;
  btn.textContent = loading ? 'Saving...' : 'Save entry';
}

/* =========================================================
   STUDENT SUBMISSION
========================================================= */

async function submit(force = false) {
  if (isGuest()) {
    return submitGuest();
  }

  if (submitting) return;

  const name = $('#name').value.trim();
  const id = $('#sid').value.trim();
  const pin = $('#pin').value;
  const tab = $('#tab').value;

  if (!name || !id) {
    return showRes('bad', 'Name and Student ID are required.');
  }

  if (!pin) {
    return showRes('bad', 'Enter the organizer PIN.');
  }

  let first, second;

  try {
    ({ first, second } = readParts());
  } catch (error) {
    return showRes('bad', esc(error.message));
  }

  submitting = true;
  setButton(true);

  try {
    const r = await api({
      action: 'save',
      pin,
      tab,
      name,
      id,
      first,
      second,
      force: Boolean(force)
    });

    if (r.ok) {
      showRes(
        'ok',
        `✔ Saved <b>${esc(r.name)}</b> in <b>${esc(r.tab)}</b>
        (Slr ${esc(r.slr)}) — ${r.added.map(esc).join(' + ')} installment(s).`
      );

      logItems.unshift({
        name: r.name,
        id: r.id,
        tab: r.tab,
        slr: r.slr,
        added: r.added,
        time: new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });

      renderLog();

      $('#name').value = '';
      $('#sid').value = '';

      showStatus('');

      setLock(1, false);
      setLock(2, false);

      $('#c1').checked = true;
      $('#c2').checked = false;

      $('#t1').value = nowLocal();
      $('#t2').value = nowLocal();
      resetCustomDates();

      syncBlock(1);
      syncBlock(2);

      $('#name').focus();

    } else if (r.needConfirm && !force) {
      const accepted = confirm(
        r.error + '\n\nSave anyway as a new student?'
      );

      if (accepted) {
        submitting = false;
        setButton(false);
        return submit(true);
      }

      showRes('bad', esc(r.error) + ' — not saved.');

    } else {
      showRes('bad', esc(r.error || 'Could not save.'));
    }

  } catch (error) {
    showRes('bad', esc(error.message || 'Could not reach the entry service.'));
  } finally {
    submitting = false;
    setButton(false);
  }
}

/* =========================================================
   GUEST SUBMISSION
========================================================= */

async function submitGuest() {
  if (submitting) return;

  const guestName = $('#gname').value.trim();
  const relation = $('#grel').value;
  const id = $('#gsid').value.trim();
  const pin = $('#pin').value;

  if (!guestName) {
    return showRes('bad', 'Enter the guest name.');
  }

  if (!RELATIONS.includes(relation)) {
    return showRes('bad', 'Select Mother, Father, Brother, Wife or Sister.');
  }

  if (!id) {
    return showRes('bad', 'Enter the student ID.');
  }

  if (!pin) {
    return showRes('bad', 'Enter the organizer PIN.');
  }

  if (!studentInfo || studentInfo.id && studentInfo.id !== id) {
    return showRes('bad', 'Verify the student ID first.');
  }

  let first, second;

  try {
    ({ first, second } = readParts());
  } catch (error) {
    return showRes('bad', esc(error.message));
  }

  submitting = true;
  setButton(true);

  try {
    const r = await api({
      action: 'saveGuest',
      pin,
      guestName,
      relation,
      id,
      studentName: studentInfo.name,
      section: studentInfo.tab,
      first,
      second
    });

    if (r.ok) {
      showRes(
        'ok',
        `✔ Saved guest <b>${esc(r.guestName)}</b>
        (${esc(r.relation)} of ${esc(r.studentName)})
        — Slr ${esc(r.slr)}.`
      );

      logItems.unshift({
        name: r.guestName + ' (guest)',
        id: r.id,
        tab: 'guest',
        slr: r.slr,
        added: r.added,
        time: new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit'
        })
      });

      renderLog();

      $('#gname').value = '';
      $('#gsid').value = '';
      $('#grel').value = '';

      studentInfo = null;
      setStudentFields(null);

      setLock(1, false);
      setLock(2, false);

      $('#c1').checked = true;
      $('#c2').checked = false;

      $('#t1').value = nowLocal();
      $('#t2').value = nowLocal();
      resetCustomDates();

      syncBlock(1);
      syncBlock(2);

      showStatus('');

      $('#gname').focus();

    } else {
      showRes('bad', esc(r.error || 'Could not save.'));
    }

  } catch (error) {
    showRes('bad', esc(error.message || 'Could not reach entry service.'));
  } finally {
    submitting = false;
    setButton(false);
  }
}

/* =========================================================
   INITIALIZATION
========================================================= */

function init() {
  const required = [
    '#tab', '#grel', '#pin',
    '#t1', '#t2', '#c1', '#c2',
    '#a1', '#a2', '#b1', '#b2',
    '#sid', '#gsid', '#name',
    '#gname', '#f', '#go',
    '#studentFields', '#guestFields',
    '#formTitle', '#formSub',
    '#idstat', '#res'
  ];

  const missing = required.filter(selector => !$(selector));

  if (missing.length) {
    console.error('Missing HTML elements:', missing);
    return;
  }

  $('#tab').innerHTML = TABS.map(tab =>
    `<option value="${esc(tab)}">${esc(tab.replace('(', ' · ').replace(')', ''))}</option>`
  ).join('');

  $('#tab').value = TABS.includes(store.get('tab'))
    ? store.get('tab')
    : TABS[0];

  $('#grel').innerHTML =
    '<option value="">Select relation</option>' +
    RELATIONS.map(r =>
      `<option value="${esc(r)}">${esc(r)}</option>`
    ).join('');

  $('#pin').value = store.get('pin');

  $('#t1').value = nowLocal();
  $('#t2').value = nowLocal();
  resetCustomDates();

  $('#a1').value = STD1;
  $('#a2').value = STD2;

  $('#c1').checked = true;
  $('#c2').checked = false;

  // Installment listeners
  [1, 2].forEach(n => {
    $('#c' + n).addEventListener('change', () => {
      if ($('#c' + n).checked) {
        $('#t' + n).value = nowLocal();
      }
      syncBlock(n);
    });

    $('#a' + n).addEventListener('input', () => syncBlock(n));

    $('#cd' + n).addEventListener('change', () => {
      if ($('#cd' + n).checked) {
        $('#t' + n).value = nowLocal();
      }
      syncBlock(n);
      if ($('#cd' + n).checked) $('#t' + n).focus();
    });
  });

  // Lookup listeners
  $('#sid').addEventListener('input', () => {
    if (!isGuest()) debounced();
  });

  $('#gsid').addEventListener('input', () => {
    if (isGuest()) debounced();
  });

  $('#grel').addEventListener('change', () => {
    if (isGuest()) refresh();
  });

  $('#pin').addEventListener('input', () => {
    store.set('pin', $('#pin').value);
  });

  $('#pin').addEventListener('change', refresh);

  $('#tab').addEventListener('change', () => {
    store.set('tab', $('#tab').value);
    if (!isGuest()) lookup();
  });

  // Mode switching
  document.querySelectorAll('input[name="mode"]').forEach(r => {
    r.addEventListener('change', () => {
      if (r.checked) setMode(r.value);
    });
  });

  // Form submission
  $('#f').addEventListener('submit', event => {
    event.preventDefault();
    submit(false);
  });

  // Initial state
  syncBlock(1);
  syncBlock(2);

  setMode('student');

  console.log('Entry system initialized successfully.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
