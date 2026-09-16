/* "the same new ad set in several campaigns": every ticked campaign must get its own
   copy, carrying THAT campaign's budget level and bid strategy — and a card aimed at
   "NEW: x" must hit x in all of them, so localId stays keyed to the ad set name. */
import fs from 'fs'; import assert from 'assert';
const src=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

const fn=src.slice(src.indexOf('function campTargetsFor('),src.indexOf('const PLAN_HINT='));
const campTargetsFor=new Function(fn+'\nreturn campTargetsFor')();

const multi=[{id:'1',name:'Prospecting',meta:{cbo:true,bid_strategy:'LOWEST_COST_WITH_MIN_ROAS'}},
             {id:'2',name:'Retargeting',meta:{cbo:false,bid_strategy:'COST_CAP'}}];
assert.deepEqual(campTargetsFor('multi',multi,'99','Ignored',{cbo:false}).map(c=>c.id),['1','2']);
assert.equal(campTargetsFor('multi',multi,'99','x',null)[1].meta.bid_strategy,'COST_CAP','each copy keeps its own campaign settings');
assert.deepEqual(campTargetsFor('one',[],'99','Solo',{cbo:true}).map(c=>c.id),['99'],'one campaign = the selected one');
assert.deepEqual(campTargetsFor('multi',[],'99','Solo',null).map(c=>c.id),['99'],'multi with nothing ticked falls back, never empty');

/* the launch loop: ad set name indexes the localId, campaign does not */
const loop=src.slice(src.indexOf('const campTargets=campTargetsFor'),src.indexOf('/* 3. media */'));
assert(/for\(const ct of campTargets\)/.test(loop),'must loop campaigns');
assert(/newAdsetPayload\(nm,ct\.id,ct\.meta\)/.test(loop),'payload must be built per campaign');
assert(/localId:'NEW'\+ni/.test(loop),'localId keyed by ad set name index, so "NEW: x" hits every campaign');

/* the payload must read budget level off the campaign it is going into */
const payload=src.slice(src.indexOf('async function newAdsetPayload('),src.indexOf('async function newAdsetPayload(')+900);
assert(/const cbo=\(S\.plan==='multi'&&cmeta\)\?cmeta\.cbo:activeCBO\(\)/.test(payload),'CBO/ABO must come from that campaign');

/* the three plans exist end to end */
['adsets','one','multi'].forEach(p=>{
  assert(src.includes(`id="plan-${p}"`),`chooser button for ${p}`);
  assert(src.includes(`planMode('${p}')`),`planMode wired for ${p}`);
});
assert(/S\.campMode==='new'&&S\.plan!=='multi'/.test(src),'multi must never create a campaign');
console.log('ok — multi-campaign fan-out, per-campaign settings, name-keyed targets');
