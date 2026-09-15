/* smoke-check the v19 SALE formats: registration, render, and price math */
import fs from 'fs'; import vm from 'vm'; import assert from 'assert';
const page = fs.readFileSync(new URL('./studio.html',import.meta.url),'utf8');
const src = page.split('/* ===== v19 patch: SALE formats')[1].split('</script>')[0].replace(/^[^\n]*\n/,'');

const state={aspect:'feed',rot:0,slots:{},caps:{},capPos:{},capStyle:{},assign:{},surf:{},layout:{},count:{}};
for(let i=1;i<=8;i++)state.slots[i]={src:'x'+i};
const g={
 console, setTimeout,
 FORMATS:{}, POOL:{}, LAYOUTP:{}, DIMS:{feed:[1080,1350],story:[1080,1920]}, state,
 filled:()=>[1,2,3],
 slotFor:i=>i,
 lay:f=>g.LAYOUTP[f]?g.LAYOUTP[f].def:0,
 surf:(f,id,def)=>def,
 C:(f,r,d,st)=>`<div class="cell" data-role="${r}" data-def="${d}" style="${st}"></div>`,
 CAP:(f,id,def,st)=>`<div class="cap" data-cap="${id}" style="${st}">${String(def).replace(/\n/g,'<br>')}</div>`,
 stageHTMLraw:f=>'OTHER:'+f,
 document:{readyState:'loading'},
 window:{addEventListener(){}, PX_SLOTMETA:{}},
};
g.window.PX_SLOTMETA=g.window.PX_SLOTMETA;
vm.createContext(g);
vm.runInContext(src,g);

const KEYS=['sl_split','sl_tag','sl_slash','sl_burst','sl_ticket','sl_stack'];
KEYS.forEach(k=>assert(g.FORMATS[k]&&g.FORMATS[k].label,'not registered: '+k));
assert.equal(g.stageHTMLraw('drop'),'OTHER:drop','must pass unknown formats through');

// --- no price data at all -> placeholder still renders
for(const k of KEYS){const h=g.stageHTMLraw(k);assert(h.startsWith('<div class="stage"'),k);assert(h.includes('499 LE'),k+' placeholder');}

// --- real price + compare-at from a link (1599 -> 499 = 69% off)
g.window.PX_SLOTMETA={1:{t:'Everyday Blue Linen Shirt',p:'499.00',c:'1599.00'}};
const h=g.stageHTMLraw('sl_split');
assert(h.includes('499 LE'),'now price');
assert(h.includes('1,599 LE'),'compare-at price');
assert(h.includes('line-through'),'compare-at struck out');
assert(h.includes('Everyday Blue Linen Shirt'),'title');
assert(g.stageHTMLraw('sl_slash').includes('69% OFF'),'discount %');
assert(g.stageHTMLraw('sl_ticket').includes('SAVE 1,100 LE'),'save amount');

// --- no compare-at -> no fake discount, no struck price
g.window.PX_SLOTMETA={1:{t:'Plain',p:'750'}};
const p=g.stageHTMLraw('sl_tag');
assert(p.includes('750 LE')&&!p.includes('line-through')&&!/\d+% *<br>OFF/.test(p),'must not invent a discount');

// --- per-tile prices in the stack come from each tile's own slot
g.window.PX_SLOTMETA={1:{t:'A',p:'100',c:'200'},2:{t:'B',p:'300',c:'400'},3:{t:'C',p:'50'}};
const st=g.stageHTMLraw('sl_stack');
['100 LE','200 LE','300 LE','400 LE','50 LE'].forEach(v=>assert(st.includes(v),'stack '+v));
assert(st.includes('UP TO 50% OFF'),'headline uses the deepest discount');

console.log('all sale-format checks passed');

// --- geometry: nothing is positioned off the 1080x1350 / 1080x1920 stage
for(const a of ['feed','story']){
 state.aspect=a; const [W,H]=g.DIMS[a];
 for(const k of KEYS){
  const html=g.stageHTMLraw(k);
  for(const m of html.matchAll(/(?:^|[;"])(left|top):(-?\d+)px/g)){
   const v=+m[2], lim=m[1]==='left'?W:H;
   assert(v>=-40&&v<lim, `${a}/${k}: ${m[1]}:${v}px outside 0..${lim}`);
  }
 }
}
console.log('geometry checks passed (feed + story)');
