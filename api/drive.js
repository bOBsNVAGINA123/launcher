/* Our own Drive fetcher, so pasting a Drive link works for anyone with no Google
   sign-in and no dependence on free public CORS proxies (which rate-limit and choke
   on video-sized files — that was the "network hiccup" nobody could get past).

   Runs on Vercel's edge runtime so it can STREAM the file through instead of
   buffering it, which is what keeps big videos working.

   Locked to Google's own hosts on purpose: an open url-proxy is an SSRF hole and a
   free bandwidth pipe for strangers. */

export const config = { runtime: 'edge' };

const ALLOWED = [
  'drive.google.com',
  'drive.usercontent.google.com',
  'docs.google.com',
  'lh3.googleusercontent.com',
  'www.googleapis.com'
];

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-expose-headers': 'content-length,content-type'
};

function bad(msg, code = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status: code,
    headers: { 'content-type': 'application/json', ...cors }
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const q = new URL(req.url).searchParams;
  const id = q.get('id');
  let target = q.get('url');

  if (id && !target) {
    target = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;
  }
  if (!target) return bad('pass ?url= or ?id=');

  let host;
  try { host = new URL(target).hostname } catch { return bad('not a url') }
  if (!ALLOWED.includes(host)) return bad('only Google Drive hosts are allowed, got ' + host, 403);

  let r;
  try { r = await fetch(target, { redirect: 'follow' }) }
  catch (e) { return bad('drive fetch failed: ' + e.message, 502) }

  if (!r.ok) return bad('drive returned HTTP ' + r.status, 502);

  /* Big files get Google's "can't scan for viruses" interstitial instead of bytes.
     It's an HTML form — resubmit it and the second response is the real file. */
  let ct = r.headers.get('content-type') || '';
  if (/text\/html/i.test(ct)) {
    const html = await r.text();
    const action = (html.match(/action="([^"]+)"/) || [])[1];
    if (action) {
      const u = new URL(action.replace(/&amp;/g, '&'));
      for (const m of html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/g)) u.searchParams.set(m[1], m[2]);
      if (ALLOWED.includes(u.hostname)) {
        try { r = await fetch(u.toString(), { redirect: 'follow' }) } catch (e) { return bad('confirm step failed: ' + e.message, 502) }
        ct = r.headers.get('content-type') || '';
      }
    }
    if (/text\/html/i.test(ct)) {
      return bad('Drive served a web page, not the file — it is probably not shared as "Anyone with the link"', 403);
    }
  }

  const h = { ...cors, 'content-type': ct || 'application/octet-stream', 'cache-control': 'public, max-age=3600' };
  const len = r.headers.get('content-length'); if (len) h['content-length'] = len;
  return new Response(r.body, { status: 200, headers: h });
}
