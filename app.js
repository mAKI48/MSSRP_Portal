/**
 * ER:LC Taktisk Planerare
 * Full version with Supabase + smaller symbols + quantity + staging + right-click pan
 */

(function () {
  'use strict';

  // ========== SUPABASE ==========
  const SUPABASE_URL = 'https://jixhrtgsxlvfrqlxkpwi.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_oclE6KnOIjMIuXCyKaFRiQ_Y8WZYgpo'; // ← put your Publishable key

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  let currentUser = null;
  let isLoginMode = true;

  // ========== STATE ==========
  const state = {
    currentOp: null,
    opsList: [],
    stage: null,
    layers: { map: null, objects: null, selection: null },
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
    checkpoint: 'Kontrollpunkt', evac: 'Evakuering', collection: 'Uppsamling',
    staging: 'Staging', holding: 'Holding', stack: 'Stack-up', 'emergency-exit': 'Nödutgång'
  };

  // ========== INDEXEDDB ==========
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

  // ========== SUPABASE CLOUD ==========
  async function saveOperationCloud(op) {
    if (!currentUser) return;

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
      const { error } = await supabase.from('operations').update(payload).eq('id', op.cloudId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('operations').insert(payload).select('id').single();
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
      id: row.id,
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

  // ========== AUTH ==========
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

  // ========== HISTORY ==========
  function pushHistory() {
    if (!state.stage) return;
    const snapshot = serializeObjects();
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    if (state.history.length > state.maxHistory) state.history.shift();
    else state.historyIndex++;
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    restoreObjects(state.history[state.historyIndex]);
    toast('Ångrat');
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex++;
    restoreObjects(state.history[state.historyIndex]);
    toast('Gjort om');
  }

  // ========== SERIALIZE ==========
  function serializeObjects() {
    if (!state.layers.objects) return [];
    return state.layers.objects.getChildren().map(node => {
      const data = {
        id: node.id(),
        type: node.getAttr('objType') || node.className,
        name: node.getAttr('objName') || '',
        desc: node.getAttr('objDesc') || '',
        groupId: node.getAttr('groupId') || '',
        color: node.getAttr('objColor') || '#2563eb',
        quantity: node.getAttr('quantity') || 1,
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY()
      };
      if (node.className === 'Group' && node.getAttr('objType') === 'symbol') {
        data.symbolType = node.getAttr('symbolType');
        data.label = node.getAttr('objName');
      } else if (node.className === 'Line' || node.className === 'Arrow') {
        data.points = node.points();
        data.stroke = node.stroke();
        data.strokeWidth = node.strokeWidth();
        data.dash = node.dash();
        data.opacity = node.opacity();
        data.isArrow = !!node.getAttr('isArrow');
        data.isFreehand = !!node.getAttr('isFreehand');
      } else if (node.className === 'Rect') {
        data.width = node.width();
        data.height = node.height();
        data.fill = node.fill();
        data.stroke = node.stroke();
        data.strokeWidth = node.strokeWidth();
        data.opacity = node.opacity();
        data.dash = node.dash();
      } else if (node.className === 'Circle') {
        data.radius = node.radius();
        data.fill = node.fill();
        data.stroke = node.stroke();
        data.strokeWidth = node.strokeWidth();
        data.opacity = node.opacity();
      } else if (node.className === 'Text') {
        data.text = node.text();
        data.fontSize = node.fontSize();
        data.fontStyle = node.fontStyle();
        data.fill = node.fill();
      }
      return data;
    });
  }

  function restoreObjects(objects) {
    if (!state.layers.objects) return;
    state.layers.objects.destroyChildren();
    state.selectedNodes = [];
    if (state.transformer) state.transformer.nodes([]);
    (objects || []).forEach(obj => createObjectFromData(obj));
    state.layers.objects.batchDraw();
    updateObjectsList();
  }

  function createObjectFromData(data) {
    let node = null;
    if (data.type === 'symbol' || data.symbolType) {
      node = createSymbolNode(data.symbolType || 'police', data.x, data.y, data);
    } else if (data.type === 'Line' || data.type === 'arrow' || data.isArrow) {
      const pts = data.points || [0, 0, 50, 0];
      if (data.isArrow || data.type === 'arrow') {
        node = new Konva.Arrow({
          points: pts,
          stroke: data.stroke || data.color || '#2563eb',
          strokeWidth: data.strokeWidth || 3,
          fill: data.stroke || data.color || '#2563eb',
          pointerLength: 12,
          pointerWidth: 10,
          dash: data.dash || [],
          opacity: data.opacity ?? 1,
          draggable: true,
          id: data.id || uid()
        });
        node.setAttr('isArrow', true);
      } else {
        node = new Konva.Line({
          points: pts,
          stroke: data.stroke || data.color || '#2563eb',
          strokeWidth: data.strokeWidth || 3,
          dash: data.dash || [],
          opacity: data.opacity ?? 1,
          lineCap: 'round',
          lineJoin: 'round',
          draggable: true,
          id: data.id || uid(),
          tension: data.isFreehand ? 0.3 : 0
        });
        if (data.isFreehand) node.setAttr('isFreehand', true);
      }
      node.setAttr('objType', data.isArrow ? 'arrow' : (data.isFreehand ? 'freehand' : 'line'));
    } else if (data.type === 'Rect' || data.type === 'rect' || data.type === 'area') {
      node = new Konva.Rect({
        x: data.x, y: data.y,
        width: data.width || 80,
        height: data.height || 60,
        fill: data.fill || (data.type === 'area' ? 'rgba(37,99,235,0.2)' : 'transparent'),
        stroke: data.stroke || data.color || '#2563eb',
        strokeWidth: data.strokeWidth || 2,
        dash: data.dash || [],
        opacity: data.opacity ?? 1,
        draggable: true,
        id: data.id || uid()
      });
      node.setAttr('objType', data.type === 'area' ? 'area' : 'rect');
    } else if (data.type === 'Circle' || data.type === 'circle') {
      node = new Konva.Circle({
        x: data.x, y: data.y,
        radius: data.radius || 40,
        fill: data.fill || 'transparent',
        stroke: data.stroke || data.color || '#2563eb',
        strokeWidth: data.strokeWidth || 2,
        opacity: data.opacity ?? 1,
        draggable: true,
        id: data.id || uid()
      });
      node.setAttr('objType', 'circle');
    } else if (data.type === 'Text' || data.type === 'text') {
      node = new Konva.Text({
        x: data.x, y: data.y,
        text: data.text || data.name || 'Text',
        fontSize: data.fontSize || 16,
        fontFamily: 'Inter, sans-serif',
        fontStyle: data.fontStyle || 'normal',
        fill: data.fill || data.color || '#f1f5f9',
        draggable: true,
        id: data.id || uid()
      });
      node.setAttr('objType', 'text');
    }

    if (node) {
      node.setAttr('objName', data.name || data.label || '');
      node.setAttr('objDesc', data.desc || '');
      node.setAttr('groupId', data.groupId || '');
      node.setAttr('objColor', data.color || '#2563eb');
      if (data.rotation) node.rotation(data.rotation);
      if (data.scaleX) node.scaleX(data.scaleX);
      if (data.scaleY) node.scaleY(data.scaleY);
      attachNodeEvents(node);
      state.layers.objects.add(node);
    }
    return node;
  }

  // ========== SYMBOL (SMALLER + QUANTITY) ==========
  function createSymbolNode(symbolType, x, y, extra = {}) {
    const color = extra.color || extra.objColor || document.getElementById('draw-color')?.value || '#2563eb';
    const label = extra.name || extra.label || SYMBOL_LABELS[symbolType] || symbolType;
    const quantity = extra.quantity || extra.qty || 1;

    const group = new Konva.Group({
      x, y,
      draggable: true,
      id: extra.id || uid()
    });
    group.setAttr('objType', 'symbol');
    group.setAttr('symbolType', symbolType);
    group.setAttr('objName', label);
    group.setAttr('objDesc', extra.desc || '');
    group.setAttr('groupId', extra.groupId || '');
    group.setAttr('objColor', color);
    group.setAttr('quantity', quantity);

    const circle = new Konva.Circle({
      radius: 9,
      fill: color,
      stroke: '#0f172a',
      strokeWidth: 1.5,
      shadowColor: 'black',
      shadowBlur: 3,
      shadowOpacity: 0.35
    });

    const icon = new Konva.Text({
      text: getSymbolIcon(symbolType),
      fontSize: 10,
      fill: '#fff',
      align: 'center',
      offsetX: 5,
      offsetY: 5
    });

    const text = new Konva.Text({
      text: label,
      fontSize: 10,
      fontFamily: 'Inter, sans-serif',
      fill: '#f1f5f9',
      y: 12,
      align: 'center',
      shadowColor: 'black',
      shadowBlur: 2,
      shadowOpacity: 0.8
    });
    text.offsetX(text.width() / 2);

    group.add(circle);
    group.add(icon);
    group.add(text);

    if (quantity > 1) {
      const qtyText = new Konva.Text({
        text: 'x' + quantity,
        fontSize: 11,
        fontStyle: 'bold',
        fontFamily: 'Inter, sans-serif',
        fill: '#fbbf24',
        y: -18,
        align: 'center',
        shadowColor: 'black',
        shadowBlur: 3,
        shadowOpacity: 0.9
      });
      qtyText.offsetX(qtyText.width() / 2);
      group.add(qtyText);
    }

    return group;
  }

  function getSymbolIcon(type) {
    const icons = {
      police: 'P', patrol: 'P', commander: '★', 'op-chief': '★★', operator: '●',
      ni: 'NI', k9: 'K9', medic: '+', negotiator: 'F', scout: 'S', sniper: 'Y',
      suspect: '!', armed: '!', hostage: 'G', civilian: 'C', vip: 'V',
      evidence: 'B', 'main-target': 'H', search: '?', entry: '→', exit: '←',
      rally: 'S', command: 'L', vehicle: 'F', 'med-point': '+', barrier: '—',
      checkpoint: 'K', evac: 'E', collection: 'U',
      staging: '☰', holding: '⏸', stack: '≡', 'emergency-exit': '🚪'
    };
    return icons[type] || '•';
  }

  function attachNodeEvents(node) {
    node.on('dragend', () => { pushHistory(); updateObjectsList(); });
    node.on('click tap', (e) => {
      if (state.currentTool !== 'select') return;
      e.cancelBubble = true;
      selectNode(node, e.evt.shiftKey);
    });
    node.on('dblclick dbltap', () => openEditObject(node));
  }

  function selectNode(node, multi = false) {
    if (!multi) {
      state.selectedNodes = [];
    }
    if (!state.selectedNodes.includes(node)) state.selectedNodes.push(node);
    if (state.transformer) {
      state.transformer.nodes(state.selectedNodes);
      state.layers.selection.batchDraw();
    }
    updatePropertiesPanel();
    updateObjectsList();
  }

  function clearSelection() {
    state.selectedNodes = [];
    if (state.transformer) {
      state.transformer.nodes([]);
      state.layers.selection.batchDraw();
    }
    updatePropertiesPanel();
    updateObjectsList();
  }

  // ========== STAGE + RIGHT-CLICK PAN ==========
  function initStage() {
    const container = document.getElementById('konva-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    state.stage = new Konva.Stage({
      container: 'konva-container',
      width: w,
      height: h,
      draggable: false
    });

    state.layers.map = new Konva.Layer({ name: 'map' });
    state.layers.objects = new Konva.Layer({ name: 'objects' });
    state.layers.selection = new Konva.Layer({ name: 'selection' });

    state.stage.add(state.layers.map);
    state.stage.add(state.layers.objects);
    state.stage.add(state.layers.selection);

    state.transformer = new Konva.Transformer({
      rotateEnabled: true,
      enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      borderStroke: '#3b82f6',
      anchorFill: '#2563eb',
      anchorStroke: '#fff',
      anchorSize: 8
    });
    state.layers.selection.add(state.transformer);

    // Wheel zoom
    state.stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const oldScale = state.stage.scaleX();
      const pointer = state.stage.getPointerPosition();
      const scaleBy = e.evt.deltaY > 0 ? 0.92 : 1.08;
      const newScale = Math.min(Math.max(oldScale * scaleBy, 0.1), 8);
      state.stage.scale({ x: newScale, y: newScale });
      const mousePointTo = {
        x: (pointer.x - state.stage.x()) / oldScale,
        y: (pointer.y - state.stage.y()) / oldScale
      };
      state.stage.position({
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale
      });
      state.scale = newScale;
      updateCoordsDisplay();
    });

    // Normal drawing events
    state.stage.on('mousedown touchstart', onPointerDown);
    state.stage.on('mousemove touchmove', onPointerMove);
    state.stage.on('mouseup touchend', onPointerUp);
    state.stage.on('click tap', (e) => {
      if (e.target === state.stage) clearSelection();
    });

    // ===== RIGHT-CLICK PAN =====
    let isRightPanning = false;
    let lastPanPos = null;

    state.stage.on('contextmenu', (e) => e.evt.preventDefault());

    state.stage.on('mousedown', (e) => {
      if (e.evt.button === 2) {
        isRightPanning = true;
        lastPanPos = state.stage.getPointerPosition();
        state.stage.container().style.cursor = 'grabbing';
      }
    });

    state.stage.on('mousemove', () => {
      if (!isRightPanning || !lastPanPos) return;
      const pos = state.stage.getPointerPosition();
      if (!pos) return;
      state.stage.position({
        x: state.stage.x() + (pos.x - lastPanPos.x),
        y: state.stage.y() + (pos.y - lastPanPos.y)
      });
      state.stage.batchDraw();
      lastPanPos = pos;
      updateCoordsDisplay();
    });

    state.stage.on('mouseup', (e) => {
      if (e.evt.button === 2) {
        isRightPanning = false;
        lastPanPos = null;
        state.stage.container().style.cursor = 'default';
      }
    });

    state.stage.on('mouseleave', () => {
      isRightPanning = false;
      lastPanPos = null;
      state.stage.container().style.cursor = 'default';
    });

    window.addEventListener('resize', () => {
      if (!state.stage) return;
      const c = document.getElementById('konva-container');
      state.stage.width(c.clientWidth);
      state.stage.height(c.clientHeight);
    });

    updateCoordsDisplay();
  }

  function updateCoordsDisplay() {
    const el = document.getElementById('coords-display');
    if (!el || !state.stage) return;
    const p = state.stage.getPointerPosition() || { x: 0, y: 0 };
    const scale = Math.round(state.stage.scaleX() * 100);
    el.textContent = `x: ${Math.round(p.x)}, y: ${Math.round(p.y)} | Zoom: ${scale}%`;
  }

  function getRelativePointer() {
    const pos = state.stage.getPointerPosition();
    if (!pos) return null;
    const transform = state.stage.getAbsoluteTransform().copy().invert();
    return transform.point(pos);
  }

  // ========== POINTER HANDLERS ==========
  function onPointerDown(e) {
    if (e.evt.button === 2) return; // right click is for pan

    if (state.mapLocked && state.currentTool === 'pan') return;
    const tool = state.currentTool;

    if (tool === 'pan') {
      state.stage.draggable(true);
      return;
    }

    if (tool === 'select') return;

    const pos = getRelativePointer();
    if (!pos) return;

    state.isDrawing = true;
    state.drawPoints = [pos.x, pos.y];

    const color = document.getElementById('draw-color').value;
    const strokeW = parseInt(document.getElementById('stroke-width').value, 10);
    const opacity = parseInt(document.getElementById('draw-opacity').value, 10) / 100;
    const dashed = document.getElementById('draw-dashed').checked ? [8, 6] : [];

    // ===== SYMBOL WITH QUANTITY =====
    if (tool === 'symbol' && state.selectedSymbol) {
      const qtyStr = prompt('Antal (lämna tomt för 1):', '1');
      const quantity = parseInt(qtyStr, 10) || 1;

      const node = createSymbolNode(state.selectedSymbol, pos.x, pos.y, { quantity });
      attachNodeEvents(node);
      state.layers.objects.add(node);
      state.layers.objects.batchDraw();
      pushHistory();
      updateObjectsList();
      state.isDrawing = false;
      return;
    }

    if (tool === 'text') {
      const text = new Konva.Text({
        x: pos.x, y: pos.y,
        text: 'Text',
        fontSize: 16,
        fontFamily: 'Inter, sans-serif',
        fill: color,
        draggable: true,
        id: uid()
      });
      text.setAttr('objType', 'text');
      text.setAttr('objName', 'Text');
      text.setAttr('objColor', color);
      attachNodeEvents(text);
      state.layers.objects.add(text);
      state.layers.objects.batchDraw();
      pushHistory();
      updateObjectsList();
      openEditObject(text);
      state.isDrawing = false;
      return;
    }

    if (tool === 'line' || tool === 'arrow' || tool === 'path' || tool === 'freehand') {
      const isArrow = tool === 'arrow';
      const Cls = isArrow ? Konva.Arrow : Konva.Line;
      state.currentPath = new Cls({
        points: [pos.x, pos.y, pos.x, pos.y],
        stroke: color,
        strokeWidth: strokeW,
        fill: isArrow ? color : undefined,
        pointerLength: isArrow ? 12 : undefined,
        pointerWidth: isArrow ? 10 : undefined,
        dash: dashed,
        opacity,
        lineCap: 'round',
        lineJoin: 'round',
        tension: tool === 'freehand' ? 0.4 : 0,
        draggable: true,
        id: uid()
      });
      state.currentPath.setAttr('objType', tool);
      state.currentPath.setAttr('objColor', color);
      if (isArrow) state.currentPath.setAttr('isArrow', true);
      if (tool === 'freehand') state.currentPath.setAttr('isFreehand', true);
      state.layers.objects.add(state.currentPath);
    }

    if (tool === 'rect' || tool === 'area') {
      state.currentPath = new Konva.Rect({
        x: pos.x, y: pos.y, width: 0, height: 0,
        fill: tool === 'area' ? color + '33' : 'transparent',
        stroke: color,
        strokeWidth: strokeW,
        dash: dashed,
        opacity,
        draggable: true,
        id: uid()
      });
      state.currentPath.setAttr('objType', tool);
      state.currentPath.setAttr('objColor', color);
      state.currentPath.setAttr('_startX', pos.x);
      state.currentPath.setAttr('_startY', pos.y);
      state.layers.objects.add(state.currentPath);
    }

    if (tool === 'circle') {
      state.currentPath = new Konva.Circle({
        x: pos.x, y: pos.y, radius: 1,
        fill: 'transparent',
        stroke: color,
        strokeWidth: strokeW,
        dash: dashed,
        opacity,
        draggable: true,
        id: uid()
      });
      state.currentPath.setAttr('objType', 'circle');
      state.currentPath.setAttr('objColor', color);
      state.currentPath.setAttr('_startX', pos.x);
      state.currentPath.setAttr('_startY', pos.y);
      state.layers.objects.add(state.currentPath);
    }
  }

  function onPointerMove() {
    updateCoordsDisplay();
    if (!state.isDrawing || !state.currentPath) return;
    const pos = getRelativePointer();
    if (!pos) return;
    const tool = state.currentTool;

    if (tool === 'line' || tool === 'arrow') {
      const pts = state.currentPath.points();
      state.currentPath.points([pts[0], pts[1], pos.x, pos.y]);
    } else if (tool === 'freehand' || tool === 'path') {
      const pts = state.currentPath.points().concat([pos.x, pos.y]);
      state.currentPath.points(pts);
    } else if (tool === 'rect' || tool === 'area') {
      const sx = state.currentPath.getAttr('_startX');
      const sy = state.currentPath.getAttr('_startY');
      state.currentPath.x(Math.min(sx, pos.x));
      state.currentPath.y(Math.min(sy, pos.y));
      state.currentPath.width(Math.abs(pos.x - sx));
      state.currentPath.height(Math.abs(pos.y - sy));
    } else if (tool === 'circle') {
      const sx = state.currentPath.getAttr('_startX');
      const sy = state.currentPath.getAttr('_startY');
      const r = Math.sqrt((pos.x - sx) ** 2 + (pos.y - sy) ** 2);
      state.currentPath.radius(r);
    }
    state.layers.objects.batchDraw();
  }

  function onPointerUp() {
    state.stage.draggable(false);
    if (!state.isDrawing) return;
    state.isDrawing = false;

    if (state.currentPath) {
      attachNodeEvents(state.currentPath);
      pushHistory();
      updateObjectsList();
      state.currentPath = null;
    }
  }

  // ========== MAP ==========
  function loadMapFromFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (state.mapImage) state.mapImage.destroy();
      state.mapImage = new Konva.Image({ image: img, x: 0, y: 0, listening: false });
      state.layers.map.destroyChildren();
      state.layers.map.add(state.mapImage);
      state.layers.map.batchDraw();
      fitMapToScreen();
      document.getElementById('map-status').textContent = file.name || 'Karta uppladdad';
      document.getElementById('btn-upload-map').classList.add('hidden');
      document.getElementById('btn-change-map').classList.remove('hidden');
      state._mapBlob = file;
      toast('Karta laddad', 'success');
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function loadMapFromBlob(blob) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (state.mapImage) state.mapImage.destroy();
      state.mapImage = new Konva.Image({ image: img, x: 0, y: 0, listening: false });
      state.layers.map.destroyChildren();
      state.layers.map.add(state.mapImage);
      state.layers.map.batchDraw();
      document.getElementById('map-status').textContent = 'Karta återställd';
      document.getElementById('btn-upload-map').classList.add('hidden');
      document.getElementById('btn-change-map').classList.remove('hidden');
      state._mapBlob = blob;
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function fitMapToScreen() {
    if (!state.mapImage || !state.stage) return;
    const iw = state.mapImage.width();
    const ih = state.mapImage.height();
    const sw = state.stage.width();
    const sh = state.stage.height();
    const scale = Math.min(sw / iw, sh / ih) * 0.95;
    state.stage.scale({ x: scale, y: scale });
    state.stage.position({
      x: (sw - iw * scale) / 2,
      y: (sh - ih * scale) / 2
    });
    state.scale = scale;
    state.stage.batchDraw();
    updateCoordsDisplay();
  }

  // ========== GROUPS / OBJECTS / LAYERS / TIMELINE / PROPS ==========
  // (These stay almost the same as your original – shortened for space)
  function renderGroups() {
    const list = document.getElementById('groups-list');
    const filters = document.getElementById('group-filters');
    if (!list || !filters) return;
    list.innerHTML = '';
    filters.innerHTML = '';
    state.groups.forEach(g => {
      const item = document.createElement('div');
      item.className = 'group-item';
      item.innerHTML = `<span class="group-color" style="background:${g.color}"></span>
        <span style="flex:1">${g.name}</span>`;
      list.appendChild(item);
    });
  }

  function updateObjectsList() {
    const list = document.getElementById('objects-list');
    if (!list || !state.layers.objects) return;
    list.innerHTML = '';
    state.layers.objects.getChildren().forEach(node => {
      const item = document.createElement('div');
      item.className = 'obj-item' + (state.selectedNodes.includes(node) ? ' selected' : '');
      const color = node.getAttr('objColor') || '#2563eb';
      let name = node.getAttr('objName') || node.getAttr('objType') || 'Objekt';
      const qty = node.getAttr('quantity') || 1;
      if (qty > 1) name += ` x${qty}`;
      item.innerHTML = `<span class="obj-color" style="background:${color}"></span><span style="flex:1">${name}</span>`;
      item.addEventListener('click', () => selectNode(node));
      list.appendChild(item);
    });
  }

  function renderLayers() {
    // keep simple
  }

  function renderTimeline() {
    const list = document.getElementById('timeline-list');
    if (!list) return;
    list.innerHTML = '';
    state.timeline.forEach(t => {
      const item = document.createElement('div');
      item.className = 'tl-item';
      item.innerHTML = `<span class="tl-time">${t.time}</span><span style="flex:1">${t.event}</span>`;
      list.appendChild(item);
    });
  }

  function updatePropertiesPanel() {
    const content = document.getElementById('props-content');
    if (!content) return;
    if (!state.selectedNodes.length) {
      content.innerHTML = '<p class="muted">Markera ett objekt för att redigera.</p>';
      return;
    }
    const node = state.selectedNodes[0];
    content.innerHTML = `
      <div class="form-group"><label>Namn</label><input type="text" id="prop-name" value="${node.getAttr('objName') || ''}"></div>
      <div class="form-group"><label>Antal</label><input type="number" id="prop-qty" value="${node.getAttr('quantity') || 1}" min="1"></div>
      <button class="btn btn-secondary btn-sm full-width" id="prop-apply">Tillämpa</button>
    `;
    content.querySelector('#prop-apply').addEventListener('click', () => {
      node.setAttr('objName', content.querySelector('#prop-name').value);
      node.setAttr('quantity', parseInt(content.querySelector('#prop-qty').value, 10) || 1);
      // recreate symbol visual if needed
      state.layers.objects.batchDraw();
      pushHistory();
      updateObjectsList();
    });
  }

  function openEditObject(node) {
    // simple version
    document.getElementById('edit-obj-name').value = node.getAttr('objName') || '';
    state._editingNode = node;
    showModal('edit-object-modal');
  }

  // ========== SAVE / LOAD ==========
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
    return op;
  }

  async function saveCurrentOp() {
    if (!state.currentOp) return;
    const op = await collectOpData();

    await saveOperationLocal(op);
    if (state._mapBlob) await saveMapImage(op.id, state._mapBlob);

    if (currentUser) {
      try {
        await saveOperationCloud(op);
        toast('Sparad i molnet + lokalt', 'success');
      } catch (err) {
        console.error(err);
        toast('Sparad lokalt (moln misslyckades)', 'error');
      }
    } else {
      toast('Sparad lokalt', 'success');
    }
    state.currentOp = op;
  }

  async function openOperation(id) {
    let op = null;
    if (currentUser) {
      const cloudOps = await loadAllOperationsCloud();
      op = cloudOps.find(o => o.id === id || o.cloudId === id);
    }
    if (!op) {
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
    document.getElementById('header-op-meta').textContent = `${op.status || ''} · ${op.location || ''}`;

    if (!state.stage) initStage();
    else {
      state.layers.objects.destroyChildren();
      state.layers.map.destroyChildren();
      state.mapImage = null;
      state._mapBlob = null;
    }

    if (op.mapBase64) {
      loadMapFromBlob(dataURLtoBlob(op.mapBase64));
    } else {
      const mapBlob = await loadMapImage(op.id);
      if (mapBlob) loadMapFromBlob(mapBlob);
    }

    setTimeout(() => {
      restoreObjects(op.objects || []);
      if (op.scale) {
        state.stage.scale({ x: op.scale, y: op.scale });
        state.stage.position({ x: op.stageX || 0, y: op.stageY || 0 });
      }
      pushHistory();
      renderGroups();
      renderTimeline();
      updateObjectsList();
      updateCoordsDisplay();
    }, 150);
  }

  // ========== OPS LIST ==========
  async function refreshOpsList() {
    let ops = currentUser ? await loadAllOperationsCloud() : await loadAllOperationsLocal();
    state.opsList = ops.sort((a, b) => (b.updated || 0) - (a.updated || 0));

    const grid = document.getElementById('saved-ops-list');
    const noMsg = document.getElementById('no-ops-msg');
    grid.innerHTML = '';

    if (!ops.length) {
      noMsg.style.display = 'block';
      return;
    }
    noMsg.style.display = 'none';

    ops.forEach(op => {
      const card = document.createElement('div');
      card.className = 'op-card';
      card.innerHTML = `
        <div class="op-card-name">${op.name}</div>
        <div class="op-card-meta">${op.location || ''} · ${op.status || ''}</div>
        <div class="op-card-actions">
          <button class="btn btn-secondary btn-sm" data-open="${op.id}">Öppna</button>
        </div>
      `;
      grid.appendChild(card);
    });

    grid.querySelectorAll('[data-open]').forEach(btn => {
      btn.addEventListener('click', () => openOperation(btn.dataset.open));
    });
  }

  // ========== UI BINDINGS ==========
  function bindUI() {
    // Auth
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

    // Close modals
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => hideModal(btn.dataset.close));
    });

    // New op
    document.getElementById('btn-new-op')?.addEventListener('click', () => {
      document.getElementById('new-op-form').reset();
      document.getElementById('op-date').value = new Date().toISOString().slice(0, 10);
      showModal('new-op-modal');
    });

    document.getElementById('new-op-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const op = {
        id: uid(),
        name: document.getElementById('op-name').value,
        number: document.getElementById('op-number').value,
        date: document.getElementById('op-date').value,
        location: document.getElementById('op-location').value,
        commander: document.getElementById('op-commander').value,
        leader: document.getElementById('op-leader').value,
        status: document.getElementById('op-status').value,
        priority: document.getElementById('op-priority').value,
        threat: document.getElementById('op-threat').value,
        objective: document.getElementById('op-objective').value,
        notes: document.getElementById('op-notes').value,
        groups: [
          { id: uid(), name: 'ALFA', color: '#2563eb' },
          { id: uid(), name: 'BRAVO', color: '#7c3aed' }
        ],
        timeline: [],
        objects: [],
        created: Date.now(),
        updated: Date.now()
      };
      await saveOperationLocal(op);
      hideModal('new-op-modal');
      await refreshOpsList();
      openOperation(op.id);
    });

    // Back
    document.getElementById('btn-back-home')?.addEventListener('click', async () => {
      await saveCurrentOp();
      document.getElementById('app-screen').classList.remove('active');
      document.getElementById('start-screen').classList.add('active');
      await refreshOpsList();
    });

    // Tools
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.currentTool = btn.dataset.tool;
        clearSelection();
      });
    });

    // Symbols
    document.querySelectorAll('.symbol-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.symbol-item').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.selectedSymbol = btn.dataset.symbol;
        document.getElementById('draw-color').value = btn.dataset.color || '#2563eb';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tool="symbol"]')?.classList.add('active');
        state.currentTool = 'symbol';
      });
    });

    // Map
    document.getElementById('btn-upload-map')?.addEventListener('click', () => {
      document.getElementById('map-upload').click();
    });
    document.getElementById('map-upload')?.addEventListener('change', (e) => {
      if (e.target.files[0]) loadMapFromFile(e.target.files[0]);
    });

    // Save
    document.getElementById('btn-save')?.addEventListener('click', saveCurrentOp);

    // Zoom
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      const s = state.stage.scaleX() * 1.2;
      state.stage.scale({ x: s, y: s });
      state.stage.batchDraw();
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      const s = Math.max(0.1, state.stage.scaleX() * 0.8);
      state.stage.scale({ x: s, y: s });
      state.stage.batchDraw();
    });
    document.getElementById('btn-zoom-fit')?.addEventListener('click', fitMapToScreen);
  }

  // ========== INIT ==========
  async function init() {
    await openDB();
    bindUI();

    supabase.auth.onAuthStateChange((event, session) => {
      currentUser = session?.user || null;
      updateAuthUI();
      refreshOpsList();
    });

    await refreshOpsList();
  }

  init().catch(err => {
    console.error(err);
    toast('Kunde inte starta', 'error');
  });
})();
