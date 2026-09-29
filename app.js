(() => {
'use strict';

const SUPABASE_URL =
  'https://jixhrtgsxlvfrqlxkpwi.supabase.co';

const SUPABASE_ANON_KEY =
  'sb_publishable_cBVpntso_6Bdo1oy_7JOLg_X_ALJWpn';

const MSSRP_API_BASE = window.MSSRP_API_BASE || '/api';

const supabase =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

async function sendSwish(receiverAccountId, amount) {
  try {
    const numAmount = Number(amount);
    const normalize = value => String(value ?? '').trim().toLowerCase();
    if (!receiverAccountId || numAmount <= 0 || !Number.isFinite(numAmount)) {
      alert('Ange mottagarens konto-ID och ett belopp över 0 kr.');
      return false;
    }
    // Find the user's bank-account table, supporting both schemas used by MSSRP.
    let table = null;
    let rows = [];
    let lastError = null;
    for (const candidate of ['bank_accounts', 'mssrp_bank_accounts']) {
      const result = await supabase.from(candidate).select('*').limit(500);
      if (!result.error) {
        table = candidate;
        rows = Array.isArray(result.data) ? result.data : [];
        break;
      }
      lastError = result.error;
    }
    if (!table) throw lastError || new Error('Bankkontotabellen kunde inte hittas.');

    const accountNumber = row => {
      const stored = row.account_number ?? row.account_no ?? row.accountNumber ?? row.kontonummer;
      if (stored) return String(stored);
      const owner = row.user_id ?? row.owner_id ?? row.profile_id ?? row.account_user_id ?? row.userid;
      return owner ? `MSSRP-${String(owner).replace(/-/g, '').slice(0, 10)}` : '';
    };
    const findByNumber = value => rows.find(row => normalize(accountNumber(row)) === normalize(value));
    const currentUserId = currentUser?.id;
    const sender = rows.find(row => [row.user_id, row.owner_id, row.profile_id, row.account_user_id, row.userid].some(value => value != null && String(value) === String(currentUserId)))
      || findByNumber(document.querySelector('#bank-account-number')?.textContent?.trim() || (currentUserId ? formatBankAccountNumber(null, currentUserId) : ''));
    const receiver = findByNumber(receiverAccountId);
    if (!sender) {
      alert('Ditt bankkonto kunde inte hittas för ditt inloggade konto.');
      return false;
    }
    if (!receiver) {
      alert('Mottagarens konto-ID hittades inte. Kontrollera att det är korrekt.');
      return false;
    }

    if (sender === receiver) {
      alert('Du kan inte skicka pengar till ditt eget konto.');
      return false;
    }

    const balanceKey = row => ['balance', 'current_balance', 'available_balance', 'saldo', 'amount'].find(key => Object.prototype.hasOwnProperty.call(row, key)) || 'balance';
    const senderKey = balanceKey(sender);
    const receiverKey = balanceKey(receiver);
    const senderBalance = Number(sender[senderKey] || 0);
    const receiverBalance = Number(receiver[receiverKey] || 0);
    if (senderBalance < numAmount) {
      alert('Saldot räcker inte till.');
      return false;
    }

    const senderId = sender.id ?? sender.account_id;
    const receiverId = receiver.id ?? receiver.account_id;
    if (senderId == null || receiverId == null) {
      alert('Kontona saknar konto-ID i databasen och överföringen kan inte genomföras.');
      return false;
    }

    const { error: deductError } = await supabase.from(table).update({ [senderKey]: senderBalance - numAmount }).eq(sender.id != null ? 'id' : 'account_id', senderId);
    if (deductError) throw deductError;
    const { error: addError } = await supabase.from(table).update({ [receiverKey]: receiverBalance + numAmount }).eq(receiver.id != null ? 'id' : 'account_id', receiverId);
    if (addError) {
      // Roll back the debit if the credit fails.
      await supabase.from(table).update({ [senderKey]: senderBalance }).eq(sender.id != null ? 'id' : 'account_id', senderId);
      throw addError;
    }

    for (const txTable of ['bank_transactions', 'mssrp_bank_transactions', 'transactions']) {
      const tx = await supabase.from(txTable).insert({
        sender_id: senderId,
        receiver_id: receiverId,
        sender_account_id: senderId,
        receiver_account_id: receiverId,
        amount: numAmount,
        type: 'transfer',
        description: `Överföring till ${receiverAccountId}`,
        created_at: new Date().toISOString()
      });
      if (!tx.error) break;
    }

    alert(`${numAmount.toLocaleString('sv-SE')} kr skickat till ${receiverAccountId}!`);
    return true;
  } catch (err) {
    console.error('Fel vid kontoöverföring:', err?.message || err);
    alert('Överföringen misslyckades: ' + (err?.message || 'okänt fel'));
    return false;
  }
}

async function getSalary(jobName, grade) {
  try {
    const { data, error } = await supabase
      .from('payroll')
      .select('salary')
      .eq('job_name', jobName)
      .eq('grade', Number(grade))
      .maybeSingle();

    if (error) {
      console.error('Fel vid hämtning av lön:', error.message);
      return 500; // Standardlön om fel uppstår
    }

    return data ? data.salary : 500;
  } catch (err) {
    console.error('Oväntat fel vid getSalary:', err);
    return 500;
  }
}

async function setSalary(jobName, grade, newSalary) {
  try {
    const salaryVal = Number(newSalary);
    const gradeVal = Number(grade);

    if (!jobName || isNaN(gradeVal) || isNaN(salaryVal)) {
      alert('Ogiltiga uppgifter för lön.');
      return false;
    }

    const { data, error } = await supabase
      .from('payroll')
      .upsert(
        { 
          job_name: jobName, 
          grade: gradeVal, 
          salary: salaryVal 
        },
        { onConflict: 'job_name, grade' }
      );

    if (error) {
      console.error('Fel vid sparande av lön:', error.message);
      alert('Kunde inte spara lönen: ' + error.message);
      return false;
    }

    console.log(`Lön för ${jobName} (Grad ${gradeVal}) sattes till ${salaryVal} kr.`);
    alert(`Lönen för ${jobName} (Grad ${gradeVal}) har uppdaterats till ${salaryVal} kr!`);
    return true;

  } catch (err) {
    console.error('Oväntat fel vid setSalary:', err);
    return false;
  }
}


// ==========================================
// SWISH- OCH LÖNEFORMULÄR
// ==========================================
function bindSwishPayrollForms() {
  const swishForm = document.getElementById('swish-form');
  if (swishForm && swishForm.dataset.bound !== '1') {
    swishForm.dataset.bound = '1';
    swishForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const senderPhone = document.getElementById('sender-phone')?.value;
      const receiverPhone = document.getElementById('receiver-phone')?.value;
      const amount = document.getElementById('swish-amount')?.value;
      await sendSwish(senderPhone, receiverPhone, amount);
    });
  }

  const payrollForm = document.getElementById('payroll-form');
  if (payrollForm && payrollForm.dataset.bound !== '1') {
    payrollForm.dataset.bound = '1';
    payrollForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const jobName = document.getElementById('job-name')?.value;
      const grade = document.getElementById('job-grade')?.value;
      const salary = document.getElementById('job-salary')?.value;
      await setSalary(jobName, grade, salary);
    });
  }
}



/* ============================================================
   GLOBAL STATE
   ============================================================ */

let currentUser = null;
let accessRoles = [];
let accessPermissions = new Set();
let isLoginMode = true;
let db = null;

const state = {

  currentOp: null,

  currentFloorId: null,

  opsList: [],

  stage: null,

  layers: {
    map: null,
    objects: null,
    selection: null
  },

  mapImage: null,

  mapLocked: false,

  currentTool: 'select',

  selectedSymbol: 'police',

  selectedNodes: [],

  selectedObject: null,

  zoom: 1,

  history: [],

  historyIndex: -1,

  isDrawing: false,

  drawingNode: null,

  tempShape: null,

  tempPoints: [],

  dragStart: null,

  editingObjectId: null,

  confirmAction: null,

  saveTimer: null,

  suppressSave: false

};


/* ============================================================
   ROBUST MSSRP ID GENERATOR
   ============================================================ */

function mssrpId() {
  try {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
  } catch (_) {}

  return 'mssrp-' + Date.now().toString(36) + '-' +
    Math.random().toString(36).slice(2, 10);
}


/* ============================================================
   SYMBOL DEFINITIONS
   ============================================================ */

const SYMBOLS = {

  police: {
    label: 'Polis',
    short: 'P',
    color: '#2563eb'
  },

  patrol: {
    label: 'Patrull',
    short: 'P',
    color: '#3b82f6'
  },

  commander: {
    label: 'Befäl',
    short: '★',
    color: '#7c3aed'
  },

  'op-chief': {
    label: 'Insatschef',
    short: '★★',
    color: '#9333ea'
  },

  operator: {
    label: 'Operatör',
    short: '●',
    color: '#0ea5e9'
  },

  ni: {
    label: 'NI-operatör',
    short: 'NI',
    color: '#111827'
  },

  k9: {
    label: 'K9',
    short: 'K9',
    color: '#92400e'
  },

  medic: {
    label: 'Sjukvård',
    short: '+',
    color: '#dc2626'
  },

  negotiator: {
    label: 'Förhandlare',
    short: 'F',
    color: '#0891b2'
  },

  scout: {
    label: 'Spanare',
    short: 'S',
    color: '#059669'
  },

  sniper: {
    label: 'Skytt',
    short: 'Y',
    color: '#374151'
  },

  suspect: {
    label: 'Misstänkt',
    short: '!',
    color: '#f59e0b'
  },

  armed: {
    label: 'Beväpnad',
    short: '!',
    color: '#dc2626'
  },

  hostage: {
    label: 'Gisslan',
    short: 'G',
    color: '#db2777'
  },

  civilian: {
    label: 'Civil',
    short: 'C',
    color: '#64748b'
  },

  vip: {
    label: 'VIP',
    short: 'V',
    color: '#ca8a04'
  },

  evidence: {
    label: 'Bevis',
    short: 'B',
    color: '#a16207'
  },

  'main-target': {
    label: 'Huvudmål',
    short: 'H',
    color: '#dc2626'
  },

  search: {
    label: 'Sökområde',
    short: '?',
    color: '#16a34a'
  },

  entry: {
    label: 'Ingång',
    short: '→',
    color: '#22c55e'
  },

  exit: {
    label: 'Utgång',
    short: '←',
    color: '#ef4444'
  },

  rally: {
    label: 'Samling',
    short: 'S',
    color: '#2563eb'
  },

  command: {
    label: 'Ledning',
    short: 'L',
    color: '#7c3aed'
  },

  vehicle: {
    label: 'Fordon',
    short: 'F',
    color: '#475569'
  },

  'med-point': {
    label: 'Sjukvårdspunkt',
    short: '+',
    color: '#dc2626'
  },

  barrier: {
    label: 'Avspärrning',
    short: '—',
    color: '#f97316'
  },

  checkpoint: {
    label: 'Kontroll',
    short: 'K',
    color: '#ea580c'
  },

  evac: {
    label: 'Evakuering',
    short: 'E',
    color: '#0891b2'
  },

  collection: {
    label: 'Uppsamling',
    short: 'U',
    color: '#0f766e'
  },

  staging: {
    label: 'Staging',
    short: '☰',
    color: '#6366f1'
  },

  holding: {
    label: 'Holding',
    short: 'Ⅱ',
    color: '#64748b'
  },

  stack: {
    label: 'Stack-up',
    short: '≡',
    color: '#8b5cf6'
  },

  'emergency-exit': {
    label: 'Nödutgång',
    short: '⇥',
    color: '#16a34a'
  }

};



/* ============================================================
   MULTI-FLOOR MAPS
   ============================================================ */

function createDefaultFloor(data = {}, index = 0) {

  return {

    id:
      data.id ||
      mssrpId(),

    name:
      data.name ||
      `Våning ${index + 1}`,

    map:
      data.map ||
      null,

    mapLocked:
      Boolean(data.mapLocked),

    objects:
      Array.isArray(data.objects)
        ? data.objects
        : []

  };

}


function normalizeOperationFloors(operation) {

  if (!operation) return null;

  if (
    !Array.isArray(operation.floors) ||
    !operation.floors.length
  ) {

    operation.floors = [
      createDefaultFloor(
        {
          id:
            operation.activeFloorId ||
            undefined,

          name:
            'Våning 1',

          map:
            operation.map ||
            null,

          mapLocked:
            operation.mapLocked,

          objects:
            Array.isArray(operation.objects)
              ? operation.objects
              : []

        },
        0
      )
    ];

  } else {

    operation.floors =
      operation.floors.map(
        (floor, index) =>
          createDefaultFloor(
            floor || {},
            index
          )
      );

  }

  const active =
    operation.floors.find(
      floor =>
        floor.id ===
        operation.activeFloorId
    ) ||
    operation.floors[0];

  operation.activeFloorId =
    active.id;

  return operation;

}


function getCurrentFloor() {

  if (!state.currentOp) return null;

  normalizeOperationFloors(
    state.currentOp
  );

  return (
    state.currentOp.floors.find(
      floor =>
        floor.id ===
        state.currentFloorId
    ) ||
    state.currentOp.floors.find(
      floor =>
        floor.id ===
        state.currentOp.activeFloorId
    ) ||
    state.currentOp.floors[0]
  );

}


function syncCurrentFloorToOperation() {

  if (!state.currentOp) return;

  const floor =
    getCurrentFloor();

  if (!floor) return;

  floor.map =
    state.currentOp.map ||
    null;

  floor.mapLocked =
    Boolean(
      state.currentOp.mapLocked
    );

  floor.objects =
    Array.isArray(
      state.currentOp.objects
    )
      ? state.currentOp.objects
      : [];

  floor.id =
    floor.id ||
    state.currentFloorId ||
    mssrpId();

  state.currentFloorId =
    floor.id;

  state.currentOp.activeFloorId =
    floor.id;

}


function activateFloor(
  floorId,
  options = {}
) {

  if (!state.currentOp) return;

  normalizeOperationFloors(
    state.currentOp
  );

  syncCurrentFloorToOperation();

  const floor =
    state.currentOp.floors.find(
      item =>
        item.id === floorId
    ) ||
    state.currentOp.floors[0];

  if (!floor) return;

  state.currentFloorId =
    floor.id;

  state.currentOp.activeFloorId =
    floor.id;

  state.currentOp.map =
    floor.map ||
    null;

  state.currentOp.mapLocked =
    Boolean(
      floor.mapLocked
    );

  state.currentOp.objects =
    floor.objects;

  state.mapLocked =
    Boolean(
      floor.mapLocked
    );

  if (state.stage) {

    clearSelection();

    if (floor.map) {

      loadMapFromData(
        floor.map
      );

    } else {

      clearMap();

      renderOperationObjects();

    }

  }

  renderFloorControls();

  updateMapUI();

  if (!options.silent) {

    pushHistory();
    scheduleSave();

  }

}


function ensureFloorControls() {

  const container =
    $('#konva-container');

  if (!container) return null;

  let controls =
    $('#floor-controls');

  if (controls) return controls;

  controls =
    document.createElement('div');

  controls.id =
    'floor-controls';

  controls.style.cssText = `
    display:flex;
    align-items:center;
    gap:8px;
    flex-wrap:wrap;
    margin:0 0 8px 0;
    padding:8px 10px;
    border:1px solid rgba(148,163,184,.25);
    border-radius:8px;
    background:rgba(15,23,42,.65);
  `;

  const parent =
    container.parentElement;

  if (parent) {

    parent.insertBefore(
      controls,
      container
    );

  }

  return controls;

}


function renderFloorControls() {

  const controls =
    ensureFloorControls();

  if (!controls || !state.currentOp) return;

  normalizeOperationFloors(
    state.currentOp
  );

  controls.innerHTML = '';

  const label =
    document.createElement('span');

  label.textContent =
    'Våningar:';

  label.style.fontWeight =
    '700';

  controls.appendChild(label);

  state.currentOp.floors.forEach(
    floor => {

      const button =
        document.createElement('button');

      button.type =
        'button';

      button.textContent =
        floor.name;

      button.dataset.floorId =
        floor.id;

      button.style.cssText = `
        border:1px solid rgba(148,163,184,.4);
        border-radius:6px;
        padding:5px 10px;
        cursor:pointer;
        font:inherit;
        background:${
          floor.id === state.currentFloorId
            ? 'rgba(59,130,246,.35)'
            : 'rgba(15,23,42,.5)'
        };
        color:inherit;
      `;

      button.onclick =
        () => switchFloor(
          floor.id
        );

      button.ondblclick =
        () => renameFloor(
          floor.id
        );

      controls.appendChild(
        button
      );

    }
  );

  const add =
    document.createElement('button');

  add.type =
    'button';

  add.textContent =
    '+ Lägg till våning';

  add.style.cssText = `
    border:1px solid rgba(34,197,94,.5);
    border-radius:6px;
    padding:5px 10px;
    cursor:pointer;
    font:inherit;
  `;

  add.onclick =
    addFloor;

  controls.appendChild(add);

  if (state.currentOp.floors.length > 1) {

    const rename =
      document.createElement('button');

    rename.type =
      'button';

    rename.textContent =
      'Byt namn';

    rename.onclick =
      () => renameFloor(
        state.currentFloorId
      );

    controls.appendChild(
      rename
    );

    const remove =
      document.createElement('button');

    remove.type =
      'button';

    remove.textContent =
      'Ta bort våning';

    remove.onclick =
      () => deleteFloor(
        state.currentFloorId
      );

    controls.appendChild(
      remove
    );

  }

}


function switchFloor(floorId) {

  if (
    !state.currentOp ||
    floorId === state.currentFloorId
  ) return;

  activateFloor(
    floorId
  );

  toast(
    `Bytte till ${getCurrentFloor()?.name || 'våning'}.`
  );

}


function addFloor() {

  if (!state.currentOp) return;

  normalizeOperationFloors(
    state.currentOp
  );

  syncCurrentFloorToOperation();

  const floor =
    createDefaultFloor(
      {
        name:
          `Våning ${
            state.currentOp.floors.length + 1
          }`
      },
      state.currentOp.floors.length
    );

  state.currentOp.floors.push(
    floor
  );

  activateFloor(
    floor.id,
    {
      silent: true
    }
  );

  if (state.stage) {

    clearSelection();

    clearMap();

    renderOperationObjects();

  }

  renderFloorControls();
  updateMapUI();
  pushHistory();
  scheduleSave();

  toast(
    `${floor.name} skapad. Ladda upp en karta för våningen.`
  );

}


function renameFloor(floorId) {

  if (!state.currentOp) return;

  const floor =
    state.currentOp.floors.find(
      item =>
        item.id === floorId
    );

  if (!floor) return;

  const name =
    window.prompt(
      'Namn på våningen:',
      floor.name
    );

  if (
    name === null ||
    !name.trim()
  ) return;

  floor.name =
    name.trim();

  renderFloorControls();
  pushHistory();
  scheduleSave();

}


function deleteFloor(floorId) {

  if (!state.currentOp) return;

  normalizeOperationFloors(
    state.currentOp
  );

  if (
    state.currentOp.floors.length <= 1
  ) {

    toast(
      'Minst en våning måste finnas.'
    );

    return;

  }

  const floor =
    state.currentOp.floors.find(
      item =>
        item.id === floorId
    );

  if (!floor) return;

  if (
    !window.confirm(
      `Ta bort "${floor.name}"? Kartan och objekten på våningen tas bort.`
    )
  ) return;

  const index =
    state.currentOp.floors.indexOf(
      floor
    );

  state.currentOp.floors.splice(
    index,
    1
  );

  activateFloor(
    state.currentOp.floors[
      Math.max(
        0,
        index - 1
      )
    ].id,
    {
      silent: true
    }
  );

  renderFloorControls();
  pushHistory();
  scheduleSave();

  toast(
    `${floor.name} borttagen.`
  );

}


/* ============================================================
   DEFAULT OPERATION
   ============================================================ */

function createDefaultOperation(data = {}) {

  const now = new Date();

  const operation = {

    id:
      data.id ||
      mssrpId(),

    name:
      data.name ||
      'Ny operation',

    number:
      data.number ||
      `OP-${now.getFullYear()}-${String(
        now.getMonth() + 1
      ).padStart(2, '0')}-${String(
        now.getDate()
      ).padStart(2, '0')}`,

    date:
      data.date ||
      now.toISOString().slice(0, 10),

    location:
      data.location ||
      '',

    commander:
      data.commander ||
      '',

    leader:
      data.leader ||
      '',

    status:
      data.status ||
      'PLANERING',

    priority:
      data.priority ||
      'NORMAL',

    threat:
      data.threat ||
      'LÅG',

    objective:
      data.objective ||
      '',

    notes:
      data.notes ||
      '',

    map:
      data.map ||
      null,

    mapLocked:
      Boolean(data.mapLocked),

    objects:
      Array.isArray(data.objects)
        ? data.objects
        : [],

    floors:
      Array.isArray(data.floors) &&
      data.floors.length
        ? data.floors
        : [
            createDefaultFloor(
              {
                name: 'Våning 1',
                map: data.map || null,
                mapLocked: data.mapLocked,
                objects:
                  Array.isArray(data.objects)
                    ? data.objects
                    : []
              },
              0
            )
          ],

    activeFloorId:
      data.activeFloorId ||
      null,

    groups:
      Array.isArray(data.groups)
        ? data.groups
        : [],

    timeline:
      Array.isArray(data.timeline)
        ? data.timeline
        : [],

    createdAt:
      data.createdAt ||
      now.toISOString(),

    updatedAt:
      data.updatedAt ||
      now.toISOString()

  };

  normalizeOperationFloors(operation);
  return operation;

}


/* ============================================================
   DOM HELPERS
   ============================================================ */

const $ = selector =>
  document.querySelector(selector);

const $$ = selector =>
  Array.from(document.querySelectorAll(selector));


function show(element) {

  if (!element) return;

  element.classList.remove('hidden');

}


function hide(element) {

  if (!element) return;

  element.classList.add('hidden');

}


function showModal(id) {

  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.add('active');

}


function closeModal(id) {

  const modal = document.getElementById(id);

  if (!modal) return;

  modal.classList.remove('active');

}


/* ============================================================
   TOAST
   ============================================================ */

let toastTimer = null;

function toast(message) {

  const el = $('#toast');

  if (!el) return;

  el.textContent = message;

  el.classList.remove('hidden');

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {

    el.classList.add('hidden');

  }, 3000);

}


/* ============================================================
   INDEXED DB
   ============================================================ */

function initDB() {

  return new Promise((resolve, reject) => {

    const request =
      indexedDB.open(
        'MSSRP-Portal',
        1
      );

    request.onupgradeneeded = event => {

      const database =
        event.target.result;

      if (!database.objectStoreNames.contains('operations')) {

        const store =
          database.createObjectStore(
            'operations',
            {
              keyPath: 'id'
            }
          );

        store.createIndex(
          'updatedAt',
          'updatedAt',
          {
            unique: false
          }
        );

      }

    };

    request.onsuccess = event => {

      db = event.target.result;

      resolve(db);

    };

    request.onerror = () => {

      reject(request.error);

    };

  });

}


function dbGetAll() {

  return new Promise((resolve, reject) => {

    if (!db) {

      resolve([]);

      return;

    }

    const transaction =
      db.transaction(
        'operations',
        'readonly'
      );

    const store =
      transaction.objectStore(
        'operations'
      );

    const request =
      store.getAll();

    request.onsuccess = () => {

      resolve(
        request.result || []
      );

    };

    request.onerror = () => {

      reject(request.error);

    };

  });

}


function dbPut(operation) {

  return new Promise((resolve, reject) => {

    if (!db) {

      resolve();

      return;

    }

    const transaction =
      db.transaction(
        'operations',
        'readwrite'
      );

    const store =
      transaction.objectStore(
        'operations'
      );

    const request =
      store.put(operation);

    request.onsuccess = () => {

      resolve();

    };

    request.onerror = () => {

      reject(request.error);

    };

  });

}


function dbDelete(id) {

  return new Promise((resolve, reject) => {

    if (!db) {

      resolve();

      return;

    }

    const transaction =
      db.transaction(
        'operations',
        'readwrite'
      );

    const store =
      transaction.objectStore(
        'operations'
      );

    const request =
      store.delete(id);

    request.onsuccess = () => {

      resolve();

    };

    request.onerror = () => {

      reject(request.error);

    };

  });

}


/* ============================================================
   LOAD OPERATIONS
   ============================================================ */

async function loadOperations() {

  try {

    state.opsList =
      await dbGetAll();

    state.opsList.sort(
      (a, b) =>
        new Date(b.updatedAt || 0) -
        new Date(a.updatedAt || 0)
    );

  } catch (error) {

    console.error(
      'Could not load operations:',
      error
    );

    state.opsList = [];

  }

  renderOperations();

}


/* ============================================================
   RENDER OPERATIONS
   ============================================================ */

function renderOperations() {

  const container =
    $('#saved-ops-list');

  const empty =
    $('#no-ops-msg');

  const count =
    $('#ops-count');

  if (!container) return;

  container.innerHTML = '';

  if (count) {

    count.textContent =
      state.opsList.length;

  }

  if (!state.opsList.length) {

    if (empty) show(empty);

    return;

  }

  if (empty) hide(empty);

  state.opsList.forEach(operation => {

    const card =
      document.createElement('div');

    card.className =
      'operation-card';

    card.dataset.id =
      operation.id;

    const updated =
      operation.updatedAt
        ? new Date(
            operation.updatedAt
          ).toLocaleString(
            'sv-SE',
            {
              dateStyle: 'short',
              timeStyle: 'short'
            }
          )
        : '—';

    card.innerHTML = `

      <div class="operation-card-header">

        <div class="operation-card-title">
          ${escapeHtml(
            operation.name ||
            'Namnlös operation'
          )}
        </div>

        <div class="operation-card-status">
          ${escapeHtml(
            operation.status ||
            'PLANERING'
          )}
        </div>

      </div>

      <div class="operation-card-meta">

        <span>
          ${escapeHtml(
            operation.number || '—'
          )}
        </span>

        <span>
          ${escapeHtml(
            operation.date || '—'
          )}
        </span>

        ${
          operation.location
            ? `<span>${escapeHtml(
                operation.location
              )}</span>`
            : ''
        }

      </div>

      ${
        operation.objective
          ? `
            <div class="operation-card-description">
              ${escapeHtml(
                operation.objective
              )}
            </div>
          `
          : ''
      }

      <div class="operation-card-footer">

        <span>
          Uppdaterad ${escapeHtml(updated)}
        </span>

        <div class="operation-card-actions">

          <button
            type="button"
            data-action="open"
          >
            Öppna
          </button>

          <button
            type="button"
            data-action="delete"
          >
            Ta bort
          </button>

        </div>

      </div>
    `;

    card.addEventListener(
      'click',
      event => {

        const action =
          event.target.closest(
            '[data-action]'
          );

        if (action) {

          event.stopPropagation();

          if (
            action.dataset.action ===
            'open'
          ) {

            openOperation(
              operation.id
            );

          }

          if (
            action.dataset.action ===
            'delete'
          ) {

            confirmDeleteOperation(
              operation.id
            );

          }

          return;

        }

        openOperation(
          operation.id
        );

      }
    );

    container.appendChild(card);

  });

}


/* ============================================================
   HTML ESCAPE
   ============================================================ */

function escapeHtml(value) {

  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

}


/* ============================================================
   PASSWORD RESET
   ============================================================ */

function ensurePasswordResetUI() {
  if (!document.getElementById('mssrp-reset-styles')) {
    const style = document.createElement('style');
    style.id = 'mssrp-reset-styles';
    style.textContent = `
      .mssrp-forgot-password { margin-top: 12px; text-align: center; }
      .mssrp-link-btn { background: none; border: 0; color: #2f8cff; cursor: pointer; font: inherit; text-decoration: underline; }
      .mssrp-link-btn:hover { opacity: .85; }
      .mssrp-reset-modal { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.72); }
      .mssrp-reset-modal.hidden { display: none; }
      .mssrp-reset-card { position: relative; width: min(420px, 100%); padding: 28px; border-radius: 14px; background: #111820; color: #fff; box-shadow: 0 20px 60px rgba(0,0,0,.45); }
      .mssrp-reset-card h2 { margin: 0 0 8px; }
      .mssrp-reset-card p { color: #aeb8c5; }
      .mssrp-reset-card label { display: block; margin: 14px 0 6px; }
      .mssrp-reset-card input { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 8px; border: 1px solid #344252; background: #0b1118; color: #fff; }
      .mssrp-reset-card .mssrp-primary { margin-top: 16px; width: 100%; }
      .mssrp-reset-close { position: absolute; top: 10px; right: 12px; border: 0; background: transparent; color: #fff; font-size: 25px; cursor: pointer; }
      .mssrp-reset-message { min-height: 20px; }
    `;
    document.head.appendChild(style);
  }

  const gate = document.getElementById('login-gate');
  if (!gate) return;

  if (!document.getElementById('forgotPasswordBtn')) {
    const wrap = document.createElement('div');
    wrap.className = 'mssrp-forgot-password';
    wrap.innerHTML = `
      <button type="button" id="forgotPasswordBtn" class="mssrp-link-btn">
        Glömt lösenordet?
      </button>
    `;
    gate.querySelector('.mssrp-login-gate-card')?.appendChild(wrap);
  }

  if (!document.getElementById('forgotPasswordModal')) {
    const modal = document.createElement('div');
    modal.id = 'forgotPasswordModal';
    modal.className = 'mssrp-reset-modal hidden';
    modal.innerHTML = `
      <div class="mssrp-reset-card">
        <button type="button" id="closeForgotPassword" class="mssrp-reset-close" aria-label="Stäng">×</button>
        <h2>Återställ lösenord</h2>
        <p>Ange e-postadressen till ditt MSSRP-konto.</p>
        <form id="forgotPasswordForm">
          <label for="resetEmail">E-post</label>
          <input id="resetEmail" type="email" autocomplete="email" required placeholder="namn@email.com">
          <button type="submit" class="mssrp-primary">Skicka återställningslänk</button>
        </form>
        <p id="forgotPasswordMessage" class="mssrp-reset-message"></p>
      </div>
    `;
    document.body.appendChild(modal);
  }

  if (!document.getElementById('newPasswordModal')) {
    const modal = document.createElement('div');
    modal.id = 'newPasswordModal';
    modal.className = 'mssrp-reset-modal hidden';
    modal.innerHTML = `
      <div class="mssrp-reset-card">
        <h2>Välj nytt lösenord</h2>
        <p>Välj ett nytt lösenord för ditt MSSRP-konto.</p>
        <form id="newPasswordForm">
          <label for="newPassword">Nytt lösenord</label>
          <input id="newPassword" type="password" minlength="8" autocomplete="new-password" required>
          <label for="newPasswordConfirm">Bekräfta lösenord</label>
          <input id="newPasswordConfirm" type="password" minlength="8" autocomplete="new-password" required>
          <button type="submit" class="mssrp-primary">Uppdatera lösenord</button>
        </form>
        <p id="newPasswordMessage" class="mssrp-reset-message"></p>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const forgotBtn = document.getElementById('forgotPasswordBtn');
  const forgotModal = document.getElementById('forgotPasswordModal');
  const closeBtn = document.getElementById('closeForgotPassword');
  const forgotForm = document.getElementById('forgotPasswordForm');
  const forgotMessage = document.getElementById('forgotPasswordMessage');
  const newModal = document.getElementById('newPasswordModal');
  const newForm = document.getElementById('newPasswordForm');
  const newMessage = document.getElementById('newPasswordMessage');

  if (forgotBtn && forgotBtn.dataset.bound !== '1') {
    forgotBtn.dataset.bound = '1';
    forgotBtn.addEventListener('click', () => {
      forgotModal?.classList.remove('hidden');
      const input = document.getElementById('resetEmail');
      input?.focus();
    });
  }

  if (closeBtn && closeBtn.dataset.bound !== '1') {
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', () => forgotModal?.classList.add('hidden'));
  }

  if (forgotModal && forgotModal.dataset.bound !== '1') {
    forgotModal.dataset.bound = '1';
    forgotModal.addEventListener('click', event => {
      if (event.target === forgotModal) forgotModal.classList.add('hidden');
    });
  }

  if (forgotForm && forgotForm.dataset.bound !== '1') {
    forgotForm.dataset.bound = '1';
    forgotForm.addEventListener('submit', async event => {
      event.preventDefault();
      const email = document.getElementById('resetEmail')?.value.trim();
      if (!email) return;

      const button = forgotForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      if (forgotMessage) forgotMessage.textContent = 'Skickar återställningslänk...';

      try {
        // Supabase requires this redirect URL to be present in
        // Authentication -> URL Configuration -> Redirect URLs.
        const redirectTo = `${window.location.origin}${window.location.pathname}?reset=password`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo
        });
        if (error) throw error;
        if (forgotMessage) {
          forgotMessage.textContent = 'Återställningsbegäran skickad. Kontrollera inkorg och skräppost.';
        }
      } catch (error) {
        console.error('Password reset:', error);
        const detail = error?.message || error?.error_description || error?.error || 'Okänt Supabase-fel';
        if (forgotMessage) {
          forgotMessage.textContent = `Kunde inte skicka återställningslänken: ${detail}`;
        }
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  if (newForm && newForm.dataset.bound !== '1') {
    newForm.dataset.bound = '1';
    newForm.addEventListener('submit', async event => {
      event.preventDefault();
      const password = document.getElementById('newPassword')?.value || '';
      const confirm = document.getElementById('newPasswordConfirm')?.value || '';
      if (password.length < 8) {
        if (newMessage) newMessage.textContent = 'Lösenordet måste vara minst 8 tecken.';
        return;
      }
      if (password !== confirm) {
        if (newMessage) newMessage.textContent = 'Lösenorden matchar inte.';
        return;
      }

      const button = newForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      if (newMessage) newMessage.textContent = 'Uppdaterar lösenord...';

      try {
        const { data } = await supabase.auth.getSession();
        if (!data?.session) throw new Error('Ingen återställningssession hittades.');
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;

        if (newMessage) newMessage.textContent = 'Lösenordet har uppdaterats.';
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => newModal?.classList.add('hidden'), 1200);
      } catch (error) {
        console.error('Password update:', error);
        if (newMessage) newMessage.textContent = 'Kunde inte uppdatera lösenordet. Länken kan ha gått ut.';
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  if (newModal && newModal.dataset.bound !== '1') {
    newModal.dataset.bound = '1';
    newModal.addEventListener('click', event => {
      if (event.target === newModal) newModal.classList.add('hidden');
    });
  }
}

async function checkPasswordRecovery() {
  try {
    const params = new URLSearchParams(window.location.search);
    const reset = params.get('reset') === 'password';
    if (!reset) return;

    ensurePasswordResetUI();

    const { data } = await supabase.auth.getSession();
    const modal = document.getElementById('newPasswordModal');
    const message = document.getElementById('newPasswordMessage');

    if (!data?.session) {
      if (message) message.textContent = 'Återställningslänken är ogiltig eller har gått ut.';
      modal?.classList.remove('hidden');
      return;
    }

    modal?.classList.remove('hidden');
  } catch (error) {
    console.error('Recovery check:', error);
  }
}

function bindPasswordRecoveryListener() {
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) currentUser = session.user;
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        updateAuthUI();
        setTimeout(() => loadMssrpBank(), 0);
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        updateAuthUI();
        setTimeout(() => loadMssrpBank(), 0);
      }
      if (event === 'PASSWORD_RECOVERY') {
        ensurePasswordResetUI();
        document.getElementById('newPasswordModal')?.classList.remove('hidden');
      }
    });
  } catch (error) {
    console.error('Recovery listener:', error);
  }
}


/* ============================================================
   AUTH
   ============================================================ */

async function checkAuth() {

  try {

    const {
      data,
      error
    } =
      await supabase.auth.getSession();

    if (error) {

      console.warn(
        'Auth session:',
        error
      );

      return;

    }

    currentUser =
      data?.session?.user ||
      null;

    updateAuthUI();

  } catch (error) {

    console.warn(
      'Auth check failed:',
      error
    );

  }

}


function updateLoginGate() {
  const gate = $('#login-gate');
  if (!gate) return;
  if (currentUser) {
    gate.classList.add('hidden');
    document.body.classList.remove('mssrp-locked');
  } else {
    gate.classList.remove('hidden');
    document.body.classList.add('mssrp-locked');
  }
}

function updateAuthUI() {
  updateLoginGate();
  const loginButton = $('#btn-login');
  const heroLoginButton = $('#btn-login-hero');
  const userInfo = $('#user-info');
  const email = $('#user-email');
  const badge = $('#user-role-badge');
  const logoutButton = $('#btn-logout');

  if (currentUser) {
    hide(loginButton);
    hide(heroLoginButton);
    show(userInfo);
    show(logoutButton);
    if (email) email.textContent = currentUser.email || '';
    if (badge) badge.textContent = accessRoles.length ? accessRoles.map(formatRoleName).join(' + ') : 'Civil';
  } else {
    show(loginButton);
    show(heroLoginButton);
    hide(userInfo);
    hide(logoutButton);
    if (badge) badge.textContent = 'Ej inloggad';
  }
  updatePortalAccess();
}


async function submitGateAuth(mode = 'login') {
  const email = $('#gate-email')?.value.trim();
  const password = $('#gate-password')?.value;
  const errorEl = $('#gate-error');
  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
  if (!email || !password) {
    if (errorEl) { errorEl.textContent = 'Fyll i e-post och lösenord.'; errorEl.classList.remove('hidden'); }
    return;
  }
  try {
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (result.error) throw result.error;
    currentUser = result.data?.user || null;
    updateAuthUI();
    await loadAccessProfile();
    if (mode === 'signup' && !currentUser) {
      if (errorEl) { errorEl.textContent = 'Kontot skapades. Bekräfta din e-post om Supabase kräver det och logga sedan in.'; errorEl.classList.remove('hidden'); }
      return;
    }
    toast(mode === 'login' ? 'Du är nu inloggad.' : 'Kontot har skapats.');
  } catch (error) {
    if (errorEl) { errorEl.textContent = error.message || 'Inloggningen misslyckades.'; errorEl.classList.remove('hidden'); }
  }
}

async function submitAuth() {

  const email =
    $('#auth-email')?.value.trim();

  const password =
    $('#auth-password')?.value;

  const errorEl =
    $('#auth-error');

  if (errorEl) {

    errorEl.textContent = '';

    hide(errorEl);

  }

  if (!email || !password) {

    if (errorEl) {

      errorEl.textContent =
        'Fyll i e-post och lösenord.';

      show(errorEl);

    }

    return;

  }

  try {

    let result;

    if (isLoginMode) {

      result =
        await supabase.auth.signInWithPassword({
          email,
          password
        });

    } else {

      result =
        await supabase.auth.signUp({
          email,
          password
        });

    }

    if (result.error) {

      throw result.error;

    }

    currentUser =
      result.data?.user ||
      null;

    closeModal('auth-modal');

    updateAuthUI();
    await loadAccessProfile();

    if (!isLoginMode) {

      toast(
        'Kontot har skapats.'
      );

    } else {

      toast(
        'Du är nu inloggad.'
      );

    }

  } catch (error) {

    console.error(error);

    if (errorEl) {

      errorEl.textContent =
        error.message ||
        'Något gick fel.';

      show(errorEl);

    }

  }

}


async function logout() {

  try {

    await supabase.auth.signOut();

  } catch (error) {

    console.warn(error);

  }

  currentUser = null;

  updateAuthUI();
  await loadAccessProfile();

  toast(
    'Du har loggats ut.'
  );

}


/* ============================================================
   MSSRP ROLE / PERMISSION ACCESS
   ============================================================ */

function formatRoleName(role) {
  const names = { civil:'Civil', polis:'Polis', fri:'FRI', ni:'NI', dispatcher:'Dispatcher', admin:'Admin' };
  return names[role] || role;
}

function hasPermission(permission) {
  return !!currentUser && (accessPermissions.has(permission) || accessRoles.includes('admin'));
}

async function loadAccessProfile() {
  accessRoles = [];
  accessPermissions = new Set();

  if (!currentUser) {
    updateAuthUI();
    return;
  }

  try {
    const { data: roleRows, error: roleError } = await supabase
      .from('user_roles')
      .select('role_id, roles(name)')
      .eq('user_id', currentUser.id);
    if (roleError) throw roleError;

    accessRoles = (roleRows || []).map(r => r.roles?.name).filter(Boolean);
    if (!accessRoles.length) accessRoles = ['civil'];

    const roleIds = (roleRows || []).map(r => r.role_id).filter(Boolean);
    if (roleIds.length) {
      const { data: permissionRows, error: permissionError } = await supabase
        .from('role_permissions')
        .select('permission_id, permissions(name)')
        .in('role_id', roleIds);
      if (permissionError) throw permissionError;
      (permissionRows || []).forEach(r => {
        if (r.permissions?.name) accessPermissions.add(r.permissions.name);
      });
    }
  } catch (error) {
    console.error('Access profile failed:', error);
    // Keep the UI locked if the permissions could not be verified.
    accessRoles = [];
    accessPermissions = new Set();
    toast('Kunde inte verifiera behörigheter. Skyddade flikar är låsta.');
  }

  updateAuthUI();
  if (hasPermission('admin')) {
    await loadAdminUsers();
    await loadAdminPermissions();
    await loadAdminStats();
    await loadAdminPayroll();
  }
  startDispatchPolling();
}

function updatePortalAccess() {
  $$('[data-feature]').forEach(el => {
    const feature = el.dataset.feature;
    const allowed = hasPermission(feature);
    if (allowed) {
      el.classList.remove('hidden');
      el.removeAttribute('aria-hidden');
    } else {
      el.classList.add('hidden');
      el.setAttribute('aria-hidden', 'true');
    }
  });

  $$('[data-feature-section]').forEach(section => {
    const allowed = hasPermission(section.dataset.featureSection);
    section.classList.toggle('hidden', !allowed);
  });

  const tacticalNav = $('[data-feature="tactical_plan"]');
  if (tacticalNav && hasPermission('tactical_plan')) tacticalNav.classList.remove('hidden');

  const adminPanel = $('#admin-panel');
  if (adminPanel) adminPanel.classList.toggle('hidden', !hasPermission('admin'));
}

function requireFeature(permission, action) {
  if (!currentUser) {
    isLoginMode = true;
    updateAuthModal();
    showModal('auth-modal');
    toast('Logga in för att använda denna funktion.');
    return false;
  }
  if (!hasPermission(permission)) {
    toast('Du saknar behörighet till denna funktion.');
    return false;
  }
  if (typeof action === 'function') action();
  return true;
}

async function loadAdminUsers() {
  if (!hasPermission('admin')) return;
  const bodies = ['#admin-users', '#admin-users-top'].map(sel => $(sel)).filter(Boolean);
  if (!bodies.length) return;
  const search = ($('#admin-user-search')?.value || '').trim().toLowerCase();
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, user_roles(role_id, roles(id,name))')
      .order('display_name');
    if (error) throw error;
    const roles = ['civil','polis','fri','ni','dispatcher','admin'];
    const filtered = (data || []).filter(user => {
      const haystack = `${user.display_name || ''} ${user.id}`.toLowerCase();
      return !search || haystack.includes(search);
    });
    const html = filtered.map(user => {
      const assigned = (user.user_roles || []).map(x => x.roles?.name).filter(Boolean);
      const options = roles.map(role => `<option value="${role}">${formatRoleName(role)}</option>`).join('');
      const removable = assigned.filter(Boolean).map(role => `<button type="button" class="mssrp-admin-remove-role" data-admin-remove-role="${user.id}" data-role-name="${escapeHtml(role)}">${escapeHtml(formatRoleName(role))} ×</button>`).join('');
      return `<tr><td><strong>${escapeHtml(user.display_name || 'Okänd')}</strong><small>${escapeHtml(user.id)}</small></td><td>${assigned.map(formatRoleName).join(', ') || '—'}</td><td><div class="mssrp-admin-assign"><select data-admin-user="${user.id}">${options}</select><button type="button" class="mssrp-secondary" data-admin-add-role="${user.id}">Ge roll</button></div></td><td><div class="mssrp-admin-remove-list">${removable || '<span>—</span>'}</div></td></tr>`;
    }).join('');
    bodies.forEach(body => body.innerHTML = html || '<tr><td colspan="4">Inga användare hittades.</td></tr>');
    const count = $('#admin-user-count');
    if (count) count.textContent = `${filtered.length} visade av ${(data || []).length}`;
    const adminCount = $('#admin-stat-admins');
    if (adminCount) adminCount.textContent = (data || []).filter(u => (u.user_roles || []).some(x => x.roles?.name === 'admin')).length;

    $$('.mssrp-admin-table [data-admin-add-role]').forEach(btn => btn.addEventListener('click', async () => {
      const userId = btn.dataset.adminAddRole;
      const select = $(`[data-admin-user="${CSS.escape(userId)}"]`);
      const roleName = select?.value;
      if (!roleName) return;
      if (roleName === 'admin' && userId === currentUser?.id) {
        toast('Du har redan administratörsbehörighet.');
        return;
      }
      const { data: role, error: roleError } = await supabase.from('roles').select('id').eq('name', roleName).single();
      if (roleError) { toast(roleError.message); return; }
      const { error } = await supabase.from('user_roles').upsert({ user_id:userId, role_id:role.id }, { onConflict:'user_id,role_id' });
      if (error) { toast(error.message); return; }
      toast(`${formatRoleName(roleName)} tilldelad.`);
      await loadAdminUsers();
    }));

    $$('.mssrp-admin-table [data-admin-remove-role]').forEach(btn => btn.addEventListener('click', async () => {
      const userId = btn.dataset.adminRemoveRole;
      const roleName = btn.dataset.roleName;
      if (!userId || !roleName) return;
      if (userId === currentUser?.id && roleName === 'admin') {
        toast('Du kan inte ta bort din egen Admin-roll här.');
        return;
      }
      const { data: role, error: roleError } = await supabase.from('roles').select('id').eq('name', roleName).single();
      if (roleError) { toast(roleError.message); return; }
      const { error } = await supabase.from('user_roles').delete().eq('user_id', userId).eq('role_id', role.id);
      if (error) { toast(error.message); return; }
      toast(`${formatRoleName(roleName)} borttagen.`);
      await loadAdminUsers();
    }));
  } catch (error) {
    console.error('Admin users failed:', error);
    bodies.forEach(body => body.innerHTML = `<tr><td colspan="4">Kunde inte läsa användare.</td></tr>`);
  }
}

async function loadAdminPermissions() {
  if (!hasPermission('admin')) return;
  const roleSelect = $('#admin-role-select');
  const list = $('#admin-permission-list');
  if (!roleSelect || !list) return;
  try {
    const [{ data: roles, error: rolesError }, { data: permissions, error: permissionsError }] = await Promise.all([
      supabase.from('roles').select('id,name,description').order('name'),
      supabase.from('permissions').select('id,name,description').order('name')
    ]);
    if (rolesError) throw rolesError;
    if (permissionsError) throw permissionsError;
    roleSelect.innerHTML = (roles || []).map(r => `<option value="${r.id}">${escapeHtml(formatRoleName(r.name))}</option>`).join('');
    window.__mssrpAdminRoles = roles || [];
    window.__mssrpAdminPermissions = permissions || [];
    await renderAdminPermissionEditor();
  } catch (error) {
    console.error('Admin permissions failed:', error);
    list.innerHTML = '<div class="mssrp-status-row">Kunde inte läsa behörigheter.</div>';
  }
}

async function renderAdminPermissionEditor() {
  const roleSelect = $('#admin-role-select');
  const list = $('#admin-permission-list');
  if (!roleSelect || !list || !roleSelect.value) return;
  const role = (window.__mssrpAdminRoles || []).find(r => r.id === roleSelect.value);
  if (!role) return;
  const { data, error } = await supabase.from('role_permissions').select('permission_id').eq('role_id', role.id);
  if (error) { toast(error.message); return; }
  const assigned = new Set((data || []).map(r => r.permission_id));
  list.innerHTML = (window.__mssrpAdminPermissions || []).map(permission => `
    <label class="mssrp-permission-item">
      <input type="checkbox" data-admin-permission="${permission.id}" ${assigned.has(permission.id) ? 'checked' : ''}>
      <span><strong>${escapeHtml(permission.name)}</strong><small>${escapeHtml(permission.description || '')}</small></span>
    </label>`).join('');
  const status = $('#admin-permission-status');
  if (status) status.textContent = `${formatRoleName(role.name)} · ${(window.__mssrpAdminPermissions || []).length} behörigheter tillgängliga`;
}

async function saveAdminPermissions() {
  if (!hasPermission('admin')) return;
  const roleId = $('#admin-role-select')?.value;
  if (!roleId) return;
  const checked = $$('#admin-permission-list [data-admin-permission]:checked').map(el => el.dataset.adminPermission);
  try {
    const { error: deleteError } = await supabase.from('role_permissions').delete().eq('role_id', roleId);
    if (deleteError) throw deleteError;
    if (checked.length) {
      const rows = checked.map(permission_id => ({ role_id: roleId, permission_id }));
      const { error: insertError } = await supabase.from('role_permissions').insert(rows);
      if (insertError) throw insertError;
    }
    toast('Rollbehörigheterna sparades.');
    await loadAccessProfile();
    await renderAdminPermissionEditor();
  } catch (error) {
    console.error('Save permissions failed:', error);
    toast(error.message || 'Kunde inte spara rollbehörigheter.');
  }
}

async function loadAdminStats() {
  if (!hasPermission('admin')) return;
  try {
    const [{ count: users }, { count: activeCalls }, { count: units }] = await Promise.all([
      supabase.from('profiles').select('id', { count:'exact', head:true }),
      supabase.from('dispatch_calls').select('id', { count:'exact', head:true }).in('status', ['new','assigned','active']),
      supabase.from('dispatch_units').select('id', { count:'exact', head:true }).neq('status', 'off-duty')
    ]);
    if ($('#admin-stat-users')) $('#admin-stat-users').textContent = users ?? '0';
    if ($('#admin-stat-active-calls')) $('#admin-stat-active-calls').textContent = activeCalls ?? '0';
    if ($('#admin-stat-units')) $('#admin-stat-units').textContent = units ?? '0';
    if ($('#admin-server-status')) $('#admin-server-status').textContent = 'MSSRP-databasen svarar.';
  } catch (error) {
    console.error('Admin stats failed:', error);
    if ($('#admin-server-status')) $('#admin-server-status').textContent = 'Kunde inte läsa systemstatus.';
  }
}

async function mssrpApi(path, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('Du måste vara inloggad.');
  const response = await fetch(`${MSSRP_API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}), Authorization: `Bearer ${token}` }
  });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.error || `API-fel (${response.status})`);
  return body;
}

let dispatchCallsCache = [];
let dispatchUnitsCache = [];

function formatCallAge(iso) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 1 ? 'NU' : `${mins} MIN`;
}

function normalizeSwedishPriority(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(3, Math.max(1, Math.round(n)));
}

function swedishPriorityLabel(value) {
  const p = normalizeSwedishPriority(value);
  return p === 1 ? 'Prio 1' : p === 2 ? 'Prio 2' : 'Prio 3';
}

function renderDispatchCalls(rows) {
  dispatchCallsCache = rows || [];
  const el = $('#dispatch-calls-list');
  if (!el) return;
  $('#dispatch-active-count') && ($('#dispatch-active-count').textContent = String(rows?.length || 0));
  if (!rows?.length) { el.innerHTML = '<div class="cad-empty">Inga aktiva larm.</div>'; return; }
  el.innerHTML = rows.map((call, i) => {
    const p = normalizeSwedishPriority(call.priority);
    const assigned = dispatchUnitsCache.filter(u => String(u.assigned_call_id) === String(call.id)).length;
    return `<div class="cad-call" data-dispatch-call="${i}">
      <div class="cad-priority p${p}">${swedishPriorityLabel(p)}</div>
      <div class="cad-call-main"><strong>${escapeHtml(call.source === 'erlc' ? 'ER:LC 112' : 'MSSRP 112')} · #${escapeHtml(call.id)}</strong><span>${escapeHtml(call.location || 'Okänd plats')}</span><small>${escapeHtml(call.caller_name || 'Okänd')} · ${escapeHtml(call.description || 'Ingen beskrivning')}</small></div>
      <div class="cad-call-meta">${formatCallAge(call.created_at)}<span class="cad-status">${assigned ? assigned+' ENH' : 'EJ TILLDELAD'}</span></div>
    </div>`;
  }).join('');
  el.querySelectorAll('[data-dispatch-call]').forEach(x => x.addEventListener('click', () => openDispatchCall(Number(x.dataset.dispatchCall))));
}

function renderDispatchUnits(rows) {
  dispatchUnitsCache = rows || [];
  const el = $('#dispatch-units-list');
  if (!el) return;
  const active = rows?.filter(x => x.status !== 'off-duty') || [];
  $('#dispatch-unit-count') && ($('#dispatch-unit-count').textContent = String(active.length));
  $('#dispatch-assigned-count') && ($('#dispatch-assigned-count').textContent = String(active.filter(x => x.assigned_call_id).length));
  const visibleRows = active;
  if (!visibleRows.length) { el.innerHTML = '<div class="cad-empty">Inga enheter i tjänst.</div>'; return; }
  el.innerHTML = visibleRows.map(unit => `<div class="cad-unit"><div class="cad-unit-left"><span class="cad-unit-dot ${unit.status === 'assigned' ? 'busy' : unit.status === 'off-duty' ? 'off' : ''}"></span><div><strong>${escapeHtml(unit.callsign)}</strong><small>${escapeHtml(unit.unit_type || 'Enhet')} · ${escapeHtml(unit.status || 'available')}</small></div></div><span class="cad-assignment">${unit.assigned_call_id ? '#'+escapeHtml(unit.assigned_call_id) : 'LEDIG'}</span></div>`).join('');
}

function openDispatchCall(index) {
  const call = dispatchCallsCache[index];
  if (!call) return;
  const title = $('#mssrp-tool-title'), eyebrow = $('#mssrp-tool-eyebrow'), body = $('#mssrp-tool-body');
  if (title) title.textContent = `Larm #${call.id}`;
  if (eyebrow) eyebrow.textContent = 'CAD · CALL DETAILS';
  const assigned = dispatchUnitsCache.filter(u => String(u.assigned_call_id) === String(call.id));
  const available = dispatchUnitsCache.filter(u => u.status !== 'off-duty');
  body.innerHTML = `<div class="cad-detail-grid">
    <div class="cad-detail"><small>Prioritet</small><strong>${swedishPriorityLabel(call.priority)}</strong></div>
    <div class="cad-detail"><small>Status</small><strong>${escapeHtml(call.status || 'new')}</strong></div>
    <div class="cad-detail"><small>Plats</small><strong>${escapeHtml(call.location || 'Okänd')}</strong></div>
    <div class="cad-detail"><small>Anmälare</small><strong>${escapeHtml(call.caller_name || 'Okänd')}</strong></div>
    <div class="cad-detail"><small>Registrerat</small><strong>${escapeHtml(new Date(call.created_at).toLocaleString('sv-SE'))}</strong></div>
    <div class="cad-detail"><small>Källa</small><strong>${escapeHtml(call.source === 'erlc' ? 'ER:LC 112' : 'MSSRP 112')}</strong></div>
  </div>
  <div class="cad-detail"><small>Händelse / lagöverträdelser</small><strong>${escapeHtml(call.legal_violations || 'Ej angivet')}</strong><p>${escapeHtml(call.description || '')}</p></div>
  <div class="cad-call-actions"><button id="cad-delete-call" class="mssrp-secondary" type="button">Ta bort larm</button></div>
  <div class="cad-assign-box" style="margin-top:12px"><span class="cad-label">TILLDELA ENHET</span><div class="cad-assign-row"><select id="cad-unit-select"><option value="">Välj ledig enhet…</option>${available.filter(u => !u.assigned_call_id || assigned.some(a => a.id === u.id)).map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.callsign)} · ${escapeHtml(u.unit_type || 'Enhet')}</option>`).join('')}</select><button id="cad-assign-btn" class="mssrp-primary" type="button">Tilldela</button></div></div>
  <div class="cad-call-actions">${assigned.length ? assigned.map(u => `<button class="mssrp-secondary" type="button" data-unassign-unit="${escapeHtml(u.id)}">Ta bort ${escapeHtml(u.callsign)}</button>`).join('') : '<span class="mssrp-status-row">Inga enheter är tilldelade.</span>'}</div>`;
  $('#cad-delete-call')?.addEventListener('click', async () => {
    if (!window.confirm(`Ta bort larm #${call.id}? Detta går inte att ångra.`)) return;

    try {
      // Frigör alla enheter som är kopplade till larmet
      const { error: unitError } = await supabase
        .from('dispatch_units')
        .update({
          assigned_call_id: null,
          status: 'available'
        })
        .eq('assigned_call_id', call.id);

      if (unitError) throw unitError;

      // Markera larmet som borttaget. Dispatch-listan visar bara
      // new, assigned och active, så larmet försvinner direkt.
      const { error: callError } = await supabase
        .from('dispatch_calls')
        .update({ status: 'deleted' })
        .eq('id', call.id);

      if (callError) throw callError;

      // Ta bort det direkt från cache/UI så användaren slipper vänta på polling.
      dispatchCallsCache = (dispatchCallsCache || []).filter(c => c.id !== call.id);

      closeModal('mssrp-tool-modal');
      renderDispatchCalls(dispatchCallsCache);
      toast(`Larm #${call.id} togs bort.`);

      await refreshDispatchBoard();
      await loadAdminStats();
    } catch (e) {
      console.error('Remove dispatch call failed:', e);
      toast(e.message || 'Kunde inte ta bort larmet.');
    }
  });

  $('#cad-assign-btn')?.addEventListener('click', async () => {
    const unitId = $('#cad-unit-select')?.value;
    if (!unitId) return toast('Välj en enhet.');
    try {
      const { error } = await supabase.from('dispatch_units').update({ assigned_call_id: call.id, status: 'assigned' }).eq('id', unitId);
      if (error) throw error;
      toast('Enheten tilldelades larmet.'); await refreshDispatchBoard(); openDispatchCall(dispatchCallsCache.findIndex(x => x.id === call.id));
    } catch (e) { toast(e.message || 'Kunde inte tilldela enheten.'); }
  });
  body.querySelectorAll('[data-unassign-unit]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      const { error } = await supabase.from('dispatch_units').update({ assigned_call_id: null, status: 'available' }).eq('id', btn.dataset.unassignUnit);
      if (error) throw error;
      toast('Enheten frigjordes.'); await refreshDispatchBoard(); openDispatchCall(dispatchCallsCache.findIndex(x => x.id === call.id));
    } catch (e) { toast(e.message || 'Kunde inte frigöra enheten.'); }
  }));
  showModal('mssrp-tool-modal');
}

function updateDutyUI(unit) {
  const badge = $('#duty-status-badge'), current = $('#duty-current'), off = $('#duty-off-btn'), form = $('#duty-form');
  if (!badge || !current || !off || !form) return;
  const onDuty = !!unit;
  badge.textContent = onDuty ? `I TJÄNST · ${unit.callsign}` : 'EJ I TJÄNST';
  current.innerHTML = onDuty ? `<span class="status-dot"></span><span>Enhet <strong>${escapeHtml(unit.callsign)}</strong> · ${escapeHtml(unit.unit_type || 'Enhet')} · ${escapeHtml(unit.status || 'available')}</span>` : '<span>Skapa ett enhetsnummer för att gå i tjänst.</span>';
  off.disabled = !onDuty;
  form.querySelectorAll('input,select,button[type="submit"]').forEach(el => { el.disabled = onDuty; });
}

async function refreshDispatchBoard() {
  if (!hasPermission('dispatch')) return;
  const [{ data: calls, error: callsError }, { data: units, error: unitsError }] = await Promise.all([
    supabase.from('dispatch_calls').select('id,source,caller_name,location,description,legal_violations,status,priority,created_at').in('status', ['new','assigned','active']).order('created_at', { ascending: false }).limit(50),
    supabase.from('dispatch_units').select('id,callsign,unit_type,status,user_id,assigned_call_id').order('callsign')
  ]);
  if (callsError) console.error('Dispatch calls:', callsError);
  if (unitsError) console.error('Dispatch units:', unitsError);
  renderDispatchUnits(units || []);
  renderDispatchCalls(calls || []);
  if ($('#dispatch-last-update')) $('#dispatch-last-update').textContent = `Senast ${new Date().toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
  updateDutyUI((units || []).find(x => x.user_id === currentUser?.id) || null);
}

function startDispatchPolling() {
  clearInterval(window.__mssrpDispatchTimer);
  if (!hasPermission('dispatch')) return;
  refreshDispatchBoard();
  window.__mssrpDispatchTimer = setInterval(refreshDispatchBoard, 5000);
}

async function sendErlcAdminCommand(path, payload) {
  const result = await mssrpApi(path, { method: 'POST', body: JSON.stringify(payload) });
  toast('ER:LC-kommandot skickades.');
  return result;
}

function initPortalTabs() {
  const pages = $$('[data-portal-page]');
  const tabs = $$('.mssrp-nav a[href^="#"]');
  if (!pages.length || !tabs.length) return;

  document.body.classList.add('mssrp-tab-mode');

  const showPage = (pageId, updateHash = true) => {
    const target = document.querySelector(`[data-portal-page="${CSS.escape(pageId)}"]`);
    if (!target) return false;

    pages.forEach(page => page.classList.toggle('portal-page-hidden', page !== target));
    tabs.forEach(tab => {
      const active = tab.getAttribute('href') === `#${pageId}`;
      tab.classList.toggle('portal-tab-active', active);
      if (active) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });

    if (updateHash && window.location.hash !== `#${pageId}`) {
      history.replaceState(null, '', `#${pageId}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', event => {
      const href = tab.getAttribute('href') || '';
      const pageId = href.slice(1);
      if (!pageId || pageId === 'shop') return;
      if (showPage(pageId)) event.preventDefault();
    });
  });

  window.addEventListener('hashchange', () => {
    const pageId = window.location.hash.slice(1) || 'home';
    showPage(pageId, false);
  });

  const initial = window.location.hash.slice(1) || 'home';
  if (!showPage(initial, false)) showPage('home', false);
}

function navigateToPortalPage(pageId) {
  const target = document.querySelector(`[data-portal-page="${CSS.escape(pageId)}"]`);
  if (!target) return false;
  const link = document.querySelector(`.mssrp-nav a[href="#${CSS.escape(pageId)}"]`);
  if (link) link.click();
  else window.location.hash = `#${pageId}`;
  return true;
}


/* ============================================================
   POLICE DATABASE + MSSRP ROLEPLAY TOOLS
   ============================================================ */

const ROLEPLAY_TOOL_CONFIG = {
  krimvapen: {
    title: 'Krimvapen',
    description: 'Köp rollspelsvapen och se registrerade innehav.',
    custom: true
  },
  fastigheter: {
    title: 'Fastigheter',
    description: 'Fastighetsregister.',
    fields: [
      ['name', 'Fastighet', 'text'],
      ['owner', 'Ägare / karaktär', 'text'],
      ['address', 'Adress', 'text'],
      ['notes', 'Anteckningar', 'textarea']
    ]
  },
  folkbokforing: {
    title: 'Folkbokföringen',
    description: 'Rollspelsregister för folkbokföring.',
    fields: [
      ['name', 'Namn', 'text'],
      ['personal', 'Personuppgift / RP-ID', 'text'],
      ['address', 'Adress', 'text'],
      ['notes', 'Anteckningar', 'textarea']
    ]
  },
  behorigheter: {
    title: 'Behörighetsstyrning',
    description: 'Hantera roller och åtkomst i MSSRP.',
    admin: true,
    fields: [
      ['name', 'Användare / RP-namn', 'text'],
      ['role', 'Roll', 'text'],
      ['notes', 'Anteckningar', 'textarea']
    ]
  }
};

function roleplayStorageKey(tool) {
  return `mssrp_roleplay_${currentUser?.id || 'guest'}_${tool}`;
}

function getRoleplayRecords(tool) {
  try {
    const value = JSON.parse(localStorage.getItem(roleplayStorageKey(tool)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveRoleplayRecords(tool, rows) {
  localStorage.setItem(roleplayStorageKey(tool), JSON.stringify(rows));
}

function renderRoleplayRecords(tool, config) {
  const list = $('#mssrp-roleplay-records');
  if (!list) return;

  const rows = getRoleplayRecords(tool);
  list.innerHTML = rows.length ? rows.map((row, index) => {
    const firstKey = config.fields[0][0];
    const title = row[firstKey] || 'Namnlös post';
    const details = config.fields
      .slice(1)
      .map(([key, label]) => row[key] ? `${label}: ${row[key]}` : '')
      .filter(Boolean)
      .join(' · ');

    return `<div class="mssrp-tool-record">
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(details || 'Ingen ytterligare information')}</small>
      <div style="margin-top:8px">
        <button type="button" class="mssrp-secondary" data-roleplay-delete="${index}">Ta bort</button>
      </div>
    </div>`;
  }).join('') : '<div class="mssrp-status-row">Inga poster ännu.</div>';

  list.querySelectorAll('[data-roleplay-delete]').forEach(button => {
    button.addEventListener('click', () => {
      const rows = getRoleplayRecords(tool);
      rows.splice(Number(button.dataset.roleplayDelete), 1);
      saveRoleplayRecords(tool, rows);
      renderRoleplayRecords(tool, config);
    });
  });
}

async function openCrimeWeapons() {
  if (!requireFeature('roleplay_system')) return;
  const title = $('#mssrp-tool-title'), eyebrow = $('#mssrp-tool-eyebrow'), body = $('#mssrp-tool-body');
  if (!body) return;
  if (title) title.textContent = 'Krimvapentörteckning';
  if (eyebrow) eyebrow.textContent = 'MSSRP · KRIMINALREGISTER';
  body.innerHTML = '<div class="mssrp-status-row">Hämtar vapenkatalog…</div>';
  showModal('mssrp-tool-modal');

  let weapons = [];
  let dbAvailable = true;
  try {
    const { data, error } = await supabase.from('crime_weapons').select('id,name,price,description,stock,status,created_at').eq('status','active').order('created_at',{ascending:false});
    if (error) throw error;
    weapons = data || [];
  } catch (e) {
    dbAvailable = false;
    weapons = JSON.parse(localStorage.getItem('mssrp_crime_weapons') || '[]');
  }

  const purchasesKey = `mssrp_weapon_purchases_${currentUser?.id || 'guest'}`;
  const purchases = JSON.parse(localStorage.getItem(purchasesKey) || '[]');
  const admin = hasPermission('admin');
  body.innerHTML = `
    <div class="mssrp-section-title"><p>In-game katalog. Vapen kan läggas in av administratör och köpas av spelare för rollspel.</p></div>
    <div class="mssrp-card-grid" id="crime-weapon-list"></div>
    <div class="mssrp-kicker" style="margin-top:22px">MINA INNEHAV</div>
    <div id="crime-my-weapons" class="mssrp-tool-modal-list"></div>
    ${admin ? `<div class="mssrp-kicker" style="margin-top:22px">ADMIN · LÄGG TILL VAPEN</div>
      <form id="crime-admin-form" class="mssrp-tool-form">
        <label>Vapen / modell<input id="crime-name" required maxlength="100" placeholder="T.ex. TEC-9"></label>
        <label>Pris<input id="crime-price" required type="number" min="0" step="1" placeholder="25000"></label>
        <label>Antal i lager<input id="crime-stock" required type="number" min="0" step="1" value="1"></label>
        <label>Beskrivning<textarea id="crime-description" maxlength="500" placeholder="Kort RP-beskrivning"></textarea></label>
        <button class="mssrp-primary" type="submit">+ Lägg till i katalog</button>
      </form>` : ''}
    ${!dbAvailable ? '<small style="display:block;margin-top:14px;color:#9aa6b2">Databastabellen crime_weapons saknas ännu. Tillfällig katalog används i denna webbläsare tills tabellen skapas.</small>' : ''}
  `;

  const render = () => {
    const list = $('#crime-weapon-list');
    if (list) list.innerHTML = weapons.length ? weapons.map(w => `<div class="mssrp-card"><span class="mssrp-card-icon">▣</span><span><strong>${escapeHtml(w.name)}</strong><small>${escapeHtml(w.description || 'Kriminellt rollspelsvapen')} · ${Number(w.price || 0).toLocaleString('sv-SE')} kr · Lager: ${escapeHtml(w.stock ?? 0)}</small><button type="button" class="mssrp-primary" data-buy-weapon="${escapeHtml(w.id ?? w.name)}" style="margin-top:9px">Köp</button></span></div>`).join('') : '<div class="mssrp-status-row">Inga vapen finns i katalogen ännu.</div>';
    const mine = $('#crime-my-weapons');
    if (mine) mine.innerHTML = purchases.length ? purchases.map(p => `<div class="mssrp-tool-record"><strong>${escapeHtml(p.name)}</strong><small>Köpt: ${new Date(p.created_at).toLocaleString('sv-SE')}</small></div>`).join('') : '<div class="mssrp-status-row">Du har inga registrerade innehav.</div>';
  };
  render();

  body.querySelectorAll('[data-buy-weapon]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.buyWeapon;
    const weapon = weapons.find(w => String(w.id ?? w.name) === String(id));
    if (!weapon) return;
    if (Number(weapon.stock || 0) <= 0) return toast('Vapnet är slut i lager.');
    const ok = confirm(`Köp ${weapon.name} för ${Number(weapon.price || 0).toLocaleString('sv-SE')} kr?`);
    if (!ok) return;
    if (dbAvailable && weapon.id) {
      const { error } = await supabase.from('crime_weapons').update({stock: Math.max(0, Number(weapon.stock)-1)}).eq('id', weapon.id);
      if (error) return toast(error.message || 'Köpet kunde inte genomföras.');
    }
    weapon.stock = Math.max(0, Number(weapon.stock)-1);
    purchases.unshift({name: weapon.name, price: weapon.price, created_at: new Date().toISOString()});
    localStorage.setItem(purchasesKey, JSON.stringify(purchases));
    if (!dbAvailable) localStorage.setItem('mssrp_crime_weapons', JSON.stringify(weapons));
    toast(`${weapon.name} köptes.`);
    render();
  }));

  $('#crime-admin-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!hasPermission('admin')) return;
    const row = {name: $('#crime-name').value.trim(), price: Number($('#crime-price').value), stock: Number($('#crime-stock').value), description: $('#crime-description').value.trim(), status:'active'};
    if (!row.name) return;
    if (dbAvailable) {
      const {data,error}=await supabase.from('crime_weapons').insert(row).select().single();
      if(error) return toast(error.message || 'Kunde inte lägga till vapnet.');
      weapons.unshift(data);
    } else {
      row.id = mssrpId(); row.created_at = new Date().toISOString(); weapons.unshift(row);
      localStorage.setItem('mssrp_crime_weapons', JSON.stringify(weapons));
    }
    event.target.reset(); $('#crime-stock').value='1'; render(); toast('Vapnet lades till i katalogen.');
  });
}

function openRoleplayTool(tool) {
  const config = ROLEPLAY_TOOL_CONFIG[tool];
  if (!config) return;
  if (config.custom) { openCrimeWeapons(); return; }

  if (config.admin) {
    if (!requireFeature('admin')) return;
  } else if (!requireFeature('roleplay_system')) {
    return;
  }

  if (config.admin && !hasPermission('admin')) {
    toast('Du saknar behörighet till denna funktion.');
    return;
  }

  const title = $('#mssrp-tool-title');
  const eyebrow = $('#mssrp-tool-eyebrow');
  const body = $('#mssrp-tool-body');
  if (!body) return;

  if (title) title.textContent = config.title;
  if (eyebrow) eyebrow.textContent = config.admin ? 'ADMIN' : 'ROLLSPEL';

  body.innerHTML = `
    <div class="mssrp-section-title">
      <p>${escapeHtml(config.description)}</p>
    </div>
    <form id="mssrp-roleplay-form" class="mssrp-tool-form">
      ${config.fields.map(([key, label, type]) => `
        <label>${escapeHtml(label)}
          ${type === 'textarea'
            ? `<textarea id="roleplay-${escapeHtml(key)}" maxlength="2000" placeholder="${escapeHtml(label)}"></textarea>`
            : `<input id="roleplay-${escapeHtml(key)}" type="${escapeHtml(type)}" maxlength="200" placeholder="${escapeHtml(label)}">`}
        </label>
      `).join('')}
      <div class="mssrp-actions">
        <button class="mssrp-primary" type="submit">Spara post</button>
        <button class="mssrp-secondary" type="button" id="mssrp-roleplay-clear">Rensa</button>
      </div>
    </form>
    <div class="mssrp-kicker" style="margin-top:22px">REGISTRERADE POSTER</div>
    <div id="mssrp-roleplay-records" class="mssrp-tool-modal-list"></div>
    <small>Poster sparas lokalt i denna webbläsare. Supabase-tabellerna för dessa fyra rollspelsregister finns inte i den uppladdade appkoden.</small>
  `;

  $('#mssrp-roleplay-form')?.addEventListener('submit', event => {
    event.preventDefault();

    const row = { created_at: new Date().toISOString() };
    config.fields.forEach(([key]) => {
      row[key] = $(`#roleplay-${CSS.escape(key)}`)?.value.trim() || '';
    });

    if (!row[config.fields[0][0]]) {
      toast(`Fyll i ${config.fields[0][1].toLowerCase()}.`);
      return;
    }

    const rows = getRoleplayRecords(tool);
    rows.unshift(row);
    saveRoleplayRecords(tool, rows);
    event.target.reset();
    renderRoleplayRecords(tool, config);
    toast(`${config.title}: posten sparades.`);
  });

  $('#mssrp-roleplay-clear')?.addEventListener('click', () => {
    $('#mssrp-roleplay-form')?.reset();
  });

  renderRoleplayRecords(tool, config);
  showModal('mssrp-tool-modal');
}

async function searchPolicePersons() {
  if (!requireFeature('police_database')) return;

  const query = $('#police-person-search')?.value.trim() || '';
  const results = $('#police-person-results');
  if (!results) return;

  results.innerHTML = '<span>Söker…</span>';

  try {
    let data, error;
    const uuid = query.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    try {
      let request = supabase.from('profiles').select('id,display_name,roblox_username').order('display_name').limit(50);
      if (query) {
        const safe = query.replace(/[%_]/g, '\$&').replace(/,/g, ' ');
        request = uuid ? request.eq('id', query) : request.or(`roblox_username.ilike.%${safe}%,display_name.ilike.%${safe}%`);
      }
      ({ data, error } = await request);
      if (error) throw error;
    } catch (firstError) {
      let request = supabase.from('profiles').select('id,display_name').order('display_name').limit(50);
      if (query) request = uuid ? request.eq('id', query) : request.ilike('display_name', `%${query.replace(/[%_]/g, '\$&')}%`);
      ({ data, error } = await request);
    }
    if (error) throw error;

    if (!data?.length) {
      results.innerHTML = '<span>Inga personer hittades.</span>';
      return;
    }

    results.innerHTML = data.map(person => `
      <div class="mssrp-list-item">
        <div>
          <strong>${escapeHtml(person.roblox_username || person.display_name || 'Okänd')}</strong>
          <small>Roblox · ${escapeHtml(person.display_name || person.id || '')}</small>
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Police person search failed:', error);
    results.innerHTML = `<span>Kunde inte läsa polisregistret: ${escapeHtml(error.message || 'Okänt fel')}</span>`;
  }
}

async function loadPoliceCases() {
  if (!requireFeature('police_database')) return;

  const results = $('#police-case-results');
  if (!results) return;

  results.innerHTML = '<span>Hämtar ärenden…</span>';

  try {
    const { data, error } = await supabase
      .from('dispatch_calls')
      .select('id,caller_name,location,description,status,priority,created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    if (!data?.length) {
      results.innerHTML = '<span>Inga ärenden hittades.</span>';
      return;
    }

    results.innerHTML = data.map(item => `
      <div class="mssrp-list-item">
        <div>
          <strong>${escapeHtml(item.location || 'Okänd plats')}</strong>
          <small>${escapeHtml(item.caller_name || 'Okänd')} · ${escapeHtml(item.status || 'new')}</small>
          <small>${escapeHtml(item.description || '')}</small>
        </div>
        <b>${swedishPriorityLabel(item.priority)}</b>
      </div>
    `).join('');
  } catch (error) {
    console.error('Police cases failed:', error);
    results.innerHTML = `<span>Kunde inte läsa ärenden: ${escapeHtml(error.message || 'Okänt fel')}</span>`;
  }
}

function openNewPolicePost() {
  if (!requireFeature('police_database')) return;

  const title = $('#mssrp-tool-title');
  const eyebrow = $('#mssrp-tool-eyebrow');
  const body = $('#mssrp-tool-body');
  if (!body) return;

  if (title) title.textContent = 'Ny polispost';
  if (eyebrow) eyebrow.textContent = 'POLISREGISTER';

  body.innerHTML = `
    <form id="mssrp-police-post-form" class="mssrp-tool-form">
      <label>Namn / identifiering
        <input id="police-post-name" required maxlength="120" placeholder="Namn eller RP-ID">
      </label>
      <label>Typ
        <select id="police-post-type">
          <option value="anteckning">Anteckning</option>
          <option value="varning">Varning</option>
          <option value="efterlysning">Efterlysning</option>
          <option value="övrigt">Övrigt</option>
        </select>
      </label>
      <label>Beskrivning
        <textarea id="police-post-description" required maxlength="3000" placeholder="Beskriv registreringen…"></textarea>
      </label>
      <div class="mssrp-actions">
        <button class="mssrp-primary" type="submit">Spara post</button>
      </div>
    </form>
    <div class="mssrp-kicker" style="margin-top:22px">LOKALA POSTER</div>
    <div id="mssrp-police-post-list" class="mssrp-tool-modal-list"></div>
    <small>Den uppladdade appkoden innehåller ingen polisregister-tabell i Supabase, så nya poster sparas lokalt tills en sådan tabell kopplas in.</small>
  `;

  const key = `mssrp_police_posts_${currentUser.id}`;

  const getRows = () => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const render = () => {
    const list = $('#mssrp-police-post-list');
    if (!list) return;

    const rows = getRows();
    list.innerHTML = rows.length ? rows.map((row, index) => `
      <div class="mssrp-tool-record">
        <strong>${escapeHtml(row.name)} · ${escapeHtml(row.type)}</strong>
        <small>${escapeHtml(row.description)}</small>
        <div style="margin-top:8px">
          <button type="button" class="mssrp-secondary" data-police-post-delete="${index}">Ta bort</button>
        </div>
      </div>
    `).join('') : '<div class="mssrp-status-row">Inga lokala poster ännu.</div>';

    list.querySelectorAll('[data-police-post-delete]').forEach(button => {
      button.addEventListener('click', () => {
        const rows = getRows();
        rows.splice(Number(button.dataset.policePostDelete), 1);
        localStorage.setItem(key, JSON.stringify(rows));
        render();
      });
    });
  };

  $('#mssrp-police-post-form')?.addEventListener('submit', event => {
    event.preventDefault();

    const row = {
      name: $('#police-post-name')?.value.trim(),
      type: $('#police-post-type')?.value,
      description: $('#police-post-description')?.value.trim(),
      created_at: new Date().toISOString()
    };

    if (!row.name || !row.description) {
      toast('Fyll i namn och beskrivning.');
      return;
    }

    const rows = getRows();
    rows.unshift(row);
    localStorage.setItem(key, JSON.stringify(rows));
    event.target.reset();
    render();
    toast('Polisposten sparades.');
  });

  render();
  showModal('mssrp-tool-modal');
}

function bindPortalEvents() {
  // One delegated handler covers both static and dynamically rendered buttons/cards.
  document.addEventListener('click', event => {
    const featureEl = event.target.closest('[data-feature]');
    if (!featureEl) return;
    const feature = featureEl.dataset.feature;
    if (!hasPermission(feature)) {
      event.preventDefault();
      event.stopPropagation();
      if (!currentUser) {
        isLoginMode = true; updateAuthModal(); showModal('auth-modal');
      }
      toast(currentUser ? 'Du saknar behörighet till denna funktion.' : 'Logga in för att se denna funktion.');
      return;
    }
    if (featureEl.tagName !== 'A') event.preventDefault();
    if (featureEl.dataset.roleplayTool) {
      openRoleplayTool(featureEl.dataset.roleplayTool);
      return;
    }
    const pageMap = {
      call_112:'112', police_database:'police', dispatch:'dispatch', roleplay_system:'roleplay',
      tactical_plan:'tactical', roblox_integration:'roblox', admin:'admin'
    };
    const pageId = pageMap[feature];
    if (pageId) navigateToPortalPage(pageId);
  });

  $('#btn-login-hero')?.addEventListener('click', () => {
    isLoginMode = true;
    updateAuthModal();
    showModal('auth-modal');
  });

  $('#btn-new-op-portal')?.addEventListener('click', openNewOperationModal);
  $('#btn-open-op-portal')?.addEventListener('click', () => {
    navigateToPortalPage('operations');
  });

  $('#admin-refresh-top')?.addEventListener('click', async () => {
    await Promise.all([loadAdminUsers(), loadAdminPermissions(), loadAdminStats(), loadAdminPayroll()]);
    toast('Adminpanelen uppdaterad.');
  });
  $('#admin-reload-permissions')?.addEventListener('click', loadAdminPermissions);
  $('#admin-role-select')?.addEventListener('change', renderAdminPermissionEditor);
  $('#admin-save-permissions')?.addEventListener('click', saveAdminPermissions);
  $('#admin-user-search')?.addEventListener('input', () => loadAdminUsers());
  bindAdminPayrollEvents();

  $('#portal-112-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireFeature('call_112')) return;
    const roblox = $('#portal-112-roblox')?.value.trim();
    const discord = $('#portal-112-discord')?.value.trim();
    const district = $('#portal-112-district')?.value.trim();
    const location = $('#portal-112-location')?.value.trim();
    const postcode = $('#portal-112-postcode')?.value.trim();
    const legalViolations = $('#portal-112-violations')?.value.trim();
    const description = $('#portal-112-description')?.value.trim();
    const units = $$('#portal-112-units option:checked').map(option => option.value);
    const priority = normalizeSwedishPriority($('#portal-112-priority')?.value || 3);
    if (!roblox || !location || !legalViolations || !description) {
      toast('Fyll i Roblox-namn, plats, lagöverträdelser och beskrivning.');
      return;
    }
    const button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const rawPayload = { roblox_username: roblox, discord_username: discord, district, postcode, requested_units: units };
      const { error } = await supabase.from('dispatch_calls').insert({
        caller_id: currentUser.id,
        caller_name: roblox,
        location,
        description,
        legal_violations: legalViolations,
        priority,
        raw_payload: rawPayload
      });
      if (error) throw error;
      event.target.reset();
      toast('112-larm skickat till Dispatch.');
      navigateToPortalPage('dispatch');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Kunde inte skicka larmet.');
    } finally {
      if (button) button.disabled = false;
    }
  });

  $('#dispatch-refresh')?.addEventListener('click', refreshDispatchBoard);

  $('#duty-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireFeature('dispatch')) return;

    const callsign = $('#duty-callsign')?.value.trim();
    const unitType = $('#duty-unit-type')?.value || 'patrol';
    if (!callsign) { toast('Ange ett enhetsnummer.'); return; }
    if (!currentUser?.id) { toast('Du måste vara inloggad.'); return; }

    const button = event.target.querySelector('button[type="submit"]');
    if (button) button.disabled = true;

    try {
      // Do not depend on the optional /api backend for duty status.
      // Create the unit directly in Supabase instead.
      const { data: existing, error: existingError } = await supabase
        .from('dispatch_units')
        .select('id,callsign,unit_type,status,user_id,assigned_call_id')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (existingError) throw existingError;

      // Prevent two active units with the same callsign.
      const { data: sameCallsign, error: callsignError } = await supabase
        .from('dispatch_units')
        .select('id,user_id,callsign,status')
        .eq('callsign', callsign)
        .neq('user_id', currentUser.id)
        .neq('status', 'off-duty')
        .limit(1);

      if (callsignError) throw callsignError;
      if (sameCallsign?.length) {
        throw new Error(`Enhetsnumret ${callsign} används redan.`);
      }

      let unit;

      if (existing?.id) {
        const { data, error } = await supabase
          .from('dispatch_units')
          .update({
            callsign,
            unit_type: unitType,
            status: existing.assigned_call_id ? 'assigned' : 'available'
          })
          .eq('id', existing.id)
          .select('id,callsign,unit_type,status,user_id,assigned_call_id')
          .single();
        if (error) throw error;
        unit = data;
      } else {
        const { data, error } = await supabase
          .from('dispatch_units')
          .insert({
            callsign,
            unit_type: unitType,
            status: 'available',
            user_id: currentUser.id,
            assigned_call_id: null
          })
          .select('id,callsign,unit_type,status,user_id,assigned_call_id')
          .single();
        if (error) throw error;
        unit = data;
      }

      toast(`Enhet ${unit.callsign} är nu i tjänst.`);
      await refreshDispatchBoard();
    } catch (error) {
      console.error('Going on duty failed:', error);
      toast(error.message || 'Kunde inte skapa enheten. Kontrollera Supabase RLS och kolumnerna i dispatch_units.');
    } finally {
      if (button) button.disabled = false;
    }
  });

  $('#duty-off-btn')?.addEventListener('click', async () => {
    if (!requireFeature('dispatch')) return;
    if (!currentUser?.id) return toast('Du måste vara inloggad.');

    try {
      const { error } = await supabase
        .from('dispatch_units')
        .update({
          status: 'off-duty',
          assigned_call_id: null
        })
        .eq('user_id', currentUser.id);

      if (error) throw error;
      toast('Du har gått ur tjänst.');
      await refreshDispatchBoard();
    } catch (error) {
      console.error('Going off duty failed:', error);
      toast(error.message || 'Kunde inte gå ur tjänst.');
    }
  });

  $('#erlc-hint-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireFeature('admin')) return;
    try { await sendErlcAdminCommand('/erlc/hint', { text: $('#erlc-hint-text')?.value.trim() }); event.target.reset(); }
    catch (error) { toast(error.message); }
  });

  $('#erlc-message-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireFeature('admin')) return;
    try { await sendErlcAdminCommand('/erlc/message', { text: $('#erlc-message-text')?.value.trim() }); event.target.reset(); }
    catch (error) { toast(error.message); }
  });

  $('#erlc-pm-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireFeature('admin')) return;
    try { await sendErlcAdminCommand('/erlc/pm', { player: $('#erlc-pm-player')?.value.trim(), text: $('#erlc-pm-text')?.value.trim() }); event.target.reset(); }
    catch (error) { toast(error.message); }
  });

  $('#police-person-search-form')?.addEventListener('submit', event => {
    event.preventDefault();
    searchPolicePersons();
  });
  $('#police-load-cases')?.addEventListener('click', loadPoliceCases);
  $('#police-new-post')?.addEventListener('click', openNewPolicePost);

  $$('[data-roleplay-tool]').forEach(button => {
    if (button.dataset.feature) return;
    button.addEventListener('click', () => openRoleplayTool(button.dataset.roleplayTool));
  });

  $$('[data-shop-item]').forEach(item => item.addEventListener('click', () => {
    toast(`${item.querySelector('strong')?.textContent || 'Shop'} är en rollspelsfunktion och är redo för vidare innehåll.`);
  }));

  startDispatchPolling();
}

/* ============================================================
   CREATE OPERATION
   ============================================================ */

function openNewOperationModal() {

  if (!currentUser) {
    isLoginMode = true; updateAuthModal(); showModal('auth-modal'); toast('Logga in för att skapa en operation.'); return;
  }

  if (!hasPermission('tactical_plan')) {
    toast('Du saknar behörighet till Taktisk plan.'); return;
  }

  const form =
    $('#new-op-form');

  if (form) {

    form.reset();

  }

  const date =
    $('#op-date');

  if (date) {

    date.value =
      new Date()
        .toISOString()
        .slice(0, 10);

  }

  showModal(
    'new-op-modal'
  );

}


async function createOperationFromForm(
  event
) {

  event.preventDefault();

  const operation =
    createDefaultOperation({

      name:
        $('#op-name')?.value.trim(),

      number:
        $('#op-number')?.value.trim(),

      date:
        $('#op-date')?.value,

      location:
        $('#op-location')?.value.trim(),

      commander:
        $('#op-commander')?.value.trim(),

      leader:
        $('#op-leader')?.value.trim(),

      status:
        $('#op-status')?.value ||
        'PLANERING',

      priority:
        $('#op-priority')?.value ||
        'NORMAL',

      threat:
        $('#op-threat')?.value ||
        'LÅG',

      objective:
        $('#op-objective')?.value.trim(),

      notes:
        $('#op-notes')?.value.trim()

    });

  await dbPut(operation);

  state.opsList.unshift(
    operation
  );

  state.currentOp =
    operation;

  closeModal(
    'new-op-modal'
  );

  renderOperations();

  openEditor();

  toast(
    'Operation skapad.'
  );

}


/* ============================================================
   OPEN OPERATION
   ============================================================ */

function openOperation(id) {

  if (!currentUser) { toast('Logga in för att öppna en operation.'); return; }
  if (!hasPermission('tactical_plan')) { toast('Du saknar behörighet till Taktisk plan.'); return; }

  const operation =
    state.opsList.find(
      item => item.id === id
    );

  if (!operation) {

    toast(
      'Operationen kunde inte hittas.'
    );

    return;

  }

  state.currentOp =
    structuredClone(operation);

  normalizeOperationFloors(
    state.currentOp
  );

  state.currentFloorId =
    state.currentOp.activeFloorId ||
    state.currentOp.floors[0]?.id ||
    null;

  activateFloor(
    state.currentFloorId,
    {
      silent: true
    }
  );

  openEditor();

}


async function openEditor() {

  const appScreen =
    $('#app-screen');

  const startScreen =
    $('#start-screen');

  if (!state.currentOp) {
    toast('Ingen operation är vald.');
    return;
  }

  hide(startScreen);
  show(appScreen);

  // Some CSS versions use either .hidden or .active for screen visibility.
  // Make sure the editor is actually visible before measuring the map area.
  appScreen?.classList.add('active');
  appScreen?.classList.remove('portal-page-hidden');

  updateHeader();

  normalizeOperationFloors(state.currentOp);

  state.currentFloorId =
    state.currentOp.activeFloorId ||
    state.currentOp.floors[0]?.id ||
    null;

  activateFloor(state.currentFloorId, { silent: true });

  try {
    await ensureKonvaLoaded();
    initStage();
  } catch (error) {
    console.error('Tactical planner startup failed:', error);

    const container = $('#konva-container');
    if (container) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;color:#dbeafe;background:#0b1f3a;">
          <div>
            <strong style="display:block;font-size:18px;margin-bottom:8px;">Taktiska planeringen kunde inte starta kartmotorn.</strong>
            <span style="display:block;color:#9fb3c8;">Försök ladda om sidan. Om problemet kvarstår, öppna F12 → Console och skicka felet.</span>
          </div>
        </div>`;
    }
    toast('Taktisk planering startade utan kartmotorn.');
    return;
  }

  ensureFloorControls();
  renderFloorControls();
  renderOperationObjects();
  renderGroups();
  renderTimeline();
  updateNotes();
  resetHistory();

  if (state.currentOp?.map) {
    loadMapFromData(state.currentOp.map);
  } else {
    clearMap();
  }

  // Force one layout pass after the editor becomes visible so Konva gets
  // the real container size instead of a hidden/zero-sized measurement.
  requestAnimationFrame(() => {
    resizeStage();
    renderOperationObjects();
  });
}


async function ensureKonvaLoaded() {
  if (globalThis.Konva?.Stage) return;

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-mssrp-konva-loader]');
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error('Konva kunde inte laddas.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/konva@9.3.6/konva.min.js';
    script.async = true;
    script.dataset.mssrpKonvaLoader = '1';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Konva kunde inte laddas från CDN.'));
    document.head.appendChild(script);
  });

  if (!globalThis.Konva?.Stage) {
    throw new Error('Konva laddades men Stage saknas.');
  }
}



/* ============================================================
   CLOSE EDITOR
   ============================================================ */

function closeEditor() {

  saveCurrentOperation();

  hide(
    $('#app-screen')
  );

  show(
    $('#start-screen')
  );

  state.currentOp = null;

  state.currentFloorId = null;

  destroyStage();

  loadOperations();

}


/* ============================================================
   UPDATE HEADER
   ============================================================ */

function updateHeader() {

  const name =
    $('#header-op-name');

  const meta =
    $('#header-op-meta');

  if (!state.currentOp) return;

  if (name) {

    name.textContent =
      state.currentOp.name ||
      'Operation';

  }

  if (meta) {

    const pieces = [
      state.currentOp.number,
      state.currentOp.date,
      state.currentOp.location
    ].filter(Boolean);

    meta.textContent =
      pieces.join(' • ');

  }

}


/* ============================================================
   STAGE
   ============================================================ */

function initStage() {

  if (!globalThis.Konva?.Stage) {
    throw new Error('Konva är inte tillgängligt.');
  }

  const container =
    $('#konva-container');

  if (!container) return;

  destroyStage();

  const rect =
    container.getBoundingClientRect();

  state.stage =
    new Konva.Stage({

      container:
        container,

      width:
        rect.width,

      height:
        rect.height

    });

  state.layers.map =
    new Konva.Layer();

  state.layers.objects =
    new Konva.Layer();

  state.layers.selection =
    new Konva.Layer();

  state.stage.add(
    state.layers.map
  );

  state.stage.add(
    state.layers.objects
  );

  state.stage.add(
    state.layers.selection
  );

  setupStageEvents();

  window.addEventListener(
    'resize',
    resizeStage
  );

}


function destroyStage() {

  window.removeEventListener(
    'resize',
    resizeStage
  );

  if (state.stage) {

    state.stage.destroy();

  }

  state.stage = null;

  state.layers = {
    map: null,
    objects: null,
    selection: null
  };

}


function resizeStage() {

  if (!state.stage) return;

  const container =
    $('#konva-container');

  if (!container) return;

  const rect =
    container.getBoundingClientRect();

  state.stage.width(
    rect.width
  );

  state.stage.height(
    rect.height
  );

  redrawMap();

}


/* ============================================================
   STAGE EVENTS
   ============================================================ */

function setupStageEvents() {

  if (!state.stage) return;

  state.stage.on(
    'mousedown touchstart',
    handleStageDown
  );

  state.stage.on(
    'mousemove touchmove',
    handleStageMove
  );

  state.stage.on(
    'mouseup touchend',
    handleStageUp
  );

  state.stage.on(
    'click tap',
    handleStageClick
  );

  state.stage.on(
    'wheel',
    handleWheel
  );

}


/* ============================================================
   POINTER POSITION
   ============================================================ */

function pointerPosition() {

  if (!state.stage) {

    return {
      x: 0,
      y: 0
    };

  }

  return (
    state.stage.getPointerPosition() ||
    {
      x: 0,
      y: 0
    }
  );

}


/* ============================================================
   TOOL HANDLING
   ============================================================ */

function setTool(tool) {

  state.currentTool =
    tool;

  $$('.tool-btn').forEach(
    button => {

      button.classList.toggle(
        'active',
        button.dataset.tool === tool
      );

    }
  );

  if (state.stage) {

    state.stage.container().style.cursor =
      tool === 'pan'
        ? 'grab'
        : tool === 'select'
          ? 'default'
          : 'crosshair';

  }

}


function selectSymbol(symbol) {

  if (!SYMBOLS[symbol]) return;

  state.selectedSymbol =
    symbol;

  $$('.symbol-item').forEach(
    button => {

      button.classList.toggle(
        'selected',
        button.dataset.symbol === symbol
      );

    }
  );

}


/* ============================================================
   STAGE DOWN
   ============================================================ */

function handleStageDown(event) {

  const pointer =
    pointerPosition();

  if (
    state.currentTool ===
    'select'
  ) {

    return;

  }


  if (
    state.currentTool ===
    'pan'
  ) {

    state.dragStart = {
      x: pointer.x,
      y: pointer.y
    };

    return;

  }


  if (
    state.currentTool ===
    'symbol'
  ) {

    if (state.mapLocked) {

      toast(
        'Kartan är låst.'
      );

      return;

    }

    createSymbolAt(
      pointer.x,
      pointer.y
    );

    return;

  }


  if (
    state.currentTool ===
    'text'
  ) {

    createTextAt(
      pointer.x,
      pointer.y
    );

    return;

  }


  if (
    state.currentTool ===
    'freehand'
  ) {

    startFreehand(
      pointer
    );

    return;

  }


  if (
    [
      'line',
      'arrow',
      'path',
      'rect',
      'area',
      'circle'
    ].includes(
      state.currentTool
    )
  ) {

    startDrawing(
      pointer
    );

  }

}


/* ============================================================
   STAGE MOVE
   ============================================================ */

function handleStageMove() {

  const pointer =
    pointerPosition();

  updateCoordinates(
    pointer
  );


  if (
    state.currentTool ===
    'pan' &&
    state.dragStart
  ) {

    const dx =
      pointer.x -
      state.dragStart.x;

    const dy =
      pointer.y -
      state.dragStart.y;

    const layers = [
      state.layers.map,
      state.layers.objects
    ];

    layers.forEach(
      layer => {

        if (!layer) return;

        layer.x(
          layer.x() + dx
        );

        layer.y(
          layer.y() + dy
        );

      }
    );

    state.dragStart = {
      x: pointer.x,
      y: pointer.y
    };

    state.stage.batchDraw();

    return;

  }


  if (!state.isDrawing) return;

  updateDrawing(
    pointer
  );

}


/* ============================================================
   STAGE UP
   ============================================================ */

function handleStageUp() {

  if (
    state.currentTool ===
    'pan'
  ) {

    state.dragStart = null;

    return;

  }

  if (
    state.isDrawing
  ) {

    finishDrawing();

  }

}


/* ============================================================
   STAGE CLICK
   ============================================================ */

function handleStageClick(event) {

  const target =
    event.target;

  if (
    state.currentTool !==
    'select'
  ) {

    return;

  }

  if (
    target ===
    state.stage
  ) {

    clearSelection();

    return;

  }

  const objectId =
    target.getAttr(
      'objectId'
    );

  if (objectId) {

    selectObject(
      objectId
    );

  }

}


/* ============================================================
   COORDINATES
   ============================================================ */

function updateCoordinates(
  pointer
) {

  const display =
    $('#coords-display');

  if (!display) return;

  display.innerHTML = `
    X: ${Math.round(pointer.x)}
    <span>•</span>
    Y: ${Math.round(pointer.y)}
    <span>•</span>
    ZOOM: ${Math.round(state.zoom * 100)}%
  `;

}


/* ============================================================
   SYMBOL CREATION
   ============================================================ */

function createSymbolAt(
  x,
  y
) {

  if (!state.currentOp) return;

  const symbol =
    SYMBOLS[
      state.selectedSymbol
    ];

  if (!symbol) return;

  const object = {

    id:
      mssrpId(),

    type:
      'symbol',

    symbol:
      state.selectedSymbol,

    name:
      symbol.label,

    description:
      '',

    x,
    y,

    color:
      getDrawColor(symbol.color),

    opacity:
      getDrawOpacity(),

    rotation:
      0,

    scale:
      1

  };

  state.currentOp.objects.push(
    object
  );

  addSymbolNode(
    object
  );

  selectObject(
    object.id
  );

  pushHistory();

  scheduleSave();

}


/* ============================================================
   SYMBOL NODE
   ============================================================ */

function addSymbolNode(
  object
) {

  if (!state.layers.objects) return;

  const symbol =
    SYMBOLS[
      object.symbol
    ] || {
      label: object.name || 'Objekt',
      short: '?',
      color: '#64748b'
    };

  const group =
    new Konva.Group({

      x:
        object.x,

      y:
        object.y,

      draggable:
        !state.mapLocked,

      rotation:
        object.rotation || 0,

      scaleX:
        object.scale || 1,

      scaleY:
        object.scale || 1,

      id:
        object.id

    });

  group.setAttr(
    'objectId',
    object.id
  );

  const shadow =
    new Konva.Circle({

      radius:
        18,

      fill:
        'rgba(0,0,0,0.25)',

      shadowColor:
        'rgba(0,0,0,0.5)',

      shadowBlur:
        8,

      shadowOpacity:
        0.6,

      shadowOffsetY:
        3

    });

  const circle =
    new Konva.Circle({

      radius:
        15,

      fill:
        object.color ||
        symbol.color,

      stroke:
        '#dbeafe',

      strokeWidth:
        1.5,

      opacity:
        object.opacity ??
        1

    });

  const text =
    new Konva.Text({

      text:
        symbol.short,

      width:
        30,

      height:
        30,

      x:
        -15,

      y:
        -10,

      align:
        'center',

      verticalAlign:
        'middle',

      fontFamily:
        'Roboto Mono',

      fontSize:
        symbol.short.length > 2
          ? 7
          : 9,

      fontStyle:
        'bold',

      fill:
        '#ffffff',

      listening:
        false

    });

  group.add(
    shadow,
    circle,
    text
  );

  group.on(
    'click tap',
    event => {

      event.cancelBubble = true;

      selectObject(
        object.id
      );

    }
  );

  group.on(
    'dragend',
    () => {

      object.x =
        group.x();

      object.y =
        group.y();

      pushHistory();

      scheduleSave();

      renderProperties();

    }
  );

  state.layers.objects.add(
    group
  );

  state.layers.objects.batchDraw();

}


/* ============================================================
   TEXT
   ============================================================ */

function createTextAt(
  x,
  y
) {

  const value =
    prompt(
      'Ange text:'
    );

  if (!value) return;

  const object = {

    id:
      mssrpId(),

    type:
      'text',

    name:
      value,

    text:
      value,

    description:
      '',

    x,
    y,

    color:
      getDrawColor(),

    opacity:
      getDrawOpacity(),

    fontSize:
      18

  };

  state.currentOp.objects.push(
    object
  );

  addTextNode(
    object
  );

  selectObject(
    object.id
  );

  pushHistory();

  scheduleSave();

}


function addTextNode(
  object
) {

  const node =
    new Konva.Text({

      x:
        object.x,

      y:
        object.y,

      text:
        object.text ||
        object.name ||
        'Text',

      fontFamily:
        'Inter',

      fontSize:
        object.fontSize ||
        18,

      fontStyle:
        'bold',

      fill:
        object.color ||
        '#ffffff',

      opacity:
        object.opacity ??
        1,

      draggable:
        !state.mapLocked

    });

  node.setAttr(
    'objectId',
    object.id
  );

  node.on(
    'click tap',
    event => {

      event.cancelBubble = true;

      selectObject(
        object.id
      );

    }
  );

  node.on(
    'dragend',
    () => {

      object.x =
        node.x();

      object.y =
        node.y();

      pushHistory();

      scheduleSave();

    }
  );

  state.layers.objects.add(
    node
  );

  state.layers.objects.batchDraw();

}


/* ============================================================
   DRAWING
   ============================================================ */

function startDrawing(
  point
) {

  if (state.mapLocked) {

    toast(
      'Kartan är låst.'
    );

    return;

  }

  state.isDrawing = true;

  state.drawingNode = {
    x: point.x,
    y: point.y
  };

  state.tempPoints = [
    point.x,
    point.y
  ];

  const tool =
    state.currentTool;

  if (
    tool === 'line' ||
    tool === 'arrow' ||
    tool === 'path'
  ) {

    state.tempShape =
      new Konva.Line({

        points:
          state.tempPoints,

        stroke:
          getDrawColor(),

        strokeWidth:
          getStrokeWidth(),

        opacity:
          getDrawOpacity(),

        dash:
          getDash(),

        lineCap:
          'round',

        lineJoin:
          'round',

        tension:
          tool === 'path'
            ? 0.15
            : 0

      });

    if (tool === 'arrow') {

      state.tempShape =
        new Konva.Arrow({

          points:
            state.tempPoints,

          stroke:
            getDrawColor(),

          fill:
            getDrawColor(),

          strokeWidth:
            getStrokeWidth(),

          pointerLength:
            10,

          pointerWidth:
            10,

          opacity:
            getDrawOpacity(),

          dash:
            getDash(),

          lineCap:
            'round',

          lineJoin:
            'round'

        });

    }

    state.layers.objects.add(
      state.tempShape
    );

  }


  if (
    tool === 'freehand'
  ) {

    state.tempShape =
      new Konva.Line({

        points:
          state.tempPoints,

        stroke:
          getDrawColor(),

        strokeWidth:
          getStrokeWidth(),

        opacity:
          getDrawOpacity(),

        dash:
          getDash(),

        lineCap:
          'round',

        lineJoin:
          'round',

        tension:
          0.3

      });

    state.layers.objects.add(
      state.tempShape
    );

  }


  if (
    tool === 'rect'
  ) {

    state.tempShape =
      new Konva.Rect({

        x:
          point.x,

        y:
          point.y,

        width:
          0,

        height:
          0,

        stroke:
          getDrawColor(),

        strokeWidth:
          getStrokeWidth(),

        opacity:
          getDrawOpacity(),

        dash:
          getDash(),

        fill:
          hexToRgba(
            getDrawColor(),
            0.08
          )

      });

    state.layers.objects.add(
      state.tempShape
    );

  }


  if (
    tool === 'circle'
  ) {

    state.tempShape =
      new Konva.Circle({

        x:
          point.x,

        y:
          point.y,

        radius:
          0,

        stroke:
          getDrawColor(),

        strokeWidth:
          getStrokeWidth(),

        opacity:
          getDrawOpacity(),

        dash:
          getDash(),

        fill:
          hexToRgba(
            getDrawColor(),
            0.08
          )

      });

    state.layers.objects.add(
      state.tempShape
    );

  }


  if (
    tool === 'area'
  ) {

    state.tempShape =
      new Konva.Rect({

        x:
          point.x,

        y:
          point.y,

        width:
          0,

        height:
          0,

        stroke:
          getDrawColor(),

        strokeWidth:
          getStrokeWidth(),

        opacity:
          getDrawOpacity(),

        dash:
          getDash(),

        fill:
          hexToRgba(
            getDrawColor(),
            0.16
          )

      });

    state.layers.objects.add(
      state.tempShape
    );

  }

  state.layers.objects.batchDraw();

}


function startFreehand(
  point
) {

  if (state.mapLocked) {

    toast(
      'Kartan är låst.'
    );

    return;

  }

  state.isDrawing = true;

  state.tempPoints = [
    point.x,
    point.y
  ];

  state.tempShape =
    new Konva.Line({

      points:
        state.tempPoints,

      stroke:
        getDrawColor(),

      strokeWidth:
        getStrokeWidth(),

      opacity:
        getDrawOpacity(),

      dash:
        getDash(),

      lineCap:
        'round',

      lineJoin:
        'round',

      tension:
        0.25

    });

  state.layers.objects.add(
    state.tempShape
  );

}


function updateDrawing(
  point
) {

  if (!state.tempShape) return;

  const tool =
    state.currentTool;

  if (
    tool === 'line' ||
    tool === 'arrow' ||
    tool === 'path' ||
    tool === 'freehand'
  ) {

    state.tempPoints.push(
      point.x,
      point.y
    );

    state.tempShape.points(
      state.tempPoints
    );

  }


  if (
    tool === 'rect' ||
    tool === 'area'
  ) {

    const start =
      state.drawingNode;

    state.tempShape.x(
      Math.min(
        start.x,
        point.x
      )
    );

    state.tempShape.y(
      Math.min(
        start.y,
        point.y
      )
    );

    state.tempShape.width(
      Math.abs(
        point.x -
        start.x
      )
    );

    state.tempShape.height(
      Math.abs(
        point.y -
        start.y
      )
    );

  }


  if (
    tool === 'circle'
  ) {

    const start =
      state.drawingNode;

    const radius =
      Math.sqrt(
        Math.pow(
          point.x -
          start.x,
          2
        ) +
        Math.pow(
          point.y -
          start.y,
          2
        )
      );

    state.tempShape.radius(
      radius
    );

  }

  state.layers.objects.batchDraw();

}


function finishDrawing() {

  if (!state.isDrawing) return;

  state.isDrawing = false;

  if (
    !state.tempShape
  ) {

    return;

  }

  const node =
    state.tempShape;

  const object = {

    id:
      mssrpId(),

    type:
      state.currentTool,

    name:
      drawingToolLabel(
        state.currentTool
      ),

    description:
      '',

    color:
      getDrawColor(),

    opacity:
      getDrawOpacity(),

    strokeWidth:
      getStrokeWidth(),

    dashed:
      $('#draw-dashed')?.checked ||
      false

  };


  if (
    [
      'line',
      'arrow',
      'path',
      'freehand'
    ].includes(
      state.currentTool
    )
  ) {

    object.points =
      node.points();

  }


  if (
    [
      'rect',
      'area'
    ].includes(
      state.currentTool
    )
  ) {

    object.x =
      node.x();

    object.y =
      node.y();

    object.width =
      node.width();

    object.height =
      node.height();

  }


  if (
    state.currentTool ===
    'circle'
  ) {

    object.x =
      node.x();

    object.y =
      node.y();

    object.radius =
      node.radius();

  }

  node.destroy();

  state.currentOp.objects.push(
    object
  );

  addDrawingNode(
    object
  );

  state.tempShape = null;
  state.tempPoints = [];
  state.drawingNode = null;

  selectObject(
    object.id
  );

  pushHistory();

  scheduleSave();

}


function drawingToolLabel(
  tool
) {

  const labels = {

    line: 'Linje',

    arrow: 'Pil',

    path: 'Förflyttning',

    freehand: 'Frihand',

    rect: 'Rektangel',

    area: 'Område',

    circle: 'Cirkel'

  };

  return labels[tool] ||
    'Ritobjekt';

}


/* ============================================================
   DRAWING NODE
   ============================================================ */

function addDrawingNode(
  object
) {

  let node = null;

  const common = {

    stroke:
      object.color ||
      '#2563eb',

    strokeWidth:
      object.strokeWidth ||
      3,

    opacity:
      object.opacity ??
      1,

    dash:
      object.dashed
        ? [8, 6]
        : [],

    lineCap:
      'round',

    lineJoin:
      'round'

  };


  if (
    object.type === 'line' ||
    object.type === 'path' ||
    object.type === 'freehand'
  ) {

    node =
      new Konva.Line({

        points:
          object.points || [],

        ...common,

        tension:
          object.type === 'path' ||
          object.type === 'freehand'
            ? 0.15
            : 0

      });

  }


  if (
    object.type === 'arrow'
  ) {

    node =
      new Konva.Arrow({

        points:
          object.points || [],

        ...common,

        fill:
          object.color ||
          '#2563eb',

        pointerLength:
          10,

        pointerWidth:
          10

      });

  }


  if (
    object.type === 'rect' ||
    object.type === 'area'
  ) {

    node =
      new Konva.Rect({

        x:
          object.x || 0,

        y:
          object.y || 0,

        width:
          object.width || 0,

        height:
          object.height || 0,

        ...common,

        fill:
          hexToRgba(
            object.color ||
            '#2563eb',
            object.type === 'area'
              ? 0.16
              : 0.06
          )

      });

  }


  if (
    object.type === 'circle'
  ) {

    node =
      new Konva.Circle({

        x:
          object.x || 0,

        y:
          object.y || 0,

        radius:
          object.radius || 0,

        ...common,

        fill:
          hexToRgba(
            object.color ||
            '#2563eb',
            0.08
          )

      });

  }


  if (!node) return;

  node.setAttr(
    'objectId',
    object.id
  );

  node.on(
    'click tap',
    event => {

      event.cancelBubble = true;

      selectObject(
        object.id
      );

    }
  );

  state.layers.objects.add(
    node
  );

}


/* ============================================================
   SELECTION
   ============================================================ */

function selectObject(
  id
) {

  state.selectedObject =
    id;

  renderSelection();

  renderProperties();

  renderObjectList();

}


function clearSelection() {

  state.selectedObject =
    null;

  renderSelection();

  renderProperties();

  renderObjectList();

}


function renderSelection() {

  const layer =
    state.layers.selection;

  if (!layer) return;

  layer.destroyChildren();

  if (!state.selectedObject) {

    layer.batchDraw();

    return;

  }

  const object =
    state.currentOp?.objects.find(
      item =>
        item.id ===
        state.selectedObject
    );

  if (!object) {

    layer.batchDraw();

    return;

  }

  const node =
    findNodeByObjectId(
      object.id
    );

  if (!node) {

    layer.batchDraw();

    return;

  }

  const box =
    node.getClientRect();

  const rect =
    new Konva.Rect({

      x:
        box.x - 5,

      y:
        box.y - 5,

      width:
        box.width + 10,

      height:
        box.height + 10,

      stroke:
        '#60a5fa',

      strokeWidth:
        1,

      dash:
        [5, 4],

      listening:
        false

    });

  layer.add(
    rect
  );

  layer.batchDraw();

}


function findNodeByObjectId(
  id
) {

  if (!state.layers.objects) {

    return null;

  }

  let found = null;

  state.layers.objects.find(
    node => {

      if (
        node.getAttr(
          'objectId'
        ) === id
      ) {

        found = node;

        return true;

      }

      return false;

    }
  );

  return found;

}


/* ============================================================
   RENDER OBJECTS
   ============================================================ */

function renderOperationObjects() {

  if (!state.currentOp) return;

  if (!state.layers.objects) return;

  state.layers.objects.destroyChildren();

  state.currentOp.objects.forEach(
    object => {

      if (
        object.type ===
        'symbol'
      ) {

        addSymbolNode(
          object
        );

      } else if (
        object.type ===
        'text'
      ) {

        addTextNode(
          object
        );

      } else {

        addDrawingNode(
          object
        );

      }

    }
  );

  state.layers.objects.batchDraw();

  renderObjectList();

}


function renderObjectList() {

  const list =
    $('#objects-list');

  const count =
    $('#object-count');

  if (!list) return;

  list.innerHTML = '';

  const objects =
    state.currentOp?.objects ||
    [];

  if (count) {

    count.textContent =
      objects.length;

  }

  if (!objects.length) {

    list.innerHTML = `
      <div class="list-empty">
        Inga objekt placerade på kartan.
      </div>
    `;

    return;

  }

  objects.forEach(
    object => {

      const item =
        document.createElement(
          'div'
        );

      item.className =
        'object-item';

      if (
        object.id ===
        state.selectedObject
      ) {

        item.classList.add(
          'selected'
        );

      }

      const icon =
        object.type === 'symbol'
          ? (
              SYMBOLS[
                object.symbol
              ]?.short ||
              '?'
            )
          : (
              object.type === 'text'
                ? 'T'
                : '✎'
            );

      const title =
        object.name ||
        SYMBOLS[
          object.symbol
        ]?.label ||
        drawingToolLabel(
          object.type
        ) ||
        'Objekt';

      item.innerHTML = `

        <div class="object-icon">
          ${escapeHtml(icon)}
        </div>

        <div class="object-info">

          <div class="object-name">
            ${escapeHtml(title)}
          </div>

          <div class="object-type">
            ${escapeHtml(
              object.type
            )}
          </div>

        </div>

        <div class="object-actions">

          <button
            class="object-action"
            data-object-action="edit"
            title="Redigera"
          >
            ✎
          </button>

          <button
            class="object-action"
            data-object-action="delete"
            title="Ta bort"
          >
            ×
          </button>

        </div>
      `;

      item.addEventListener(
        'click',
        event => {

          const action =
            event.target.closest(
              '[data-object-action]'
            );

          if (action) {

            event.stopPropagation();

            if (
              action.dataset.objectAction ===
              'edit'
            ) {

              editObject(
                object.id
              );

            }

            if (
              action.dataset.objectAction ===
              'delete'
            ) {

              deleteObject(
                object.id
              );

            }

            return;

          }

          selectObject(
            object.id
          );

        }
      );

      list.appendChild(
        item
      );

    }
  );

}


/* ============================================================
   PROPERTIES
   ============================================================ */

function renderProperties() {

  const container =
    $('#props-content');

  if (!container) return;

  const object =
    state.currentOp?.objects.find(
      item =>
        item.id ===
        state.selectedObject
    );

  if (!object) {

    container.innerHTML = `

      <div class="empty-panel">

        <div class="empty-panel-icon">
          ◇
        </div>

        <strong>
          Inget objekt markerat
        </strong>

        <span>
          Markera ett objekt på kartan för att visa dess egenskaper.
        </span>

      </div>

    `;

    return;

  }

  const label =
    object.type === 'symbol'
      ? (
          SYMBOLS[
            object.symbol
          ]?.label ||
          object.name
        )
      : object.name;

  container.innerHTML = `

    <div class="property-grid">

      <div class="property-field full">

        <label>
          NAMN
        </label>

        <input
          id="property-name"
          value="${escapeHtml(
            object.name || label || ''
          )}"
        >

      </div>


      <div class="property-field">

        <label>
          TYP
        </label>

        <input
          value="${escapeHtml(
            object.type || ''
          )}"
          disabled
        >

      </div>


      ${
        object.type === 'symbol'
          ? `
            <div class="property-field">

              <label>
                SYMBOL
              </label>

              <input
                value="${escapeHtml(
                  SYMBOLS[
                    object.symbol
                  ]?.label ||
                  object.symbol ||
                  ''
                )}"
                disabled
              >

            </div>
          `
          : ''
      }


      <div class="property-field full">

        <label>
          BESKRIVNING
        </label>

        <textarea
          id="property-description"
        >${escapeHtml(
          object.description || ''
        )}</textarea>

      </div>

    </div>

    <button
      id="property-save"
      class="btn btn-primary property-save"
    >
      SPARA EGENSKAPER
    </button>

  `;

  $('#property-save')?.addEventListener(
    'click',
    () => {

      const name =
        $('#property-name')?.value.trim();

      const description =
        $('#property-description')?.value.trim();

      object.name =
        name ||
        label ||
        'Objekt';

      object.description =
        description || '';

      pushHistory();

      scheduleSave();

      renderProperties();

      renderObjectList();

      toast(
        'Egenskaper sparade.'
      );

    }
  );

}


/* ============================================================
   EDIT OBJECT MODAL
   ============================================================ */

function editObject(
  id
) {

  const object =
    state.currentOp?.objects.find(
      item =>
        item.id === id
    );

  if (!object) return;

  state.editingObjectId =
    id;

  const name =
    $('#edit-obj-name');

  const description =
    $('#edit-obj-desc');

  if (name) {

    name.value =
      object.name || '';

  }

  if (description) {

    description.value =
      object.description || '';

  }

  showModal(
    'edit-object-modal'
  );

}


function saveEditedObject() {

  const object =
    state.currentOp?.objects.find(
      item =>
        item.id ===
        state.editingObjectId
    );

  if (!object) {

    closeModal(
      'edit-object-modal'
    );

    return;

  }

  object.name =
    $('#edit-obj-name')?.value.trim() ||
    object.name;

  object.description =
    $('#edit-obj-desc')?.value.trim() ||
    '';

  closeModal(
    'edit-object-modal'
  );

  pushHistory();

  scheduleSave();

  renderObjectList();

  renderProperties();

  toast(
    'Objekt uppdaterat.'
  );

}


function deleteObject(
  id
) {

  const index =
    state.currentOp?.objects.findIndex(
      object =>
        object.id === id
    );

  if (
    index === undefined ||
    index < 0
  ) {

    return;

  }

  state.currentOp.objects.splice(
    index,
    1
  );

  if (
    state.selectedObject === id
  ) {

    state.selectedObject = null;

  }

  const node =
    findNodeByObjectId(
      id
    );

  if (node) {

    node.destroy();

  }

  pushHistory();

  scheduleSave();

  renderObjectList();

  renderProperties();

  renderSelection();

  toast(
    'Objekt borttaget.'
  );

}


/* ============================================================
   MAP
   ============================================================ */

function loadMapFromData(
  data
) {

  if (!data) {

    clearMap();

    return;

  }

  state.mapLocked =
    Boolean(
      state.currentOp?.mapLocked
    );

  const image =
    new Image();

  image.onload = () => {

    state.mapImage =
      image;

    drawMapImage();

    updateMapUI();

  };

  image.onerror = () => {

    toast(
      'Kartan kunde inte läsas.'
    );

    clearMap();

  };

  image.src =
    data.data ||
    data.src ||
    data;

}


function drawMapImage() {

  if (
    !state.stage ||
    !state.layers.map ||
    !state.mapImage
  ) {

    return;

  }

  state.layers.map.destroyChildren();

  const image =
    state.mapImage;

  const stageWidth =
    state.stage.width();

  const stageHeight =
    state.stage.height();

  const imageRatio =
    image.width /
    image.height;

  const stageRatio =
    stageWidth /
    stageHeight;

  let width;
  let height;

  if (
    imageRatio >
    stageRatio
  ) {

    width =
      stageWidth * 0.9;

    height =
      width /
      imageRatio;

  } else {

    height =
      stageHeight * 0.9;

    width =
      height *
      imageRatio;

  }

  const x =
    (stageWidth - width) / 2;

  const y =
    (stageHeight - height) / 2;

  const node =
    new Konva.Image({

      image,

      x,

      y,

      width,

      height,

      listening:
        false,

      opacity:
        0.96

    });

  state.layers.map.add(
    node
  );

  state.layers.map.batchDraw();

  renderOperationObjects();

}


function redrawMap() {

  if (
    state.mapImage
  ) {

    drawMapImage();

  }

  renderSelection();

}


function clearMap() {

  state.mapImage = null;

  if (
    state.layers.map
  ) {

    state.layers.map.destroyChildren();

    state.layers.map.batchDraw();

  }

  updateMapUI();

}


function updateMapUI() {

  const status =
    $('#map-status');

  const upload =
    $('#btn-upload-map');

  const change =
    $('#btn-change-map');

  const lock =
    $('#btn-lock-map');

  const empty =
    $('#map-empty-state');

  if (state.mapImage) {

    if (status) {

      status.textContent =
        state.mapLocked
          ? 'Karta låst'
          : 'Karta aktiv';

    }

    if (upload) hide(upload);

    if (change) show(change);

    if (lock) {

      lock.textContent =
        state.mapLocked
          ? 'LÅS UPP KARTA'
          : 'LÅS KARTA';

    }

    if (empty) hide(empty);

  } else {

    if (status) {

      status.textContent =
        'Ingen karta uppladdad';

    }

    if (upload) show(upload);

    if (change) hide(change);

    if (lock) {

      lock.textContent =
        'LÅS KARTA';

    }

    if (empty) show(empty);

  }

}


/* ============================================================
   MAP UPLOAD
   ============================================================ */

function handleMapUpload(
  event
) {

  const file =
    event.target.files?.[0];

  if (!file) return;

  if (state.mapLocked) {

    toast(
      'Lås upp kartan innan du byter den.'
    );

    event.target.value = '';

    return;

  }

  const reader =
    new FileReader();

  reader.onload = () => {

    state.currentOp.map = {

      name:
        file.name,

      type:
        file.type,

      data:
        reader.result

    };

    state.currentOp.mapLocked =
      false;

    state.mapLocked =
      false;

    loadMapFromData(
      state.currentOp.map
    );

    pushHistory();

    scheduleSave();

    toast(
      'Karta uppladdad.'
    );

  };

  reader.readAsDataURL(
    file
  );

  event.target.value = '';

}


/* ============================================================
   LOCK MAP
   ============================================================ */

function toggleMapLock() {

  if (!state.mapImage) {

    toast(
      'Ladda upp en karta först.'
    );

    return;

  }

  state.mapLocked =
    !state.mapLocked;

  state.currentOp.mapLocked =
    state.mapLocked;

  if (
    state.layers.objects
  ) {

    state.layers.objects.children.forEach(
      node => {

        if (
          node.draggable
        ) {

          node.draggable(
            !state.mapLocked
          );

        }

      }
    );

  }

  updateMapUI();

  scheduleSave();

  toast(
    state.mapLocked
      ? 'Kartan är låst.'
      : 'Kartan är upplåst.'
  );

}


/* ============================================================
   ZOOM
   ============================================================ */

function setZoom(
  value
) {

  state.zoom =
    Math.max(
      0.25,
      Math.min(
        3,
        value
      )
    );

  const stage =
    state.stage;

  if (!stage) return;

  const center = {
    x:
      stage.width() / 2,

    y:
      stage.height() / 2
  };

  const oldScale =
    stage.scaleX();

  const scale =
    state.zoom;

  const mousePointTo =
    {
      x:
        (center.x -
          stage.x()) /
        oldScale,

      y:
        (center.y -
          stage.y()) /
        oldScale
    };

  stage.scale({
    x:
      scale,

    y:
      scale
  });

  stage.position({
    x:
      center.x -
      mousePointTo.x *
        scale,

    y:
      center.y -
      mousePointTo.y *
        scale
  });

  updateZoomDisplay();

}


function updateZoomDisplay() {

  const display =
    $('.zoom-display');

  if (display) {

    display.textContent =
      `${Math.round(
        state.zoom * 100
      )}%`;

  }

  const coords =
    $('#coords-display');

  if (coords) {

    const match =
      coords.textContent;

    if (match) {

      coords.innerHTML =
        coords.innerHTML.replace(
          /ZOOM:\s*\d+%/,
          `ZOOM: ${Math.round(
            state.zoom * 100
          )}%`
        );

    }

  }

}


function handleWheel(
  event
) {

  event.evt.preventDefault();

  const oldScale =
    state.stage.scaleX();

  const pointer =
    state.stage.getPointerPosition();

  const scaleBy =
    1.08;

  const direction =
    event.evt.deltaY > 0
      ? -1
      : 1;

  const newScale =
    direction > 0
      ? oldScale * scaleBy
      : oldScale / scaleBy;

  state.zoom =
    Math.max(
      0.25,
      Math.min(
        3,
        newScale
      )
    );

  const mousePointTo =
    {
      x:
        (pointer.x -
          state.stage.x()) /
        oldScale,

      y:
        (pointer.y -
          state.stage.y()) /
        oldScale
    };

  state.stage.scale({
    x:
      state.zoom,

    y:
      state.zoom
  });

  state.stage.position({
    x:
      pointer.x -
      mousePointTo.x *
        state.zoom,

    y:
      pointer.y -
      mousePointTo.y *
        state.zoom

  });

  updateZoomDisplay();

}


function resetZoom() {

  if (!state.stage) return;

  state.zoom = 1;

  state.stage.scale({
    x: 1,
    y: 1
  });

  state.stage.position({
    x: 0,
    y: 0
  });

  updateZoomDisplay();

}


function fitMap() {

  if (!state.stage || !state.mapImage) {

    resetZoom();

    return;

  }

  resetZoom();

  const stageWidth =
    state.stage.width();

  const stageHeight =
    state.stage.height();

  const imageRatio =
    state.mapImage.width /
    state.mapImage.height;

  const stageRatio =
    stageWidth /
    stageHeight;

  let width;
  let height;

  if (
    imageRatio >
    stageRatio
  ) {

    width =
      stageWidth * 0.9;

    height =
      width /
      imageRatio;

  } else {

    height =
      stageHeight * 0.9;

    width =
      height *
      imageRatio;

  }

  const scale =
    Math.min(
      stageWidth / width,
      stageHeight / height
    );

  state.zoom =
    Math.max(
      0.25,
      Math.min(
        3,
        scale
      )
    );

  state.stage.scale({
    x:
      state.zoom,

    y:
      state.zoom
  });

  updateZoomDisplay();

}


/* ============================================================
   UNDO / REDO
   ============================================================ */

function getSerializableState() {

  if (!state.currentOp) {

    return null;

  }

  return structuredClone(
    state.currentOp
  );

}


function resetHistory() {

  state.history = [];

  state.historyIndex = -1;

  const snapshot =
    getSerializableState();

  if (snapshot) {

    state.history.push(
      snapshot
    );

    state.historyIndex = 0;

  }

  updateUndoRedoUI();

}


function pushHistory() {

  if (
    state.suppressSave ||
    !state.currentOp
  ) {

    return;

  }

  const snapshot =
    getSerializableState();

  state.history =
    state.history.slice(
      0,
      state.historyIndex + 1
    );

  state.history.push(
    snapshot
  );

  if (
    state.history.length >
    60
  ) {

    state.history.shift();

  }

  state.historyIndex =
    state.history.length - 1;

  updateUndoRedoUI();

}


function undo() {

  if (
    state.historyIndex <= 0
  ) {

    return;

  }

  state.historyIndex--;

  restoreHistorySnapshot(
    state.history[
      state.historyIndex
    ]
  );

}


function redo() {

  if (
    state.historyIndex >=
    state.history.length - 1
  ) {

    return;

  }

  state.historyIndex++;

  restoreHistorySnapshot(
    state.history[
      state.historyIndex
    ]
  );

}


function restoreHistorySnapshot(
  snapshot
) {

  if (!snapshot) return;

  state.suppressSave =
    true;

  state.currentOp =
    structuredClone(
      snapshot
    );

  normalizeOperationFloors(
    state.currentOp
  );

  state.currentFloorId =
    state.currentOp.activeFloorId ||
    state.currentOp.floors[0]?.id ||
    null;

  activateFloor(
    state.currentFloorId,
    {
      silent: true
    }
  );

  state.mapLocked =
    Boolean(
      state.currentOp.mapLocked
    );

  updateHeader();
  renderFloorControls();

  renderOperationObjects();

  renderGroups();

  renderTimeline();

  updateNotes();

  if (state.currentOp.map) {

    loadMapFromData(
      state.currentOp.map
    );

  } else {

    clearMap();

  }

  clearSelection();

  updateMapUI();

  state.suppressSave =
    false;

  scheduleSave();

  updateUndoRedoUI();

}


function updateUndoRedoUI() {

  const undoButton =
    $('#btn-undo');

  const redoButton =
    $('#btn-redo');

  if (undoButton) {

    undoButton.disabled =
      state.historyIndex <= 0;

    undoButton.style.opacity =
      undoButton.disabled
        ? '0.4'
        : '1';

  }

  if (redoButton) {

    redoButton.disabled =
      state.historyIndex >=
      state.history.length - 1;

    redoButton.style.opacity =
      redoButton.disabled
        ? '0.4'
        : '1';

  }

}


/* ============================================================
   GROUPS
   ============================================================ */

function renderGroups() {

  const list =
    $('#groups-list');

  if (!list) return;

  list.innerHTML = '';

  const groups =
    state.currentOp?.groups ||
    [];

  if (!groups.length) {

    list.innerHTML = `
      <div class="list-empty">
        Inga insatsgrupper skapade.
      </div>
    `;

    return;

  }

  groups.forEach(
    (group, index) => {

      const item =
        document.createElement(
          'div'
        );

      item.className =
        'stack-item';

      item.innerHTML = `

        <div class="object-icon">
          ${escapeHtml(
            group.short ||
            'G'
          )}
        </div>

        <div class="stack-item-main">

          <div class="stack-item-title">
            ${escapeHtml(
              group.name ||
              `Grupp ${index + 1}`
            )}
          </div>

          <div class="stack-item-sub">
            ${escapeHtml(
              group.role ||
              'Ingen roll angiven'
            )}
          </div>

        </div>

        <button
          class="object-action"
          data-delete-group="${escapeHtml(
            group.id
          )}"
        >
          ×
        </button>

      `;

      item.querySelector(
        '[data-delete-group]'
      )?.addEventListener(
        'click',
        event => {

          event.stopPropagation();

          deleteGroup(
            group.id
          );

        }
      );

      list.appendChild(
        item
      );

    }
  );

}


function addGroup() {

  if (!state.currentOp) return;

  const name =
    prompt(
      'Gruppnamn:',
      `Grupp ${
        state.currentOp.groups.length + 1
      }`
    );

  if (!name) return;

  const role =
    prompt(
      'Roll:',
      'Polis'
    ) || '';

  const short =
    prompt(
      'Kortnamn:',
      'G'
    ) || 'G';

  state.currentOp.groups.push({

    id:
      mssrpId(),

    name:
      name.trim(),

    role:
      role.trim(),

    short:
      short.trim().slice(0, 3)

  });

  renderGroups();

  pushHistory();

  scheduleSave();

}


function deleteGroup(
  id
) {

  const index =
    state.currentOp.groups.findIndex(
      group =>
        group.id === id
    );

  if (index < 0) return;

  state.currentOp.groups.splice(
    index,
    1
  );

  renderGroups();

  pushHistory();

  scheduleSave();

}


/* ============================================================
   TIMELINE
   ============================================================ */

function renderTimeline() {

  const list =
    $('#timeline-list');

  if (!list) return;

  list.innerHTML = '';

  const timeline =
    state.currentOp?.timeline ||
    [];

  if (!timeline.length) {

    list.innerHTML = `
      <div class="list-empty">
        Inga händelser i tidslinjen.
      </div>
    `;

    return;

  }

  timeline.forEach(
    event => {

      const item =
        document.createElement(
          'div'
        );

      item.className =
        'stack-item';

      item.innerHTML = `

        <div class="stack-item-time">
          ${escapeHtml(
            event.time ||
            '--:--'
          )}
        </div>

        <div class="stack-item-main">

          <div class="stack-item-title">
            ${escapeHtml(
              event.title ||
              'Händelse'
            )}
          </div>

          <div class="stack-item-sub">
            ${escapeHtml(
              event.description ||
              ''
            )}
          </div>

        </div>

        <button
          class="object-action"
          data-delete-timeline="${escapeHtml(
            event.id
          )}"
        >
          ×
        </button>

      `;

      item.querySelector(
        '[data-delete-timeline]'
      )?.addEventListener(
        'click',
        eventClick => {

          eventClick.stopPropagation();

          deleteTimelineEvent(
            event.id
          );

        }
      );

      list.appendChild(
        item
      );

    }
  );

}


function addTimelineEvent() {

  if (!state.currentOp) return;

  const time =
    prompt(
      'Tid:',
      '20:00'
    );

  if (!time) return;

  const title =
    prompt(
      'Händelse:',
      'Insats start'
    );

  if (!title) return;

  const description =
    prompt(
      'Beskrivning:',
      ''
    ) || '';

  state.currentOp.timeline.push({

    id:
      mssrpId(),

    time:
      time.trim(),

    title:
      title.trim(),

    description:
      description.trim()

  });

  state.currentOp.timeline.sort(
    compareTimeline
  );

  renderTimeline();

  pushHistory();

  scheduleSave();

}


function compareTimeline(
  a,
  b
) {

  return String(
    a.time || ''
  ).localeCompare(
    String(
      b.time || ''
    )
  );

}


function deleteTimelineEvent(
  id
) {

  const index =
    state.currentOp.timeline.findIndex(
      event =>
        event.id === id
    );

  if (index < 0) return;

  state.currentOp.timeline.splice(
    index,
    1
  );

  renderTimeline();

  pushHistory();

  scheduleSave();

}


/* ============================================================
   NOTES
   ============================================================ */

function updateNotes() {

  const textarea =
    $('#op-notes-panel');

  if (!textarea) return;

  textarea.value =
    state.currentOp?.notes ||
    '';

}


function saveNotes() {

  if (!state.currentOp) return;

  const textarea =
    $('#op-notes-panel');

  if (!textarea) return;

  state.currentOp.notes =
    textarea.value;

  scheduleSave();

}


/* ============================================================
   SAVE
   ============================================================ */

function scheduleSave() {

  if (
    state.suppressSave ||
    !state.currentOp
  ) {

    return;

  }

  clearTimeout(
    state.saveTimer
  );

  state.saveTimer =
    setTimeout(
      () => {
        saveCurrentOperation();
      },
      500
    );

}


async function saveCurrentOperation() {

  if (!state.currentOp) return;

  normalizeOperationFloors(
    state.currentOp
  );

  syncCurrentFloorToOperation();

  state.currentOp.updatedAt =
    new Date().toISOString();

  try {

    await dbPut(
      state.currentOp
    );

    const index =
      state.opsList.findIndex(
        item =>
          item.id ===
          state.currentOp.id
      );

    if (index >= 0) {

      state.opsList[index] =
        structuredClone(
          state.currentOp
        );

    } else {

      state.opsList.unshift(
        structuredClone(
          state.currentOp
        )
      );

    }

    updateSaveIndicator();

    if (currentUser) {

      await saveToSupabase();

    }

  } catch (error) {

    console.error(
      'Save failed:',
      error
    );

    toast(
      'Kunde inte spara operationen.'
    );

  }

}


function updateSaveIndicator() {

  const indicator =
    $('.save-indicator');

  if (!indicator) return;

  indicator.innerHTML = `
    <span class="status-dot"></span>
    <span>LOKALT SPARAD</span>
  `;

}


/* ============================================================
   SUPABASE SAVE
   ============================================================ */

async function saveToSupabase() {

  if (
    !currentUser ||
    !state.currentOp
  ) {

    return;

  }

  try {

    const payload = {

      user_id:
        currentUser.id,

      operation_id:
        state.currentOp.id,

      data:
        state.currentOp,

      updated_at:
        state.currentOp.updatedAt

    };

    const {
      error
    } =
      await supabase
        .from('operations')
        .upsert(
          payload,
          {
            onConflict:
              'user_id,operation_id'
          }
        );

    if (error) {

      console.warn(
        'Supabase save:',
        error.message
      );

    }

  } catch (error) {

    console.warn(
      'Supabase save failed:',
      error
    );

  }

}


/* ============================================================
   DELETE OPERATION
   ============================================================ */

function confirmDeleteOperation(
  id
) {

  const operation =
    state.opsList.find(
      item =>
        item.id === id
    );

  if (!operation) return;

  $('#confirm-title').textContent =
    'Ta bort operation?';

  $('#confirm-message').textContent =
    `Är du säker på att du vill ta bort "${operation.name}"? Detta går inte att ångra.`;

  state.confirmAction =
    async () => {

      await dbDelete(
        id
      );

      state.opsList =
        state.opsList.filter(
          item =>
            item.id !== id
        );

      renderOperations();

      closeModal(
        'confirm-modal'
      );

      toast(
        'Operationen har tagits bort.'
      );

    };

  showModal(
    'confirm-modal'
  );

}


/* ============================================================
   EXPORT PNG / JPG
   ============================================================ */

function exportImage(
  format
) {

  if (!state.stage) return;

  const oldSelection =
    state.layers.selection
      ?.visible();

  if (
    state.layers.selection
  ) {

    state.layers.selection.visible(
      false
    );

  }

  state.stage.toDataURL({

    pixelRatio:
      2,

    mimeType:
      format === 'jpg'
        ? 'image/jpeg'
        : 'image/png',

    quality:
      0.95,

    callback:
      dataURL => {

        if (
          state.layers.selection
        ) {

          state.layers.selection.visible(
            oldSelection
          );

        }

        const filename =
          sanitizeFilename(
            state.currentOp?.name ||
            'erlc-operation'
          );

        downloadDataURL(
          dataURL,
          `${filename}.${format}`
        );

        toast(
          `Kartan exporterades som ${format.toUpperCase()}.`
        );

      }

  });

}


/* ============================================================
   EXPORT ERLCPLAN
   ============================================================ */

function exportPlan() {

  if (!state.currentOp) return;

  const payload = {

    format:
      'mssrpplan',

    version:
      2,

    application:
      'MSSRP Taktisk Planerare',

    exportedAt:
      new Date().toISOString(),

    operation:
      state.currentOp

  };

  const blob =
    new Blob(
      [
        JSON.stringify(
          payload,
          null,
          2
        )
      ],
      {
        type:
          'application/json'
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const a =
    document.createElement(
      'a'
    );

  a.href =
    url;

  a.download =
    `${sanitizeFilename(
      state.currentOp.name
    )}.mssrpplan`;

  a.click();

  URL.revokeObjectURL(
    url
  );

  toast(
    'Operation exporterad.'
  );

}


/* ============================================================
   IMPORT ERLCPLAN
   ============================================================ */

async function importPlan(
  event
) {

  const file =
    event.target.files?.[0];

  if (!file) return;

  try {

    const text =
      await file.text();

    const payload =
      JSON.parse(
        text
      );

    const operation =
      payload.operation ||
      payload;

    if (
      !operation ||
      typeof operation !==
      'object'
    ) {

      throw new Error(
        'Ogiltig operationsfil.'
      );

    }

    const imported =
      createDefaultOperation(
        operation
      );

    imported.id =
      mssrpId();

    imported.createdAt =
      new Date().toISOString();

    imported.updatedAt =
      new Date().toISOString();

    await dbPut(
      imported
    );

    state.opsList.unshift(
      imported
    );

    renderOperations();

    toast(
      'Operation importerad.'
    );

  } catch (error) {

    console.error(error);

    toast(
      'Kunde inte importera filen.'
    );

  }

  event.target.value = '';

}


/* ============================================================
   DOWNLOAD HELPERS
   ============================================================ */

function downloadDataURL(
  dataURL,
  filename
) {

  const a =
    document.createElement(
      'a'
    );

  a.href =
    dataURL;

  a.download =
    filename;

  document.body.appendChild(
    a
  );

  a.click();

  a.remove();

}


function sanitizeFilename(
  name
) {

  return String(
    name || 'export'
  )
    .replace(
      /[<>:"/\\|?*\x00-\x1F]/g,
      '_'
    )
    .replace(
      /\s+/g,
      '_'
    )
    .slice(
      0,
      100
    );

}


/* ============================================================
   DRAW SETTINGS
   ============================================================ */

function getDrawColor(
  fallback = '#2563eb'
) {

  return (
    $('#draw-color')?.value ||
    fallback
  );

}


function getStrokeWidth() {

  return Number(
    $('#stroke-width')?.value ||
    3
  );

}


function getDrawOpacity() {

  return (
    Number(
      $('#draw-opacity')?.value ||
      100
    ) / 100
  );

}


function getDash() {

  return $('#draw-dashed')?.checked
    ? [8, 6]
    : [];

}


function hexToRgba(
  hex,
  alpha
) {

  const value =
    String(hex)
      .replace(
        '#',
        ''
      );

  if (
    value.length !== 6
  ) {

    return `rgba(37,99,235,${alpha})`;

  }

  const r =
    parseInt(
      value.slice(0, 2),
      16
    );

  const g =
    parseInt(
      value.slice(2, 4),
      16
    );

  const b =
    parseInt(
      value.slice(4, 6),
      16
    );

  return `rgba(${r},${g},${b},${alpha})`;

}


/* ============================================================
   KEYBOARD SHORTCUTS
   ============================================================ */

function handleKeyboard(
  event
) {

  const target =
    event.target;

  const typing =
    target &&
    (
      target.tagName ===
        'INPUT' ||
      target.tagName ===
        'TEXTAREA' ||
      target.tagName ===
        'SELECT' ||
      target.isContentEditable
    );


  if (
    event.ctrlKey &&
    event.key.toLowerCase() ===
      'z'
  ) {

    if (typing) return;

    event.preventDefault();

    undo();

    return;

  }


  if (
    event.ctrlKey &&
    event.key.toLowerCase() ===
      'y'
  ) {

    if (typing) return;

    event.preventDefault();

    redo();

    return;

  }


  if (typing) return;


  if (
    event.key ===
    'Delete' ||
    event.key ===
    'Backspace'
  ) {

    if (
      state.selectedObject
    ) {

      deleteObject(
        state.selectedObject
      );

    }

    return;

  }


  const key =
    event.key.toLowerCase();

  const shortcuts = {

    v: 'select',

    p: 'pan',

    s: 'symbol',

    t: 'text',

    l: 'line',

    a: 'arrow',

    g: 'path',

    f: 'freehand',

    r: 'rect',

    o: 'area',

    c: 'circle'

  };

  if (
    shortcuts[key]
  ) {

    setTool(
      shortcuts[key]
    );

  }


  if (
    event.key ===
    'Escape'
  ) {

    clearSelection();

  }

}


/* ============================================================
   EVENT BINDINGS
   ============================================================ */

function bindEvents() {

  /* ------------------------------
     AUTH
  ------------------------------ */

  $('#gate-login')?.addEventListener('click', () => submitGateAuth('login'));
  $('#gate-signup')?.addEventListener('click', () => submitGateAuth('signup'));
  $('#gate-password')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') submitGateAuth('login');
  });

  $('#btn-login')?.addEventListener(
    'click',
    () => {

      isLoginMode = true;

      updateAuthModal();

      showModal(
        'auth-modal'
      );

    }
  );


  $('#auth-toggle')?.addEventListener(
    'click',
    event => {

      event.preventDefault();

      isLoginMode =
        !isLoginMode;

      updateAuthModal();

    }
  );


  $('#btn-auth-submit')?.addEventListener(
    'click',
    submitAuth
  );


  $('#btn-logout')?.addEventListener(
    'click',
    logout
  );


  /* ------------------------------
     START SCREEN
  ------------------------------ */

  $('#btn-new-op')?.addEventListener(
    'click',
    openNewOperationModal
  );


  $('#btn-open-op')?.addEventListener(
    'click',
    () => {

      const section =
        document.querySelector(
          '.saved-ops-section'
        );

      section?.scrollIntoView({
        behavior:
          'smooth'
      });

    }
  );


  $('#new-op-form')?.addEventListener(
    'submit',
    createOperationFromForm
  );


  /* ------------------------------
     EDITOR
  ------------------------------ */

  $('#btn-back-home')?.addEventListener(
    'click',
    closeEditor
  );


  $('#btn-save')?.addEventListener(
    'click',
    async () => {

      await saveCurrentOperation();

      toast(
        'Operation sparad.'
      );

    }
  );


  $('#btn-undo')?.addEventListener(
    'click',
    undo
  );


  $('#btn-redo')?.addEventListener(
    'click',
    redo
  );


  $('#btn-zoom-in')?.addEventListener(
    'click',
    () => {

      setZoom(
        state.zoom * 1.15
      );

    }
  );


  $('#btn-zoom-out')?.addEventListener(
    'click',
    () => {

      setZoom(
        state.zoom / 1.15
      );

    }
  );


  $('#btn-zoom-reset')?.addEventListener(
    'click',
    resetZoom
  );


  $('#btn-zoom-fit')?.addEventListener(
    'click',
    fitMap
  );


  /* ------------------------------
     EXPORT
  ------------------------------ */

  $('#btn-export-menu')?.addEventListener(
    'click',
    event => {

      event.stopPropagation();

      $('#export-dropdown')?.classList.toggle(
        'hidden'
      );

    }
  );


  $$('[data-export]').forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          hide(
            $('#export-dropdown')
          );

          const type =
            button.dataset.export;

          if (type === 'png') {

            exportImage(
              'png'
            );

          }

          if (type === 'jpg') {

            exportImage(
              'jpg'
            );

          }

          if (
            type ===
            'mssrpplan'
          ) {

            exportPlan();

          }

        }
      );

    }
  );


  $$('[data-import]').forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          hide(
            $('#export-dropdown')
          );

          $('#import-file')?.click();

        }
      );

    }
  );


  $('#import-file')?.addEventListener(
    'change',
    importPlan
  );


  /* ------------------------------
     MAP
  ------------------------------ */

  $('#btn-upload-map')?.addEventListener(
    'click',
    () => {

      $('#map-upload')?.click();

    }
  );


  $('#btn-empty-upload')?.addEventListener(
    'click',
    () => {

      $('#map-upload')?.click();

    }
  );


  $('#btn-change-map')?.addEventListener(
    'click',
    () => {

      if (state.mapLocked) {

        toast(
          'Lås upp kartan först.'
        );

        return;

      }

      $('#map-upload')?.click();

    }
  );


  $('#map-upload')?.addEventListener(
    'change',
    handleMapUpload
  );


  $('#btn-lock-map')?.addEventListener(
    'click',
    toggleMapLock
  );


  /* ------------------------------
     TOOLS
  ------------------------------ */

  $$('.tool-btn').forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          setTool(
            button.dataset.tool
          );

        }
      );

    }
  );


  $$('.symbol-item').forEach(
    button => {

      button.addEventListener(
        'click',
        () => {

          selectSymbol(
            button.dataset.symbol
          );

          setTool(
            'symbol'
          );

        }
      );

    }
  );


  /* ------------------------------
     DRAW SETTINGS
  ------------------------------ */

  $('#stroke-width')?.addEventListener(
    'input',
    event => {

      const output =
        event.target.parentElement
          ?.querySelector(
            'output'
          );

      if (output) {

        output.textContent =
          event.target.value;

      }

    }
  );


  $('#draw-opacity')?.addEventListener(
    'input',
    event => {

      const output =
        event.target.parentElement
          ?.querySelector(
            'output'
          );

      if (output) {

        output.textContent =
          `${event.target.value}%`;

      }

    }
  );


  /* ------------------------------
     GROUPS / TIMELINE
  ------------------------------ */

  $('#btn-add-group')?.addEventListener(
    'click',
    addGroup
  );


  $('#btn-add-timeline')?.addEventListener(
    'click',
    addTimelineEvent
  );


  $('#op-notes-panel')?.addEventListener(
    'input',
    saveNotes
  );


  /* ------------------------------
     OBJECT EDIT
  ------------------------------ */

  $('#btn-edit-object-save')?.addEventListener(
    'click',
    saveEditedObject
  );


  $('#btn-delete-selected')?.addEventListener(
    'click',
    () => {

      if (
        state.selectedObject
      ) {

        deleteObject(
          state.selectedObject
        );

      }

    }
  );


  /* ------------------------------
     CONFIRM
  ------------------------------ */

  $('#btn-confirm')?.addEventListener(
    'click',
    async () => {

      if (
        typeof state.confirmAction ===
        'function'
      ) {

        await state.confirmAction();

      }

      state.confirmAction =
        null;

    }
  );


  /* ------------------------------
     MODAL CLOSE BUTTONS
  ------------------------------ */

  $$('[data-close]').forEach(
    button => {

      button.addEventListener(
        'click',
        () => {
          if (button.dataset.close === 'auth-modal' && !currentUser) return;
          closeModal(button.dataset.close);
        }
      );

    }
  );


  /* ------------------------------
     MODAL BACKDROPS
  ------------------------------ */

  $$('.modal').forEach(
    modal => {

      modal
        .querySelector(
          '.modal-backdrop'
        )
        ?.addEventListener(
          'click',
          () => {
            if (modal.id === 'auth-modal' && !currentUser) return;
            modal.classList.remove('active');
          }
        );

    }
  );


  /* ------------------------------
     GLOBAL CLICK
  ------------------------------ */

  document.addEventListener(
    'click',
    event => {

      const dropdown =
        $('#export-dropdown');

      const exportButton =
        $('#btn-export-menu');

      if (
        dropdown &&
        !dropdown.contains(
          event.target
        ) &&
        !exportButton?.contains(
          event.target
        )
      ) {

        hide(dropdown);

      }

    }
  );


  /* ------------------------------
     KEYBOARD
  ------------------------------ */

  document.addEventListener(
    'keydown',
    handleKeyboard
  );


  /* ------------------------------
     WINDOW
  ------------------------------ */

  window.addEventListener(
    'beforeunload',
    () => {

      if (
        state.currentOp
      ) {

        saveCurrentOperation();

      }

    }
  );

}


/* ============================================================
   AUTH MODAL UI
   ============================================================ */

function updateAuthModal() {

  const title =
    $('#auth-title');

  const submit =
    $('#btn-auth-submit');

  const switchText =
    $('#auth-switch-text');

  const toggle =
    $('#auth-toggle');

  if (isLoginMode) {

    if (title) {

      title.textContent =
        'Logga in';

    }

    if (submit) {

      submit.textContent =
        'Logga in';

    }

    if (switchText) {

      switchText.textContent =
        'Har du inget konto?';

    }

    if (toggle) {

      toggle.textContent =
        'Skapa konto';

    }

  } else {

    if (title) {

      title.textContent =
        'Skapa konto';

    }

    if (submit) {

      submit.textContent =
        'Skapa konto';

    }

    if (switchText) {

      switchText.textContent =
        'Har du redan ett konto?';

    }

    if (toggle) {

      toggle.textContent =
        'Logga in';

    }

  }

}


/* ============================================================
   INITIALIZATION
   ============================================================ */

/* ============================================================
   MSSRP BANK
   The Bank page exists in index.html, but the original app.js
   did not contain any bank loader or event handlers.
   This module loads the bank data from Supabase and maps common
   MSSRP bank/payroll column names to the existing HTML fields.
   ============================================================ */

const MSSRP_BANK_TABLES = {
  accounts: ['bank_accounts', 'mssrp_bank_accounts'],
  transactions: ['bank_transactions', 'mssrp_bank_transactions'],
  payroll: ['user_payroll', 'bank_payroll', 'payroll_assignments', 'mssrp_payroll']
};

let mssrpBankTableCache = {};

function bankFirstValue(row, keys, fallback = null) {
  if (!row || typeof row !== 'object') return fallback;
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return row[key];
    }
  }
  return fallback;
}

function bankMatchesUser(row, userId) {
  if (!row || !userId) return false;
  return [
    row.user_id,
    row.owner_id,
    row.profile_id,
    row.account_user_id,
    row.userid
  ].some(value => value === userId);
}

function bankMatchesAccount(row, accountId, accountNumber) {
  if (!row) return false;
  if (accountId && [
    row.account_id,
    row.bank_account_id,
    row.accountId
  ].some(value => value === accountId)) return true;
  if (accountNumber && [
    row.account_number,
    row.account_no,
    row.accountNumber,
    row.kontonummer
  ].some(value => String(value) === String(accountNumber))) return true;
  return false;
}

async function bankReadCandidate(table, userId) {
  try {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(250);

    if (error) return { ok: false, table, error };

    const rows = Array.isArray(data) ? data : [];
    const userRows = userId
      ? rows.filter(row => bankMatchesUser(row, userId))
      : rows;

    return { ok: true, table, rows, userRows };
  } catch (error) {
    return { ok: false, table, error };
  }
}

async function bankFindUserRows(kind, userId) {
  const cached = mssrpBankTableCache[kind];

  if (cached) {
    const result = await bankReadCandidate(cached, userId);
    if (result.ok) return result;
    delete mssrpBankTableCache[kind];
  }

  let lastError = null;

  for (const table of MSSRP_BANK_TABLES[kind] || []) {
    const result = await bankReadCandidate(table, userId);
    if (result.ok) {
      mssrpBankTableCache[kind] = table;
      return result;
    }
    lastError = result.error;
  }

  return {
    ok: false,
    table: null,
    rows: [],
    userRows: [],
    error: lastError || new Error(`Ingen ${kind}-tabell hittades.`)
  };
}

function formatBankSEK(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0 kr';
  return new Intl.NumberFormat('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amount) + ' kr';
}

function formatBankAccountNumber(value, userId) {
  if (value) return String(value);
  if (!userId) return '—';

  // Display-only fallback so the page never stays blank if the
  // database account-number column is not populated.
  const compact = String(userId).replace(/-/g, '').slice(0, 10);
  return compact ? `MSSRP-${compact}` : '—';
}

function formatBankDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

function setBankText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function renderBankTransactions(rows, account) {
  const list = $('#bank-transactions-list');
  if (!list) return;

  const accountId = bankFirstValue(account, ['id', 'account_id']);
  const accountNumber = bankFirstValue(account, [
    'account_number',
    'account_no',
    'accountNumber',
    'kontonummer'
  ]);

  const filtered = (rows || [])
    .filter(row => {
      if (!accountId && !accountNumber) return true;
      return bankMatchesAccount(row, accountId, accountNumber) || bankMatchesUser(row, currentUser?.id);
    })
    .sort((a, b) => {
      const da = new Date(bankFirstValue(a, ['created_at', 'date', 'transaction_date', 'timestamp'], 0)).getTime();
      const db = new Date(bankFirstValue(b, ['created_at', 'date', 'transaction_date', 'timestamp'], 0)).getTime();
      return db - da;
    })
    .slice(0, 20);

  if (!filtered.length) {
    list.innerHTML = '<div class="mssrp-bank-loading">Inga bankhändelser ännu.</div>';
    return;
  }

  list.innerHTML = filtered.map(row => {
    const description = bankFirstValue(row, [
      'description',
      'title',
      'message',
      'reason',
      'reference',
      'type'
    ], 'Bankhändelse');

    const amount = bankFirstValue(row, [
      'amount',
      'value',
      'sum',
      'belopp'
    ], 0);

    const date = bankFirstValue(row, [
      'created_at',
      'date',
      'transaction_date',
      'timestamp'
    ]);

    const numericAmount = Number(amount);
    const amountText = Number.isFinite(numericAmount)
      ? `${numericAmount >= 0 ? '+' : ''}${formatBankSEK(numericAmount)}`
      : String(amount ?? '—');

    const rowClass = numericAmount >= 0 ? 'is-credit' : 'is-debit';

    return `
      <div class="mssrp-bank-transaction ${rowClass}">
        <div>
          <strong>${escapeHtml(String(description))}</strong>
          <small>${escapeHtml(formatBankDate(date))}</small>
        </div>
        <b>${escapeHtml(amountText)}</b>
      </div>
    `;
  }).join('');
}

async function loadMssrpBank() {
  const page = $('#bank');
  if (!page) return;
  ensureSwishTransferUI();

  if (!currentUser?.id) {
    setBankText('#bank-user-name', 'Inte inloggad');
    setBankText('#bank-role-line', 'Logga in för att läsa ditt bankkonto.');
    setBankText('#bank-balance', '—');
    setBankText('#bank-payroll-role', '—');
    setBankText('#bank-paycheck', '—');
    setBankText('#bank-next-payday', '—');
    setBankText('#bank-account-number', '—');

    const list = $('#bank-transactions-list');
    if (list) list.innerHTML = '<div class="mssrp-bank-loading">Logga in för att läsa bankhändelser.</div>';
    return;
  }

  setBankText(
    '#bank-user-name',
    currentUser.user_metadata?.display_name ||
    currentUser.user_metadata?.full_name ||
    currentUser.email?.split('@')[0] ||
    'MSSRP-användare'
  );

  const list = $('#bank-transactions-list');
  if (list) list.innerHTML = '<div class="mssrp-bank-loading">Laddar bankhändelser…</div>';

  try {
    const [accountsResult, payrollResult, transactionsResult] = await Promise.all([
      bankFindUserRows('accounts', currentUser.id),
      bankFindUserRows('payroll', currentUser.id),
      bankFindUserRows('transactions', currentUser.id)
    ]);

    /*
      Accounts
    */
    // The bank page must still render even when the optional bank tables
    // have not been created yet. In that case we show a valid empty account
    // instead of aborting the whole Bank page.
    const account = accountsResult.ok ? (accountsResult.userRows[0] || null) : null;

    if (!account) {
      setBankText('#bank-balance', '0 kr');
      setBankText('#bank-account-number', formatBankAccountNumber(null, currentUser.id));
    } else {
      const balance = bankFirstValue(account, [
        'balance',
        'current_balance',
        'available_balance',
        'saldo',
        'amount'
      ], 0);

      const accountNumber = bankFirstValue(account, [
        'account_number',
        'account_no',
        'accountNumber',
        'kontonummer'
      ]);

      setBankText('#bank-balance', formatBankSEK(balance));
      setBankText('#bank-account-number', formatBankAccountNumber(accountNumber, currentUser.id));
    }

    /*
      Payroll
    */
    const payroll = payrollResult.ok ? (payrollResult.userRows[0] || null) : null;

    const payrollRole = bankFirstValue(payroll, [
      'role_name',
      'payroll_role',
      'salary_class',
      'pay_class',
      'loneklass',
      'role'
    ], 'Civil');

    const paycheck = bankFirstValue(payroll, [
      'daily_salary',
      'daily_pay',
      'salary',
      'paycheck',
      'amount',
      'lön',
      'lon'
    ], 0);

    setBankText('#bank-payroll-role', String(payrollRole));
    setBankText('#bank-role-line', `Löneklass: ${payrollRole}`);
    setBankText('#bank-paycheck', formatBankSEK(paycheck));

    const nextPayday = bankFirstValue(payroll, [
      'next_payday',
      'next_payment',
      'next_salary_at'
    ]);

    if (nextPayday) {
      setBankText('#bank-next-payday', formatBankDate(nextPayday));
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(12, 0, 0, 0);
      setBankText('#bank-next-payday', tomorrow.toLocaleDateString('sv-SE'));
    }

    /*
      Transactions
    */
    renderBankTransactions(
      transactionsResult.ok ? transactionsResult.rows : [],
      account
    );

    if (!transactionsResult.ok) {
      const transactionList = $('#bank-transactions-list');
      if (transactionList) {
        transactionList.innerHTML =
          '<div class="mssrp-bank-loading">Kontot laddades, men transaktionstabellen kunde inte läsas.</div>';
      }
    }

  } catch (error) {
    console.error('MSSRP Bank load failed:', error);

    setBankText('#bank-balance', '—');
    setBankText('#bank-role-line', 'Banken kunde inte laddas.');

    if (list) {
      list.innerHTML = `
        <div class="mssrp-bank-loading">
          Kunde inte ladda banken.<br>
          <small>${escapeHtml(error.message || 'Okänt fel')}</small>
        </div>
      `;
    }
  }
}

function ensureSwishTransferUI() {
  const page = document.querySelector('#bank');
  if (!page || page.querySelector('#mssrp-swish-launcher')) return;

  if (!document.getElementById('mssrp-swish-ui-style')) {
    const style = document.createElement('style');
    style.id = 'mssrp-swish-ui-style';
    style.textContent = `
      .mssrp-swish-card{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:22px;margin:18px 0;background:linear-gradient(120deg,#f8d83a,#f5c928);color:#17201b;border-radius:22px;box-shadow:0 8px 24px #00000018}
      .mssrp-swish-card h3{margin:0 0 6px;font-size:22px;font-weight:800}.mssrp-swish-card p{margin:0;opacity:.82}
      .mssrp-swish-launch{border:0;border-radius:999px;background:#153f35;color:#fff;padding:13px 22px;font-weight:800;cursor:pointer;white-space:nowrap}
      .mssrp-swish-overlay{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;padding:18px;background:#07110dcc;backdrop-filter:blur(5px)}
      .mssrp-swish-overlay.is-open{display:flex}.mssrp-swish-dialog{width:min(100%,430px);background:#fff;color:#17201b;border-radius:26px;padding:26px;box-shadow:0 25px 80px #0005}
      .mssrp-swish-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.mssrp-swish-brand{font-size:26px;font-weight:900;letter-spacing:-1px}.mssrp-swish-mark{display:inline-grid;place-items:center;width:38px;height:38px;margin-right:8px;border-radius:50%;background:#f5d331;font-size:20px}
      .mssrp-swish-close{border:0;background:#f0f1ed;border-radius:50%;width:38px;height:38px;font-size:22px;cursor:pointer}.mssrp-swish-field{display:block;margin:14px 0}.mssrp-swish-field span{display:block;font-size:13px;font-weight:750;margin-bottom:7px}.mssrp-swish-field input{box-sizing:border-box;width:100%;border:1px solid #d8ddd7;border-radius:13px;padding:14px;font-size:16px;background:#fff;color:#17201b}.mssrp-swish-submit{width:100%;border:0;border-radius:999px;padding:15px;background:#153f35;color:white;font-weight:850;font-size:16px;cursor:pointer;margin-top:10px}.mssrp-swish-submit:disabled{opacity:.6;cursor:wait}.mssrp-swish-note{font-size:12px;line-height:1.5;color:#69716b;margin:12px 0 0}
      @media(max-width:520px){.mssrp-swish-card{align-items:flex-start;flex-direction:column}.mssrp-swish-launch{width:100%}.mssrp-swish-dialog{padding:20px}}
    `;
    document.head.appendChild(style);
  }

  const card = document.createElement('section');
  card.className = 'mssrp-swish-card';
  card.innerHTML = `<div><h3>Swish</h3><p>Skicka pengar snabbt till någon i MSSRP.</p></div><button id="mssrp-swish-launcher" class="mssrp-swish-launch" type="button">↗ Skicka pengar</button>`;
  page.prepend(card);

  const overlay = document.createElement('div');
  overlay.className = 'mssrp-swish-overlay';
  overlay.id = 'mssrp-swish-overlay';
  overlay.innerHTML = `
    <section class="mssrp-swish-dialog" role="dialog" aria-modal="true" aria-labelledby="mssrp-swish-title">
      <div class="mssrp-swish-head"><div class="mssrp-swish-brand"><span class="mssrp-swish-mark">↗</span><span id="mssrp-swish-title">Swish</span></div><button type="button" class="mssrp-swish-close" aria-label="Stäng">×</button></div>
      <form id="mssrp-swish-transfer-form">
        <label class="mssrp-swish-field"><span>Mottagarens konto-ID</span><input id="mssrp-swish-recipient" type="text" autocomplete="off" placeholder="MSSRP-…" required></label>
        <label class="mssrp-swish-field"><span>Belopp (kr)</span><input id="mssrp-swish-amount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0,00" required></label>
        <button class="mssrp-swish-submit" id="mssrp-swish-submit" type="submit">Granska och skicka</button>
        <p class="mssrp-swish-note">Detta är en intern överföring i appen, inte en riktig Swish-betalning. Kontrollera mottagare och belopp innan du skickar.</p>
      </form>
    </section>`;
  document.body.appendChild(overlay);

  const close = () => overlay.classList.remove('is-open');
  card.querySelector('#mssrp-swish-launcher').addEventListener('click', () => {
    overlay.classList.add('is-open');
    setTimeout(() => overlay.querySelector('#mssrp-swish-recipient').focus(), 0);
  });
  overlay.querySelector('.mssrp-swish-close').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  overlay.querySelector('#mssrp-swish-transfer-form').addEventListener('submit', async event => {
    event.preventDefault();
    const receiverAccountId = overlay.querySelector('#mssrp-swish-recipient').value.trim();
    const amount = Number(overlay.querySelector('#mssrp-swish-amount').value);
    if (!receiverAccountId || !Number.isFinite(amount) || amount <= 0) {
      alert('Ange mottagarens konto-ID och ett belopp över 0 kr.');
      return;
    }
    const formatted = formatBankSEK(amount);
    if (!confirm(`Skicka ${formatted} till konto ${receiverAccountId}?`)) return;
    const submit = overlay.querySelector('#mssrp-swish-submit');
    submit.disabled = true;
    submit.textContent = 'Skickar…';
    try {
      const success = await sendSwish(receiverAccountId, amount);
      if (success) {
        overlay.querySelector('#mssrp-swish-transfer-form').reset();
        close();
        await loadMssrpBank();
      }
    } finally {
      submit.disabled = false;
      submit.textContent = 'Granska och skicka';
    }
  });
}

function bindBankEvents() {
  $('#bank-refresh')?.addEventListener('click', () => {
    loadMssrpBank();
  });

  document.addEventListener('click', event => {
    const bankLink = event.target.closest('[data-bank-nav]');
    if (bankLink) setTimeout(() => loadMssrpBank(), 0);
  });
}


function mssrpPayrollRoleCatalog() {
  return [
    { name: 'Lön 1', salary: 500 },
    { name: 'Lön 2', salary: 1000 },
    { name: 'Lön 3', salary: 1500 },
    { name: 'Lön 4', salary: 2000 },
    { name: 'Lön 5', salary: 2500 },
    { name: 'Lön 6', salary: 3000 },
    { name: 'Lön 7', salary: 3500 },
    { name: 'Lön 8', salary: 4000 },
    { name: 'Lön 9', salary: 4500 },
    { name: 'Lön 10', salary: 5000 }
  ];
}

function payrollEscape(value) {
  return escapeHtml(String(value ?? ''));
}

async function adminFindPayrollTable() {
  const cached = mssrpBankTableCache.payroll;
  if (cached) {
    const test = await bankReadCandidate(cached, null);
    if (test.ok) return test;
    delete mssrpBankTableCache.payroll;
  }
  for (const table of MSSRP_BANK_TABLES.payroll) {
    const result = await bankReadCandidate(table, null);
    if (result.ok) {
      mssrpBankTableCache.payroll = table;
      return result;
    }
  }
  return { ok:false, table:null, rows:[], userRows:[], error:new Error('Ingen payroll-tabell hittades.') };
}

async function adminFindAccountsTable() {
  const cached = mssrpBankTableCache.accounts;
  if (cached) {
    const test = await bankReadCandidate(cached, null);
    if (test.ok) return test;
    delete mssrpBankTableCache.accounts;
  }
  for (const table of MSSRP_BANK_TABLES.accounts) {
    const result = await bankReadCandidate(table, null);
    if (result.ok) {
      mssrpBankTableCache.accounts = table;
      return result;
    }
  }
  return { ok:false, table:null, rows:[], userRows:[], error:new Error('Ingen bankkonto-tabell hittades.') };
}

async function adminFindTransactionsTable() {
  const cached = mssrpBankTableCache.transactions;
  if (cached) {
    const test = await bankReadCandidate(cached, null);
    if (test.ok) return test;
    delete mssrpBankTableCache.transactions;
  }
  for (const table of MSSRP_BANK_TABLES.transactions) {
    const result = await bankReadCandidate(table, null);
    if (result.ok) {
      mssrpBankTableCache.transactions = table;
      return result;
    }
  }
  return { ok:false, table:null, rows:[], userRows:[], error:new Error('Ingen transaktionstabell hittades.') };
}

async function adminSetUserCash(userId, amount, description='Admin bankinsättning') {
  if (!hasPermission('admin')) throw new Error('Adminbehörighet krävs.');
  if (!userId) throw new Error('Ingen användare vald.');
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) throw new Error('Ange ett giltigt belopp.');

  const accounts = await adminFindAccountsTable();
  if (!accounts.ok || !accounts.table) throw accounts.error || new Error('Bankkontotabellen kunde inte hittas.');

  const rows = accounts.rows || [];
  let account = rows.find(row => bankMatchesUser(row, userId));
  let balanceKey = account ? ['balance','current_balance','available_balance','saldo','amount'].find(k => Object.prototype.hasOwnProperty.call(account,k)) : 'balance';

  if (!account) {
    const payload = {
      user_id: userId,
      balance: value,
      account_number: `MSSRP-${String(userId).replace(/-/g,'').slice(0,10)}`
    };
    let result = await supabase.from(accounts.table).insert(payload).select('*').single();
    if (result.error) {
      // Try the smaller payload for schemas without account_number.
      result = await supabase.from(accounts.table).insert({ user_id:userId, balance:value }).select('*').single();
    }
    if (result.error) throw result.error;
    account = result.data;
  } else {
    const current = Number(bankFirstValue(account,['balance','current_balance','available_balance','saldo','amount'],0)) || 0;
    balanceKey = balanceKey || 'balance';
    const patch = { [balanceKey]: current + value };
    let updateQuery = supabase.from(accounts.table).update(patch);
    if (account.id !== undefined && account.id !== null) {
      updateQuery = updateQuery.eq('id', account.id);
    } else {
      const userKey = ['user_id','owner_id','profile_id','account_user_id','userid'].find(k => Object.prototype.hasOwnProperty.call(account,k));
      if (!userKey) throw new Error('Bankkontot saknar id/user_id för uppdatering.');
      updateQuery = updateQuery.eq(userKey, userId);
    }
    const { error } = await updateQuery;
    if (error) throw new Error(`Kunde inte uppdatera bankkontot: ${error.message || error.details || 'okänt Supabase-fel'}`);
  }

  // Record the movement when the optional transaction table is available.
  const transactions = await adminFindTransactionsTable();
  if (transactions.ok && transactions.table) {
    const accountId = account?.id || null;
    const payload = {
      user_id:userId,
      account_id:accountId,
      amount:value,
      description,
      type:value >= 0 ? 'deposit' : 'withdrawal'
    };
    const tx = await supabase.from(transactions.table).insert(payload);
    if (tx.error) {
      // Some schemas do not have type/account_id. Do not undo a successful bank balance change.
      const fallback = await supabase.from(transactions.table).insert({ user_id:userId, amount:value, description });
      if (fallback.error) console.warn('Transaction log failed:', fallback.error);
    }
  }

  return true;
}

async function adminUpsertPayroll(userId, roleName, salary) {
  if (!hasPermission('admin')) throw new Error('Adminbehörighet krävs.');
  const tableResult = await adminFindPayrollTable();
  if (!tableResult.ok || !tableResult.table) throw tableResult.error || new Error('Ingen payroll-tabell hittades.');
  const table = tableResult.table;
  const existing = (tableResult.rows || []).find(row => bankMatchesUser(row,userId));
  const salaryValue = Number(salary);
  if (!Number.isFinite(salaryValue) || salaryValue < 0) throw new Error('Ogiltig lön.');

  if (existing?.id) {
    const roleKey = ['role_name','payroll_role','salary_class','pay_class','loneklass','role'].find(k => Object.prototype.hasOwnProperty.call(existing,k)) || 'role_name';
    const salaryKey = ['daily_salary','daily_pay','salary','paycheck','amount','lön','lon'].find(k => Object.prototype.hasOwnProperty.call(existing,k)) || 'daily_salary';
    const { error } = await supabase.from(table).update({ [roleKey]:roleName, [salaryKey]:salaryValue }).eq('id',existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from(table).insert({ user_id:userId, role_name:roleName, daily_salary:salaryValue });
    if (error) throw error;
  }
}

async function loadAdminPayroll() {
  const roleBox = $('#admin-payroll-roles');
  const userBody = $('#admin-payroll-users');
  if (!roleBox || !userBody || !hasPermission('admin')) return;

  roleBox.innerHTML = mssrpPayrollRoleCatalog().map(role => `
    <button type="button" class="mssrp-card" data-payroll-role="${payrollEscape(role.name)}" data-payroll-salary="${role.salary}">
      <strong>${payrollEscape(role.name)}</strong><small>${formatBankSEK(role.salary)} / dag</small>
    </button>`).join('');

  try {
    const search = ($('#admin-payroll-search')?.value || '').trim().toLowerCase();
    const [{data:profiles,error:profileError}, payrollResult] = await Promise.all([
      supabase.from('profiles').select('id,display_name').order('display_name'),
      adminFindPayrollTable()
    ]);
    if (profileError) throw profileError;
    const payrollRows = payrollResult.ok ? (payrollResult.rows || []) : [];
    const filtered = (profiles || []).filter(p => `${p.display_name||''} ${p.id}`.toLowerCase().includes(search));
    userBody.innerHTML = filtered.map(user => {
      const row = payrollRows.find(r => bankMatchesUser(r,user.id));
      const role = bankFirstValue(row,['role_name','payroll_role','salary_class','pay_class','loneklass','role'],'Civil');
      const salary = bankFirstValue(row,['daily_salary','daily_pay','salary','paycheck','amount','lön','lon'],0);
      return `<tr><td><strong>${payrollEscape(user.display_name||'Okänd')}</strong><small>${payrollEscape(user.id)}</small></td><td>${payrollEscape(role)}</td><td>${escapeHtml(formatBankSEK(salary))}</td><td><div class="mssrp-admin-assign"><button type="button" class="mssrp-secondary" data-payroll-user="${user.id}">Välj</button><button type="button" class="mssrp-primary" data-admin-cash-user="${user.id}">Sätt in cash</button><button type="button" class="mssrp-secondary" data-pay-cash-user="${user.id}" data-pay-cash-amount="${Number(salary)||0}">Betala lön</button></div></td></tr>`;
    }).join('') || '<tr><td colspan="4">Inga användare hittades.</td></tr>';

    $$('#admin-payroll-roles [data-payroll-role]').forEach(button => button.addEventListener('click', async () => {
      const selectedUser = window.__mssrpSelectedPayrollUser;
      if (!selectedUser) { toast('Välj en användare först.'); return; }
      try {
        await adminUpsertPayroll(selectedUser, button.dataset.payrollRole, button.dataset.payrollSalary);
        toast(`${button.dataset.payrollRole} tilldelad.`);
        await loadAdminPayroll();
        await loadMssrpBank();
      } catch(error) { console.error(error); toast(error.message || 'Kunde inte tilldela löneklass.'); }
    }));

    $$('#admin-payroll-users [data-payroll-user]').forEach(button => button.addEventListener('click', () => {
      window.__mssrpSelectedPayrollUser = button.dataset.payrollUser;
      $$('#admin-payroll-users tr').forEach(tr => tr.classList.remove('is-selected'));
      button.closest('tr')?.classList.add('is-selected');
      toast('Användare vald. Välj en löneklass ovan.');
    }));

    $$('#admin-payroll-users [data-admin-cash-user]').forEach(button => button.addEventListener('click', async () => {
      const userId = button.dataset.adminCashUser;
      const raw = window.prompt('Hur mycket SEK ska sättas in på användarens bankkonto?');
      if (raw === null) return;
      const amount = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(amount) || amount === 0) { toast('Ange ett giltigt belopp.'); return; }
      try {
        await adminSetUserCash(userId, amount, 'Admin bankinsättning');
        toast(`${formatBankSEK(amount)} insatt på kontot.`);
        await loadAdminPayroll();
      } catch(error) { console.error(error); toast(error.message || 'Kunde inte sätta in pengar.'); }
    }));

    $$('#admin-payroll-users [data-pay-cash-user]').forEach(button => button.addEventListener('click', async () => {
      const userId = button.dataset.payCashUser;
      const amount = Number(button.dataset.payCashAmount || 0);
      if (!amount) { toast('Användaren har ingen daglig lön tilldelad.'); return; }
      try {
        await adminSetUserCash(userId, amount, 'Daglig RP-lön');
        toast(`Lön på ${formatBankSEK(amount)} utbetald.`);
        await loadAdminPayroll();
      } catch(error) { console.error(error); toast(error.message || 'Kunde inte betala lön.'); }
    }));
  } catch(error) {
    console.error('Admin payroll failed:',error);
    userBody.innerHTML = `<tr><td colspan="4">Kunde inte ladda löner: ${payrollEscape(error.message || 'Okänt fel')}</td></tr>`;
  }
}

function bindAdminPayrollEvents() {
  $('#admin-payroll-search')?.addEventListener('input', () => loadAdminPayroll());
}


async function init() {

  ensurePasswordResetUI();
  bindPasswordRecoveryListener();
  bindEvents();
  bindPortalEvents();
  bindBankEvents();
  bindSwishPayrollForms();
  initPortalTabs();

  updateAuthModal();

  try {

    await initDB();

  } catch (error) {

    console.error(
      'IndexedDB initialization failed:',
      error
    );

    toast(
      'Lokal lagring kunde inte startas.'
    );

  }

  await loadOperations();

  await checkAuth();
  await loadAccessProfile();
  await loadMssrpBank();
  await checkPasswordRecovery();

  setTool(
    'select'
  );

  selectSymbol(
    'police'
  );

}


if (
  document.readyState ===
  'loading'
) {

  document.addEventListener(
    'DOMContentLoaded',
    init
  );

} else {

  init();

}


/* ============================================================
   MSSRP SOCIAL 1:1 - FACEBOOK / BLOCKET EXPERIENCE
   Posts, follows, reactions, replies, images and Messenger.
   ============================================================ */
function initMssrpSocialOneToOne() {
  if (window.__mssrpSocial1to1) return;
  window.__mssrpSocial1to1 = true;
  const $s = s => document.querySelector(s);
  const $$s = s => [...document.querySelectorAll(s)];
  const esc = v => typeof escapeHtml === 'function' ? escapeHtml(v ?? '') : String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => currentUser?.id || null;
  const name = () => currentUser?.user_metadata?.display_name || currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'MSSRP-användare';
  const avatarLetter = n => (n || 'M').trim().charAt(0).toUpperCase();
  const toastSafe = m => typeof toast === 'function' ? toast(m) : alert(m);
  let socialState = { view:'facebook', activeChat:null, people:[], posts:[], conversations:[] };

  async function requireSocialUser() {
    if (!uid()) { toastSafe('Du måste vara inloggad för att använda Socialt.'); if (typeof showModal==='function') { isLoginMode=true; updateAuthModal(); showModal('auth-modal'); } return false; }
    return true;
  }

  async function profileFor(id) {
    try { const {data}=await supabase.from('profiles').select('id,display_name,avatar_url').eq('id',id).maybeSingle(); return data || {id,display_name:'MSSRP-användare'}; } catch { return {id,display_name:'MSSRP-användare'}; }
  }

  function setSocialView(view) {
    socialState.view=view;
    $$('.mssrp-social-tab').forEach(b=>b.classList.toggle('active',b.dataset.socialView===view));
    $$('.mssrp-social-view').forEach(v=>v.classList.add('hidden'));
    const target=$s(`#social-${view}-view`); if(target) target.classList.remove('hidden');
    if(view==='facebook') loadSocialFeed();
    if(view==='messages') loadSocialConversations();
    if(view==='blocket') loadBlocket1to1();
    if(view==='profile') loadSocialProfile();
  }

  async function loadSocialHeader() {
    const n=name();
    ['social-current-user','social-my-name','social-profile-name'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=n;});
    ['social-my-handle','social-profile-handle'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent='@'+n.toLowerCase().replace(/[^a-z0-9åäö]+/gi,'').slice(0,20);});
    ['social-my-avatar','social-composer-avatar','social-profile-avatar'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=avatarLetter(n);});
    if(uid()) {
      try { const [{count:followers},{count:following}] = await Promise.all([
        supabase.from('mssrp_social_follows').select('id',{count:'exact',head:true}).eq('following_id',uid()),
        supabase.from('mssrp_social_follows').select('id',{count:'exact',head:true}).eq('follower_id',uid())
      ]); if($s('#social-follower-count')) $s('#social-follower-count').textContent=followers||0; if($s('#social-following-count')) $s('#social-following-count').textContent=following||0; } catch {}
    }
  }

  async function uploadSocialImage(file) {
    if(!file || !uid()) return null;
    try {
      const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
      const path=`${uid()}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const {error}=await supabase.storage.from('mssrp-social').upload(path,file,{upsert:false,contentType:file.type||'image/jpeg'});
      if(error) throw error;
      const {data}=supabase.storage.from('mssrp-social').getPublicUrl(path); return data?.publicUrl||null;
    } catch(error) { console.error('Social image upload:',error); toastSafe('Bilden kunde inte laddas upp. Kör SQL-migrationen för Social-bilder först.'); return null; }
  }

  async function loadSocialFeed() {
    const feed=$s('#social-feed'); if(!feed) return; feed.innerHTML='<div class="mssrp-social-loading">Laddar flödet…</div>';
    const {data,error}=await supabase.from('mssrp_social_posts').select('*').order('created_at',{ascending:false}).limit(50);
    if(error){console.error(error);feed.innerHTML='<div class="mssrp-social-loading">Kunde inte läsa Facebook-flödet. Kör social-migrationen i Supabase.</div>';return;}
    socialState.posts=data||[]; if(!data?.length){feed.innerHTML='<div class="mssrp-social-loading">Inga inlägg ännu. Bli den första att publicera något.</div>';return;}
    feed.innerHTML='';
    for(const post of data) feed.insertAdjacentHTML('beforeend', await renderSocialPost(post));
  }

  async function reactionSummary(postId) {
    try { const {data}=await supabase.from('mssrp_social_reactions').select('reaction,user_id').eq('post_id',postId); const counts={}; (data||[]).forEach(r=>counts[r.reaction]=(counts[r.reaction]||0)+1); const mine=(data||[]).some(r=>r.user_id===uid()); return {counts,mine}; } catch{return {counts:{},mine:false};}
  }

  async function renderSocialPost(post) {
    const p=post.author_name||'MSSRP-användare'; const summary=await reactionSummary(post.id);
    const {data:comments}=await supabase.from('mssrp_social_comments').select('*').eq('post_id',post.id).order('created_at',{ascending:true}).limit(30).catch(()=>({data:[]}));
    const commentHtml=(comments||[]).map(c=>`<div class="mssrp-comment"><div class="mssrp-avatar">${esc(avatarLetter(c.author_name))}</div><div class="mssrp-comment-body"><strong>${esc(c.author_name||'Användare')}</strong><p>${esc(c.body||'')}</p>${c.image_url?`<img class="mssrp-comment-image" src="${esc(c.image_url)}" alt="Bild i kommentar">`:''}</div></div>`).join('');
    const reactionText=Object.entries(summary.counts).map(([r,c])=>`${r} ${c}`).join(' · ')||'0 reaktioner';
    return `<article class="mssrp-fb-post" data-post-id="${post.id}"><div class="mssrp-post-head"><div class="mssrp-avatar">${esc(avatarLetter(p))}</div><div><strong>${esc(p)}</strong><small>${new Date(post.created_at).toLocaleString('sv-SE')} · 🌐</small></div><button class="mssrp-post-menu">•••</button></div>${post.body?`<div class="mssrp-post-text">${esc(post.body)}</div>`:''}${post.image_url?`<img class="mssrp-post-image" src="${esc(post.image_url)}" alt="Inläggsbild">`:''}<div class="mssrp-post-stats"><span>${esc(reactionText)}</span><span>${comments?.length||0} kommentarer</span></div><div class="mssrp-post-actions"><button data-social-react="👍" class="${summary.mine?'active':''}">👍 Gilla</button><button data-social-comment>💬 Kommentera</button><button data-social-share>↗ Dela</button></div><div class="mssrp-comments"><div class="mssrp-comment-list">${commentHtml}</div><form class="mssrp-comment-form"><input name="comment" placeholder="Skriv en kommentar…"><label class="mssrp-image-button">🖼️<input name="image" type="file" accept="image/*" hidden></label><button>Skicka</button></form></div></article>`;
  }

  async function createPost() {
    if(!await requireSocialUser()) return;
    const modal=document.createElement('div'); modal.className='mssrp-social-compose-modal'; modal.innerHTML=`<div class="mssrp-social-modal-backdrop"></div><div class="mssrp-social-compose-card"><button class="mssrp-social-modal-close">×</button><h2>Skapa inlägg</h2><p>Dela något med Malmö Skåne.</p><form id="mssrp-social-post-form" class="mssrp-social-compose-form"><textarea name="body" placeholder="Vad tänker du på?"></textarea><label class="mssrp-upload-box">🖼️ Lägg till foto/video<input type="file" name="image" accept="image/*" hidden></label><img id="mssrp-compose-preview" class="mssrp-upload-preview hidden"><button class="mssrp-social-primary">Publicera</button></form></div>`; document.body.appendChild(modal);
    modal.querySelector('.mssrp-social-modal-close').onclick=()=>modal.remove(); modal.querySelector('.mssrp-social-modal-backdrop').onclick=()=>modal.remove();
    const file=modal.querySelector('input[type=file]'),preview=modal.querySelector('#mssrp-compose-preview'); file.onchange=()=>{if(file.files[0]){preview.src=URL.createObjectURL(file.files[0]);preview.classList.remove('hidden')}};
    modal.querySelector('form').onsubmit=async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{const body=e.target.body.value.trim();let image_url=null;if(file.files[0]) image_url=await uploadSocialImage(file.files[0]);const {error}=await supabase.from('mssrp_social_posts').insert({author_id:uid(),author_name:name(),body,image_url});if(error)throw error;modal.remove();toastSafe('Inlägget publicerades.');await loadSocialFeed();}catch(err){toastSafe(err.message||'Kunde inte publicera inlägget.');}finally{btn.disabled=false}};
  }

  async function toggleReaction(postId,reaction='👍') {
    if(!await requireSocialUser()) return;
    const {data:existing}=await supabase.from('mssrp_social_reactions').select('id').eq('post_id',postId).eq('user_id',uid()).maybeSingle();
    if(existing) await supabase.from('mssrp_social_reactions').delete().eq('id',existing.id); else await supabase.from('mssrp_social_reactions').insert({post_id:postId,user_id:uid(),reaction});
    await loadSocialFeed();
  }

  async function submitComment(form,postId) {
    if(!await requireSocialUser()) return; const body=form.comment.value.trim(); let image_url=null;if(form.image.files[0])image_url=await uploadSocialImage(form.image.files[0]); if(!body&&!image_url)return;
    const {error}=await supabase.from('mssrp_social_comments').insert({post_id:postId,author_id:uid(),author_name:name(),body,image_url}); if(error)toastSafe(error.message);else await loadSocialFeed();
  }

  async function loadSuggestions() {
    const box=$s('#social-suggestions');if(!box||!uid())return;const {data}=await supabase.from('profiles').select('id,display_name,avatar_url').neq('id',uid()).limit(12);const people=data||[];box.innerHTML=people.map(p=>`<div class="mssrp-suggestion" data-person-id="${p.id}"><div class="mssrp-avatar">${esc(avatarLetter(p.display_name))}</div><div class="mssrp-suggestion-main"><strong>${esc(p.display_name||'Användare')}</strong><small>MSSRP</small></div><button class="mssrp-follow-btn" data-follow-user="${p.id}">Följ</button></div>`).join('')||'<small>Inga förslag just nu.</small>';
    for(const p of people){const {data:f}=await supabase.from('mssrp_social_follows').select('id').eq('follower_id',uid()).eq('following_id',p.id).maybeSingle();const b=box.querySelector(`[data-follow-user="${p.id}"]`);if(b&&f){b.textContent='Följer';b.classList.add('following')}}
  }

  async function toggleFollow(target) {if(!await requireSocialUser())return;if(target===uid())return;const {data:f}=await supabase.from('mssrp_social_follows').select('id').eq('follower_id',uid()).eq('following_id',target).maybeSingle();if(f)await supabase.from('mssrp_social_follows').delete().eq('id',f.id);else await supabase.from('mssrp_social_follows').insert({follower_id:uid(),following_id:target});await loadSuggestions();await loadSocialHeader();}

  async function loadSocialConversations() {
    const box=$s('#social-conversations');if(!box||!uid())return;const {data,error}=await supabase.from('mssrp_social_messages').select('*').or(`sender_id.eq.${uid()},receiver_id.eq.${uid()}`).order('created_at',{ascending:false}).limit(200);if(error){box.innerHTML='<div class="mssrp-social-loading">Kunde inte läsa meddelanden.</div>';return;}const map=new Map();for(const m of data||[]){const other=m.sender_id===uid()?m.receiver_id:m.sender_id;if(!map.has(other))map.set(other,m)}box.innerHTML='';for(const [other,m] of map){const p=await profileFor(other);box.insertAdjacentHTML('beforeend',`<div class="mssrp-conversation" data-chat-user="${other}"><div class="mssrp-avatar">${esc(avatarLetter(p.display_name))}</div><div><strong>${esc(p.display_name)}</strong><small>${esc(m.body||'Bild')}</small></div></div>`)}if(!map.size)box.innerHTML='<div class="mssrp-social-loading">Inga meddelanden ännu.</div>';
  }

  async function openChat(other) {const p=await profileFor(other);socialState.activeChat=other;$s('#social-chat-empty')?.classList.add('hidden');$s('#social-chat-active')?.classList.remove('hidden');$s('#social-chat-name').textContent=p.display_name||'Användare';$s('#social-chat-avatar').textContent=avatarLetter(p.display_name);await renderChatMessages();}

  async function openNewMessagePicker() {
    if (!await requireSocialUser()) return;
    const {data,error}=await supabase.from('profiles').select('id,display_name,avatar_url').neq('id',uid()).order('display_name',{ascending:true}).limit(100);
    if(error){toastSafe(error.message||'Kunde inte hämta användare.');return;}
    const people=data||[];
    const modal=document.createElement('div');
    modal.className='mssrp-social-compose-modal';
    modal.innerHTML=`<div class="mssrp-social-modal-backdrop"></div><div class="mssrp-social-compose-card mssrp-new-chat-card"><button type="button" class="mssrp-social-modal-close" aria-label="Stäng">×</button><h2>Nytt meddelande</h2><p>Välj vem du vill skriva till.</p><input type="search" class="mssrp-new-chat-search" placeholder="Sök användare…" aria-label="Sök användare"><div class="mssrp-new-chat-results"></div></div>`;
    document.body.appendChild(modal);
    const close=()=>modal.remove();
    modal.querySelector('.mssrp-social-modal-close').addEventListener('click',close);
    modal.querySelector('.mssrp-social-modal-backdrop').addEventListener('click',close);
    const results=modal.querySelector('.mssrp-new-chat-results');
    const render=filter=>{
      const q=filter.trim().toLocaleLowerCase('sv');
      const matches=people.filter(p=>(p.display_name||'Användare').toLocaleLowerCase('sv').includes(q));
      results.innerHTML=matches.map(p=>`<button type="button" class="mssrp-new-chat-person" data-new-chat-user="${esc(p.id)}"><span class="mssrp-avatar">${esc(avatarLetter(p.display_name))}</span><span><strong>${esc(p.display_name||'Användare')}</strong><small>Starta konversation</small></span></button>`).join('')||'<p class="mssrp-new-chat-empty">Inga användare hittades.</p>';
    };
    render('');
    modal.querySelector('.mssrp-new-chat-search').addEventListener('input',e=>render(e.target.value));
    results.addEventListener('click',async e=>{const btn=e.target.closest('[data-new-chat-user]');if(!btn)return;const other=btn.dataset.newChatUser;close();setSocialView('messages');await openChat(other);});
    modal.querySelector('.mssrp-new-chat-search').focus();
  }
  async function renderChatMessages(){const box=$s('#social-chat-messages');if(!box||!socialState.activeChat)return;const {data}=await supabase.from('mssrp_social_messages').select('*').or(`and(sender_id.eq.${uid()},receiver_id.eq.${socialState.activeChat}),and(sender_id.eq.${socialState.activeChat},receiver_id.eq.${uid()})`).order('created_at',{ascending:true});box.innerHTML=(data||[]).map(m=>`<div class="mssrp-chat-bubble ${m.sender_id===uid()?'mine':'theirs'}">${m.image_url?`<img src="${esc(m.image_url)}">`:''}${m.body?`<div>${esc(m.body)}</div>`:''}<small>${new Date(m.created_at).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit'})}</small></div>`).join('');box.scrollTop=box.scrollHeight;}
  async function sendChat(e){e.preventDefault();if(!socialState.activeChat||!await requireSocialUser())return;const input=$s('#social-chat-input'),file=$s('#social-chat-image');const body=input.value.trim();let image_url=null;if(file.files[0])image_url=await uploadSocialImage(file.files[0]);if(!body&&!image_url)return;const {error}=await supabase.from('mssrp_social_messages').insert({sender_id:uid(),receiver_id:socialState.activeChat,body,image_url});if(error)toastSafe(error.message);else{input.value='';file.value='';await renderChatMessages();await loadSocialConversations();}}

  async function loadBlocket1to1(){const box=$s('#blocket-feed');if(!box)return;const {data,error}=await supabase.from('mssrp_social_blocket').select('*').eq('sold',false).order('created_at',{ascending:false});if(error){box.innerHTML='<div class="mssrp-social-loading">Kunde inte läsa Blocket. Kör social-migrationen.</div>';return;}box.innerHTML=(data||[]).map(x=>`<article class="mssrp-blocket-card"><img class="mssrp-blocket-card-image" src="${esc(x.image_url||'')}" onerror="this.style.display='none'"><div class="mssrp-blocket-card-body"><div class="mssrp-blocket-price">${Number(x.price||0).toLocaleString('sv-SE')} kr</div><h3>${esc(x.title)}</h3><div class="mssrp-blocket-meta">${esc(x.category||'Övrigt')} · ${esc(x.location||'Malmö')}</div><p>${esc(x.description||'')}</p><div class="mssrp-blocket-actions"><button data-blocket-contact="${x.seller_id}">💬 Kontakta</button><button data-blocket-favorite="${x.id}">♡ Spara</button></div></div></article>`).join('')||'<div class="mssrp-social-loading">Inga annonser ännu.</div>';}
  async function createBlocket(){if(!await requireSocialUser())return;const modal=document.createElement('div');modal.className='mssrp-social-compose-modal';modal.innerHTML=`<div class="mssrp-social-modal-backdrop"></div><div class="mssrp-social-compose-card"><button class="mssrp-social-modal-close">×</button><h2>Lägg upp på Blocket</h2><form id="blocket-form" class="mssrp-social-compose-form"><input name="title" placeholder="Vad säljer du?" required><div class="mssrp-form-grid-2"><input name="price" type="number" min="0" placeholder="Pris (kr)" required><select name="category"><option>Övrigt</option><option>Fordon</option><option>Elektronik</option><option>Kläder</option><option>Bostad</option></select></div><input name="location" placeholder="Plats" value="Malmö"><textarea name="description" placeholder="Beskriv varan…"></textarea><label class="mssrp-upload-box">🖼️ Lägg till bild<input name="image" type="file" accept="image/*" hidden></label><img class="mssrp-upload-preview hidden" id="blocket-preview"><button class="mssrp-social-primary">Publicera annons</button></form></div>`;document.body.appendChild(modal);modal.querySelector('.mssrp-social-modal-close').onclick=()=>modal.remove();modal.querySelector('.mssrp-social-modal-backdrop').onclick=()=>modal.remove();const f=modal.querySelector('input[type=file]');f.onchange=()=>{const i=modal.querySelector('#blocket-preview');if(f.files[0]){i.src=URL.createObjectURL(f.files[0]);i.classList.remove('hidden')}};modal.querySelector('form').onsubmit=async e=>{e.preventDefault();let image_url=null;if(f.files[0])image_url=await uploadSocialImage(f.files[0]);const v=e.target;const {error}=await supabase.from('mssrp_social_blocket').insert({seller_id:uid(),seller_name:name(),title:v.title.value,price:Number(v.price.value),category:v.category.value,location:v.location.value,description:v.description.value,image_url});if(error)toastSafe(error.message);else{modal.remove();toastSafe('Annonsen publicerades.');loadBlocket1to1();}};}

  async function loadSocialProfile(){await loadSocialHeader();const box=$s('#social-profile-feed');if(!box||!uid())return;const {data}=await supabase.from('mssrp_social_posts').select('*').eq('author_id',uid()).order('created_at',{ascending:false});$s('#social-profile-post-count').textContent=`${data?.length||0} inlägg`;box.innerHTML='';for(const p of data||[])box.insertAdjacentHTML('beforeend',await renderSocialPost(p));}

  document.addEventListener('click',async e=>{
    const tab=e.target.closest('[data-social-view]');if(tab){setSocialView(tab.dataset.socialView);return;}
    if(e.target.closest('[data-social-compose]')){createPost();return;}
    if(e.target.closest('[data-social-new-message]')){openNewMessagePicker();return;}
    const react=e.target.closest('[data-social-react]');if(react){const post=react.closest('[data-post-id]');if(post)toggleReaction(post.dataset.postId,react.dataset.socialReact);return;}
    const comment=e.target.closest('[data-social-comment]');if(comment){const post=comment.closest('[data-post-id]');post?.querySelector('input[name=comment]')?.focus();return;}
    const follow=e.target.closest('[data-follow-user]');if(follow){toggleFollow(follow.dataset.followUser);return;}
    const conv=e.target.closest('[data-chat-user]');if(conv){openChat(conv.dataset.chatUser);return;}
    if(e.target.closest('[data-blocket-create]')){createBlocket();return;}
    const bc=e.target.closest('[data-blocket-contact]');if(bc){setSocialView('messages');setTimeout(()=>openChat(bc.dataset.blocketContact),100);return;}
  });
  document.addEventListener('submit',e=>{const form=e.target;if(form.matches('.mssrp-comment-form')){e.preventDefault();const post=form.closest('[data-post-id]');if(post)submitComment(form,post.dataset.postId);}if(form.id==='social-chat-form')sendChat(e);});
  $s('#social-message-search')?.addEventListener('input',e=>{$$('.mssrp-conversation').forEach(c=>c.style.display=c.textContent.toLowerCase().includes(e.target.value.toLowerCase())?'flex':'none')});
  loadSocialHeader();loadSocialFeed();loadSuggestions();
}

setTimeout(initMssrpSocialOneToOne, 500);


/* ============================================================
   MSSRP PHONE — virtual Swedish-style numbers + WebRTC audio
   Requires Supabase Realtime enabled and browser microphone permission.
   ============================================================ */
function initMssrpPhone() {
  if (document.getElementById('mssrp-phone-root')) return;
  const style = document.createElement('style');
  style.textContent = `
  #mssrp-phone-root{position:fixed;right:20px;bottom:20px;z-index:99990;font:14px system-ui;color:#172033}
  #mssrp-phone-toggle{background:#16a34a;color:#fff;border:0;border-radius:999px;padding:13px 19px;font-weight:800;box-shadow:0 8px 28px #0003;cursor:pointer}
  #mssrp-phone-panel{display:none;width:min(360px,calc(100vw - 28px));max-height:78vh;overflow:auto;background:#fff;border:1px solid #dce3ed;border-radius:20px;box-shadow:0 18px 55px #0003;margin-bottom:10px;padding:16px;box-sizing:border-box}
  #mssrp-phone-panel.open{display:block}.mssrp-phone-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.mssrp-phone-head h3{margin:0;font-size:20px}.mssrp-phone-num{background:#f1f5f9;border-radius:12px;padding:10px;text-align:center;font-weight:700;margin:8px 0 12px}
  #mssrp-phone-digits{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:20px;text-align:center;letter-spacing:1px}
  .mssrp-phone-pad{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.mssrp-phone-pad button,.mssrp-phone-action{border:0;border-radius:10px;padding:12px;background:#eef2f7;font-weight:700;cursor:pointer}.mssrp-phone-call{background:#16a34a!important;color:white}.mssrp-phone-hang{background:#dc2626!important;color:white}.mssrp-phone-contact{display:flex;align-items:center;gap:9px;padding:10px 0;border-top:1px solid #e5eaf0}.mssrp-phone-contact-main{flex:1;min-width:0}.mssrp-phone-contact small{display:block;color:#64748b;margin-top:3px}.mssrp-phone-contact button{border:0;border-radius:999px;padding:8px 11px;background:#16a34a;color:white;font-weight:700;cursor:pointer}.mssrp-phone-status{padding:10px;border-radius:10px;background:#f1f5f9;margin:10px 0}.mssrp-phone-controls{display:flex;gap:8px}.mssrp-phone-controls button{flex:1}.mssrp-phone-hidden{display:none!important}
  `;
  document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'mssrp-phone-root';
  root.innerHTML = `<section id="mssrp-phone-panel"><div class="mssrp-phone-head"><h3>📞 Telefon</h3><button id="mssrp-phone-close" aria-label="Stäng">✕</button></div><div class="mssrp-phone-num">Ditt appnummer: <span id="mssrp-phone-own">Logga in</span></div><input id="mssrp-phone-digits" inputmode="tel" placeholder="Skriv nummer, t.ex. 0701234567" maxlength="15"><div class="mssrp-phone-pad">${['1','2','3','4','5','6','7','8','9','⌫','0','+'].map(k=>`<button type="button" data-phone-key="${k}">${k}</button>`).join('')}</div><button class="mssrp-phone-action mssrp-phone-call" id="mssrp-phone-dial" style="width:100%">📞 Ring nummer</button><div id="mssrp-phone-callbox" class="mssrp-phone-status mssrp-phone-hidden"><strong id="mssrp-phone-callstatus">Redo</strong><div class="mssrp-phone-controls" style="margin-top:10px"><button class="mssrp-phone-action" id="mssrp-phone-mute">🎙️ Mikrofon på</button><button class="mssrp-phone-action mssrp-phone-hang" id="mssrp-phone-hang">Lägg på</button></div></div><h4>Kontakter</h4><div id="mssrp-phone-contacts">Logga in för att se användare.</div><audio id="mssrp-phone-audio" autoplay playsinline></audio></section><button id="mssrp-phone-toggle">📞 Telefon</button>`;
  document.body.appendChild(root);
  const $p = s => root.querySelector(s);
  let phoneChannel=null, pc=null, localStream=null, activePeer=null, muted=false, incoming=null;
  const myId=()=>currentUser?.id||null;
  const digits=$p('#mssrp-phone-digits');
  function stableNumber(id){let h=2166136261;for(let i=0;i<id.length;i++){h^=id.charCodeAt(i);h=Math.imul(h,16777619)}const n=(Math.abs(h)>>>0)%10000000;const prefixes=['70','72','73','76','79'];const p=prefixes[(Math.abs(h)>>>0)%prefixes.length];const s=String(n).padStart(7,'0');return `+46 ${p} ${s.slice(0,3)} ${s.slice(3)}`;}
  function normalizeNumber(v){let d=String(v||'').replace(/[^\d+]/g,'');if(d.startsWith('+46'))d='0'+d.slice(3);else if(d.startsWith('46'))d='0'+d.slice(2);return d;}
  function showStatus(t){$p('#mssrp-phone-callbox').classList.remove('mssrp-phone-hidden');$p('#mssrp-phone-callstatus').textContent=t;}
  async function signal(to,event,payload={}){if(!supabase||!myId())return;const ch=supabase.channel(`mssrp-phone-${to}`);await ch.subscribe();await ch.send({type:'broadcast',event,payload:{...payload,from:myId(),to}});supabase.removeChannel(ch);}
  async function setupPeer(peerId){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Mikrofon stöds inte i denna webbläsare eller anslutning.');
    localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
    localStream.getTracks().forEach(t=>pc.addTrack(t,localStream));
    pc.ontrack=e=>{$p('#mssrp-phone-audio').srcObject=e.streams[0];};
    pc.onicecandidate=e=>{if(e.candidate)signal(peerId,'phone-ice',{candidate:e.candidate});};
    pc.onconnectionstatechange=()=>{if(pc&&['connected','connecting'].includes(pc.connectionState))showStatus(pc.connectionState==='connected'?'Samtalet är anslutet':'Ansluter…');if(pc&&['failed','disconnected'].includes(pc.connectionState))showStatus('Anslutningen bröts.');};
    activePeer=peerId;
  }
  async function startCall(peerId){try{if(!myId())return alert('Logga in för att ringa.');if(peerId===myId())return alert('Du kan inte ringa dig själv.');await setupPeer(peerId);const offer=await pc.createOffer();await pc.setLocalDescription(offer);await signal(peerId,'phone-offer',{sdp:offer,fromName:currentUser.user_metadata?.display_name||currentUser.email||'Användare'});showStatus('Ringer…');}catch(e){cleanup();alert('Kunde inte starta samtalet: '+e.message);}}
  async function acceptCall(){if(!incoming)return;const call=incoming;incoming=null;try{await setupPeer(call.from);await pc.setRemoteDescription(new RTCSessionDescription(call.sdp));const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await signal(call.from,'phone-answer',{sdp:answer});showStatus('Samtalet ansluter…');}catch(e){cleanup();alert('Kunde inte svara: '+e.message);}}
  function cleanup(){if(pc){pc.close();pc=null;}if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;}$p('#mssrp-phone-audio').srcObject=null;activePeer=null;muted=false;$p('#mssrp-phone-mute').textContent='🎙️ Mikrofon på';$p('#mssrp-phone-callbox').classList.add('mssrp-phone-hidden');}
  async function listen(){if(!myId())return;if(phoneChannel)supabase.removeChannel(phoneChannel);phoneChannel=supabase.channel(`mssrp-phone-${myId()}`);phoneChannel.on('broadcast',{event:'phone-offer'},({payload})=>{if(!payload||payload.to!==myId())return;incoming=payload;showStatus(`Inkommande samtal från ${payload.fromName||'användare'}`);const yes=confirm(`Inkommande samtal från ${payload.fromName||'användare'}. Svara?`);if(yes)acceptCall();else{signal(payload.from,'phone-reject');cleanup();}}).on('broadcast',{event:'phone-answer'},async({payload})=>{if(payload?.to===myId()&&pc&&payload.sdp){await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));showStatus('Samtalet ansluter…');}}).on('broadcast',{event:'phone-ice'},async({payload})=>{if(payload?.to===myId()&&pc&&payload.candidate){try{await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));}catch(e){console.warn(e);}}}).on('broadcast',{event:'phone-hangup'},({payload})=>{if(payload?.to===myId()){cleanup();showStatus('Samtalet avslutades.');}}).on('broadcast',{event:'phone-reject'},({payload})=>{if(payload?.to===myId()){cleanup();showStatus('Samtalet avböjdes.');}}).subscribe();}
  async function loadContacts(){const box=$p('#mssrp-phone-contacts');if(!myId()){box.textContent='Logga in för att se användare.';return;}$p('#mssrp-phone-own').textContent=stableNumber(myId());box.textContent='Laddar kontakter…';const {data,error}=await supabase.from('profiles').select('id,display_name,full_name').neq('id',myId()).limit(100);if(error){box.textContent='Kunde inte hämta kontakter från profiles-tabellen.';return;}box.innerHTML='';(data||[]).forEach(u=>{const name=u.display_name||u.full_name||'Användare';const row=document.createElement('div');row.className='mssrp-phone-contact';const main=document.createElement('div');main.className='mssrp-phone-contact-main';const strong=document.createElement('strong');strong.textContent=name;const small=document.createElement('small');small.textContent=stableNumber(u.id);main.append(strong,small);const btn=document.createElement('button');btn.textContent='📞 Ring';btn.onclick=()=>startCall(u.id);row.append(main,btn);box.append(row);});if(!data?.length)box.textContent='Inga andra användare hittades.';}
  $p('#mssrp-phone-toggle').onclick=()=>{$p('#mssrp-phone-panel').classList.toggle('open');if($p('#mssrp-phone-panel').classList.contains('open')){loadContacts();listen();}};
  $p('#mssrp-phone-close').onclick=()=>$p('#mssrp-phone-panel').classList.remove('open');
  root.addEventListener('click',e=>{const b=e.target.closest('[data-phone-key]');if(!b)return;const k=b.dataset.phoneKey;if(k==='⌫')digits.value=digits.value.slice(0,-1);else digits.value+=k;});
  $p('#mssrp-phone-dial').onclick=async()=>{const target=normalizeNumber(digits.value);if(!/^07\d{8}$/.test(target)&&!/^\+467\d{8}$/.test(digits.value.replace(/[\s-]/g,'')))return alert('Ange ett svenskt mobilnummer, t.ex. 0701234567. För att ringa i appen behöver numret vara kopplat till en användare.');const {data}=await supabase.from('profiles').select('id').limit(300);const match=(data||[]).find(u=>stableNumber(u.id).replace(/\s/g,'')===digits.value.replace(/\s/g,'')||stableNumber(u.id).replace('+46','0').replace(/\s/g,'')===target);if(match)startCall(match.id);else alert('Numret hittades inte bland appens användare.');};
  $p('#mssrp-phone-mute').onclick=()=>{muted=!muted;(localStream?.getAudioTracks()||[]).forEach(t=>t.enabled=!muted);$p('#mssrp-phone-mute').textContent=muted?'🔇 Mikrofon av':'🎙️ Mikrofon på';};
  $p('#mssrp-phone-hang').onclick=()=>{if(activePeer)signal(activePeer,'phone-hangup');cleanup();};
  if(myId()){loadContacts();listen();}
  supabase.auth.onAuthStateChange(()=>{setTimeout(()=>{if(myId()){loadContacts();listen();}else{cleanup();if(phoneChannel)supabase.removeChannel(phoneChannel);}},250);});
}
setTimeout(initMssrpPhone, 700);

})();
