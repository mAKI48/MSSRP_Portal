(() => {
'use strict';

const SUPABASE_URL = 'https://jixhrtgsxlvfrqlxkpwi.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_oclE6KnOIjMUxIuCyKaFRiQ_Y8WZYgpo';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null, isLoginMode = true, db = null;

const state = {
  currentOp:null, opsList:[], stage:null, layers:{map:null,objects:null,selection:null},
  mapImage:null,mapLocked:false,currentTool:'select',selectedSymbol:'police',selectedNodes:[],
  isDrawing:false,currentPath:null,history:[],historyIndex:-1,maxHistory:50,
  groups:[],timeline:[],notes:'',transformer:null,_mapBlob:null,_editingNode:null,confirmCallback:null
};

const SYMBOL_LABELS = {
 police:'Polis',patrol:'Patrull',commander:'Befäl','op-chief':'Insatschef',operator:'Operatör',ni:'NI-operatör',
 k9:'K9',medic:'Sjukvårdare',negotiator:'Förhandlare',scout:'Spanare',sniper:'Skytt',suspect:'Misstänkt',
 armed:'Beväpnad',hostage:'Gisslan',civilian:'Civilperson',vip:'VIP',evidence:'Bevis','main-target':'Huvudmål',
 search:'Sökområde',entry:'Ingång',exit:'Utgång',rally:'Samlingsplats',command:'Ledningsplats',
 vehicle:'Fordonsplats','med-point':'Sjukvårdsplats',barrier:'Avspärrning',checkpoint:'Kontrollpunkt',
 evac:'Evakuering',collection:'Uppsamling',staging:'Staging',holding:'Holding',stack:'Stack-up','emergency-exit':'Nödutgång'
};
const SYMBOL_ICONS = {
 police:'P',patrol:'P',commander:'★','op-chief':'★★',operator:'●',ni:'NI',k9:'K9',medic:'+',negotiator:'F',scout:'S',
 sniper:'Y',suspect:'!',armed:'!',hostage:'G',civilian:'C',vip:'V',evidence:'B','main-target':'H',search:'?',
 entry:'→',exit:'←',rally:'S',command:'L',vehicle:'F','med-point':'+',barrier:'—',checkpoint:'K',evac:'E',
 collection:'U',staging:'☰',holding:'Ⅱ',stack:'≡','emergency-exit':'⇥'
};

const $ = id => document.getElementById(id);
const uid = () => 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
function toast(msg,type=''){const el=$('toast');el.textContent=msg;el.className='toast'+(type?' '+type:'');clearTimeout(el._t);el.classList.remove('hidden');el._t=setTimeout(()=>el.classList.add('hidden'),2800);}
function showModal(id){$(id)?.classList.add('active')} function hideModal(id){$(id)?.classList.remove('active')}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

function openDB(){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open('ERLC_TaktiskPlanerare',2);
  req.onupgradeneeded=e=>{
   const d=e.target.result;
   if(!d.objectStoreNames.contains('operations')) d.createObjectStore('operations',{keyPath:'id'});
   if(!d.objectStoreNames.contains('mapImages')) d.createObjectStore('mapImages',{keyPath:'opId'});
  };
  req.onsuccess=e=>{db=e.target.result;resolve(db)}; req.onerror=e=>reject(e.target.error);
 });
}
function tx(store,mode,fn){return new Promise((resolve,reject)=>{const t=db.transaction(store,mode);const s=t.objectStore(store);let r;try{r=fn(s)}catch(e){reject(e);return}t.oncomplete=()=>resolve(r);t.onerror=e=>reject(e.target.error)})}
const saveOperationLocal=op=>tx(['operations'],'readwrite',s=>s.put(op));
const loadAllOperationsLocal=()=>new Promise((res,rej)=>{const t=db.transaction(['operations'],'readonly'),r=t.objectStore('operations').getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=e=>rej(e.target.error)});
const saveMapImage=(opId,blob)=>tx(['mapImages'],'readwrite',s=>s.put({opId,blob,updated:Date.now()}));
const loadMapImage=opId=>new Promise((res,rej)=>{const t=db.transaction(['mapImages'],'readonly'),r=t.objectStore('mapImages').get(opId);r.onsuccess=()=>res(r.result?.blob||null);r.onerror=e=>rej(e.target.error)});
const deleteLocal=id=>tx(['operations','mapImages'],'readwrite',s=>{s.delete(id)});

function blobToDataURL(blob){return new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(blob)})}
function dataURLtoBlob(url){const [head,data]=url.split(',');const mime=head.match(/:(.*?);/)[1];const bin=atob(data);const a=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)a[i]=bin.charCodeAt(i);return new Blob([a],{type:mime})}

async function saveOperationCloud(op){
 if(!currentUser)return;
 let mapImage=null;if(state._mapBlob)mapImage=await blobToDataURL(state._mapBlob);
 const payload={user_id:currentUser.id,name:op.name,number:op.number||null,date:op.date||null,location:op.location||null,
 commander:op.commander||null,leader:op.leader||null,status:op.status||'PLANERING',priority:op.priority||'NORMAL',
 threat:op.threat||'LÅG',objective:op.objective||null,notes:op.notes||null,
 data:{objects:op.objects||[],groups:op.groups||[],timeline:op.timeline||[],scale:op.scale||1,stageX:op.stageX||0,stageY:op.stageY||0,mapImage},
 updated_at:new Date().toISOString()};
 if(op.cloudId){const {error}=await supabase.from('operations').update(payload).eq('id',op.cloudId);if(error)throw error}
 else{const {data,error}=await supabase.from('operations').insert(payload).select('id').single();if(error)throw error;op.cloudId=data.id}
}
async function loadAllOperationsCloud(){
 if(!currentUser)return [];
 const {data,error}=await supabase.from('operations').select('*').order('updated_at',{ascending:false});
 if(error){console.error(error);return []}
 return (data||[]).map(r=>({id:r.id,cloudId:r.id,name:r.name,number:r.number,date:r.date,location:r.location,commander:r.commander,leader:r.leader,status:r.status,priority:r.priority,threat:r.threat,objective:r.objective,notes:r.notes,objects:r.data?.objects||[],groups:r.data?.groups||[],timeline:r.data?.timeline||[],scale:r.data?.scale||1,stageX:r.data?.stageX||0,stageY:r.data?.stageY||0,mapBase64:r.data?.mapImage||null,updated:new Date(r.updated_at).getTime()}));
}

function updateAuthUI(){
 const info=$('user-info'),login=$('btn-login');
 if(currentUser){login?.classList.add('hidden');info?.classList.remove('hidden');$('user-email').textContent=currentUser.email||''}
 else{login?.classList.remove('hidden');info?.classList.add('hidden')}
}
function setAuthMode(login){isLoginMode=login;$('auth-title').textContent=login?'Logga in':'Skapa konto';$('btn-auth-submit').textContent=login?'Logga in':'Skapa konto';$('auth-switch-text').textContent=login?'Har du inget konto?':'Har du redan ett konto?';$('auth-toggle').textContent=login?'Skapa konto':'Logga in';$('auth-error').classList.add('hidden')}

function serializeObjects(){
 if(!state.layers.objects)return [];
 return state.layers.objects.getChildren().map(n=>{
  const d={id:n.id(),type:n.getAttr('objType')||n.className,name:n.getAttr('objName')||'',desc:n.getAttr('objDesc')||'',groupId:n.getAttr('groupId')||'',color:n.getAttr('objColor')||'#2563eb',quantity:n.getAttr('quantity')||1,x:n.x(),y:n.y(),rotation:n.rotation(),scaleX:n.scaleX(),scaleY:n.scaleY()};
  if(n.className==='Group'){d.symbolType=n.getAttr('symbolType')}
  if(n.className==='Line'||n.className==='Arrow'){Object.assign(d,{points:n.points(),stroke:n.stroke(),strokeWidth:n.strokeWidth(),dash:n.dash(),opacity:n.opacity(),isArrow:!!n.getAttr('isArrow'),isFreehand:!!n.getAttr('isFreehand')})}
  if(n.className==='Rect')Object.assign(d,{width:n.width(),height:n.height(),fill:n.fill(),stroke:n.stroke(),strokeWidth:n.strokeWidth(),opacity:n.opacity(),dash:n.dash()});
  if(n.className==='Circle')Object.assign(d,{radius:n.radius(),fill:n.fill(),stroke:n.stroke(),strokeWidth:n.strokeWidth(),opacity:n.opacity()});
  if(n.className==='Text')Object.assign(d,{text:n.text(),fontSize:n.fontSize(),fontStyle:n.fontStyle(),fill:n.fill()});
  return d;
 });
}
function pushHistory(){if(!state.layers.objects)return;state.history=state.history.slice(0,state.historyIndex+1);state.history.push(serializeObjects());if(state.history.length>state.maxHistory)state.history.shift();else state.historyIndex++}
function undo(){if(state.historyIndex<=0)return;state.historyIndex--;restoreObjects(state.history[state.historyIndex]);toast('Ångrat')}
function redo(){if(state.historyIndex>=state.history.length-1)return;state.historyIndex++;restoreObjects(state.history[state.historyIndex]);toast('Gjort om')}

function createSymbolNode(type,x,y,extra={}){
 const color=extra.color||extra.objColor||$('draw-color')?.value||'#2563eb',label=extra.name||extra.label||SYMBOL_LABELS[type]||type,qty=extra.quantity||1;
 const g=new Konva.Group({x,y,draggable:true,id:extra.id||uid()});
 g.setAttrs({objType:'symbol',symbolType:type,objName:label,objDesc:extra.desc||'',groupId:extra.groupId||'',objColor:color,quantity:qty});
 const c=new Konva.Circle({radius:10,fill:color,stroke:'#0f172a',strokeWidth:1.5,shadowColor:'black',shadowBlur:3,shadowOpacity:.35});
 const i=new Konva.Text({text:SYMBOL_ICONS[type]||'•',fontSize:9,fill:'#fff',width:20,height:20,align:'center',verticalAlign:'middle',offsetX:10,offsetY:10});
 const t=new Konva.Text({text:label,fontSize:9,fontFamily:'Inter',fill:'#f1f5f9',y:14});t.offsetX(t.width()/2);
 g.add(c,i,t);
 if(qty>1){const q=new Konva.Text({text:'x'+qty,fontSize:10,fontStyle:'bold',fill:'#fbbf24',y:-19});q.offsetX(q.width()/2);g.add(q)}
 return g;
}
function createObjectFromData(d){
 let n=null;
 if(d.type==='symbol'||d.symbolType)n=createSymbolNode(d.symbolType||'police',d.x,d.y,d);
 else if(d.type==='arrow'||d.isArrow)n=new Konva.Arrow({points:d.points||[0,0,50,0],stroke:d.stroke||d.color||'#2563eb',strokeWidth:d.strokeWidth||3,fill:d.stroke||d.color||'#2563eb',pointerLength:12,pointerWidth:10,dash:d.dash||[],opacity:d.opacity??1,draggable:true,id:d.id||uid()});
 else if(d.type==='line'||d.type==='path'||d.type==='freehand'||d.type==='Line')n=new Konva.Line({points:d.points||[0,0,50,0],stroke:d.stroke||d.color||'#2563eb',strokeWidth:d.strokeWidth||3,dash:d.dash||[],opacity:d.opacity??1,lineCap:'round',lineJoin:'round',draggable:true,id:d.id||uid(),tension:d.isFreehand?.4:0});
 else if(d.type==='rect'||d.type==='area'||d.type==='Rect')n=new Konva.Rect({x:d.x,y:d.y,width:d.width||80,height:d.height||60,fill:d.fill||'transparent',stroke:d.stroke||d.color||'#2563eb',strokeWidth:d.strokeWidth||2,dash:d.dash||[],opacity:d.opacity??1,draggable:true,id:d.id||uid()});
 else if(d.type==='circle'||d.type==='Circle')n=new Konva.Circle({x:d.x,y:d.y,radius:d.radius||40,fill:d.fill||'transparent',stroke:d.stroke||d.color||'#2563eb',strokeWidth:d.strokeWidth||2,opacity:d.opacity??1,draggable:true,id:d.id||uid()});
 else if(d.type==='text'||d.type==='Text')n=new Konva.Text({x:d.x,y:d.y,text:d.text||d.name||'Text',fontSize:d.fontSize||16,fontFamily:'Inter',fontStyle:d.fontStyle||'normal',fill:d.fill||d.color||'#f1f5f9',draggable:true,id:d.id||uid()});
 if(!n)return null;
 n.setAttrs({objType:d.type==='Rect'?'rect':(d.type==='Circle'?'circle':d.type),objName:d.name||d.label||'',objDesc:d.desc||'',groupId:d.groupId||'',objColor:d.color||'#2563eb',quantity:d.quantity||1});
 if(d.rotation)n.rotation(d.rotation);if(d.scaleX)n.scaleX(d.scaleX);if(d.scaleY)n.scaleY(d.scaleY);
 attachNodeEvents(n);state.layers.objects.add(n);return n;
}
function restoreObjects(arr){if(!state.layers.objects)return;state.layers.objects.destroyChildren();state.selectedNodes=[];state.transformer?.nodes([]);(arr||[]).forEach(createObjectFromData);state.layers.objects.batchDraw();updateObjectsList();updatePropertiesPanel()}

function attachNodeEvents(n){
 n.on('dragend',()=>{pushHistory();updateObjectsList()});
 n.on('click tap',e=>{if(state.currentTool!=='select')return;e.cancelBubble=true;selectNode(n,!!e.evt.shiftKey)});
 n.on('dblclick dbltap',()=>openEditObject(n));
}
function selectNode(n,multi=false){if(!multi)state.selectedNodes=[];if(!state.selectedNodes.includes(n))state.selectedNodes.push(n);state.transformer?.nodes(state.selectedNodes);state.layers.selection?.batchDraw();updatePropertiesPanel();updateObjectsList()}
function clearSelection(){state.selectedNodes=[];state.transformer?.nodes([]);updatePropertiesPanel();updateObjectsList()}

function initStage(){
 const c=$('konva-container'),w=c.clientWidth,h=c.clientHeight;
 state.stage=new Konva.Stage({container:'konva-container',width:w,height:h});
 state.layers.map=new Konva.Layer();state.layers.objects=new Konva.Layer();state.layers.selection=new Konva.Layer();
 state.stage.add(state.layers.map,state.layers.objects,state.layers.selection);
 state.transformer=new Konva.Transformer({rotateEnabled:true,enabledAnchors:['top-left','top-right','bottom-left','bottom-right'],borderStroke:'#3b82f6',anchorFill:'#2563eb',anchorStroke:'#fff',anchorSize:8});
 state.layers.selection.add(state.transformer);

 state.stage.on('wheel',e=>{e.evt.preventDefault();const old=state.stage.scaleX(),p=state.stage.getPointerPosition(),factor=e.evt.deltaY>0?.92:1.08,n=Math.min(Math.max(old*factor,.1),8),mp={x:(p.x-state.stage.x())/old,y:(p.y-state.stage.y())/old};state.stage.scale({x:n,y:n});state.stage.position({x:p.x-mp.x*n,y:p.y-mp.y*n});updateCoordsDisplay()});
 let pan=false,last=null;
 state.stage.on('contextmenu',e=>e.evt.preventDefault());
 state.stage.on('mousedown',e=>{if(e.evt.button===2){pan=true;last=state.stage.getPointerPosition();state.stage.container().style.cursor='grabbing';return}onPointerDown(e)});
 state.stage.on('mousemove',e=>{updateCoordsDisplay();if(pan){const p=state.stage.getPointerPosition();if(p&&last){state.stage.position({x:state.stage.x()+p.x-last.x,y:state.stage.y()+p.y-last.y});last=p;updateCoordsDisplay()}}else onPointerMove()});
 state.stage.on('mouseup',e=>{if(e.evt.button===2){pan=false;last=null;state.stage.container().style.cursor='default';return}onPointerUp()});
 state.stage.on('mouseleave',()=>{pan=false;last=null;state.stage.container().style.cursor='default'});
 state.stage.on('click tap',e=>{if(e.target===state.stage)clearSelection()});
 window.addEventListener('resize',()=>{if(!state.stage)return;state.stage.width(c.clientWidth);state.stage.height(c.clientHeight)});
}
function updateCoordsDisplay(){if(!state.stage)return;const p=state.stage.getPointerPosition()||{x:0,y:0};$('coords-display').textContent=`x: ${Math.round(p.x)}, y: ${Math.round(p.y)} | Zoom: ${Math.round(state.stage.scaleX()*100)}%`}
function relPointer(){const p=state.stage.getPointerPosition();if(!p)return null;return state.stage.getAbsoluteTransform().copy().invert().point(p)}

function onPointerDown(e){
 if(e.evt.button===2||state.mapLocked&&state.currentTool!=='select')return;
 if(state.currentTool==='pan'){state.stage.draggable(true);return}
 if(state.currentTool==='select')return;
 const p=relPointer();if(!p)return;state.isDrawing=true;
 const color=$('draw-color').value,sw=+$('stroke-width').value,op=+$('draw-opacity').value/100,dash=$('draw-dashed').checked?[8,6]:[];
 if(state.currentTool==='symbol'){const q=Math.max(1,parseInt(prompt('Antal (lämna tomt för 1):','1')||'1',10)||1);const n=createSymbolNode(state.selectedSymbol,p.x,p.y,{quantity:q,color});attachNodeEvents(n);state.layers.objects.add(n);state.layers.objects.batchDraw();pushHistory();updateObjectsList();state.isDrawing=false;return}
 if(state.currentTool==='text'){const n=new Konva.Text({x:p.x,y:p.y,text:'Text',fontSize:16,fontFamily:'Inter',fill:color,draggable:true,id:uid()});n.setAttrs({objType:'text',objName:'Text',objColor:color});attachNodeEvents(n);state.layers.objects.add(n);state.layers.objects.batchDraw();pushHistory();openEditObject(n);state.isDrawing=false;return}
 if(['line','arrow','path','freehand'].includes(state.currentTool)){const arrow=state.currentTool==='arrow';state.currentPath=new (arrow?Konva.Arrow:Konva.Line)({points:[p.x,p.y,p.x,p.y],stroke:color,strokeWidth:sw,fill:arrow?color:undefined,pointerLength:arrow?12:undefined,pointerWidth:arrow?10:undefined,dash,opacity:op,lineCap:'round',lineJoin:'round',tension:state.currentTool==='freehand'?.4:0,draggable:true,id:uid()});state.currentPath.setAttrs({objType:state.currentTool,objColor:color,isArrow:arrow,isFreehand:state.currentTool==='freehand'});state.layers.objects.add(state.currentPath)}
 if(['rect','area'].includes(state.currentTool)){state.currentPath=new Konva.Rect({x:p.x,y:p.y,width:0,height:0,fill:state.currentTool==='area'?color+'33':'transparent',stroke:color,strokeWidth:sw,dash,opacity:op,draggable:true,id:uid()});state.currentPath.setAttrs({objType:state.currentTool,objColor:color,_startX:p.x,_startY:p.y});state.layers.objects.add(state.currentPath)}
 if(state.currentTool==='circle'){state.currentPath=new Konva.Circle({x:p.x,y:p.y,radius:1,fill:'transparent',stroke:color,strokeWidth:sw,dash,opacity:op,draggable:true,id:uid()});state.currentPath.setAttrs({objType:'circle',objColor:color,_startX:p.x,_startY:p.y});state.layers.objects.add(state.currentPath)}
}
function onPointerMove(){if(!state.isDrawing||!state.currentPath)return;const p=relPointer();if(!p)return;const t=state.currentTool,n=state.currentPath;
 if(t==='line'||t==='arrow')n.points([n.points()[0],n.points()[1],p.x,p.y]);
 else if(t==='freehand'||t==='path')n.points(n.points().concat([p.x,p.y]));
 else if(t==='rect'||t==='area'){const sx=n.getAttr('_startX'),sy=n.getAttr('_startY');n.x(Math.min(sx,p.x));n.y(Math.min(sy,p.y));n.width(Math.abs(p.x-sx));n.height(Math.abs(p.y-sy))}
 else if(t==='circle'){const sx=n.getAttr('_startX'),sy=n.getAttr('_startY');n.radius(Math.hypot(p.x-sx,p.y-sy))}
 state.layers.objects.batchDraw()
}
function onPointerUp(){state.stage.draggable(false);if(!state.isDrawing)return;state.isDrawing=false;if(state.currentPath){attachNodeEvents(state.currentPath);pushHistory();updateObjectsList();state.currentPath=null}}

function loadMapFromFile(file){if(!file)return;const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{state.mapImage?.destroy();state.mapImage=new Konva.Image({image:img,x:0,y:0,listening:false});state.layers.map.destroyChildren();state.layers.map.add(state.mapImage);state.layers.map.batchDraw();fitMapToScreen();$('map-status').textContent=file.name;$('btn-upload-map').classList.add('hidden');$('btn-change-map').classList.remove('hidden');state._mapBlob=file;toast('Karta laddad','success');URL.revokeObjectURL(url)};img.src=url}
function loadMapFromBlob(blob){if(!blob)return;const url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{state.mapImage?.destroy();state.mapImage=new Konva.Image({image:img,x:0,y:0,listening:false});state.layers.map.destroyChildren();state.layers.map.add(state.mapImage);state.layers.map.batchDraw();$('map-status').textContent='Karta återställd';$('btn-upload-map').classList.add('hidden');$('btn-change-map').classList.remove('hidden');state._mapBlob=blob;fitMapToScreen();URL.revokeObjectURL(url)};img.src=url}
function fitMapToScreen(){if(!state.mapImage||!state.stage)return;const s=Math.min(state.stage.width()/state.mapImage.width(),state.stage.height()/state.mapImage.height())*.92;state.stage.scale({x:s,y:s});state.stage.position({x:(state.stage.width()-state.mapImage.width()*s)/2,y:(state.stage.height()-state.mapImage.height()*s)/2});updateCoordsDisplay()}
function updateObjectsList(){const list=$('objects-list');if(!list)return;list.innerHTML='';$('object-count').textContent=state.layers.objects?.getChildren().length||0;(state.layers.objects?.getChildren()||[]).forEach(n=>{const d=document.createElement('div');d.className='obj-item'+(state.selectedNodes.includes(n)?' selected':'');const c=n.getAttr('objColor')||'#2563eb';let name=n.getAttr('objName')||n.getAttr('objType')||'Objekt';const q=n.getAttr('quantity')||1;if(q>1)name+=` x${q}`;d.innerHTML=`<span class="obj-color" style="background:${esc(c)}"></span><span>${esc(name)}</span>`;d.onclick=()=>selectNode(n);list.appendChild(d)})}
function updatePropertiesPanel(){const c=$('props-content');if(!c)return;if(!state.selectedNodes.length){c.innerHTML='<p class="muted">Markera ett objekt för att redigera.</p>';return}const n=state.selectedNodes[0];c.innerHTML=`<div class="form-group"><label>Namn</label><input id="prop-name" value="${esc(n.getAttr('objName')||'')}"></div><div class="form-group"><label>Antal</label><input id="prop-qty" type="number" min="1" value="${n.getAttr('quantity')||1}"></div><button id="prop-apply" class="btn btn-secondary btn-sm">Tillämpa</button>`;$('prop-apply').onclick=()=>{n.setAttr('objName',$('prop-name').value);n.setAttr('quantity',Math.max(1,+$('prop-qty').value||1));if(n.className==='Group'){n.getChildren()[2]?.text(n.getAttr('objName'));n.getChildren()[2]?.offsetX(n.getChildren()[2].width()/2)}pushHistory();updateObjectsList();state.layers.objects.batchDraw()}}
function openEditObject(n){state._editingNode=n;$('edit-obj-name').value=n.getAttr('objName')||'';$('edit-obj-desc').value=n.getAttr('objDesc')||'';showModal('edit-object-modal')}

function renderGroups(){const l=$('groups-list');l.innerHTML='';state.groups.forEach(g=>{const d=document.createElement('div');d.className='stack-item';d.innerHTML=`<span class="obj-color" style="background:${esc(g.color)}"></span><span style="flex:1">${esc(g.name)}</span><button class="mini-danger">×</button>`;d.querySelector('button').onclick=()=>{state.groups=state.groups.filter(x=>x.id!==g.id);renderGroups();};l.appendChild(d)})}
function renderTimeline(){const l=$('timeline-list');l.innerHTML='';state.timeline.forEach(t=>{const d=document.createElement('div');d.className='stack-item';d.innerHTML=`<span class="hint">${esc(t.time)}</span><span style="flex:1">${esc(t.event)}</span><button class="mini-danger">×</button>`;d.querySelector('button').onclick=()=>{state.timeline=state.timeline.filter(x=>x.id!==t.id);renderTimeline()};l.appendChild(d)})}

async function collectOpData(){if(!state.currentOp)return null;const op=state.currentOp;op.objects=serializeObjects();op.groups=state.groups;op.timeline=state.timeline;op.notes=$('op-notes-panel').value;op.scale=state.stage?.scaleX()||1;op.stageX=state.stage?.x()||0;op.stageY=state.stage?.y()||0;op.updated=Date.now();return op}
async function saveCurrentOp(){if(!state.currentOp)return;const op=await collectOpData();await saveOperationLocal(op);if(state._mapBlob)await saveMapImage(op.id,state._mapBlob);if(currentUser){try{await saveOperationCloud(op);toast('Sparad lokalt + i molnet','success')}catch(e){console.error(e);toast('Sparad lokalt, moln misslyckades','error')}}else toast('Sparad lokalt','success')}
async function openOperation(id){
 let op=null;if(currentUser)op=(await loadAllOperationsCloud()).find(x=>x.id===id||x.cloudId===id);if(!op)op=(await loadAllOperationsLocal()).find(x=>x.id===id);if(!op){toast('Operation hittades inte','error');return}
 state.currentOp=op;state.groups=op.groups||[];state.timeline=op.timeline||[];state.notes=op.notes||'';state.history=[];state.historyIndex=-1;
 $('start-screen').classList.remove('active');$('app-screen').classList.add('active');$('header-op-name').textContent=op.name;$('header-op-meta').textContent=`${op.status||''} · ${op.location||''}`;
 if(!state.stage)initStage();else{state.layers.objects.destroyChildren();state.layers.map.destroyChildren();state.mapImage=null;state._mapBlob=null}
 $('op-notes-panel').value=op.notes||'';
 if(op.mapBase64)loadMapFromBlob(dataURLtoBlob(op.mapBase64));else{const b=await loadMapImage(op.id);if(b)loadMapFromBlob(b);else{$('map-status').textContent='Ingen karta uppladdad';$('btn-upload-map').classList.remove('hidden');$('btn-change-map').classList.add('hidden')}}
 restoreObjects(op.objects||[]);if(op.scale)state.stage.scale({x:op.scale,y:op.scale});if(op.stageX!=null)state.stage.position({x:op.stageX,y:op.stageY});pushHistory();renderGroups();renderTimeline();updateObjectsList();updateCoordsDisplay()
}
async function refreshOpsList(){
 const ops=currentUser?await loadAllOperationsCloud():await loadAllOperationsLocal();state.opsList=ops.sort((a,b)=>(b.updated||0)-(a.updated||0));const grid=$('saved-ops-list');grid.innerHTML='';$('ops-count').textContent=ops.length;
 $('no-ops-msg').style.display=ops.length?'none':'block';
 ops.forEach(op=>{const card=document.createElement('div');card.className='op-card';card.innerHTML=`<div class="op-card-name">${esc(op.name)}</div><div class="op-card-meta">${esc(op.location||'Ingen plats')} · ${esc(op.status||'PLANERING')}</div><div class="op-card-actions"><button class="btn btn-secondary btn-sm">Öppna</button></div>`;card.querySelector('button').onclick=()=>openOperation(op.id);grid.appendChild(card)})
}

function exportPlan(){
 if(!state.currentOp)return null;const plan={version:2,type:'ERLC-TACTICAL-PLAN',exportedAt:new Date().toISOString(),operation:{...state.currentOp,objects:serializeObjects(),groups:state.groups,timeline:state.timeline,notes:$('op-notes-panel').value,scale:state.stage?.scaleX()||1,stageX:state.stage?.x()||0,stageY:state.stage?.y()||0}};return plan
}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function exportAction(type){
 if(type==='erlcplan'){const plan=exportPlan();if(!plan)return;downloadBlob(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}),(state.currentOp.name||'operation').replace(/[^\wåäö-]+/gi,'_')+'.erlcplan');toast('Plan exporterad','success');return}
 if(!state.stage)return;
 const data=state.stage.toDataURL({pixelRatio:2,mimeType:type==='jpg'?'image/jpeg':'image/png'});const a=document.createElement('a');a.href=data;a.download=(state.currentOp?.name||'taktisk-plan')+'.'+type;a.click()
}
async function importPlan(file){try{const plan=JSON.parse(await file.text()),op=plan.operation||plan;if(!op.name)throw new Error('Ogiltig plan');op.id=uid();op.created=Date.now();op.updated=Date.now();await saveOperationLocal(op);await refreshOpsList();await openOperation(op.id);toast('Plan importerad','success')}catch(e){console.error(e);toast('Kunde inte importera planen','error')}}

function bindUI(){
 $('btn-login').onclick=()=>{setAuthMode(true);showModal('auth-modal')};
 $('auth-toggle').onclick=e=>{e.preventDefault();setAuthMode(!isLoginMode)};
 $('btn-auth-submit').onclick=async()=>{const email=$('auth-email').value.trim(),password=$('auth-password').value,error=$('auth-error');try{const r=isLoginMode?await supabase.auth.signInWithPassword({email,password}):await supabase.auth.signUp({email,password});if(r.error)throw r.error;hideModal('auth-modal');toast(isLoginMode?'Inloggad!':'Konto skapat!','success')}catch(e){error.textContent=e.message;error.classList.remove('hidden')}};
 $('btn-logout').onclick=async()=>{await supabase.auth.signOut();toast('Utloggad')};
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>hideModal(b.dataset.close));

 $('btn-new-op').onclick=()=>{$('new-op-form').reset();$('op-date').value=new Date().toISOString().slice(0,10);showModal('new-op-modal')};
 $('new-op-form').onsubmit=async e=>{e.preventDefault();const op={id:uid(),name:$('op-name').value.trim(),number:$('op-number').value.trim(),date:$('op-date').value,location:$('op-location').value.trim(),commander:$('op-commander').value.trim(),leader:$('op-leader').value.trim(),status:$('op-status').value,priority:$('op-priority').value,threat:$('op-threat').value,objective:$('op-objective').value.trim(),notes:$('op-notes').value,groups:[{id:uid(),name:'ALFA',color:'#2563eb'},{id:uid(),name:'BRAVO',color:'#7c3aed'}],timeline:[],objects:[],created:Date.now(),updated:Date.now()};await saveOperationLocal(op);hideModal('new-op-modal');await refreshOpsList();await openOperation(op.id)};
 $('btn-open-op').onclick=()=>{if(state.opsList[0])openOperation(state.opsList[0].id);else toast('Det finns inga sparade operationer ännu')};
 $('btn-back-home').onclick=async()=>{await saveCurrentOp();$('app-screen').classList.remove('active');$('start-screen').classList.add('active');await refreshOpsList()};

 document.querySelectorAll('.tool-btn').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tool-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.currentTool=b.dataset.tool;clearSelection()});
 document.querySelectorAll('.symbol-item').forEach(b=>b.onclick=()=>{document.querySelectorAll('.symbol-item').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');state.selectedSymbol=b.dataset.symbol;$('draw-color').value=b.dataset.color;document.querySelectorAll('.tool-btn').forEach(x=>x.classList.remove('active'));document.querySelector('[data-tool="symbol"]').classList.add('active');state.currentTool='symbol'});
 $('btn-upload-map').onclick=()=>$('map-upload').click();$('btn-change-map').onclick=()=>$('map-upload').click();$('map-upload').onchange=e=>e.target.files[0]&&loadMapFromFile(e.target.files[0]);
 $('btn-lock-map').onclick=()=>{state.mapLocked=!state.mapLocked;$('btn-lock-map').textContent=state.mapLocked?'Lås upp karta':'Lås karta';toast(state.mapLocked?'Kartan är låst':'Kartan är upplåst')};
 $('btn-save').onclick=saveCurrentOp;$('btn-undo').onclick=undo;$('btn-redo').onclick=redo;
 $('btn-zoom-in').onclick=()=>{const s=Math.min(8,state.stage.scaleX()*1.2);state.stage.scale({x:s,y:s});updateCoordsDisplay()};
 $('btn-zoom-out').onclick=()=>{const s=Math.max(.1,state.stage.scaleX()*.8);state.stage.scale({x:s,y:s});updateCoordsDisplay()};
 $('btn-zoom-fit').onclick=fitMapToScreen;$('btn-zoom-reset').onclick=()=>{state.stage.scale({x:1,y:1});state.stage.position({x:0,y:0});updateCoordsDisplay()};
 $('btn-export-menu').onclick=e=>{e.stopPropagation();$('export-dropdown').classList.toggle('hidden')};document.addEventListener('click',e=>{if(!e.target.closest('.export-wrap'))$('export-dropdown').classList.add('hidden')});
 document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportAction(b.dataset.export));document.querySelector('[data-import]').onclick=()=>$('import-file').click();$('import-file').onchange=e=>e.target.files[0]&&importPlan(e.target.files[0]);
 $('btn-edit-object-save').onclick=()=>{if(!state._editingNode)return;state._editingNode.setAttrs({objName:$('edit-obj-name').value,objDesc:$('edit-obj-desc').value});if(state._editingNode.className==='Group'){const t=state._editingNode.getChildren()[2];if(t){t.text($('edit-obj-name').value);t.offsetX(t.width()/2)}}hideModal('edit-object-modal');pushHistory();updateObjectsList();updatePropertiesPanel();state.layers.objects.batchDraw()};
 $('btn-delete-selected').onclick=()=>{if(!state.selectedNodes.length)return;state.selectedNodes.forEach(n=>n.destroy());clearSelection();pushHistory();updateObjectsList();toast('Objekt borttaget')};
 $('btn-add-group').onclick=()=>{const name=prompt('Gruppnamn:','CHARLIE');if(!name)return;state.groups.push({id:uid(),name:name.trim(),color:'#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0')});renderGroups()};
 $('btn-add-timeline').onclick=()=>{const time=prompt('Tid:','12:00');if(time===null)return;const event=prompt('Händelse:','Insats startar');if(!event)return;state.timeline.push({id:uid(),time,event});renderTimeline()};
 document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();undo()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo()}if(e.key==='Delete')$('btn-delete-selected').click()});
}

async function init(){
 await openDB();bindUI();updateAuthUI();
 supabase.auth.onAuthStateChange((_event,session)=>{currentUser=session?.user||null;updateAuthUI();refreshOpsList()});
 try{const {data}=await supabase.auth.getSession();currentUser=data?.session?.user||null;updateAuthUI()}catch{}
 await refreshOpsList();
}
init().catch(e=>{console.error(e);toast('Kunde inte starta planeraren','error')});
})();