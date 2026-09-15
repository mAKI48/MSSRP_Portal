/**
 * ER:LC Taktisk Planerare
 * Client-side tactical planning tool for Roblox ER:LC RP
 * Uses Konva.js + IndexedDB
 */

(function () {
  'use strict';

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
    confirmCallback: null
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

  function saveOperation(op) {
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

  function loadAllOperations() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['operations'], 'readonly');
      const req = tx.objectStore('operations').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function deleteOperation(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['operations', 'mapImages'], 'readwrite');
      tx.objectStore('operations').delete(id);
      tx.objectStore('mapImages').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
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

  // ========== SERIALIZE / DESERIALIZE ==========
  function serializeObjects() {
    if (!state.layers.objects) return [];
    return state.layers.objects.getChildren().map(node => {
      const attrs = node.getAttrs();
      const data = {
        id: node.id(),
        type: node.getAttr('objType') || node.className,
        name: node.getAttr('objName') || '',
        desc: node.getAttr('objDesc') || '',
        groupId: node.getAttr('groupId') || '',
        color: node.getAttr('objColor') || '#2563eb',
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
        scaleX: node.scaleX(),
        scaleY: node.scaleY()
      };
      if (node.className === 'Group' && node.getAttr('objType') === 'symbol') {
        data.symbolType = node.getAttr('symbolType');
        data.label = node.getAttr('objName');
      } else if (node.className === 'Line') {
        data.points = node.points();
        data.stroke = node.stroke();
        data.strokeWidth = node.strokeWidth();
        data.dash = node.dash();
        data.opacity = node.opacity();
        data.lineCap = node.lineCap();
        data.lineJoin = node.lineJoin();
        data.pointerLength = node.pointerLength?.() || 0;
        data.pointerWidth = node.pointerWidth?.() || 0;
        data.isArrow = !!node.getAttr('isArrow');
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
        data.dash = node.dash();
      } else if (node.className === 'Text') {
        data.text = node.text();
        data.fontSize = node.fontSize();
        data.fontStyle = node.fontStyle();
        data.fill = node.fill();
        data.padding = node.padding();
      } else if (node.className === 'Path' || (node.className === 'Line' && node.getAttr('isFreehand'))) {
        data.points = node.points();
        data.stroke = node.stroke();
        data.strokeWidth = node.strokeWidth();
        data.opacity = node.opacity();
        data.isFreehand = true;
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
          pointerLength: data.pointerLength || 12,
          pointerWidth: data.pointerWidth || 10,
          dash: data.dash || [],
          opacity: data.opacity ?? 1,
          lineCap: 'round',
          lineJoin: 'round',
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
        dash: data.dash || [],
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
        padding: data.padding || 4,
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

  // ========== SYMBOL CREATION ==========
  function createSymbolNode(symbolType, x, y, extra = {}) {
    const color = extra.color || extra.objColor || document.getElementById('draw-color')?.value || '#2563eb';
    const label = extra.name || extra.label || SYMBOL_LABELS[symbolType] || symbolType;
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

    // Circle background
    const circle = new Konva.Circle({
      radius: 14,
      fill: color,
      stroke: '#0f172a',
      strokeWidth: 2,
      shadowColor: 'black',
      shadowBlur: 4,
      shadowOpacity: 0.4
    });
    // Label below
    const text = new Konva.Text({
      text: label,
      fontSize: 11,
      fontFamily: 'Inter, sans-serif',
      fill: '#f1f5f9',
      y: 18,
      align: 'center',
      offsetX: 0,
      shadowColor: 'black',
      shadowBlur: 3,
      shadowOpacity: 0.8
    });
    text.offsetX(text.width() / 2);

    // Icon text (simple)
    const icon = new Konva.Text({
      text: getSymbolIcon(symbolType),
      fontSize: 12,
      fill: '#fff',
      align: 'center',
      offsetX: 6,
      offsetY: 6
    });

    group.add(circle);
    group.add(icon);
    group.add(text);
    return group;
  }

  function getSymbolIcon(type) {
    const icons = {
      police: 'P', patrol: 'P', commander: '★', 'op-chief': '★★', operator: '●',
      ni: 'NI', k9: 'K9', medic: '+', negotiator: 'F', scout: 'S', sniper: 'Y',
      suspect: '!', armed: '!', hostage: 'G', civilian: 'C', vip: 'V',
      evidence: 'B', 'main-target': 'H', search: '?', entry: '→', exit: '←',
      rally: 'S', command: 'L', vehicle: 'F', 'med-point': '+', barrier: '—',
      checkpoint: 'K', evac: 'E', collection: 'U'
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
      state.selectedNodes.forEach(n => n.getAttr('_selected') && n.getAttr('_selected')(false));
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

  // ========== STAGE SETUP ==========
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

    // Mouse events for drawing / panning
    state.stage.on('mousedown touchstart', onPointerDown);
    state.stage.on('mousemove touchmove', onPointerMove);
    state.stage.on('mouseup touchend', onPointerUp);
    state.stage.on('click tap', (e) => {
      if (e.target === state.stage) clearSelection();
    });

    // Resize
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

  // ========== POINTER HANDLERS ==========
  function getRelativePointer() {
    const pos = state.stage.getPointerPosition();
    if (!pos) return null;
    const transform = state.stage.getAbsoluteTransform().copy().invert();
    return transform.point(pos);
  }

  function onPointerDown(e) {
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

    if (tool === 'symbol' && state.selectedSymbol) {
      const node = createSymbolNode(state.selectedSymbol, pos.x, pos.y);
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

    if (tool === 'polygon') {
      // Simple: start a closed line
      state.currentPath = new Konva.Line({
        points: [pos.x, pos.y],
        stroke: color,
        strokeWidth: strokeW,
        fill: color + '33',
        closed: true,
        dash: dashed,
        opacity,
        draggable: true,
        id: uid()
      });
      state.currentPath.setAttr('objType', 'polygon');
      state.currentPath.setAttr('objColor', color);
      state.layers.objects.add(state.currentPath);
      state.drawPoints = [pos.x, pos.y];
    }
  }

  function onPointerMove(e) {
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
    } else if (tool === 'polygon') {
      // live preview last point
      const pts = state.drawPoints.concat([pos.x, pos.y]);
      state.currentPath.points(pts);
    }
    state.layers.objects.batchDraw();
  }

  function onPointerUp(e) {
    state.stage.draggable(false);
    if (!state.isDrawing) return;
    state.isDrawing = false;

    if (state.currentPath) {
      attachNodeEvents(state.currentPath);
      // For polygon: on second click finish? For simplicity finish on mouseup for now, or keep adding
      if (state.currentTool === 'polygon') {
        // Keep drawing until double-click or switch tool - for now finalize
        const pts = state.currentPath.points();
        if (pts.length < 6) {
          // too few points, remove
          state.currentPath.destroy();
        } else {
          pushHistory();
          updateObjectsList();
        }
      } else {
        pushHistory();
        updateObjectsList();
      }
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
      state.mapImage = new Konva.Image({
        image: img,
        x: 0, y: 0,
        listening: false
      });
      state.layers.map.destroyChildren();
      state.layers.map.add(state.mapImage);
      state.layers.map.batchDraw();
      fitMapToScreen();
      document.getElementById('map-status').textContent = file.name || 'Karta uppladdad';
      document.getElementById('btn-upload-map').classList.add('hidden');
      document.getElementById('btn-change-map').classList.remove('hidden');
      // Store blob for save
      state._mapBlob = file;
      toast('Karta laddad', 'success');
      URL.revokeObjectURL(url);
    };
    img.onerror = () => toast('Kunde inte ladda bilden', 'error');
    img.src = url;
  }

  function loadMapFromBlob(blob) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (state.mapImage) state.mapImage.destroy();
      state.mapImage = new Konva.Image({
        image: img,
        x: 0, y: 0,
        listening: false
      });
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

  // ========== GROUPS ==========
  function renderGroups() {
    const list = document.getElementById('groups-list');
    const filters = document.getElementById('group-filters');
    list.innerHTML = '';
    filters.innerHTML = '';
    state.groups.forEach(g => {
      const item = document.createElement('div');
      item.className = 'group-item';
      item.innerHTML = `<span class="group-color" style="background:${g.color}"></span>
        <span style="flex:1">${g.name}</span>
        <button class="btn btn-icon-sm" data-edit-group="${g.id}" title="Redigera">✎</button>
        <button class="btn btn-icon-sm" data-del-group="${g.id}" title="Ta bort">🗑</button>`;
      list.appendChild(item);

      const fi = document.createElement('label');
      fi.className = 'group-filter-item';
      fi.innerHTML = `<input type="checkbox" data-filter-group="${g.id}" checked> ${g.name}`;
      filters.appendChild(fi);
    });

    // Default "Ingen grupp"
    const none = document.createElement('label');
    none.className = 'group-filter-item';
    none.innerHTML = `<input type="checkbox" data-filter-group="" checked> Ingen grupp`;
    filters.appendChild(none);

    list.querySelectorAll('[data-edit-group]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const g = state.groups.find(x => x.id === btn.dataset.editGroup);
        if (g) {
          state.editingGroupId = g.id;
          document.getElementById('group-modal-title').textContent = 'Redigera grupp';
          document.getElementById('group-name').value = g.name;
          document.getElementById('group-color').value = g.color;
          showModal('group-modal');
        }
      });
    });
    list.querySelectorAll('[data-del-group]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDialog('Ta bort grupp', 'Vill du ta bort gruppen?', () => {
          state.groups = state.groups.filter(x => x.id !== btn.dataset.delGroup);
          renderGroups();
          updateObjectsList();
        });
      });
    });

    filters.querySelectorAll('[data-filter-group]').forEach(cb => {
      cb.addEventListener('change', applyGroupFilter);
    });
  }

  function applyGroupFilter() {
    const checked = new Set();
    document.querySelectorAll('[data-filter-group]').forEach(cb => {
      if (cb.checked) checked.add(cb.dataset.filterGroup);
    });
    state.layers.objects.getChildren().forEach(node => {
      const gid = node.getAttr('groupId') || '';
      node.visible(checked.has(gid));
    });
    state.layers.objects.batchDraw();
  }

  // ========== OBJECTS LIST ==========
  function updateObjectsList() {
    const list = document.getElementById('objects-list');
    if (!list || !state.layers.objects) return;
    list.innerHTML = '';
    const byGroup = {};
    state.layers.objects.getChildren().forEach(node => {
      const gid = node.getAttr('groupId') || '__none';
      if (!byGroup[gid]) byGroup[gid] = [];
      byGroup[gid].push(node);
    });

    Object.keys(byGroup).forEach(gid => {
      const gName = gid === '__none' ? 'Övrigt' : (state.groups.find(g => g.id === gid)?.name || 'Grupp');
      const header = document.createElement('div');
      header.style.cssText = 'font-size:0.7rem;color:var(--text-muted);margin:0.4rem 0 0.2rem;font-weight:600;';
      header.textContent = gName;
      list.appendChild(header);

      byGroup[gid].forEach(node => {
        const item = document.createElement('div');
        item.className = 'obj-item' + (state.selectedNodes.includes(node) ? ' selected' : '');
        const color = node.getAttr('objColor') || '#2563eb';
        const name = node.getAttr('objName') || node.getAttr('objType') || 'Objekt';
        item.innerHTML = `<span class="obj-color" style="background:${color}"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${name}</span>`;
        item.addEventListener('click', () => selectNode(node));
        list.appendChild(item);
      });
    });
  }

  // ========== LAYERS PANEL ==========
  function renderLayers() {
    const list = document.getElementById('layers-list');
    list.innerHTML = '';
    const layerDefs = [
      { key: 'map', name: 'Karta', layer: state.layers.map },
      { key: 'objects', name: 'Objekt', layer: state.layers.objects }
    ];
    layerDefs.forEach(ld => {
      if (!ld.layer) return;
      const item = document.createElement('div');
      item.className = 'layer-item';
      const vis = ld.layer.visible();
      const locked = ld.key === 'map' ? state.mapLocked : false;
      item.innerHTML = `
        <button class="layer-vis" data-vis="${ld.key}" title="Visa/dölj">${vis ? '👁' : '👁‍🗨'}</button>
        <button class="layer-lock" data-lock="${ld.key}" title="Lås">${locked ? '🔒' : '🔓'}</button>
        <span style="flex:1">${ld.name}</span>
      `;
      list.appendChild(item);
    });
    list.querySelectorAll('[data-vis]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.vis;
        const layer = state.layers[key];
        if (layer) {
          layer.visible(!layer.visible());
          layer.batchDraw();
          renderLayers();
        }
      });
    });
    list.querySelectorAll('[data-lock]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.lock === 'map') {
          state.mapLocked = !state.mapLocked;
          renderLayers();
          document.getElementById('btn-lock-map').textContent = state.mapLocked ? '🔓 Lås upp' : '🔒 Lås karta';
        }
      });
    });
  }

  // ========== TIMELINE ==========
  function renderTimeline() {
    const list = document.getElementById('timeline-list');
    list.innerHTML = '';
    state.timeline.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    state.timeline.forEach(t => {
      const item = document.createElement('div');
      item.className = 'tl-item';
      item.innerHTML = `<span class="tl-time">${t.time}</span><span style="flex:1">${t.event}</span>
        <button class="btn btn-icon-sm" data-edit-tl="${t.id}">✎</button>
        <button class="btn btn-icon-sm" data-del-tl="${t.id}">🗑</button>`;
      list.appendChild(item);
    });
    list.querySelectorAll('[data-edit-tl]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = state.timeline.find(x => x.id === btn.dataset.editTl);
        if (t) {
          state.editingTlId = t.id;
          document.getElementById('tl-time').value = t.time;
          document.getElementById('tl-event').value = t.event;
          showModal('timeline-modal');
        }
      });
    });
    list.querySelectorAll('[data-del-tl]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.timeline = state.timeline.filter(x => x.id !== btn.dataset.delTl);
        renderTimeline();
      });
    });
  }

  // ========== PROPERTIES ==========
  function updatePropertiesPanel() {
    const content = document.getElementById('props-content');
    if (!state.selectedNodes.length) {
      content.innerHTML = '<p class="muted">Markera ett objekt för att redigera.</p>';
      return;
    }
    const node = state.selectedNodes[0];
    const name = node.getAttr('objName') || '';
    const color = node.getAttr('objColor') || '#2563eb';
    content.innerHTML = `
      <div class="form-group"><label>Namn</label><input type="text" id="prop-name" value="${name}"></div>
      <div class="form-group"><label>Färg</label><input type="color" id="prop-color" value="${color}"></div>
      <div class="form-group"><label>Grupp</label><select id="prop-group"><option value="">Ingen</option></select></div>
      <button class="btn btn-secondary btn-sm full-width" id="prop-apply" style="margin-top:0.5rem">Tillämpa</button>
      <button class="btn btn-danger btn-sm full-width" id="prop-delete" style="margin-top:0.35rem">Radera</button>
    `;
    const sel = content.querySelector('#prop-group');
    state.groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      if (node.getAttr('groupId') === g.id) opt.selected = true;
      sel.appendChild(opt);
    });
    content.querySelector('#prop-apply').addEventListener('click', () => {
      node.setAttr('objName', content.querySelector('#prop-name').value);
      const newColor = content.querySelector('#prop-color').value;
      node.setAttr('objColor', newColor);
      // Update visual color for symbols
      if (node.getAttr('objType') === 'symbol') {
        const circle = node.findOne('Circle');
        if (circle) circle.fill(newColor);
      } else if (node.stroke) {
        node.stroke(newColor);
        if (node.fill && node.getAttr('isArrow')) node.fill(newColor);
      }
      node.setAttr('groupId', content.querySelector('#prop-group').value);
      // Update label text
      if (node.getAttr('objType') === 'symbol') {
        const txt = node.find('Text');
        if (txt[1]) {
          txt[1].text(content.querySelector('#prop-name').value);
          txt[1].offsetX(txt[1].width() / 2);
        }
      }
      state.layers.objects.batchDraw();
      pushHistory();
      updateObjectsList();
    });
    content.querySelector('#prop-delete').addEventListener('click', () => {
      state.selectedNodes.forEach(n => n.destroy());
      clearSelection();
      pushHistory();
      updateObjectsList();
    });
  }

  function openEditObject(node) {
    document.getElementById('edit-obj-name').value = node.getAttr('objName') || '';
    document.getElementById('edit-obj-desc').value = node.getAttr('objDesc') || '';
    document.getElementById('edit-obj-color').value = node.getAttr('objColor') || '#2563eb';
    const sel = document.getElementById('edit-obj-group');
    sel.innerHTML = '<option value="">Ingen</option>';
    state.groups.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = g.name;
      if (node.getAttr('groupId') === g.id) opt.selected = true;
      sel.appendChild(opt);
    });
    const isText = node.getAttr('objType') === 'text';
    document.getElementById('edit-text-options').classList.toggle('hidden', !isText);
    if (isText) {
      document.getElementById('edit-text-size').value = node.fontSize() || 16;
      document.getElementById('edit-text-bold').checked = (node.fontStyle() || '').includes('bold');
      document.getElementById('edit-text-italic').checked = (node.fontStyle() || '').includes('italic');
    }
    state._editingNode = node;
    showModal('edit-object-modal');
  }

  // ========== SAVE / LOAD OPERATION ==========
  async function collectOpData() {
    const op = state.currentOp;
    if (!op) return null;
    op.objects = serializeObjects();
    op.groups = state.groups;
    op.timeline = state.timeline;
    op.notes = document.getElementById('op-notes-panel').value || state.notes;
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
    await saveOperation(op);
    if (state._mapBlob) {
      await saveMapImage(op.id, state._mapBlob);
    }
    toast('Operation sparad', 'success');
    state.currentOp = op;
  }

  async function openOperation(id) {
    const ops = await loadAllOperations();
    const op = ops.find(o => o.id === id);
    if (!op) { toast('Operation hittades inte', 'error'); return; }

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
    document.getElementById('op-notes-panel').value = op.notes || '';

    // Init stage if needed
    if (!state.stage) initStage();
    else {
      state.layers.objects.destroyChildren();
      state.layers.map.destroyChildren();
      state.mapImage = null;
    }

    // Load map
    const mapBlob = await loadMapImage(op.id);
    if (mapBlob) {
      loadMapFromBlob(mapBlob);
    } else {
      document.getElementById('map-status').textContent = 'Ingen karta uppladdad';
      document.getElementById('btn-upload-map').classList.remove('hidden');
      document.getElementById('btn-change-map').classList.add('hidden');
    }

    // Restore objects
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
    }, 100);
  }

  // ========== EXPORT / IMPORT ==========
  async function exportErLcPlan() {
    const op = await collectOpData();
    if (!op) return;
    let mapDataUrl = null;
    if (state._mapBlob) {
      mapDataUrl = await blobToDataURL(state._mapBlob);
    }
    const payload = {
      version: 1,
      type: 'erlcplan',
      operation: op,
      mapImage: mapDataUrl
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (op.name || 'operation').replace(/[^a-zA-Z0-9åäöÅÄÖ_-]/g, '_') + '.erlcplan';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Exporterad som .erlcplan', 'success');
  }

  async function importErLcPlan(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.operation) throw new Error('Ogiltig fil');
      const op = data.operation;
      op.id = uid(); // new id
      op.updated = Date.now();
      await saveOperation(op);
      if (data.mapImage) {
        const blob = dataURLtoBlob(data.mapImage);
        await saveMapImage(op.id, blob);
      }
      await refreshOpsList();
      toast('Operation importerad', 'success');
      openOperation(op.id);
    } catch (err) {
      console.error(err);
      toast('Kunde inte importera filen', 'error');
    }
  }

  function exportImage(format) {
    if (!state.stage) return;
    // Hide transformer temporarily
    const nodes = state.transformer.nodes();
    state.transformer.nodes([]);
    state.layers.selection.batchDraw();

    // Create a temporary stage clone for export with legend etc
    const dataURL = state.stage.toDataURL({
      pixelRatio: 2,
      mimeType: format === 'jpg' ? 'image/jpeg' : 'image/png',
      quality: 0.92
    });

    state.transformer.nodes(nodes);
    state.layers.selection.batchDraw();

    const a = document.createElement('a');
    a.href = dataURL;
    a.download = (state.currentOp?.name || 'plan') + '.' + format;
    a.click();
    toast('Bild exporterad', 'success');
  }

  // ========== DEMO OPERATION ==========
  function createDemoOp() {
    const op = {
      id: 'demo_nightfall',
      name: 'Operation Nightfall',
      number: 'OP-DEMO-001',
      date: new Date().toISOString().slice(0, 10),
      location: 'Liberty County',
      commander: 'Insatschef Demo',
      leader: 'Insatsledare Demo',
      status: 'PLANERING',
      priority: 'HÖG',
      threat: 'HÖG',
      objective: 'Högriskgripande',
      notes: 'Huvudmål:\nGrip misstänkt person.\n\nInformation:\nMisstänkt befinner sig sannolikt i byggnaden.\n\nÖvrigt:\nCivilpersoner kan finnas i området.',
      groups: [
        { id: 'g_alfa', name: 'ALFA', color: '#2563eb' },
        { id: 'g_bravo', name: 'BRAVO', color: '#7c3aed' },
        { id: 'g_ledning', name: 'LEDNING', color: '#a855f7' }
      ],
      timeline: [
        { id: 't1', time: '20:00', event: 'Genomgång' },
        { id: 't2', time: '20:10', event: 'Grupper lämnar samlingsplats' },
        { id: 't3', time: '20:15', event: 'Perimeter etablerad' },
        { id: 't4', time: '20:20', event: 'Insats påbörjas' },
        { id: 't5', time: '20:30', event: 'Mål säkrat' },
        { id: 't6', time: '20:40', event: 'Utrymning' }
      ],
      objects: [],
      created: Date.now(),
      updated: Date.now(),
      hasMap: false
    };
    return op;
  }

  // ========== UI BINDINGS ==========
  function bindUI() {
    // Close modals
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => hideModal(btn.dataset.close));
    });
    document.getElementById('btn-confirm-ok').addEventListener('click', () => {
      hideModal('confirm-modal');
      if (state.confirmCallback) state.confirmCallback();
      state.confirmCallback = null;
    });

    // Start screen
    document.getElementById('btn-new-op').addEventListener('click', () => {
      document.getElementById('new-op-form').reset();
      document.getElementById('op-date').value = new Date().toISOString().slice(0, 10);
      showModal('new-op-modal');
    });
    document.getElementById('btn-open-op').addEventListener('click', () => {
      document.querySelector('.saved-ops-section')?.scrollIntoView({ behavior: 'smooth' });
    });

    document.getElementById('new-op-form').addEventListener('submit', async (e) => {
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
          { id: uid(), name: 'BRAVO', color: '#7c3aed' },
          { id: uid(), name: 'LEDNING', color: '#a855f7' }
        ],
        timeline: [],
        objects: [],
        created: Date.now(),
        updated: Date.now(),
        hasMap: false
      };
      await saveOperation(op);
      hideModal('new-op-modal');
      await refreshOpsList();
      openOperation(op.id);
    });

    // Back
    document.getElementById('btn-back-home').addEventListener('click', async () => {
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
        state.stage.draggable(false);
        if (state.currentTool === 'select') {
          // keep selection
        } else {
          clearSelection();
        }
      });
    });

    // Symbols
    document.querySelectorAll('.symbol-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.symbol-item').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.selectedSymbol = btn.dataset.symbol;
        document.getElementById('draw-color').value = btn.dataset.color || '#2563eb';
        // Switch to symbol tool
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tool="symbol"]').classList.add('active');
        state.currentTool = 'symbol';
      });
    });

    // Stroke settings
    document.getElementById('stroke-width').addEventListener('input', (e) => {
      document.getElementById('stroke-width-val').textContent = e.target.value;
    });
    document.getElementById('draw-opacity').addEventListener('input', (e) => {
      document.getElementById('opacity-val').textContent = e.target.value;
    });

    // Map upload
    document.getElementById('btn-upload-map').addEventListener('click', () => {
      document.getElementById('map-upload').click();
    });
    document.getElementById('btn-change-map').addEventListener('click', () => {
      confirmDialog('Byt karta', 'Är du säker på att du vill byta karta? Den nuvarande kartan kommer att ersättas.', () => {
        document.getElementById('map-upload').click();
      });
    });
    document.getElementById('map-upload').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadMapFromFile(file);
      e.target.value = '';
    });
    document.getElementById('btn-lock-map').addEventListener('click', () => {
      state.mapLocked = !state.mapLocked;
      document.getElementById('btn-lock-map').textContent = state.mapLocked ? '🔓 Lås upp' : '🔒 Lås karta';
      renderLayers();
    });

    // Zoom
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      const s = state.stage.scaleX() * 1.2;
      state.stage.scale({ x: s, y: s });
      state.scale = s;
      state.stage.batchDraw();
      updateCoordsDisplay();
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      const s = Math.max(0.1, state.stage.scaleX() * 0.8);
      state.stage.scale({ x: s, y: s });
      state.scale = s;
      state.stage.batchDraw();
      updateCoordsDisplay();
    });
    document.getElementById('btn-zoom-fit').addEventListener('click', fitMapToScreen);
    document.getElementById('btn-zoom-reset').addEventListener('click', () => {
      state.stage.scale({ x: 1, y: 1 });
      state.stage.position({ x: 0, y: 0 });
      state.scale = 1;
      state.stage.batchDraw();
      updateCoordsDisplay();
    });

    // Undo/redo
    document.getElementById('btn-undo').addEventListener('click', undo);
    document.getElementById('btn-redo').addEventListener('click', redo);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
      if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedNodes.length && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
          state.selectedNodes.forEach(n => n.destroy());
          clearSelection();
          pushHistory();
          updateObjectsList();
        }
      }
    });

    // Save
    document.getElementById('btn-save').addEventListener('click', saveCurrentOp);

    // Export menu
    document.getElementById('btn-export-menu').addEventListener('click', () => {
      document.getElementById('export-dropdown').classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#btn-export-menu') && !e.target.closest('#export-dropdown')) {
        document.getElementById('export-dropdown').classList.add('hidden');
      }
    });
    document.querySelectorAll('[data-export]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('export-dropdown').classList.add('hidden');
        const t = btn.dataset.export;
        if (t === 'png' || t === 'jpg') exportImage(t);
        else if (t === 'erlcplan') exportErLcPlan();
      });
    });
    document.querySelector('[data-import="erlcplan"]').addEventListener('click', () => {
      document.getElementById('export-dropdown').classList.add('hidden');
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importErLcPlan(file);
      e.target.value = '';
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    // Groups
    document.getElementById('btn-add-group').addEventListener('click', () => {
      state.editingGroupId = null;
      document.getElementById('group-modal-title').textContent = 'Ny grupp';
      document.getElementById('group-name').value = '';
      document.getElementById('group-color').value = '#2563eb';
      showModal('group-modal');
    });
    document.getElementById('btn-save-group').addEventListener('click', () => {
      const name = document.getElementById('group-name').value.trim();
      const color = document.getElementById('group-color').value;
      if (!name) return;
      if (state.editingGroupId) {
        const g = state.groups.find(x => x.id === state.editingGroupId);
        if (g) { g.name = name; g.color = color; }
      } else {
        state.groups.push({ id: uid(), name, color });
      }
      hideModal('group-modal');
      renderGroups();
    });

    // Timeline
    document.getElementById('btn-add-timeline').addEventListener('click', () => {
      state.editingTlId = null;
      document.getElementById('tl-time').value = '';
      document.getElementById('tl-event').value = '';
      showModal('timeline-modal');
    });
    document.getElementById('btn-save-timeline').addEventListener('click', () => {
      const time = document.getElementById('tl-time').value.trim();
      const event = document.getElementById('tl-event').value.trim();
      if (!time || !event) return;
      if (state.editingTlId) {
        const t = state.timeline.find(x => x.id === state.editingTlId);
        if (t) { t.time = time; t.event = event; }
      } else {
        state.timeline.push({ id: uid(), time, event });
      }
      hideModal('timeline-modal');
      renderTimeline();
    });

    // Notes
    document.getElementById('btn-save-notes').addEventListener('click', () => {
      state.notes = document.getElementById('op-notes-panel').value;
      saveCurrentOp();
    });

    // Edit object modal
    document.getElementById('btn-save-obj').addEventListener('click', () => {
      const node = state._editingNode;
      if (!node) return;
      node.setAttr('objName', document.getElementById('edit-obj-name').value);
      node.setAttr('objDesc', document.getElementById('edit-obj-desc').value);
      node.setAttr('groupId', document.getElementById('edit-obj-group').value);
      const color = document.getElementById('edit-obj-color').value;
      node.setAttr('objColor', color);
      if (node.getAttr('objType') === 'symbol') {
        const circle = node.findOne('Circle');
        if (circle) circle.fill(color);
        const texts = node.find('Text');
        if (texts[1]) {
          texts[1].text(document.getElementById('edit-obj-name').value);
          texts[1].offsetX(texts[1].width() / 2);
        }
      } else if (node.getAttr('objType') === 'text') {
        node.text(document.getElementById('edit-obj-name').value);
        node.fontSize(parseInt(document.getElementById('edit-text-size').value, 10) || 16);
        let style = 'normal';
        if (document.getElementById('edit-text-bold').checked) style = 'bold';
        if (document.getElementById('edit-text-italic').checked) style += ' italic';
        node.fontStyle(style.trim());
        node.fill(color);
      } else if (node.stroke) {
        node.stroke(color);
      }
      state.layers.objects.batchDraw();
      pushHistory();
      updateObjectsList();
      hideModal('edit-object-modal');
    });
    document.getElementById('btn-delete-obj').addEventListener('click', () => {
      if (state._editingNode) {
        state._editingNode.destroy();
        clearSelection();
        pushHistory();
        updateObjectsList();
      }
      hideModal('edit-object-modal');
    });

    // Legend toggle
    document.getElementById('btn-toggle-legend').addEventListener('click', () => {
      document.getElementById('legend-content').classList.toggle('hidden');
    });
  }

  // ========== OPS LIST ==========
  async function refreshOpsList() {
    const ops = await loadAllOperations();
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
      try {
        const blob = await loadMapImage(op.id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          thumbHtml = `<div class="op-card-thumb"><img src="${url}" alt=""></div>`;
        }
      } catch (_) {}
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
      btn.addEventListener('click', (e) => { e.stopPropagation(); openOperation(btn.dataset.open); });
    });
    grid.querySelectorAll('[data-dup]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const src = state.opsList.find(o => o.id === btn.dataset.dup);
        if (!src) return;
        const copy = JSON.parse(JSON.stringify(src));
        copy.id = uid();
        copy.name = src.name + ' (kopia)';
        copy.updated = Date.now();
        await saveOperation(copy);
        const mapBlob = await loadMapImage(src.id);
        if (mapBlob) await saveMapImage(copy.id, mapBlob);
        await refreshOpsList();
        toast('Operation duplicerad', 'success');
      });
    });
    grid.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDialog('Ta bort operation', 'Är du säker? Detta kan inte ångras.', async () => {
          await deleteOperation(btn.dataset.del);
          await refreshOpsList();
          toast('Operation borttagen');
        });
      });
    });
  }

  // ========== INIT ==========
  async function init() {
    await openDB();
    bindUI();

    // Ensure demo exists
    const ops = await loadAllOperations();
    if (!ops.find(o => o.id === 'demo_nightfall')) {
      const demo = createDemoOp();
      await saveOperation(demo);
    }

    await refreshOpsList();
  }

  init().catch(err => {
    console.error('Init failed', err);
    toast('Kunde inte starta applikationen', 'error');
  });
})();
