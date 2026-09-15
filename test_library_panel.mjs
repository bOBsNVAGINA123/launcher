/* the library panel markup was rewritten for layout only — every id its handlers
   reach for must still exist, or a button silently dies */
import fs from 'fs'; import assert from 'assert';
const s=fs.readFileSync(new URL('./studio.html',import.meta.url),'utf8');

const panel=s.slice(s.indexOf("box.innerHTML='<div class=\"lbl\""), s.indexOf("const dh=document.getElementById('dhLib')"));
const present=new Set([...panel.matchAll(/id="(sy[A-Za-z]+)"/g)].map(m=>m[1]));
const wanted=new Set([...s.matchAll(/getElementById\('(sy[A-Za-z]+)'\)/g)].map(m=>m[1]).filter(id=>id!=='syncLib'));
// syBigLoad/syBigSend were deliberately deleted; nothing may still look for them
assert(!s.includes('syBigLoad')&&!s.includes('syBigSend'),'duplicate CTAs must be gone');
const missing=[...wanted].filter(id=>!present.has(id));
assert.deepEqual(missing,[],'handlers reference ids the panel no longer renders: '+missing);
for(const id of ['syUrl','syAddCol','syProgWrap','syAnother','syAddDrive','syAddFol','syRe',
                 'sySources','sySearch','syLoadAll','syLoadSel','syToLauncher','syDlAll',
                 'syBatch','syBatchDl','syMarpipe','syAllImg','syGrid','syExcl','syStatus'])
 assert(present.has(id),'panel lost #'+id);

// the grid must size itself to the panel, not be locked to 3 columns
assert(/#syGrid\{[^}]*auto-fill/.test(panel),'grid should be responsive (auto-fill)');
assert(!/id="syGrid" style="display:grid/.test(panel),'grid styles belong in the stylesheet, not inline');
// every secondary action is a chip, and exactly two primaries remain
assert.equal((panel.match(/class="syb"/g)||[]).length,11,'secondary actions should all be chips');
assert.equal((panel.match(/class="btn ghost sybig"/g)||[]).length,2,'exactly two primary buttons');
console.log('library panel checks passed —',present.size,'ids intact');
