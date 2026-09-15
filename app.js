/**
 * ER:LC Taktisk Planerare
 * Client-side tactical planning tool for Roblox ER:LC RP
 * Uses Konva.js + IndexedDB + Supabase (when logged in)
 */

(function () {
  'use strict';

  // ========== SUPABASE ==========
  // ← PASTE YOUR VALUES HERE
  const SUPABASE_URL = 'https://jixhrtgsxlvfrqlxkpwi.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oclE6KnOIjMIuXCyKaFRiQ_Y8WZYgpo';

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let currentUser = null;
  let isLoginMode = true;

  // ========== STATE ==========
  const state = {
    currentOp: null,
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
    selectedSymbol: null,
    selectedNodes: [],
    isDrawing: false,
    drawPoints: [],
    currentPath: null,
    history: [],
    historyIndex: -1,
    maxHistory: 50,
    groups: [],
    timeline: [],
    notes: '',
    transformer: null,
    scale: 1,
    stagePos: { x: 0, y: 0 },
    editingGroupId: null,
    editingTlId: null,
    confirmCallback: null,
    _mapBlob: null
  };

  const SYMBOL_LABELS = {
    police: 'Polis', patrol: 'Patrull', commander: 'Befäl', 'op-chief': 'Insatschef',
    operator: 'Operatör', ni: 'NI-operatör', k9: 'K9', medic: 'Sjukvårdare',
    negotiator: 'Förhandlare', scout: 'Spanare', sniper: 'Skytt',
    suspect: 'Misstänkt', armed: 'Beväpnad', hostage: 'Gisslan', civilian: 'Civilperson',
    vip: 'VIP', evidence: 'Bevis', 'main-target': 'Huvudmål', search: 'Sökområde',
    entry: 'Ingång', exit: 'Utgång', rally: 'Samlingsplats', command: 'Ledningsplats',
    vehicle: 'Fordonsplats', 'med-point': 'Sjukvårdsplats', barrier: 'Avspärrning',
    checkpoint: 'Kontrollpunkt', evac: 'Evakuering', collection: 'Uppsamling'
  };

  // ========== INDEXEDDB (fallback / offline) ==========
  const DB_NAME = 'ERLC_TaktiskPlanerare';
  const DB_VERSION = 1;
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('operations')) {
          database.createObjectStore('operations', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('mapImages')) {
          database.createObjectStore('mapImages', { keyPath: 'opId' });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function saveOperationLocal(op) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['operations'], 'readwrite');
      tx.objectStore('operations').put(op);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  function saveMapImage(opId, blob) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['mapImages'], 'readwrite');
      tx.objectStore('mapImages').put({ opId, blob, updated: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  function loadMapImage(opId) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['mapImages'], 'readonly');
      const req = tx.objectStore('mapImages').get(opId);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function loadAllOperationsLocal() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['operations'], 'readonly');
      const req = tx.objectStore('operations').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function deleteOperationLocal(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['operations', 'mapImages'], 'readwrite');
      tx.objectStore('operations').delete(id);
      tx.objectStore('mapImages').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ========== SUPABASE SAVE / LOAD ==========
  async function saveOperationCloud(op) {
    if (!currentUser) return;

    // Convert map blob → base64 if exists
    let mapBase64 = null;
    if (state._mapBlob) {
      mapBase64 = await blobToDataURL(state._mapBlob);
    }

    const payload = {
      user_id: currentUser.id,
      name: op.name,
      number: op.number || null,
      date: op.date || null,
      location: op.location || null,
      commander: op.commander || null,
      leader: op.leader || null,
      status: op.status || 'PLANERING',
      priority: op.priority || 'NORMAL',
      threat: op.threat || 'LÅG',
      objective: op.objective || null,
      notes: op.notes || null,
      data: {
        objects: op.objects || [],
        groups: op.groups || [],
        timeline: op.timeline || [],
        scale: op.scale || 1,
        stageX: op.stageX || 0,
        stageY: op.stageY || 0,
        mapImage: mapBase64
      },
      updated_at: new Date().toISOString()
    };

    if (op.cloudId) {
      // Update
      const { error } = await supabase
        .from('operations')
        .update(payload)
        .eq('id', op.cloudId);
      if (error) throw error;
    } else {
      // Insert
      const { data, error } = await supabase
        .from('operations')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      op.cloudId = data.id;
    }
  }

  async function loadAllOperationsCloud() {
    if (!currentUser) return [];
    const { data, error } = await supabase
      .from('operations')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      console.error(error);
      return [];
    }
    return (data || []).map(row => ({
      id: row.id,               // use cloud id as local id when logged in
      cloudId: row.id,
      name: row.name,
      number: row.number,
      date: row.date,
      location: row.location,
      commander: row.commander,
      leader: row.leader,
      status: row.status,
      priority: row.priority,
      threat: row.threat,
      objective: row.objective,
      notes: row.notes,
      objects: row.data?.objects || [],
      groups: row.data?.groups || [],
      timeline: row.data?.timeline || [],
      scale: row.data?.scale || 1,
      stageX: row.data?.stageX || 0,
      stageY: row.data?.stageY || 0,
      mapBase64: row.data?.mapImage || null,
      updated: new Date(row.updated_at).getTime(),
      hasMap: !!row.data?.mapImage
    }));
  }

  // ========== UTILS ==========
  function uid() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  function showModal(id) {
    document.getElementById(id).classList.add('active');
  }

  function hideModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  function confirmDialog(title, message, cb) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    state.confirmCallback = cb;
    showModal('confirm-modal');
  }

  function blobToDataURL(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(blob);
    });
  }

  function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8 = new Uint8Array(n);
    while (n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  // ========== AUTH UI ==========
  function updateAuthUI() {
    const loginBtn = document.getElementById('btn-login');
    const userInfo = document.getElementById('user-info');
    const userEmail = document.getElementById('user-email');

    if (currentUser) {
      loginBtn?.classList.add('hidden');
      userInfo?.classList.remove('hidden');
      if (userEmail) userEmail.textContent = currentUser.email;
    } else {
      loginBtn?.classList.remove('hidden');
      userInfo?.classList.add('hidden');
    }
  }

  function setAuthMode(login) {
    isLoginMode = login;
    document.getElementById('auth-title').textContent = login ? 'Logga in' : 'Skapa konto';
    document.getElementById('btn-auth-submit').textContent = login ? 'Logga in' : 'Skapa konto';
    document.getElementById('auth-switch-text').textContent = login ? 'Har du inget konto?' : 'Har du redan ett konto?';
    document.getElementById('auth-toggle').textContent = login ? 'Skapa konto' : 'Logga in';
    document.getElementById('auth-error').style.display = 'none';
  }

  // ========== HISTORY + SERIALIZE (unchanged from your original) ==========
  // ... keep all your original functions: pushHistory, undo, redo,
  // serializeObjects, restoreObjects, createObjectFromData,
  // createSymbolNode, getSymbolIcon, attachNodeEvents, selectNode, clearSelection
  // initStage, updateCoordsDisplay, getRelativePointer,
  // onPointerDown, onPointerMove, onPointerUp,
  // loadMapFromFile, loadMapFromBlob, fitMapToScreen,
  // renderGroups, applyGroupFilter, updateObjectsList, renderLayers,
  // renderTimeline, updatePropertiesPanel, openEditObject
  // (copy them exactly from your original file)

  // ========== SAVE / LOAD OPERATION (updated) ==========
  async function collectOpData() {
    const op = state.currentOp;
    if (!op) return null;
    op.objects = serializeObjects();
    op.groups = state.groups;
    op.timeline = state.timeline;
    op.notes = document.getElementById('op-notes-panel')?.value || state.notes;
    op.scale = state.stage ? state.stage.scaleX() : 1;
    op.stageX = state.stage ? state.stage.x() : 0;
    op.stageY = state.stage ? state.stage.y() : 0;
    op.updated = Date.now();
    op.hasMap = !!state._mapBlob || !!state.mapImage;
    return op;
  }

  async function saveCurrentOp() {
    if (!state.currentOp) return;
    const op = await collectOpData();

    // Always save locally
    await saveOperationLocal(op);
    if (state._mapBlob) {
      await saveMapImage(op.id, state._mapBlob);
    }

    // Also save to cloud if logged in
    if (currentUser) {
      try {
        await saveOperationCloud(op);
        toast('Operation sparad (moln + lokalt)', 'success');
      } catch (err) {
        console.error(err);
        toast('Sparad lokalt, men molnsparning misslyckades', 'error');
      }
    } else {
      toast('Operation sparad lokalt', 'success');
    }

    state.currentOp = op;
  }

  async function openOperation(id) {
    let op = null;

    if (currentUser) {
      // Try cloud first
      const cloudOps = await loadAllOperationsCloud();
      op = cloudOps.find(o => o.id === id || o.cloudId === id);
    }

    if (!op) {
      // Fallback to local
      const localOps = await loadAllOperationsLocal();
      op = localOps.find(o => o.id === id);
    }

    if (!op) {
      toast('Operation hittades inte', 'error');
      return;
    }

    state.currentOp = op;
    state.groups = op.groups || [];
    state.timeline = op.timeline || [];
    state.notes = op.notes || '';
    state.history = [];
    state.historyIndex = -1;

    document.getElementById('start-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    document.getElementById('header-op-name').textContent = op.name;
    document.getElementById('header-op-meta').textContent =
      `${op.status || ''} · ${op.location || ''} · Hot: ${op.threat || ''}`;
    if (document.getElementById('op-notes-panel')) {
      document.getElementById('op-notes-panel').value = op.notes || '';
    }

    if (!state.stage) initStage();
    else {
      state.layers.objects.destroyChildren();
      state.layers.map.destroyChildren();
      state.mapImage = null;
      state._mapBlob = null;
    }

    // Load map
    if (op.mapBase64) {
      const blob = dataURLtoBlob(op.mapBase64);
      loadMapFromBlob(blob);
    } else {
      const mapBlob = await loadMapImage(op.id);
      if (mapBlob) loadMapFromBlob(mapBlob);
      else {
        document.getElementById('map-status').textContent = 'Ingen karta uppladdad';
        document.getElementById('btn-upload-map')?.classList.remove('hidden');
        document.getElementById('btn-change-map')?.classList.add('hidden');
      }
    }

    setTimeout(() => {
      restoreObjects(op.objects || []);
      if (op.scale) {
        state.stage.scale({ x: op.scale, y: op.scale });
        state.stage.position({ x: op.stageX || 0, y: op.stageY || 0 });
        state.scale = op.scale;
      }
      pushHistory();
      renderGroups();
      renderTimeline();
      renderLayers();
      updateObjectsList();
      updateCoordsDisplay();
    }, 120);
  }

  // ========== OPS LIST (updated) ==========
  async function refreshOpsList() {
    let ops = [];

    if (currentUser) {
      ops = await loadAllOperationsCloud();
    } else {
      ops = await loadAllOperationsLocal();
    }

    state.opsList = ops.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const grid = document.getElementById('saved-ops-list');
    const noMsg = document.getElementById('no-ops-msg');
    grid.innerHTML = '';

    if (!ops.length) {
      noMsg.style.display = 'block';
      return;
    }
    noMsg.style.display = 'none';

    for (const op of ops) {
      const card = document.createElement('div');
      card.className = 'op-card';
      const dateStr = op.updated ? new Date(op.updated).toLocaleString('sv-SE') : '';
      let thumbHtml = '<div class="op-card-thumb">Ingen karta</div>';

      if (op.mapBase64) {
        thumbHtml = `<div class="op-card-thumb"><img src="${op.mapBase64}" alt=""></div>`;
      } else {
        try {
          const blob = await loadMapImage(op.id);
          if (blob) {
            const url = URL.createObjectURL(blob);
            thumbHtml = `<div class="op-card-thumb"><img src="${url}" alt=""></div>`;
          }
        } catch (_) {}
      }

      card.innerHTML = `
        ${thumbHtml}
        <div class="op-card-name">${op.name}</div>
        <div class="op-card-meta">${op.location || ''} · ${dateStr}</div>
        <span class="op-card-status status-${op.status || 'PLANERING'}">${op.status || 'PLANERING'}</span>
        <div class="op-card-actions">
          <button class="btn btn-secondary btn-sm" data-open="${op.id}">Öppna</button>
          <button class="btn btn-secondary btn-sm" data-dup="${op.id}">Duplicera</button>
          <button class="btn btn-danger btn-sm" data-del="${op.id}">Ta bort</button>
        </div>
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openOperation(btn.dataset.open);
      });
    });

    // Keep your original duplicate + delete handlers (they still work with local)
    // ... (copy the rest of your original refreshOpsList event listeners)
  }

  // ========== UI BINDINGS (add auth parts) ==========
  function bindUI() {
    // === AUTH ===
    document.getElementById('btn-login')?.addEventListener('click', () => {
      setAuthMode(true);
      showModal('auth-modal');
    });

    document.getElementById('auth-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      setAuthMode(!isLoginMode);
    });

    document.getElementById('btn-auth-submit')?.addEventListener('click', async () => {
      const email = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const errorEl = document.getElementById('auth-error');

      if (!email || !password) {
        errorEl.textContent = 'Fyll i både e-post och lösenord';
        errorEl.style.display = 'block';
        return;
      }

      try {
        if (isLoginMode) {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          toast('Inloggad!', 'success');
        } else {
          const { error } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
          toast('Konto skapat!', 'success');
        }
        hideModal('auth-modal');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    });

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      await supabase.auth.signOut();
      toast('Utloggad');
    });

    // === REST OF YOUR ORIGINAL bindUI() ===
    // Copy everything else from your original bindUI function here
    // (modals, tools, symbols, map upload, zoom, undo/redo, save, export, tabs, groups, timeline, notes, edit object...)
  }

  // ========== INIT ==========
  async function init() {
    await openDB();
    bindUI();

    // Auth state
    supabase.auth.onAuthStateChange((event, session) => {
      currentUser = session?.user || null;
      updateAuthUI();
      refreshOpsList();
    });

    // Demo op (local only)
    const ops = await loadAllOperationsLocal();
    if (!ops.find(o => o.id === 'demo_nightfall')) {
      // keep your createDemoOp() if you want
    }

    await refreshOpsList();
  }

  init().catch(err => {
    console.error('Init failed', err);
    toast('Kunde inte starta applikationen', 'error');
  });
})();
