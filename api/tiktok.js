/* TikTok import — the clean, watermark-free file behind a TikTok link, plus the
   audio track of a YouTube video when you want to swap the sound.

   Same shape and the same reason as drive.js: the browser cannot fetch either of
   these itself (no CORS, hotlink checks), and an open url-proxy is an SSRF hole and
   a free bandwidth pipe for strangers — so every host is allowlisted.

   Modes:  ?tt=<tiktok link>   -> JSON {url,title,author,duration,cover}
           ?yt=<youtube link>  -> JSON {url,title,mime}
           ?url=<media link>   -> streams the bytes (that's what the page fetches) */

export const config = { runtime: 'edge' };

/* Hosts the ?url= streamer will touch. Nothing else. */
const MEDIA_HOSTS = [
  /(^|\.)tikwm\.com$/,
  /(^|\.)tiktokcdn\.com$/, /(^|\.)tiktokcdn-us\.com$/, /(^|\.)tiktokcdn-eu\.com$/,
  /(^|\.)tiktokv\.com$/, /(^|\.)tiktokv\.us$/, /(^|\.)muscdn\.com$/,
  /(^|\.)byteoversea\.com$/, /(^|\.)ibyteimg\.com$/, /(^|\.)ipstatp\.com$/,
  /(^|\.)googlevideo\.com$/
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-expose-headers': 'content-length,content-type,x-yt-truncated'
};

const bad = (msg, code = 400) => new Response(JSON.stringify({ error: msg }), {
  status: code, headers: { 'content-type': 'application/json', ...cors }
});
const ok = obj => new Response(JSON.stringify(obj), {
  status: 200, headers: { 'content-type': 'application/json', ...cors }
});

const hostOf = u => { try { return new URL(u).hostname } catch { return '' } };
const allowed = h => MEDIA_HOSTS.some(re => re.test(h));

/* ---------------- TikTok ---------------- */
async function tiktok(link) {
  const h = hostOf(link);
  if (!/(^|\.)tiktok\.com$/.test(h)) return bad('that is not a tiktok.com link');

  let j;
  try {
    const r = await fetch('https://www.tikwm.com/api/?hd=1&url=' + encodeURIComponent(link),
      { headers: { 'user-agent': UA, accept: 'application/json' } });
    j = await r.json();
  } catch (e) { return bad('TikTok resolver unreachable: ' + e.message, 502) }

  if (!j || j.code !== 0 || !j.data) return bad('TikTok resolver said: ' + ((j && (j.msg || j.message)) || 'no data') + ' — private, deleted, or rate-limited (it allows about one link per second).', 502);

  const d = j.data;
  /* play / hdplay are the clean renders. wmplay is the watermarked one and is
     never returned from here — that is the whole point of this endpoint. */
  const abs = p => !p ? '' : (/^https?:/.test(p) ? p : 'https://www.tikwm.com' + p);

  /* hdplay is 1080p but is often HEVC, which ad platforms reject and Windows
     Chrome can't even decode (so the audio-swap canvas would record black).
     Sniff the first 8KB: H.264 keeps HD, HEVC drops to the h264 render. */
  let file = abs(d.hdplay), hd = true;
  if (!file || !(await isH264(file))) { file = abs(d.play); hd = false }
  if (!file) return bad('no watermark-free file came back — that link may be a photo post or region-locked', 502);

  return ok({
    url: file, hd,
    title: d.title || '',
    author: (d.author && (d.author.unique_id || d.author.nickname)) || '',
    duration: d.duration || 0,
    cover: abs(d.cover || d.origin_cover || '')
  });
}

async function isH264(u) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, range: 'bytes=0-8191', referer: 'https://www.tiktok.com/' } });
    return !/hvc1|hev1/.test(new TextDecoder().decode(new Uint8Array(await r.arrayBuffer())));
  } catch { return false }
}

/* ---------------- YouTube audio ---------------- */
const YT_CLIENTS = [
  { clientName: 'ANDROID_VR', clientVersion: '1.61.43', androidSdkVersion: 32, deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12',
    ua: 'com.google.android.apps.youtube.vr.oculus/1.61.43 (Linux; U; Android 12; GB) gzip' },
  { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82',
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X)' },
  { clientName: 'WEB', clientVersion: '2.20250312.04.00', ua: UA }
];

function ytId(link) {
  try {
    const u = new URL(link);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return u.pathname.slice(1).split('/')[0];
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return '';
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(shorts|embed|live|v)\/([^/?#]+)/);
    return m ? m[2] : '';
  } catch { return '' }
}

async function youtube(link) {
  const id = ytId(link);
  if (!id) return bad('that is not a YouTube link');

  let lastMsg = '';
  for (const c of YT_CLIENTS) {
    const { ua, ...client } = c;
    let j;
    try {
      const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': ua, origin: 'https://www.youtube.com' },
        body: JSON.stringify({
          videoId: id, contentCheckOk: true, racyCheckOk: true,
          context: { client: { ...client, hl: 'en', gl: 'US' } }
        })
      });
      j = await r.json();
    } catch (e) { lastMsg = e.message; continue }

    lastMsg = (j && j.playabilityStatus && (j.playabilityStatus.reason || j.playabilityStatus.status)) || 'no streams';
    const fmts = ((j && j.streamingData && j.streamingData.adaptiveFormats) || [])
      /* a format with only signatureCipher needs YouTube's player JS to unlock —
         not worth shipping a JS interpreter for, so skip it and try the next client */
      .filter(f => f.url && /^audio\//.test(f.mimeType || ''))
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
    /* m4a first: it is the one every browser can decodeAudioData() */
    const pick = fmts.find(f => /mp4a/.test(f.mimeType)) || fmts[0];
    if (!pick) continue;

    return ok({
      url: pick.url,
      mime: pick.mimeType,
      title: (j.videoDetails && j.videoDetails.title) || '',
      duration: +((j.videoDetails && j.videoDetails.lengthSeconds) || 0)
    });
  }
  return bad('YouTube would not hand over the audio (' + lastMsg + '). It blocks datacentre IPs, so this fails for some videos — download the audio and use "From my PC" instead.', 502);
}

/* ---------------- byte pipe ---------------- */

/* What googlevideo will actually part with, measured 2026-09-18: a whole-file GET
   403s, an open-ended range 403s, a 2MB range 403s, and after ONE 1MB range every
   further offset 403s too — re-resolving the link first does not help. YouTube now
   wants its own player's PO token for sustained downloads. So we take the one bite
   it allows: ~1MB, about 65 seconds at 128kbps, which covers an ad soundtrack.
   ponytail: first-minute cap. Lift it only with a real yt-dlp-class extractor
   (player JS + PO tokens) running somewhere that is not a datacentre IP. */
const YT_CAP = 1024 * 1024;

function chunked(target, head, total) {
  const SZ = 1024 * 1024;
  let pos = 0;
  return new ReadableStream({
    async pull(ctrl) {
      if (pos >= total) { ctrl.close(); return }
      const r = await fetch(target, { headers: { ...head, range: `bytes=${pos}-${Math.min(total, pos + SZ) - 1}` } });
      if (!r.ok && r.status !== 206) { ctrl.error(new Error('source returned HTTP ' + r.status)); return }
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!buf.length) { ctrl.close(); return }
      ctrl.enqueue(buf); pos += buf.length;
    }
  });
}

async function stream(req, target) {
  const h = hostOf(target);
  if (!allowed(h)) return bad('only TikTok and YouTube media hosts are allowed, got ' + h, 403);

  const head = { 'user-agent': UA, referer: 'https://www.tiktok.com/' };
  const range = req.headers.get('range'); if (range) head.range = range;

  if (/googlevideo/.test(h) && !range) {
    let probe;
    try { probe = await fetch(target, { headers: { ...head, range: 'bytes=0-1' } }) }
    catch (e) { return bad('YouTube fetch failed: ' + e.message, 502) }
    if (probe.status !== 206) return bad('YouTube refused the audio (HTTP ' + probe.status + ') — its links expire in a few hours and it blocks some server IPs. Try again, or download the audio and use "From my PC".', 502);
    const total = +((probe.headers.get('content-range') || '').match(/\/(\d+)$/) || [0, 0])[1];
    if (!total) return bad('YouTube gave no length for that audio', 502);
    const take = Math.min(total, YT_CAP);
    return new Response(chunked(target, head, take), {
      status: 200,
      headers: {
        ...cors,
        'content-type': probe.headers.get('content-type') || 'audio/mp4',
        'content-length': String(take),
        'x-yt-truncated': take < total ? '1' : '0',
        'cache-control': 'no-store'
      }
    });
  }

  let r;
  try { r = await fetch(target, { headers: head, redirect: 'follow' }) }
  catch (e) { return bad('fetch failed: ' + e.message, 502) }
  if (!r.ok && r.status !== 206) return bad('source returned HTTP ' + r.status, 502);

  const out = { ...cors, 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'public, max-age=3600' };
  for (const k of ['content-length', 'content-range', 'accept-ranges']) {
    const v = r.headers.get(k); if (v) out[k] = v;
  }
  return new Response(r.body, { status: r.status, headers: out });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const q = new URL(req.url).searchParams;
  if (q.get('tt')) return tiktok(q.get('tt').trim());
  if (q.get('yt')) return youtube(q.get('yt').trim());
  if (q.get('url')) return stream(req, q.get('url'));
  return bad('pass ?tt=, ?yt= or ?url=');
}
