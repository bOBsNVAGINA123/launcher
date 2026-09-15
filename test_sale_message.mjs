/* smoke-check the v21 "Apply sale message" patch: text, corner placement, refresh rules */
import fs from 'fs'; import vm from 'vm'; import assert from 'assert';
const page=fs.readFileSync(new URL('./studio.html',import.meta.url),'utf8');
const src=page.split('/* ===== v21 patch:')[1].split('</script>')[0].replace(/^[\s\S]*?\*\/\n/,'');

const state={aspect:'feed',els:{},slots:{}};
const g={console,setTimeout,
 state, DIMS:{feed:[1080,1350],story:[1080,1920]}, eid:1, ACTIVE:'drop',
 FORMATS:{drop:{label:'Drop'},lineup:{label:'Lineup'}}, fKey:f=>f+'|feed',
 els:f=>(state.els[g.fKey(f)]=state.els[g.fKey(f)]||[]),
 stageHTMLraw:()=>'',
 eachAspect:fn=>fn(), renderStage(){}, renderMirrorNow(){},
 buildElLayer:()=>'base',
 document:{readyState:'loading',getElementById:()=>null},
 window:{addEventListener(){}},
};
vm.createContext(g); vm.runInContext(src,g);
const API=g.window.SALE_MSG, K='drop|feed', sale=()=>(state.els[K]||[]).find(e=>e.saleEl);

// --- text: discount present -> was/now; no compare-at -> plain price; nothing -> placeholder
g.window.SALE_DEAL=()=>({now:'499 LE',was:'1,599 LE',pct:69});
assert.equal(API.text(),'69% OFF\n1,599 LE  →  499 LE');
g.window.SALE_DEAL=()=>({now:'750 LE',was:'',pct:0});
assert.equal(API.text(),'NOW 750 LE','no compare-at must not invent a discount');
g.window.SALE_DEAL=null; assert.equal(API.text(),'SALE\nUP TO 50% OFF');
g.window.SALE_DEAL=()=>({now:'499 LE',was:'1,599 LE',pct:69});

// --- add / remove through the same path the button uses
API.set('drop',true);
assert(sale(),'element added'); assert(API.has('drop'));
assert.equal(sale().f,'badge'); assert.equal(sale().bg,'#d92b1f');
API.set('drop',false); assert(!sale()&&!API.has('drop'),'removed cleanly');

// --- placement: it lands in a corner the format's own text is NOT using
const corners=[[21,8],[79,8],[21,92],[79,92]];
g.stageHTMLraw=()=>'<div class="cap" style="left:40px;top:80px;width:300px">BRAND</div>';   // top-left busy
let c=API.corner('drop');
assert(corners.some(k=>k[0]===c[0]&&k[1]===c[1]),'picks one of the four corners');
assert(!(c[0]===21&&c[1]===8),'avoids the busy top-left, got '+JSON.stringify(c));
g.stageHTMLraw=()=>'<div class="cap" style="left:0px;top:1200px;width:1080px">HEADLINE</div>'; // bottom busy
c=API.corner('drop'); assert(c[1]===8,'goes up top when the copy sits at the foot');
// existing overlays (free-shipping badge at 50/95) count as occupied too
state.els[K]=[{id:1,k:'t',x:50,y:95},{id:2,k:'t',x:50,y:88}];
g.stageHTMLraw=()=>'';
c=API.corner('drop'); assert(c[1]===8,'stays clear of the USP badge row');
state.els[K]=[];

// --- refresh: auto text follows the product, hand-edits survive
API.set('drop',true);
g.window.SALE_DEAL=()=>({now:'250 LE',was:'500 LE',pct:50});
g.buildElLayer('h','drop',1);
assert.equal(sale().t,'50% OFF\n500 LE  →  250 LE','auto text follows the swapped product');
sale().t='MY OWN WORDS';
g.window.SALE_DEAL=()=>({now:'99 LE',was:'199 LE',pct:50});
g.buildElLayer('h','drop',1);
assert.equal(sale().t,'MY OWN WORDS','user edits survive a re-render');

console.log('sale-message checks passed');
