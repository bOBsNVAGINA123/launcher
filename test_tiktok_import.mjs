/* The TikTok importer has two things that must never quietly break: the endpoint
   must never hand back the watermarked render, and it must never become an open
   proxy. Everything else is UI wiring — checked here so a dead button can't ship. */
import fs from 'fs'; import assert from 'assert'; import vm from 'vm';
const page = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const api  = fs.readFileSync(new URL('./api/tiktok.js', import.meta.url), 'utf8');

/* 1. the watermark. tikwm's wmplay is the watermarked file — it is never read. */
assert(!/\bd\.wmplay\b/.test(api), 'the watermarked render (wmplay) must never be used');
assert(/d\.hdplay/.test(api) && /d\.play/.test(api), 'the clean renders are play / hdplay');

/* 2. the block on HEVC, which ad platforms reject and Windows Chrome can't decode */
assert(/hvc1\|hev1/.test(api), 'HD must be sniffed for HEVC and dropped to the h264 render');

/* 3. the UI: every id the handlers reach for has to exist in the markup */
const block = page.slice(page.indexOf('/* ===== IMPORT FROM TIKTOK'));
const wanted = new Set([...block.matchAll(/getElementById\('(ttImp[A-Za-z]+)'\)/g)].map(m => m[1]));
for (const id of wanted) assert(page.includes('id="' + id + '"'), 'the page has no #' + id);
assert(wanted.size >= 6, 'expected the whole import panel to be wired, saw ' + wanted.size);
for (const fn of ['ttImport()', 'ttImpAudioPick()']) assert(page.includes('onclick="' + fn + '"') || page.includes('onchange="' + fn + '"'), fn + ' is never called');

/* 4. it parses (a syntax error here kills every script after it on the page) */
new vm.Script(block.split('</script>')[0]);

/* 5. the endpoint refuses to be an open proxy, and refuses junk links */
const { default: handler } = await import('./api/tiktok.js');
const call = q => handler(new Request('https://x/api/tiktok?' + q));
assert.equal((await call('url=' + encodeURIComponent('https://evil.example/a.mp4'))).status, 403);
assert.equal((await call('url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data/'))).status, 403);
assert.equal((await call('tt=' + encodeURIComponent('https://example.com/x'))).status, 400);
assert.equal((await call('yt=' + encodeURIComponent('https://example.com/x'))).status, 400);
assert.equal((await call('')).status, 400);

/* LIVE=1 also checks the real resolver — needs network, and tikwm rate-limits */
if (process.env.LIVE) {
  const j = await (await call('tt=' + encodeURIComponent('https://www.tiktok.com/@tiktok/video/7106594312292453675'))).json();
  assert(j.url && /tiktokcdn|tikwm/.test(new URL(j.url).hostname), 'live resolve failed: ' + JSON.stringify(j));
  const r = await call('url=' + encodeURIComponent(j.url));
  assert.equal(r.status, 200);
  assert((await r.arrayBuffer()).byteLength > 100000, 'live download came back too small');
  console.log('live check: clean file resolved and downloaded, hd=' + j.hd);
}
console.log('tiktok import checks passed —', wanted.size, 'ids wired');
