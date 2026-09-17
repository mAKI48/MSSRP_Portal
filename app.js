(() => {
'use strict';

/* ============================================================
   MSSRP
   PRO UI APPLICATION
   ============================================================ */

const SUPABASE_URL =
  'https://jixhrtgsxlvfrqlxkpwi.supabase.co';

const SUPABASE_ANON_KEY =
  'sb_publishable_oclE6KnOIjMUxIuCyKaFRiQ_Y8WZYgpo';

const MSSRP_API_BASE = window.MSSRP_API_BASE || '/api';

const supabase =
  window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );


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
      crypto.randomUUID(),

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
    crypto.randomUUID();

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
      crypto.randomUUID(),

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
  const userInfo = $('#user-info');
  const email = $('#user-email');
  const badge = $('#user-role-badge');

  if (currentUser) {
    hide(loginButton);
    show(userInfo);
    if (email) email.textContent = currentUser.email || '';
    if (badge) badge.textContent = accessRoles.length ? accessRoles.map(formatRoleName).join(' + ') : 'Civil';
  } else {
    show(loginButton);
    hide(userInfo);
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
  if (hasPermission('admin')) await loadAdminUsers();
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
  const targets = ['#admin-users', '#admin-users-top'];
  const bodies = targets.map(sel => $(sel)).filter(Boolean);
  if (!bodies.length) return;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, user_roles(role_id, roles(name))')
      .order('display_name');
    if (error) throw error;
    const roles = ['civil','polis','fri','ni','dispatcher','admin'];
    const html = (data || []).map(user => {
      const assigned = (user.user_roles || []).map(x => x.roles?.name).filter(Boolean);
      const options = roles.map(role => `<option value="${role}">${formatRoleName(role)}</option>`).join('');
      return `<tr><td>${escapeHtml(user.display_name || user.id)}</td><td>${assigned.map(formatRoleName).join(', ') || '—'}</td><td><select data-admin-user="${user.id}">${options}</select></td><td><button class="mssrp-secondary" data-admin-add-role="${user.id}">Ge roll</button></td></tr>`;
    }).join('');
    bodies.forEach(body => body.innerHTML = html || '<tr><td colspan="4">Inga användare hittades.</td></tr>');
    $$('.mssrp-admin-table [data-admin-add-role]').forEach(btn => btn.addEventListener('click', async () => {
      const userId = btn.dataset.adminAddRole;
      const select = $(`[data-admin-user="${userId}"]`);
      const roleName = select?.value;
      if (!roleName) return;
      const { data: role, error: roleError } = await supabase.from('roles').select('id').eq('name', roleName).single();
      if (roleError) { toast(roleError.message); return; }
      const { error } = await supabase.from('user_roles').upsert({ user_id:userId, role_id:role.id }, { onConflict:'user_id,role_id' });
      if (error) { toast(error.message); return; }
      toast(`${formatRoleName(roleName)} tilldelad.`);
      await loadAdminUsers();
    }));
  } catch (error) {
    console.error('Admin users failed:', error);
    bodies.forEach(body => body.innerHTML = `<tr><td colspan="4">Kunde inte läsa användare.</td></tr>`);
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

function renderDispatchCalls(rows) {
  const el = $('#dispatch-calls-list');
  if (!el) return;
  if (!rows?.length) { el.innerHTML = '<span>Inga aktiva larm.</span>'; return; }
  el.innerHTML = rows.map(call => `<div class="mssrp-list-item"><div><strong>${escapeHtml(call.source === 'erlc' ? 'ER:LC 112' : 'MSSRP 112')}</strong><span>${escapeHtml(call.location || 'Okänd plats')}</span></div><div><span>${escapeHtml(call.caller_name || 'Okänd')}</span><small>${escapeHtml(call.description || '')}</small></div><b>${escapeHtml(call.status || 'new')}</b></div>`).join('');
}

function renderDispatchUnits(rows) {
  const el = $('#dispatch-units-list');
  if (!el) return;
  if (!rows?.length) { el.innerHTML = '<span>Inga enheter i tjänst.</span>'; return; }
  el.innerHTML = rows.map(unit => `<div class="mssrp-list-item"><div><strong>${escapeHtml(unit.callsign)}</strong><span>${escapeHtml(unit.unit_type || 'Enhet')}</span></div><b>${escapeHtml(unit.status || 'available')}</b></div>`).join('');
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
    supabase.from('dispatch_calls').select('id,source,caller_name,location,description,status,priority,created_at').in('status', ['new','assigned','active']).order('created_at', { ascending: false }).limit(50),
    supabase.from('dispatch_units').select('id,callsign,unit_type,status,user_id,assigned_call_id').order('callsign')
  ]);
  if (callsError) console.error('Dispatch calls:', callsError);
  if (unitsError) console.error('Dispatch units:', unitsError);
  renderDispatchCalls(calls || []);
  renderDispatchUnits(units || []);
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

function bindPortalEvents() {
  $$('[data-feature]').forEach(link => {
    link.addEventListener('click', event => {
      const feature = link.dataset.feature;
      if (!hasPermission(feature)) {
        event.preventDefault();
        if (!currentUser) {
          isLoginMode = true; updateAuthModal(); showModal('auth-modal');
        }
        toast(currentUser ? 'Du saknar behörighet till denna flik.' : 'Logga in för att se denna flik.');
      }
    });
  });

  $('#btn-new-op-portal')?.addEventListener('click', openNewOperationModal);
  $('#btn-open-op-portal')?.addEventListener('click', () => document.querySelector('#operations')?.scrollIntoView({ behavior:'smooth' }));
  $('#admin-refresh-top')?.addEventListener('click', loadAdminUsers);

  $('#portal-112-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireFeature('call_112')) return;
    const location = $('#portal-112-location')?.value.trim();
    const description = $('#portal-112-description')?.value.trim();
    if (!location || !description) return;
    try {
      const { error } = await supabase.from('dispatch_calls').insert({ caller_id: currentUser.id, location, description, priority:3 });
      if (error) throw error;
      event.target.reset();
      toast('112-larm skickat till Dispatch.');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Kunde inte skicka larmet.');
    }
  });

  $('#duty-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!requireFeature('dispatch')) return;
    const callsign = $('#duty-callsign')?.value.trim();
    const unitType = $('#duty-unit-type')?.value;
    try {
      await mssrpApi('/dispatch/on-duty', { method: 'POST', body: JSON.stringify({ callsign, unitType }) });
      event.target.reset();
      toast(`Enhet ${callsign} skapad. Du är nu i tjänst.`);
      await refreshDispatchBoard();
    } catch (error) { toast(error.message); }
  });

  $('#duty-off-btn')?.addEventListener('click', async () => {
    if (!requireFeature('dispatch')) return;
    try {
      await mssrpApi('/dispatch/off-duty', { method: 'POST', body: '{}' });
      toast('Du har gått ur tjänst.');
      await refreshDispatchBoard();
    } catch (error) { toast(error.message); }
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


function openEditor() {

  hide(
    $('#start-screen')
  );

  show(
    $('#app-screen')
  );

  updateHeader();

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

  initStage();

  ensureFloorControls();
  renderFloorControls();

  renderOperationObjects();

  renderGroups();

  renderTimeline();

  updateNotes();

  resetHistory();

  if (state.currentOp?.map) {

    loadMapFromData(
      state.currentOp.map
    );

  } else {

    clearMap();

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
      crypto.randomUUID(),

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
      crypto.randomUUID(),

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
      crypto.randomUUID(),

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
      crypto.randomUUID(),

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
      crypto.randomUUID(),

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
      crypto.randomUUID();

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

async function init() {

  bindEvents();
  bindPortalEvents();

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

})();