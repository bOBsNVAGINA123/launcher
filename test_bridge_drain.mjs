/* the Content Studio inbox used to be wiped with clear(), so anything the Studio
   wrote while the Launcher was importing was destroyed. It also only ran once at
   boot, so an open Launcher tab never saw new sends. Both are load-bearing. */
import fs from 'fs'; import assert from 'assert';
const src=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

const a=src.indexOf('/* ============ Content Studio bridge ============');
const b=src.indexOf('\ndrainBridge();',a);   /* functions only — the boot call is asserted, not run */
assert(a>0&&b>a,'bridge block not found');
const code=src.slice(a,b);
const boot=src.slice(b,b+400);
assert(/window\.addEventListener\('storage'/.test(boot),'live cross-tab sync listener is gone');
assert(/visibilitychange/.test(boot),'refocus re-drain is gone');
assert(!/objectStore\('inbox'\)\.clear\(\)/.test(code),'blanket clear() is back — mid-drain sends would be lost');

/* --- tiny in-memory IndexedDB, enough to run the real drain --- */
let store=new Map(), nextKey=1, midDrainWrite=null;
const ev=fn=>setTimeout(fn,0);
const indexedDB={open(){const r={};ev(()=>{r.result=db;r.onsuccess&&r.onsuccess()});return r}};
const db={transaction(_n,mode){
  const t={};
  const os={
    openCursor(){const req={};const keys=[...store.keys()];let i=0;
      const step=()=>ev(()=>{if(i<keys.length){const k=keys[i++];req.result={key:k,value:store.get(k),continue:step};req.onsuccess()}else{req.result=null;req.onsuccess()}});
      step();return req},
    delete(k){store.delete(k)}
  };
  if(mode==='readwrite'&&midDrainWrite){midDrainWrite();midDrainWrite=null} /* Studio writes while we drain */
  t.objectStore=()=>os; ev(()=>t.oncomplete&&t.oncomplete());
  return t}};

const put=r=>store.set(nextKey++,r);
const localStorage={_d:{},getItem(k){return this._d[k]||null},setItem(k,v){this._d[k]=String(v)}};
const S={media:[]};
const stub=()=>{},logs=[];
const ctx={indexedDB,localStorage,S,
  bridgeDB:async()=>db,
  kindOf:n=>/\.mp4$/.test(n)?'video':'image',driveDirect:id=>'drive://'+id,
  sortMedia:stub,renderMedia:stub,paint:stub,log:(t,c)=>logs.push(t),
  File:class{constructor(p,n,o){this.name=n;this.type=o.type;this.size=(p[0]&&p[0].size)||0}},
  URL:{createObjectURL:()=>'blob:x'},
  document:{getElementById:()=>null,addEventListener:stub},
  window:{addEventListener:stub}};
const run=new Function(...Object.keys(ctx),code+'\nreturn drainBridge;')(...Object.values(ctx));

put({name:'a.png',blob:{size:10,type:'image/png'}});
put({name:'b.png',blob:{size:20,type:'image/png'}});
put({name:'a.png',blob:{size:10,type:'image/png'}});           /* duplicate name */
midDrainWrite=()=>put({name:'late.png',blob:{size:30,type:'image/png'}}); /* lands mid-drain */
await run();

assert.deepEqual(S.media.map(m=>m.name),['a.png','b.png'],'imported the wrong set');
assert.deepEqual([...store.values()].map(r=>r.name),['late.png'],'a send that arrived mid-drain was destroyed');
const L=JSON.parse(localStorage.getItem('launcher_bridge_log'));
assert.equal(L.filter(r=>r.ev==='imported').length,2);
assert.equal(L.filter(r=>r.ev==='skipped').length,1,'the dropped duplicate must be logged, not silently vanish');

await run(); /* second pass picks up the late arrival — this is what live sync does */
assert.deepEqual(S.media.map(m=>m.name),['a.png','b.png','late.png']);
assert.equal(store.size,0);
console.log('ok — per-key drain, mid-drain sends survive, skips are logged');
