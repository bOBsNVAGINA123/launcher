/* Drives uploadVideoChunked (lifted out of index.html) against a fake Graph that speaks
   Meta's offset protocol, including one dropped chunk. Run: node test-chunked-upload.mjs */
import {readFileSync} from 'fs';
import assert from 'assert';

const src=readFileSync('index.html','utf8');
const body=src.slice(src.indexOf('async function uploadVideoChunked'),src.indexOf('function uploadVideoFile('));

const GRAPH='https://graph.test/v1', cfg={meta:'TOK'};
const metaErr=j=>new Error(j.error.message), log=()=>{};
const SIZE=500*1024*1024, CH=64*1024*1024;
let got=0, dropped=false, finished=false;
globalThis.fetch=async(url,{body:fd})=>{
  const phase=fd.get('upload_phase');
  if(phase==='start'){
    assert.strictEqual(+fd.get('file_size'),SIZE);
    return {json:async()=>({upload_session_id:'S1',video_id:'VID9',start_offset:'0',end_offset:String(Math.min(CH,SIZE))})};
  }
  if(phase==='transfer'){
    const off=+fd.get('start_offset'), chunk=fd.get('video_file_chunk');
    assert.strictEqual(off,got,'chunk arrived at the wrong offset');
    if(off===CH&&!dropped){dropped=true;throw new TypeError('Failed to fetch')}   // blip mid-upload
    got=off+chunk.size;
    return {json:async()=>({start_offset:String(got),end_offset:String(Math.min(got+CH,SIZE))})};
  }
  finished=true;
  return {json:async()=>({success:true})};
};

const pcts=[];
const uploadVideoChunked=eval('('+body.replace(/^async function uploadVideoChunked/,'async function')+')');
const out=await uploadVideoChunked('ACT',new File([new Uint8Array(SIZE)],'big clip.mp4'),p=>pcts.push(p));

assert.strictEqual(out.id,'VID9','returns the video id from the start phase');
assert.strictEqual(got,SIZE,'every byte transferred');
assert.ok(dropped,'the dropped-chunk path was exercised');
assert.ok(finished,'finish phase ran');
assert.strictEqual(pcts.at(-1),100);
assert.ok(pcts.every((p,i)=>i===0||p>=pcts[i-1]),'progress never goes backwards');
console.log('ok — '+(SIZE/1048576)+'MB in '+pcts.length+' chunks, survived a mid-upload drop');
