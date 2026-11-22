// Sahar Love — servidor
// Guarda parejas, mensajes, rachas y días juntos, y envía notificaciones:
//   - Web Push (la app instalable desde Safari)
//   - APNs (para una futura app nativa de iPhone / Apple Watch)
//
// Almacenamiento:
//   - Si existen UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN → Upstash (gratis, persistente)
//   - Si no → archivo JSON (DATA_FILE, por defecto ./data.json)
const express = require('express');
const webpush = require('web-push');
const http2 = require('http2');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const I18N = require('./public/i18n.js');
const BOARDS = require('./public/boards.js');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const UP_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const UP_KEY = process.env.UPSTASH_KEY || 'sahar-db';
const useUpstash = !!(UP_URL && UP_TOKEN);

// ---------------------------------------------------------------------------
// Almacenamiento
// ---------------------------------------------------------------------------
let db = { users: {}, couples: {} };

async function loadDb() {
  if (useUpstash) {
    const r = await fetch(`${UP_URL}/get/${UP_KEY}`, { headers: { Authorization: `Bearer ${UP_TOKEN}` } });
    if (!r.ok) throw new Error(`Upstash GET ${r.status}`);
    const j = await r.json();
    if (j.result) db = JSON.parse(j.result);
  } else {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (_) {}
  }
  db.users = db.users || {};
  db.couples = db.couples || {};
}

let saveTimer = null;
let saving = Promise.resolve();
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  const data = JSON.stringify(db);
  saving = saving.then(async () => {
    try {
      if (useUpstash) {
        const r = await fetch(`${UP_URL}/set/${UP_KEY}`, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}` }, body: data });
        if (!r.ok) console.error('Upstash SET', r.status, await r.text());
      } else {
        const tmp = DATA_FILE + '.tmp';
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, DATA_FILE);
      }
    } catch (e) { console.error('Error al guardar', e.message); }
  });
  return saving;
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { flush().finally(() => process.exit(0)); });

// ---------------------------------------------------------------------------
// Web Push (VAPID). Si no hay variables de entorno, las claves se generan
// una vez y se guardan junto con los datos.
// ---------------------------------------------------------------------------
let vapid = null;
function setupVapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    if (!db.vapid) { db.vapid = webpush.generateVAPIDKeys(); save(); }
    vapid = db.vapid;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:sahar@example.com', vapid.publicKey, vapid.privateKey);
}

// ---------------------------------------------------------------------------
// APNs (notificaciones nativas de Apple) — solo si se configura
//   APNS_KEY (contenido .p8) o APNS_KEY_FILE, APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID
// ---------------------------------------------------------------------------
const APNS = {
  key: process.env.APNS_KEY ? process.env.APNS_KEY.replace(/\\n/g, '\n')
    : (process.env.APNS_KEY_FILE && fs.existsSync(process.env.APNS_KEY_FILE) ? fs.readFileSync(process.env.APNS_KEY_FILE, 'utf8') : null),
  keyId: process.env.APNS_KEY_ID,
  teamId: process.env.APNS_TEAM_ID,
  bundleId: process.env.APNS_BUNDLE_ID,
};
const apnsEnabled = !!(APNS.key && APNS.keyId && APNS.teamId && APNS.bundleId);

let apnsJwt = { token: null, at: 0 };
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function apnsToken() {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwt.token && now - apnsJwt.at < 50 * 60) return apnsJwt.token;
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: APNS.keyId }));
  const claims = b64url(JSON.stringify({ iss: APNS.teamId, iat: now }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: APNS.key, dsaEncoding: 'ieee-p1363' });
  apnsJwt = { token: `${header}.${claims}.${b64url(sig)}`, at: now };
  return apnsJwt.token;
}
function sendApns(device, payload) {
  return new Promise((resolve) => {
    const host = device.env === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
    let client, done = false;
    const finish = (r) => { if (!done) { done = true; try { client && client.close(); } catch (_) {} resolve(r); } };
    try { client = http2.connect(host); } catch (e) { return finish({ ok: false, status: 0, reason: e.message }); }
    client.on('error', (e) => finish({ ok: false, status: 0, reason: e.message }));
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${device.token}`,
      authorization: `bearer ${apnsToken()}`, 'apns-topic': APNS.bundleId,
      'apns-push-type': 'alert', 'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 3600),
    });
    req.setTimeout(10000, () => { req.close(); finish({ ok: false, status: 0, reason: 'timeout' }); });
    let status = 0, body = '';
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { body += d; });
    req.on('end', () => { let reason = ''; try { reason = JSON.parse(body).reason; } catch (_) {} finish({ ok: status === 200, status, reason }); });
    req.on('error', (e) => finish({ ok: false, status: 0, reason: e.message }));
    req.end(JSON.stringify(payload));
  });
}

// Envía una notificación a todos los dispositivos de un usuario. Devuelve cuántos la recibieron.
async function pushTo(user, { title, body, subtitle = '', tag = '' }) {
  let delivered = 0;
  if (apnsEnabled && (user.devices || []).length) {
    const payload = { aps: { alert: subtitle ? { title, subtitle, body } : { title, body }, sound: 'default', 'thread-id': 'sahar', 'content-available': 1 } };
    const alive = [];
    for (const d of user.devices) {
      const r = await sendApns(d, payload);
      if (r.ok) { delivered++; alive.push(d); }
      else {
        console.error('APNs', r.status, r.reason);
        if (!(r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered')) alive.push(d);
      }
    }
    user.devices = alive;
  }
  if ((user.subs || []).length) {
    const payload = JSON.stringify({ title, body: subtitle ? `${body}\n${subtitle}` : body, vibrate: [200, 100, 200, 100, 400], tag });
    const alive = [];
    for (const sub of user.subs) {
      try { await webpush.sendNotification(sub, payload, { TTL: 3600, urgency: 'high' }); alive.push(sub); delivered++; }
      catch (err) {
        if (err.statusCode !== 404 && err.statusCode !== 410) alive.push(sub);
        console.error('web push', err.statusCode, err.body || err.message);
      }
    }
    user.subs = alive;
  }
  return delivered;
}
const canReceive = (user) => (user.subs || []).length > 0 || (apnsEnabled && (user.devices || []).length > 0);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const LANGS = I18N.LANGS;
const DEFAULT_MESSAGES = I18N.MESSAGES.es.map((_, i) => `@${i}`);
function langOf(user) { return LANGS.includes(user && user.lang) ? user.lang : 'de'; }
const localize = (msg, lang) => I18N.localizeMessage(msg, lang);
const fail = (res, status, code, extra = {}) => res.status(status).json({ error: code, code, ...extra });

// Mensaje en el idioma de quien lo lee: predeterminados ("@n") o traducción guardada
function textFor(couple, msg, lang) {
  if (/^[@#?]/.test(msg || '')) return localize(msg, lang);
  const tr = couple && couple.tr && couple.tr[msg];
  return (tr && tr[lang]) || msg;
}

// ---------------------------------------------------------------------------
// Traducción automática de los mensajes que escriben ustedes (MyMemory, gratis).
// Opcional: MYMEMORY_EMAIL sube el límite diario gratuito.
// ---------------------------------------------------------------------------
const TRANSLATE = process.env.TRANSLATE !== 'off';
const mmLang = (l) => ({ fa: 'fa-IR', ar: 'ar-SA', uk: 'uk-UA' }[l] || l);
async function translateOne(text, src, tgt) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${mmLang(src)}|${mmLang(tgt)}`
    + (process.env.MYMEMORY_EMAIL ? `&de=${encodeURIComponent(process.env.MYMEMORY_EMAIL)}` : '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const j = await r.json();
    const out = j && j.responseData && j.responseData.translatedText;
    if (!r.ok || Number(j.responseStatus) !== 200 || !out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE/i.test(out)) return null;
    return String(out).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, 300);
  } catch (_) { return null; } finally { clearTimeout(timer); }
}
const onlyEmoji = (t) => !/[\p{L}\p{N}]/u.test(t);
// Solo hace falta traducir a los idiomas que usan los dos (antes se traducía a los 11
// y el límite diario gratuito se gastaba enseguida: por eso quedaban textos sin traducir)
function coupleLangs(couple) { return [...new Set((couple.members || []).map((id) => langOf(db.users[id])))]; }
// Si alguien escribe en otra escritura que la de su idioma (p. ej. persa con la app en
// español), se adivina el idioma de origen por las letras.
const SCRIPT = (l) => (l === 'fa' || l === 'ar' ? 'arab' : l === 'ru' || l === 'uk' ? 'cyr' : 'latin');
function guessSrc(text, fallback, langs) {
  const sc = /[؀-ۿ]/.test(text) ? 'arab' : /[Ѐ-ӿ]/.test(text) ? 'cyr' : /\p{Script=Latin}/u.test(text) ? 'latin' : null;
  if (!sc || SCRIPT(fallback) === sc) return fallback;
  return langs.find((l) => SCRIPT(l) === sc) || (sc === 'arab' ? 'fa' : sc === 'cyr' ? 'ru' : 'en');
}
// Traduce un texto a los idiomas que falten. Si el servicio falla, se reintenta más
// tarde (cada vez se espera un poco más), en vez de rendirse para siempre.
async function translateEntry(couple, text, only) {
  if (!TRANSLATE || !text || /^[@#?]/.test(text) || onlyEmoji(text)) return false;
  couple.tr = couple.tr || {};
  const langs = coupleLangs(couple);
  const entry = couple.tr[text] || (couple.tr[text] = { _tries: 0 });
  if (!entry._src) entry._src = guessSrc(text, couple.src?.[text] || langOf(db.users[couple.members[0]]), langs);
  const src = entry._src;
  entry[src] = text;
  const missing = (only ? [only] : langs).filter((l) => !entry[l]);
  if (!missing.length) return false;
  if (!only && entry._next && Date.now() < entry._next) return false;
  let ok = true;
  for (const l of missing) {
    const out = await translateOne(text, src, l);
    if (out && out.trim().toLowerCase() !== text.trim().toLowerCase()) entry[l] = out;
    else if (out) entry[l] = text; // ya estaba en ese idioma
    else { ok = false; break; }
  }
  if (ok) { entry._tries = 0; delete entry._next; } else {
    entry._tries = (entry._tries || 0) + 1;
    entry._next = Date.now() + Math.min(24 * 3600e3, 10 * 60e3 * 2 ** Math.min(entry._tries, 8));
  }
  save();
  return true;
}
// Traducir ya (para que la notificación llegue traducida), con tiempo máximo
async function translateFor(couple, text, lang, ms = 4500) {
  if (!couple || !text) return text;
  await Promise.race([translateEntry(couple, text, lang).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
  return textFor(couple, text, lang);
}
function textsToTranslate(couple) {
  const answers = Object.values(couple.qa || {}).flatMap((d) => Object.values(d.answers || {}));
  // Lo más reciente primero
  return [...new Set([...(couple.history || []).slice(-50).map((h) => h.body).reverse(), ...(couple.messages || []), ...answers.reverse(), ...harmonyTexts(couple).reverse()])];
}
let translating = false;
async function translatePending(limit = 6) {
  if (!TRANSLATE || translating) return 0;
  translating = true;
  let done = 0;
  try {
    for (const couple of Object.values(db.couples)) {
      for (const text of textsToTranslate(couple)) {
        if (done >= limit) return done;
        if (await translateEntry(couple, text)) done++;
      }
    }
  } finally { translating = false; }
  return done;
}

// ---------------------------------------------------------------------------
// Fotos y audios (Upstash o carpeta local)
// ---------------------------------------------------------------------------
const MEDIA_DIR = path.join(path.dirname(DATA_FILE), 'media');
const MAX_MEDIA_B64 = 1400000; // ~1 MB

// Cifrado de fotos y audios (AES-256-GCM). La clave buena es MEDIA_KEY en las
// variables de entorno de Render (así quien vea la base de datos no ve las
// fotos). Sin MEDIA_KEY se usa una clave guardada en la base, que al menos
// evita que las fotos queden en claro.
const keyFrom = (s) => crypto.createHash('sha256').update(String(s)).digest();
const MEDIA_KEYS = () => ({
  ...(process.env.MEDIA_KEY ? { env: keyFrom(process.env.MEDIA_KEY) } : {}),
  ...(db.mediaKey ? { db: Buffer.from(db.mediaKey, 'base64') } : {}),
});
function currentMediaKey() {
  if (process.env.MEDIA_KEY) return { kid: 'env', key: keyFrom(process.env.MEDIA_KEY) };
  if (!db.mediaKey) { db.mediaKey = crypto.randomBytes(32).toString('base64'); save(); }
  return { kid: 'db', key: Buffer.from(db.mediaKey, 'base64') };
}
function sealMedia(mime, b64) {
  const { kid, key } = currentMediaKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(Buffer.from(b64, 'base64')), c.final()]);
  return { v: 1, kid, mime, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function openMedia(rec) {
  if (!rec) return null;
  if (!rec.v) return { mime: rec.mime, buf: Buffer.from(rec.b64, 'base64'), plain: true };
  const key = MEDIA_KEYS()[rec.kid];
  if (!key) { console.error('media: falta la clave', rec.kid); return null; }
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(rec.iv, 'base64'));
    d.setAuthTag(Buffer.from(rec.tag, 'base64'));
    return { mime: rec.mime, buf: Buffer.concat([d.update(Buffer.from(rec.data, 'base64')), d.final()]), plain: false, kid: rec.kid };
  } catch (e) { console.error('media: no se pudo descifrar', e.message); return null; }
}
// Comprobar que el archivo es de verdad lo que dice ser (y no un HTML disfrazado)
function looksLike(kind, mime, buf) {
  const at = (i, hex) => buf.length >= i + hex.length / 2 && buf.subarray(i, i + hex.length / 2).toString('hex') === hex;
  if (kind === 'photo') {
    if (mime === 'image/jpeg') return at(0, 'ffd8ff');
    if (mime === 'image/png') return at(0, '89504e470d0a1a0a');
    if (mime === 'image/webp') return at(0, '52494646') && at(8, '57454250');
    return false;
  }
  return at(4, '66747970') /* mp4/m4a */ || at(0, '1a45dfa3') /* webm */ || at(0, '4f676753') /* ogg */
    || at(0, '494433') /* mp3 */ || (buf.length > 1 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) /* mp3/aac */;
}
async function putMedia(id, mime, b64) {
  const body = JSON.stringify(sealMedia(mime, b64));
  if (useUpstash) {
    const r = await fetch(`${UP_URL}/set/sahar-media:${id}`, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}` }, body });
    if (!r.ok) throw new Error('upstash ' + r.status);
  } else {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, id + '.json'), body);
  }
}
// Devuelve { mime, buf } ya descifrado. Las fotos viejas sin cifrar se
// cifran solas la primera vez que alguien las abre.
async function getMedia(id) {
  let rec = null;
  if (useUpstash) {
    const r = await fetch(`${UP_URL}/get/sahar-media:${id}`, { headers: { Authorization: `Bearer ${UP_TOKEN}` } });
    const j = await r.json();
    rec = j.result ? JSON.parse(j.result) : null;
  } else {
    try { rec = JSON.parse(fs.readFileSync(path.join(MEDIA_DIR, id + '.json'), 'utf8')); } catch (_) { rec = null; }
  }
  const out = openMedia(rec);
  if (out && (out.plain || (process.env.MEDIA_KEY && out.kid !== 'env'))) {
    putMedia(id, out.mime, out.buf.toString('base64')).catch((e) => console.error('media: recifrar', e.message));
  }
  return out;
}
async function delMedia(id) {
  try {
    if (useUpstash) await fetch(`${UP_URL}/del/sahar-media:${id}`, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}` } });
    else fs.rmSync(path.join(MEDIA_DIR, id + '.json'), { force: true });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Preferencias de avisos de quien recibe. Ya no hay "no molestar" ni límite:
// cada toque llega al instante, siempre.
// ---------------------------------------------------------------------------
const DEFAULT_PREFS = { extra: true };
const prefsOf = (u) => ({ extra: u && u.prefs && typeof u.prefs.extra === 'boolean' ? u.prefs.extra : DEFAULT_PREFS.extra });

function newCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join(''); }
  while (db.couples[c]);
  return c;
}
function partnerOf(user) {
  const couple = user.code && db.couples[user.code];
  if (!couple) return null;
  const pid = couple.members.find((m) => m !== user.id);
  return pid ? db.users[pid] : null;
}

// ---------------------------------------------------------------------------
// Racha: días seguidos en los que LOS DOS se mandaron al menos un toque.
// Hoy no rompe la racha mientras el día no termine.
// ---------------------------------------------------------------------------
function validTz(tz) { try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch (_) { return false; } }
function dayKey(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function minuteIn(date, tz) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).split(':').map(Number);
  return h * 60 + m;
}
function hourIn(date, tz) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(date));
}
function prevDay(key) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function streakInfo(couple, now = new Date()) {
  const days = couple.days || {};
  const frozen = couple.frozen || {};
  const both = (k) => (days[k] || []).length >= 2 || !!frozen[k];
  const today = dayKey(now, couple.tz);
  let count = 0;
  let k = both(today) ? today : prevDay(today);
  while (both(k)) { count++; k = prevDay(k); }
  return { streak: count, bestStreak: Math.max(couple.bestStreak || 0, count), todayDone: both(today), todayMembers: days[today] || [] };
}
function recordDay(couple, userId, now = new Date()) {
  const today = dayKey(now, couple.tz);
  couple.days = couple.days || {};
  const list = couple.days[today] || [];
  if (!list.includes(userId)) list.push(userId);
  couple.days[today] = list;
  const keys = Object.keys(couple.days).sort();
  while (keys.length > 400) delete couple.days[keys.shift()];
  if (couple.frozen) for (const k of Object.keys(couple.frozen)) if (k < keys[0]) delete couple.frozen[k];
  couple.bestStreak = streakInfo(couple, now).bestStreak;
}

// Pregunta del día: la misma para los dos, según la fecha de la pareja
const N_Q = I18N.QUESTIONS.es.length;
const dayNum = (day) => Math.floor(Date.parse(day + 'T12:00:00Z') / 86400000);
function questionIndex(day) { return dayNum(day) % N_Q; }
const MOODS = ['😊', '🥰', '😴', '😔', '😤', '🤒', '🥳', '🤔', '😢', '🤗'];
const TOUCH_TYPES = { heart: '💗', kiss: '💋', hug: '🤗', miss: '🥺', night: '🌙', morning: '☀️', laugh: '😂', proud: '🫶' };
const REACTIONS = ['❤️', '😍', '😂', '🥺', '🔥', '😘'];

function stateFor(user) {
  const couple = user.code ? db.couples[user.code] : null;
  const partner = couple ? partnerOf(user) : null;
  const s = couple ? streakInfo(couple) : { streak: 0, bestStreak: 0, todayMembers: [], todayDone: false };
  const received = couple ? couple.history.filter((h) => h.to === user.id) : [];
  const lang = langOf(user);
  // Traducciones al idioma de este usuario de los mensajes escritos a mano
  const trans = {};
  if (couple) {
    const ans = Object.values(couple.qa || {}).flatMap((d) => Object.values(d.answers || {}));
    for (const t of new Set([...couple.messages, ...received.slice(-50).map((h) => h.body), ...ans, ...harmonyTexts(couple)])) {
      if (!t || /^[@#?]/.test(t)) continue;
      const tx = textFor(couple, t, lang);
      if (tx !== t) trans[t] = tx;
    }
  }
  return {
    name: user.name || null,
    lang,
    code: user.code || null,
    partnerName: partner ? partner.name : null,
    messages: couple ? couple.messages : [],
    trans,
    received: received.slice(-50).reverse().map(({ from, body, at, level, media, type, sync }) => ({ from, body, at, level: level || 1, media: media || null, type: type || 'heart', sync: !!sync })),
    streak: s.streak,
    bestStreak: s.bestStreak,
    iSentToday: s.todayMembers.includes(user.id),
    partnerSentToday: partner ? s.todayMembers.includes(partner.id) : false,
    totalSent: couple ? couple.counts?.[user.id] ?? couple.history.filter((h) => h.fromId === user.id).length : 0,
    totalReceived: couple && partner ? couple.counts?.[partner.id] ?? received.length : 0,
    since: couple ? couple.since || null : null,
    dates: couple ? (couple.dates || []).map((d) => ({ ...d, ics: icsToken(d.id) })) : [],
    partnerOnline: !!(partner && partner.seenAt && Date.now() - partner.seenAt < ONLINE_MS),
    partnerSeenAt: partner ? partner.seenAt || null : null,
    persianOn: couple ? couple.persianDates !== false : true,
    persian: couple && couple.persianDates !== false ? upcomingPersian(dayKey(new Date(), couple.tz)) : [],
    prefs: prefsOf(user),
    question: couple ? questionState(couple, user, partner) : null,
    myMood: moodToday(user, couple),
    partnerMood: partner ? moodToday(partner, couple) : null,
    album: couple ? (couple.media || []).filter((m) => m.kind === 'photo').slice(-60).reverse().map((m) => ({ id: m.id, at: m.at, mine: m.by === user.id, title: m.title || '' })) : [],
    tot: couple ? totState(couple, user, partner) : null,
    score: couple ? scoreState(couple, user, partner) : null,
    cards: couple ? (couple.cards || []).filter((c) => !c.used || Date.now() - c.usedAt < 7 * 86400000).map((c) => ({ id: c.id, card: c.card, mine: c.owner === user.id, used: !!c.used, at: c.at, gift: !!c.from, fromMe: c.from === user.id, note: c.note || '', issue: c.issue || null })) : [],
    notifReady: canReceive(user),
    partnerNotifReady: partner ? canReceive(partner) : false,
    harmony: couple ? harmonyState(couple, user, partner) : null,
    race: couple ? raceState(user) : null,
    science: couple ? scienceState(couple, user, partner) : null,
    play: couple ? playState(couple, user, partner) : null,
    ...(couple ? wishState(couple, user, partner) : {}),
  };
}
// Textos escritos a mano en «Armonía» que conviene traducir
function harmonyTexts(couple) {
  return [
    ...(couple.issues || []).slice(-60).flatMap((x) => [x.what, x.need]),
    ...(couple.thanks || []).slice(-40).map((x) => x.text),
    ...(couple.cards || []).map((c) => c.note),
    ...(couple.chest || []).slice(-60).map((x) => x.text),
    ...Object.values(couple.lmap || {}).flatMap((e) => Object.values(e.ans || {}).flatMap((a) => [a.me, a.guess])),
    ...Object.values(couple.checkins || {}).slice(-4).flatMap((w) => Object.values(w).flatMap((c) => [c.best, c.need])),
    ...(couple.news || []).slice(-8).flatMap((n) => [n.text, n.reply && n.reply.text]),
    ...Object.values(couple.stress || {}).map((s) => s.note),
    ...(couple.story ? couple.story.lines.map((l) => l.text) : []),
    ...(couple.stories || []).slice(-3).flatMap((s) => s.lines.map((l) => l.text)),
    ...(couple.stories || []).map((s) => s.title),
    ...(couple.dates || []).map((d) => d.name),
    ...(couple.media || []).map((m) => m.title),
  ].filter(Boolean);
}

function questionState(couple, user, partner) {
  const day = dayKey(new Date(), couple.tz);
  const entry = (couple.qa || {})[day] || { answers: {} };
  const mine = entry.answers[user.id] || null;
  const theirs = partner ? entry.answers[partner.id] || null : null;
  // Si ya respondieron antes del cambio a 40 preguntas, mantener la que vieron
  const q = Number.isInteger(entry.q) ? entry.q : (Object.keys(entry.answers).length ? dayNum(day) % 20 : questionIndex(day));
  return { day, q, mine, partner: mine ? theirs : null, partnerAnswered: !!theirs };
}
function moodToday(u, couple) {
  if (!u || !u.mood) return null;
  return u.mood.day === dayKey(new Date(), (couple && couple.tz) || u.tz) ? u.mood.emoji : null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render pone un proxy delante: la IP real viene en X-Forwarded-For

// ---------------------------------------------------------------------------
// Seguridad: cabeceras, política de contenido (CSP) y límite de intentos
// ---------------------------------------------------------------------------
// Huella del <script> en línea de index.html: así el navegador solo ejecuta
// NUESTRO código y nada inyectado (aunque alguien colara texto raro).
const INLINE_HASHES = (() => {
  try {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
    return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  } catch (_) { return []; }
})();
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_HASHES.join(' ')}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (process.env.CSP !== 'off' && INLINE_HASHES.length) res.setHeader('Content-Security-Policy', CSP);
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

// Límite de intentos (en memoria): frena a quien intente adivinar códigos o
// llenar el servidor. Muy por encima de lo que hacen ustedes dos.
const hits = new Map();
function limited(bucket, key, max, windowMs) {
  const k = bucket + ':' + key;
  const now = Date.now();
  let h = hits.get(k);
  if (!h || now - h.start > windowMs) { h = { start: now, n: 0 }; hits.set(k, h); }
  h.n++;
  if (hits.size > 5000) for (const [kk, v] of hits) if (now - v.start > 3600000) hits.delete(kk);
  return h.n > max;
}
const rateLimit = (bucket, max, windowMs, keyFn = (req) => req.ip) => (req, res, next) =>
  (limited(bucket, keyFn(req), max, windowMs) ? fail(res, 429, 'too_many') : next());
app.use('/api/', rateLimit('api', 1500, 60000));
app.use('/api/couple/join', rateLimit('join', 10, 10 * 60000));
app.use('/api/register', rateLimit('register', 30, 60 * 60000));

const jsonSmall = express.json({ limit: '50kb' });
const jsonBig = express.json({ limit: '2mb' });
app.use((req, res, next) => (req.path === '/api/media' ? jsonBig : jsonSmall)(req, res, next));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|js|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// La identidad viaja en una cabecera (no en la dirección), para que no quede
// en registros del servidor ni en el historial. Se acepta aún en el cuerpo o
// la dirección para las versiones viejas de la app que tengan guardadas.
function auth(req, res, next) {
  const id = req.get('X-User-Id') || (req.body && req.body.userId) || req.query.userId;
  const user = typeof id === 'string' && Object.prototype.hasOwnProperty.call(db.users, id) && db.users[id];
  if (!user) return fail(res, 401, 'unknown_user');
  if (limited('user', user.id, 900, 60000)) return fail(res, 429, 'too_many');
  req.user = user;
  user.seenAt = Date.now(); // para «en línea ahora»
  const couple = user.code && db.couples[user.code];
  if (couple) { settleTotBonus(couple); settleWeek(couple); settleShields(couple); }
  next();
}

const APP_VERSION = (() => { try { return /const APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'))[1]; } catch (_) { return null; } })();
app.get('/api/health', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, version: APP_VERSION, storage: useUpstash ? 'upstash' : 'file', apns: apnsEnabled }); });
app.get('/api/vapid', (_req, res) => res.json({ publicKey: vapid.publicKey }));

app.post('/api/register', (req, res) => {
  const { name, tz, lang } = req.body;
  const userId = req.get('X-User-Id') || req.body.userId;
  if (!userId || typeof userId !== 'string' || !name || userId.length > 100 || !/^[\w-]+$/.test(userId) || !String(name).trim()) return fail(res, 400, 'missing');
  const user = db.users[userId] || { id: userId, subs: [], devices: [] };
  user.name = String(name).trim().slice(0, 30);
  if (tz && validTz(tz)) user.tz = tz;
  if (LANGS.includes(lang)) user.lang = lang;
  db.users[userId] = user;
  save();
  res.json(stateFor(user));
});

app.post('/api/couple/create', auth, (req, res) => {
  if (req.user.code && db.couples[req.user.code]) return res.json(stateFor(req.user));
  const code = newCode();
  db.couples[code] = {
    members: [req.user.id], messages: [...DEFAULT_MESSAGES], bag: [], history: [],
    days: {}, bestStreak: 0, tz: req.user.tz || 'Europe/Berlin', counts: {}, since: null, reminded: {},
    defaultsV: 2, tr: {}, src: {}, media: [], dates: [],
  };
  req.user.code = code;
  save();
  res.json(stateFor(req.user));
});

app.post('/api/couple/join', auth, (req, res) => {
  const code = String(req.body.code || '').toUpperCase().trim();
  const couple = db.couples[code];
  if (!couple) return fail(res, 404, 'code_not_found');
  if (!couple.members.includes(req.user.id)) {
    if (couple.members.length >= 2) return fail(res, 409, 'couple_full');
    couple.members.push(req.user.id);
  }
  req.user.code = code;
  save();
  res.json(stateFor(req.user));
});

app.get('/api/state', auth, (req, res) => res.json(stateFor(req.user)));

// Desvincularse de la pareja (si no queda nadie, se borra)
app.post('/api/couple/leave', auth, (req, res) => {
  const code = req.user.code;
  const couple = code && db.couples[code];
  req.user.code = null;
  if (couple) {
    couple.members = couple.members.filter((m) => m !== req.user.id);
    if (!couple.members.length) deleteCouple(code);
  }
  save();
  res.json(stateFor(req.user));
});

app.post('/api/lang', auth, (req, res) => {
  if (!LANGS.includes(req.body.lang)) return fail(res, 400, 'invalid_lang');
  req.user.lang = req.body.lang;
  save();
  res.json(stateFor(req.user));
  translatePending(8).catch(() => {}); // lo escrito antes, ahora también en el idioma nuevo
});

// Fecha en que empezaron (YYYY-MM-DD) o null para borrarla
app.post('/api/since', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  const d = req.body.date;
  if (d === null || d === '') couple.since = null;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')) && d >= '1950-01-01' && d <= dayKey(new Date(), couple.tz)) couple.since = d;
  else return fail(res, 400, 'invalid_date');
  save();
  res.json(stateFor(req.user));
});

app.post('/api/subscribe', auth, (req, res) => {
  const sub = req.body.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return fail(res, 400, 'invalid_subscription');
  req.user.subs = (req.user.subs || []).filter((s) => s.endpoint !== sub.endpoint);
  req.user.subs.push({ endpoint: sub.endpoint, keys: sub.keys });
  req.user.subs = req.user.subs.slice(-5);
  save();
  res.json({ ok: true });
});

app.post('/api/device', auth, (req, res) => {
  const token = String(req.body.token || '').toLowerCase();
  const env = req.body.env === 'production' ? 'production' : 'sandbox';
  if (!/^[0-9a-f]{32,200}$/.test(token)) return fail(res, 400, 'invalid_token');
  req.user.devices = (req.user.devices || []).filter((d) => d.token !== token);
  req.user.devices.push({ token, env });
  save();
  res.json({ ok: true });
});

app.post('/api/messages', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  const text = String(req.body.text || '').trim().slice(0, 140);
  if (!couple || !text) return fail(res, 400, 'invalid_message');
  if (couple.messages.length >= 200) return fail(res, 400, 'invalid_message');
  couple.messages.push(text);
  couple.src = couple.src || {};
  couple.src[text] = langOf(req.user);
  if (couple.tr && couple.tr[text]) { couple.tr[text]._tries = 0; delete couple.tr[text]._next; }
  save();
  res.json(stateFor(req.user));
  translatePending(3).catch(() => {});
});

app.delete('/api/messages', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  const idx = Number(req.body.index);
  if (!couple || !Number.isInteger(idx) || idx < 0 || idx >= couple.messages.length) return fail(res, 400, 'invalid_index');
  if (couple.messages.length <= 1) return fail(res, 400, 'min_one');
  couple.messages.splice(idx, 1);
  couple.bag = [];
  save();
  res.json(stateFor(req.user));
});

// Siguiente mensaje: baraja y no repite hasta usar todos
function nextMessage(couple) {
  couple.bag = (couple.bag || []).filter((i) => i < couple.messages.length);
  if (couple.bag.length === 0) {
    couple.bag = couple.messages.map((_, i) => i);
    for (let i = couple.bag.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [couple.bag[i], couple.bag[j]] = [couple.bag[j], couple.bag[i]];
    }
  }
  return couple.messages[couple.bag.pop()];
}

app.post('/api/send', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  if (!canReceive(partner)) return fail(res, 409, 'partner_no_notif', { partner: partner.name });

  // Fuerza del toque: 1 suave, 2 fuerte, 3 con todo
  const level = Math.min(3, Math.max(1, Math.round(Number(req.body.level) || 1)));
  // Foto o audio adjunto (subido antes con /api/media)
  const mediaId = String(req.body.mediaId || '');
  const media = mediaId ? (couple.media || []).find((m) => m.id === mediaId && m.by === user.id) : null;
  if (mediaId && !media) return fail(res, 400, 'invalid_media');

  const type = TOUCH_TYPES[req.body.type] ? req.body.type : 'heart';
  // Mensaje escrito al momento, pregunta al azar, o mensaje del tipo de toque
  const custom = String(req.body.text || '').trim().slice(0, 140);
  let body;
  if (custom) {
    body = custom;
    couple.src = couple.src || {};
    couple.src[custom] = langOf(user);
  } else if (req.body.ask) body = `?${crypto.randomInt(N_Q)}`;
  else body = type === 'heart' ? nextMessage(couple) : `#${type}`;
  const lang = langOf(partner);
  const prevStreak = streakInfo(couple).streak;
  const prevDays = JSON.stringify(couple.days || {});
  const prevBest = couple.bestStreak;
  recordDay(couple, user.id);
  const s = streakInfo(couple);
  const newMilestone = s.streak > prevStreak && I18N.MILESTONES.includes(s.streak);
  const prevShields = shieldsOf(couple), prevShieldAt = couple.shieldAt;
  if (s.streak > prevStreak) earnShield(couple, s.streak);
  let subtitle = '';
  if (newMilestone) subtitle = `${I18N.MILESTONE_EMOJI[s.streak]} ${I18N.t(lang, 'msTitle', { n: I18N.fmtNum(lang, s.streak), days: I18N.plural(lang, s.streak, I18N.STRINGS[lang].days) })}`;
  else if (s.streak > prevStreak && s.streak > 1) subtitle = I18N.streakPush(lang, s.streak);
  const icon = media ? (media.kind === 'photo' ? ' 📷' : ' 🎤') : '';

  // Sincronía: los dos se tocaron con menos de 90 segundos de diferencia
  const lastFromPartner = [...couple.history].reverse().find((h) => h.fromId === partner.id && h.to === user.id && h.type !== 'react');
  const sync = !!(lastFromPartner && Date.now() - lastFromPartner.at < 90 * 1000 && !lastFromPartner.sync);

  const emoji = req.body.ask ? '💭' : custom ? '💌' : TOUCH_TYPES[type];
  const title = sync ? `${user.name} · ${I18N.t(lang, 'syncTitle')}` : `${user.name} ${emoji.repeat(custom || req.body.ask ? 1 : level)}`;
  // Lo escrito a mano se traduce antes de avisar, para que la notificación llegue en su idioma
  const shown = custom ? await translateFor(couple, custom, lang) : textFor(couple, body, lang);
  const delivered = await pushTo(partner, { title, body: shown + icon, subtitle });
  if (!delivered) {
    couple.days = JSON.parse(prevDays); // si no llegó, no cuenta para la racha
    couple.bestStreak = prevBest;
    couple.shields = prevShields; couple.shieldAt = prevShieldAt;
    save();
    return fail(res, 502, 'delivery_failed');
  }

  couple.history.push({ to: partner.id, fromId: user.id, from: user.name, body, at: Date.now(), level, type: req.body.ask ? 'ask' : custom ? 'text' : type, media: media ? { id: media.id, kind: media.kind } : null, sync });
  couple.history = couple.history.slice(-500);
  couple.counts = couple.counts || {};
  couple.counts[user.id] = (couple.counts[user.id] ?? couple.history.filter((h) => h.fromId === user.id).length - 1) + 1;
  if (newMilestone) couple.milestones = [...new Set([...(couple.milestones || []), s.streak])];
  save();
  res.json({ ok: true, body, level, sync, milestone: newMilestone ? s.streak : null, shieldEarned: shieldsOf(couple) > prevShields, ...stateFor(user) });
  if (custom) translatePending(2).catch(() => {});
  if (sync) pushTo(user, { title: `${partner.name} · ${I18N.t(langOf(user), 'syncTitle')}`, body: I18N.t(langOf(user), 'syncBody') }).catch(() => {});

  // Vibraciones extra según la fuerza, si quien recibe las quiere
  if (custom || req.body.ask || !prefsOf(partner).extra) return;
  for (let i = 2; i <= level; i++) {
    await new Promise((r) => setTimeout(r, 1300));
    await pushTo(partner, { title: `${user.name} ${TOUCH_TYPES[type].repeat(i)}`, body: TOUCH_TYPES[type].repeat(i), tag: `sahar-extra-${Date.now()}-${i}` }).catch(() => 0);
  }
  save();
});

// Reaccionar con un emoji a lo último que te mandaron
app.post('/api/react', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const e = String(req.body.emoji || '');
  if (!REACTIONS.includes(e)) return fail(res, 400, 'invalid_message');
  couple.history.push({ to: partner.id, fromId: user.id, from: user.name, body: e, at: Date.now(), level: 1, type: 'react' });
  couple.history = couple.history.slice(-500);
  save();
  res.json(stateFor(user));
  if (canReceive(partner)) await pushTo(partner, { title: `${user.name} ${e}`, body: I18N.t(langOf(partner), 'reactBody', { e }) }).catch(() => 0);
});

// ---------------------------------------------------------------------------
// «Esto o aquello»: cada uno elige lo suyo y adivina lo del otro.
// Cada acierto = 1 punto. Puntos totales y por semana; quien gane la semana
// se lleva un vale (masaje, cena romántica, comodín…).
// ---------------------------------------------------------------------------
const TOT_N = 4;
// Recorre todas las preguntas sin repetir: cada «vuelta» es una baraja distinta
// y cada día toma las 4 siguientes. Solo se repite una pregunta cuando ya
// salieron todas.
function totPerm(round, n) {
  const idx = Array.from({ length: n }, (_, i) => i);
  let seed = (round + 1) * 2654435761 >>> 0;
  for (let i = n - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}
function totPairs(day) {
  const n = I18N.TOT.es.length;
  const perDay = Math.floor(n / TOT_N); // días por vuelta
  const d = dayNum(day);
  const round = Math.floor(d / perDay), slot = d % perDay;
  return totPerm(round, n).slice(slot * TOT_N, slot * TOT_N + TOT_N);
}
// Punto extra por constancia: si un día solo jugó uno de los dos, quien jugó
// se lleva 1 punto cuando termina ese día.
const TOT_BONUS = 1;
function settleTotBonus(couple, now = new Date()) {
  if (!couple.tot || couple.members.length < 2) return;
  const today = dayKey(now, couple.tz);
  const oldest = prevDay(prevDay(today)); // no repartir puntos de días muy antiguos
  for (const [day, entry] of Object.entries(couple.tot)) {
    if (day >= today || day < oldest || entry.bonus || entry.scored) continue;
    const played = couple.members.filter((m) => entry.answers && entry.answers[m]);
    if (played.length !== 1) continue;
    const uid = played[0];
    entry.bonus = uid;
    couple.points = couple.points || {};
    couple.points[uid] = (couple.points[uid] || 0) + TOT_BONUS;
    if (couple.week && couple.week.key === weekKey(new Date(day + 'T12:00:00Z'), 'UTC')) {
      couple.week.pts[uid] = (couple.week.pts[uid] || 0) + TOT_BONUS;
    }
    save();
    const u = db.users[uid];
    const other = db.users[couple.members.find((m) => m !== uid)];
    if (u && canReceive(u)) pushTo(u, { title: 'Sahar 🌟', body: I18N.t(langOf(u), 'totBonusPush', { p: other ? other.name : '' }) }).catch(() => {});
  }
}
const countHits = (guess, mine) => guess.reduce((a, g, i) => a + (g === mine[i] ? 1 : 0), 0);
function totState(couple, user, partner) {
  const day = dayKey(new Date(), couple.tz);
  const entry = (couple.tot || {})[day] || { answers: {} };
  const mine = entry.answers[user.id] || null;
  const theirs = partner ? entry.answers[partner.id] || null : null;
  const both = !!(mine && theirs);
  return {
    day, pairs: entry.pairs || totPairs(day), mine,
    partner: both ? theirs : null, partnerPlayed: !!theirs,
    myHits: both ? countHits(mine.guess, theirs.mine) : null,
    partnerHits: both ? countHits(theirs.guess, mine.mine) : null,
  };
}
function weekKey(now, tz) {
  const d = new Date(dayKey(now, tz) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // lunes
  return d.toISOString().slice(0, 10);
}
function scoreState(couple, user, partner) {
  const wk = couple.week && couple.week.key === weekKey(new Date(), couple.tz) ? couple.week.pts : {};
  return {
    me: (couple.points || {})[user.id] || 0, partner: partner ? (couple.points || {})[partner.id] || 0 : 0,
    weekMe: wk[user.id] || 0, weekPartner: partner ? wk[partner.id] || 0 : 0,
  };
}
function drawCard(couple, owner) {
  const n = I18N.CARDS.es.length;
  const have = new Set((couple.cards || []).filter((c) => c.owner === owner && !c.used).map((c) => c.card));
  const pool = Array.from({ length: n }, (_, i) => i).filter((i) => !have.has(i));
  const card = (pool.length ? pool : Array.from({ length: n }, (_, i) => i))[crypto.randomInt(pool.length || n)];
  const c = { id: crypto.randomBytes(6).toString('hex'), card, owner, at: Date.now(), used: false };
  couple.cards = [...(couple.cards || []), c].slice(-60);
  return c;
}
const cardName = (lang, i) => `${I18N.CARD_EMOJI[i]} ${I18N.CARDS[I18N.pick(lang)][i]}`;
// Cierra la semana anterior: quien tenga más puntos se lleva un vale; empate con puntos = vale para los dos
function settleWeek(couple, now = new Date()) {
  const cur = weekKey(now, couple.tz);
  if (!couple.week) { couple.week = { key: cur, pts: {} }; return; }
  if (couple.week.key === cur) return;
  const pts = couple.week.pts || {};
  couple.week = { key: cur, pts: {} };
  save();
  const [a, b] = couple.members;
  if (!a || !b) return;
  const pa = pts[a] || 0, pb = pts[b] || 0;
  if (!pa && !pb) return;
  const users = [db.users[a], db.users[b]];
  if (pa === pb) {
    const ca = drawCard(couple, a), cb = drawCard(couple, b);
    for (const [u, c] of [[users[0], ca], [users[1], cb]]) if (u && canReceive(u)) pushTo(u, { title: 'Sahar 🎁', body: `${I18N.t(langOf(u), 'weekTiePush')}\n${cardName(langOf(u), c.card)}` }).catch(() => {});
    return;
  }
  const [win, lose] = pa > pb ? users : [users[1], users[0]];
  if (!win) return;
  const c = drawCard(couple, win.id);
  if (canReceive(win)) pushTo(win, { title: 'Sahar 🏆', body: I18N.t(langOf(win), 'weekWinPush', { c: cardName(langOf(win), c.card) }) }).catch(() => {});
  if (lose && canReceive(lose)) pushTo(lose, { title: 'Sahar 🏆', body: I18N.t(langOf(lose), 'weekLosePush', { p: win.name, c: cardName(langOf(lose), c.card) }) }).catch(() => {});
}
app.post('/api/tot', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const ok = (a) => Array.isArray(a) && a.length === TOT_N && a.every((x) => x === 0 || x === 1);
  const { mine, guess } = req.body;
  if (!ok(mine) || !ok(guess)) return fail(res, 400, 'invalid_message');
  const day = dayKey(new Date(), couple.tz);
  couple.tot = couple.tot || {};
  const entry = couple.tot[day] || (couple.tot[day] = { answers: {}, pairs: totPairs(day) });
  if (entry.answers[user.id]) return res.json(stateFor(user)); // ya jugó hoy
  entry.answers[user.id] = { mine, guess };
  const theirs = entry.answers[partner.id];
  if (theirs && !entry.scored) {
    entry.scored = true;
    couple.points = couple.points || {};
    if (!couple.week || couple.week.key !== weekKey(new Date(), couple.tz)) couple.week = { key: weekKey(new Date(), couple.tz), pts: {} };
    for (const [uid, g, m] of [[user.id, guess, theirs.mine], [partner.id, theirs.guess, mine]]) {
      const hits = countHits(g, m);
      couple.points[uid] = (couple.points[uid] || 0) + hits;
      couple.week.pts[uid] = (couple.week.pts[uid] || 0) + hits;
    }
  }
  const keys = Object.keys(couple.tot).sort();
  while (keys.length > 14) delete couple.tot[keys.shift()];
  save();
  res.json(stateFor(user));
  if (canReceive(partner)) {
    const pl = langOf(partner);
    const body = theirs
      ? I18N.t(pl, 'totPts', { n: I18N.fmtNum(pl, countHits(theirs.guess, mine)), t: I18N.fmtNum(pl, TOT_N) }) + ' 🎯'
      : I18N.t(pl, 'totPush', { p: user.name });
    pushTo(partner, { title: `Sahar 🎲 ${I18N.t(pl, 'totTitle')}`, body }).catch(() => {});
  }
});
// Canjear un vale: avisa a la pareja
app.post('/api/card/use', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  const c = couple && (couple.cards || []).find((x) => x.id === req.body.id && x.owner === user.id && !x.used);
  if (!c) return fail(res, 400, 'invalid_message');
  c.used = true; c.usedAt = Date.now();
  save();
  res.json(stateFor(user));
  if (partner && canReceive(partner)) pushTo(partner, { title: 'Sahar 🎁', body: I18N.t(langOf(partner), 'cardPush', { p: user.name, c: cardName(langOf(partner), c.card) }) }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Armonía: enojos contados con suavidad, gratitud, vales regalados y deseos
// ---------------------------------------------------------------------------
const N_ISS_CATS = I18N.ISS_CAT_EMOJI.length;
const N_FEELS = I18N.FEEL_EMOJI.length;
const N_WISHES = 7;
const clean = (v, max) => String(v || '').trim().slice(0, max);
const remember = (couple, text, user) => { if (!text) return; couple.src = couple.src || {}; couple.src[text] = langOf(user); if (couple.tr && couple.tr[text]) { couple.tr[text]._tries = 0; delete couple.tr[text]._next; } };
const DAY_MS = 86400000;
const ONLINE_MS = 50000; // visto hace menos de 50 s = con la app abierta
const recentCount = (list, uid, ms) => (list || []).filter((x) => x.by === uid && Date.now() - x.at < ms).length;

// Contar algo que molestó: tema, emoción, qué pasó y qué necesito (método Gottman)
app.post('/api/issue', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const cat = Number(req.body.cat), feel = Number(req.body.feel);
  if (!Number.isInteger(cat) || cat < 0 || cat >= N_ISS_CATS || !Number.isInteger(feel) || feel < 0 || feel >= N_FEELS) return fail(res, 400, 'invalid_message');
  if (recentCount(couple.issues, user.id, DAY_MS) >= 10) return fail(res, 429, 'invalid_message');
  const what = clean(req.body.what, 300), need = clean(req.body.need, 200);
  const it = { id: crypto.randomBytes(6).toString('hex'), by: user.id, cat, feel, what, need, at: Date.now(), sorry: false, solved: false };
  couple.issues = [...(couple.issues || []), it].slice(-200);
  remember(couple, what, user); remember(couple, need, user);
  save();
  res.json(stateFor(user));
  translatePending(2).catch(() => {});
  if (canReceive(partner)) pushTo(partner, { title: 'Sahar 💬', body: I18N.t(langOf(partner), 'issPush', { p: user.name }) }).catch(() => {});
});
// Responder: «lo siento» (quien lo recibió), «resuelto» (cualquiera) o borrar (quien lo escribió)
app.post('/api/issue/act', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  const it = couple && (couple.issues || []).find((x) => x.id === req.body.id);
  if (!it) return fail(res, 400, 'invalid_message');
  const act = req.body.act;
  const author = db.users[it.by];
  const catName = (lang) => `${I18N.ISS_CAT_EMOJI[it.cat]} ${I18N.t(lang, 'issCats.' + it.cat)}`;
  if (act === 'sorry' && it.by !== user.id && !it.sorry) {
    it.sorry = true; it.sorryAt = Date.now();
    if (author && canReceive(author)) pushTo(author, { title: 'Sahar 💗', body: I18N.t(langOf(author), 'issSorryPush', { p: user.name }) }).catch(() => {});
  } else if (act === 'solved' && !it.solved) {
    it.solved = true; it.solvedAt = Date.now();
    if (partner && canReceive(partner)) pushTo(partner, { title: 'Sahar 🕊️', body: I18N.t(langOf(partner), 'issSolvedPush', { p: user.name, c: catName(langOf(partner)) }) }).catch(() => {});
  } else if (act === 'delete' && it.by === user.id) {
    couple.issues = couple.issues.filter((x) => x !== it);
  } else return fail(res, 400, 'invalid_message');
  save();
  res.json(stateFor(user));
});

// Frasco de gratitud
app.post('/api/thanks', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const text = clean(req.body.text, 200);
  if (!text) return fail(res, 400, 'invalid_message');
  if (recentCount(couple.thanks, user.id, DAY_MS) >= 30) return fail(res, 429, 'invalid_message');
  couple.thanks = [...(couple.thanks || []), { id: crypto.randomBytes(6).toString('hex'), by: user.id, text, at: Date.now() }].slice(-300);
  remember(couple, text, user);
  save();
  res.json(stateFor(user));
  if (canReceive(partner)) {
    const pl = langOf(partner);
    pushTo(partner, { title: 'Sahar 🫙', body: I18N.t(pl, 'gratPush', { p: user.name, m: await translateFor(couple, text, pl) }) }).catch(() => {});
  }
  translatePending(2).catch(() => {});
});

// Regalar un vale (para compensar, para mimar o porque sí)
app.post('/api/gift', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const card = Number(req.body.card);
  if (!I18N.GIFT_CARDS.includes(card)) return fail(res, 400, 'invalid_message');
  const gifted = (couple.cards || []).filter((c) => c.from === user.id && Date.now() - c.at < DAY_MS).length;
  if (gifted >= 5) return fail(res, 429, 'invalid_message');
  const note = clean(req.body.note, 140);
  const issue = (couple.issues || []).find((x) => x.id === req.body.issue && x.by === partner.id);
  const c = { id: crypto.randomBytes(6).toString('hex'), card, owner: partner.id, from: user.id, note, issue: issue ? issue.id : null, at: Date.now(), used: false };
  couple.cards = [...(couple.cards || []), c].slice(-60);
  if (issue) issue.gift = c.id;
  remember(couple, note, user);
  save();
  res.json(stateFor(user));
  translatePending(1).catch(() => {});
  if (canReceive(partner)) pushTo(partner, { title: 'Sahar 🎁', body: I18N.t(langOf(partner), 'giftPush', { p: user.name, c: cardName(langOf(partner), card) }) + (note ? `\n«${await translateFor(couple, note, langOf(partner))}»` : '') }).catch(() => {});
});

// 7 deseos para la próxima versión de la app
app.post('/api/wishes', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, N_WISHES).map((x) => clean(x, 400)) : [];
  while (items.length < N_WISHES) items.push('');
  if (!items.some(Boolean)) return fail(res, 400, 'invalid_message');
  couple.wishes = couple.wishes || {};
  const first = !couple.wishes[user.id];
  couple.wishes[user.id] = { items, at: Date.now(), lang: langOf(user) };
  for (const w of items) remember(couple, w, user);
  save();
  res.json(stateFor(user));
  translatePending(3).catch(() => {});
  const partner = partnerOf(user);
  if (first && partner && canReceive(partner)) pushTo(partner, { title: 'Sahar 💫', body: I18N.t(langOf(partner), 'wishPush', { p: user.name }) }).catch(() => {});
});

function harmonyState(couple, user, partner) {
  const since = Date.now() - 30 * DAY_MS;
  const issues = couple.issues || [];
  const thanks = couple.thanks || [];
  const cats = Array(N_ISS_CATS).fill(0);
  for (const it of issues) cats[it.cat] = (cats[it.cat] || 0) + 1;
  const w = couple.wishes || {};
  return {
    issues: issues.slice(-60).reverse().map((x) => ({ id: x.id, mine: x.by === user.id, cat: x.cat, feel: x.feel, what: x.what, need: x.need, at: x.at, sorry: !!x.sorry, solved: !!x.solved, gift: !!x.gift })),
    issueCats: cats,
    thanks: thanks.slice(-40).reverse().map((x) => ({ id: x.id, mine: x.by === user.id, text: x.text, at: x.at })),
    ratio: { g: thanks.filter((x) => x.at > since).length, i: issues.filter((x) => x.at > since).length },
    wishes: { mine: w[user.id] ? w[user.id].items : null, partner: partner && w[partner.id] ? w[partner.id].items : null, partnerAt: partner && w[partner.id] ? w[partner.id].at : null },
  };
}

// ---------------------------------------------------------------------------
// «Tira y afloja»: juego en vivo. Los dos tocan a la vez; el corazón se mueve
// hacia quien toca más. Gana quien lo lleve a su lado (o quien vaya delante
// al acabar el tiempo). El estado vive en memoria: solo se guarda el resultado.
// ---------------------------------------------------------------------------
const RACE = { wait: 120000, countdown: 3500, duration: 20000, target: 40, maxRate: 16, linger: 60000, prize: 2 };
const races = {};
function raceFinish(couple, r, now) {
  r.status = 'done'; r.doneAt = now;
  const [a, b] = couple.members;
  const ca = r.counts[a] || 0, cb = r.counts[b] || 0;
  r.winner = ca === cb ? 'tie' : ca > cb ? a : b;
  if (r.winner !== 'tie') {
    couple.points = couple.points || {};
    couple.points[r.winner] = (couple.points[r.winner] || 0) + RACE.prize;
    if (!couple.week || couple.week.key !== weekKey(new Date(now), couple.tz)) couple.week = { key: weekKey(new Date(now), couple.tz), pts: {} };
    couple.week.pts[r.winner] = (couple.week.pts[r.winner] || 0) + RACE.prize;
    couple.raceWins = couple.raceWins || {};
    couple.raceWins[r.winner] = (couple.raceWins[r.winner] || 0) + 1;
  }
  save();
}
function raceTick(code, now = Date.now()) {
  const r = races[code];
  const couple = db.couples[code];
  if (!r || !couple) return null;
  if (r.status === 'waiting' && now - r.created > RACE.wait) { r.status = 'expired'; r.doneAt = now; }
  if (r.status === 'live') {
    const [a, b] = couple.members;
    const diff = (r.counts[a] || 0) - (r.counts[b] || 0);
    if (Math.abs(diff) >= RACE.target || now >= r.endAt) raceFinish(couple, r, now);
  }
  if ((r.status === 'done' || r.status === 'expired' || r.status === 'cancelled') && now - r.doneAt > RACE.linger) { delete races[code]; return null; }
  return r;
}
function raceState(user, now = Date.now()) {
  const couple = user.code && db.couples[user.code];
  const partner = couple && partnerOf(user);
  const wins = (couple && couple.raceWins) || {};
  const base = { target: RACE.target, duration: RACE.duration, prize: RACE.prize, winsMe: wins[user.id] || 0, winsPartner: partner ? wins[partner.id] || 0 : 0 };
  const r = couple && raceTick(user.code, now);
  if (!r || !partner) return { ...base, id: null, status: 'none' };
  return {
    ...base, id: r.id, status: r.status, byMe: r.by === user.id,
    startIn: r.startAt ? r.startAt - now : null, endIn: r.endAt ? r.endAt - now : null,
    me: r.counts[user.id] || 0, partner: r.counts[partner.id] || 0,
    winner: r.winner ? (r.winner === 'tie' ? 'tie' : r.winner === user.id ? 'me' : 'partner') : null,
  };
}
app.get('/api/race', auth, (req, res) => res.json(raceState(req.user)));
app.post('/api/race/start', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const r = raceTick(user.code);
  if (r && (r.status === 'waiting' || r.status === 'live')) return res.json(raceState(user)); // ya hay una en marcha
  races[user.code] = { id: crypto.randomBytes(6).toString('hex'), by: user.id, status: 'waiting', created: Date.now(), counts: {} };
  res.json(raceState(user));
  if (canReceive(partner)) pushTo(partner, { title: 'Sahar ⚡', body: I18N.t(langOf(partner), 'racePush', { p: user.name }), tag: 'sahar-race' }).catch(() => {});
});
app.post('/api/race/accept', auth, (req, res) => {
  const user = req.user;
  const r = raceTick(user.code);
  if (!r || r.id !== req.body.id || r.status !== 'waiting' || r.by === user.id) return res.json(raceState(user));
  const now = Date.now();
  r.status = 'live'; r.startAt = now + RACE.countdown; r.endAt = r.startAt + RACE.duration;
  res.json(raceState(user));
});
app.post('/api/race/cancel', auth, (req, res) => {
  const user = req.user;
  const r = raceTick(user.code);
  if (r && r.id === req.body.id && r.status === 'waiting') { r.status = 'cancelled'; r.doneAt = Date.now(); r.cancelledBy = user.id; }
  res.json(raceState(user));
});
app.post('/api/race/tap', auth, (req, res) => {
  const user = req.user;
  const now = Date.now();
  const r = raceTick(user.code, now);
  if (r && r.id === req.body.id && r.status === 'live' && now >= r.startAt) {
    // Tope razonable de toques por segundo (contra trampas o errores)
    const maxN = Math.ceil(((Math.min(now, r.endAt) - r.startAt) / 1000) * RACE.maxRate) + 3;
    const n = Math.min(maxN, Math.max(0, Math.floor(Number(req.body.n) || 0)));
    if (n > (r.counts[user.id] || 0)) r.counts[user.id] = n;
    raceTick(user.code, now);
  }
  res.json(raceState(user));
});

// ---------------------------------------------------------------------------
// Protector de racha 🛡️: si un día se les olvida, se gasta uno y la racha
// sigue. Empiezan con 2 y ganan 1 cada 7 días seguidos (máximo 3).
// «Recuperar racha»: regalo único para traer de vuelta la racha perdida.
// ---------------------------------------------------------------------------
const SHIELD = { start: 2, max: 3, every: 7, maxGap: 2, rescueGap: 21 };
const shieldsOf = (couple) => (Number.isInteger(couple.shields) ? couple.shields : SHIELD.start);
function earnShield(couple, streak) {
  if (streak > 0 && streak % SHIELD.every === 0 && (couple.shieldAt || 0) < streak) {
    couple.shieldAt = streak;
    couple.shields = Math.min(SHIELD.max, shieldsOf(couple) + 1);
  }
}
const isBoth = (couple, k) => ((couple.days || {})[k] || []).length >= 2 || !!(couple.frozen || {})[k];
const chainFrom = (couple, k) => { let n = 0; while (isBoth(couple, k)) { n++; k = prevDay(k); } return n; };
function settleShields(couple, now = new Date()) {
  if (!couple || couple.members.length < 2) return 0;
  const today = dayKey(now, couple.tz);
  let k = prevDay(today);
  const gap = [];
  while (!isBoth(couple, k) && gap.length <= SHIELD.maxGap) { gap.push(k); k = prevDay(k); }
  if (!gap.length || gap.length > SHIELD.maxGap) return 0;
  const chain = chainFrom(couple, k);
  const have = shieldsOf(couple);
  if (!chain || gap.length > have) return 0;
  couple.frozen = couple.frozen || {};
  for (const g of gap) couple.frozen[g] = true;
  couple.shields = have - gap.length;
  couple.bestStreak = streakInfo(couple, now).bestStreak;
  save();
  for (const id of couple.members) {
    const u = db.users[id];
    if (u && canReceive(u)) pushTo(u, { title: 'Sahar 🛡️', body: I18N.t(langOf(u), 'shieldUsedPush', { n: I18N.fmtNum(langOf(u), chain) }) }).catch(() => {});
  }
  return gap.length;
}
// La racha perdida más reciente que todavía se puede recuperar
function rescueInfo(couple, now = new Date()) {
  if (couple.rescued || couple.members.length < 2) return null;
  const today = dayKey(now, couple.tz);
  let k = isBoth(couple, today) ? today : prevDay(today);
  const current = chainFrom(couple, k);
  for (let i = 0; i < current; i++) k = prevDay(k);
  const gap = [];
  while (!isBoth(couple, k) && gap.length <= SHIELD.rescueGap) { gap.push(k); k = prevDay(k); }
  if (!gap.length || gap.length > SHIELD.rescueGap) return null;
  const old = chainFrom(couple, k);
  if (old < 2) return null;
  return { gap, n: old + gap.length + current };
}
app.post('/api/streak/rescue', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const r = rescueInfo(couple);
  if (!r) return fail(res, 400, 'invalid_message');
  couple.frozen = couple.frozen || {};
  for (const g of r.gap) couple.frozen[g] = true;
  couple.rescued = true;
  couple.bestStreak = streakInfo(couple).bestStreak;
  save();
  res.json(stateFor(user));
  if (canReceive(partner)) pushTo(partner, { title: 'Sahar 🔥', body: I18N.t(langOf(partner), 'rescuePush', { p: user.name, n: I18N.fmtNum(langOf(partner), r.n) }) }).catch(() => {});
});

// Número estable a partir de un texto (para elegir ideas de la semana)
const hashNum = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0; return h; };

// ---------------------------------------------------------------------------
// Plan de la semana: una receta para cocinar juntos y una salida para
// descubrir algo nuevo. Se puede pedir otra idea y marcar «lo hicimos».
// ---------------------------------------------------------------------------
const N_COOK = I18N.COOK_EMOJI.length, N_OUT = I18N.OUT_EMOJI.length;
function weeklyOf(couple, now = new Date()) {
  const key = weekKey(now, couple.tz);
  if (!couple.weekly || couple.weekly.key !== key) {
    const code = couple.members.join('');
    couple.weekly = { key, cook: hashNum(key + 'c' + code) % N_COOK, out: hashNum(key + 'o' + code) % N_OUT, cookDone: null, outDone: null };
  }
  return couple.weekly;
}
app.post('/api/weekly', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const kind = req.body.kind === 'out' ? 'out' : req.body.kind === 'cook' ? 'cook' : null;
  if (!kind) return fail(res, 400, 'invalid_message');
  const w = weeklyOf(couple);
  const n = kind === 'cook' ? N_COOK : N_OUT;
  if (req.body.act === 'other' && !w[kind + 'Done']) {
    w[kind] = (w[kind] + 1 + crypto.randomInt(n - 1)) % n;
  } else if (req.body.act === 'done' && !w[kind + 'Done']) {
    w[kind + 'Done'] = { by: user.id, at: Date.now() };
    couple.weeklyCount = couple.weeklyCount || { cook: 0, out: 0 };
    couple.weeklyCount[kind]++;
    if (canReceive(partner)) {
      const pl = langOf(partner);
      const list = (kind === 'cook' ? I18N.COOK : I18N.OUT);
      const emo = (kind === 'cook' ? I18N.COOK_EMOJI : I18N.OUT_EMOJI)[w[kind]];
      pushTo(partner, { title: `Sahar ${emo}`, body: I18N.t(pl, 'weekDonePush', { p: user.name, x: (list[pl] || list.en)[w[kind]] }) }).catch(() => {});
    }
  } else return fail(res, 400, 'invalid_message');
  save();
  res.json(stateFor(user));
});

// ---------------------------------------------------------------------------
// «Juntos hacia la felicidad»: juego en equipo. Cada semana una misión por
// pilar (felicidad, éxito, satisfacción, orgullo). Cuando los dos la cumplen,
// crece su jardín. Si cumplen las 4, vale para cada uno.
// ---------------------------------------------------------------------------
const N_MISS = I18N.MISSIONS.en[0].length;
const missionPicks = (key) => [0, 1, 2, 3].map((p) => hashNum(key + ':' + p) % N_MISS);
function missOf(couple, now = new Date()) {
  const key = weekKey(now, couple.tz);
  if (!couple.miss || couple.miss.key !== key) couple.miss = { key, picks: missionPicks(key), done: [[], [], [], []], all: false };
  return couple.miss;
}
app.post('/api/mission', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const p = Number(req.body.p);
  if (![0, 1, 2, 3].includes(p)) return fail(res, 400, 'invalid_message');
  const m = missOf(couple);
  if (m.done[p].includes(user.id)) return res.json(stateFor(user));
  m.done[p].push(user.id);
  const both = couple.members.every((id) => m.done[p].includes(id));
  if (both) {
    couple.missTotal = (couple.missTotal || 0) + 1;
    couple.pillars = couple.pillars || [0, 0, 0, 0];
    couple.pillars[p]++;
  }
  const allNow = !m.all && m.done.every((d) => couple.members.every((id) => d.includes(id)));
  if (allNow) {
    m.all = true;
    for (const id of couple.members) drawCard(couple, id);
  }
  save();
  res.json(stateFor(user));
  if (allNow) {
    for (const id of couple.members) { const u = db.users[id]; if (u && canReceive(u)) pushTo(u, { title: 'Sahar 🌳', body: I18N.t(langOf(u), 'missAllPush') }).catch(() => {}); }
  } else if (!both && canReceive(partner)) {
    const pl = langOf(partner);
    pushTo(partner, { title: `Sahar ${I18N.PILLAR_EMOJI[p]}`, body: I18N.t(pl, 'missPush', { p: user.name, x: (I18N.MISSIONS[pl] || I18N.MISSIONS.en)[p][m.picks[p]] }) }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// «Carrera de la suerte»: carrera por turnos con dado (gana la suerte, no la
// velocidad). Casillas especiales y viento a favor para quien va detrás.
// ---------------------------------------------------------------------------
const DICE = { len: 36, wind: 6, prize: 2, specials: { turbo: 3, slip: 3, star: 2, swap: 2, heart: 4 } };
function diceBoard() {
  const cells = Array(DICE.len).fill('');
  const free = Array.from({ length: DICE.len - 5 }, (_, i) => i + 2); // 2..32
  for (let i = free.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [free[i], free[j]] = [free[j], free[i]]; }
  for (const [type, n] of Object.entries(DICE.specials)) for (let i = 0; i < n; i++) cells[free.pop()] = type;
  return cells;
}
function diceState(couple, user, partner) {
  const g = couple.dice;
  const wins = couple.diceWins || {};
  const base = { winsMe: wins[user.id] || 0, winsPartner: partner ? wins[partner.id] || 0 : 0, racer: user.racer || I18N.RACERS[0], partnerRacer: (partner && partner.racer) || I18N.RACERS[1], len: DICE.len };
  if (!g || !partner) return { ...base, id: null };
  return {
    ...base, id: g.id, board: g.board, status: g.status, myTurn: g.status === 'live' && g.turn === user.id,
    me: g.pos[user.id] || 0, partner: g.pos[partner.id] || 0,
    winner: g.winner ? (g.winner === user.id ? 'me' : 'partner') : null,
    log: (g.log || []).slice(-6).map((x) => ({ ...x, by: x.by === user.id ? 'me' : 'partner' })), at: g.at,
  };
}
app.post('/api/racer', auth, (req, res) => {
  if (!I18N.RACERS.includes(req.body.racer)) return fail(res, 400, 'invalid_message');
  req.user.racer = req.body.racer;
  save();
  res.json(stateFor(req.user));
});
app.post('/api/dice/start', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  if (couple.dice && couple.dice.status === 'live') return res.json(stateFor(user));
  couple.dice = { id: crypto.randomBytes(6).toString('hex'), board: diceBoard(), pos: { [user.id]: 0, [partner.id]: 0 }, turn: user.id, status: 'live', log: [], at: Date.now() };
  save();
  res.json(stateFor(user));
  if (canReceive(partner)) pushTo(partner, { title: 'Sahar 🏎️', body: I18N.t(langOf(partner), 'diceStartPush', { p: user.name }), tag: 'sahar-dice' }).catch(() => {});
});
app.post('/api/dice/roll', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  const g = couple && couple.dice;
  if (!partner || !g || g.status !== 'live' || g.turn !== user.id || g.id !== req.body.id) return couple ? res.json(stateFor(user)) : fail(res, 400, 'no_partner');
  const end = DICE.len - 1;
  const from = g.pos[user.id] || 0, other = g.pos[partner.id] || 0;
  const roll = crypto.randomInt(1, 7);
  const wind = other - from >= DICE.wind ? 1 : 0;
  let to = Math.min(end, from + roll + wind);
  const effect = g.board[to] || '';
  let again = false;
  if (to < end) {
    if (effect === 'turbo') to = Math.min(end, to + 3);
    else if (effect === 'slip') to = Math.max(0, to - 2);
    else if (effect === 'star') again = true;
    else if (effect === 'swap') { g.pos[partner.id] = to; to = other; }
    else if (effect === 'heart') { const nx = g.board.findIndex((c, i) => i > to && c === 'heart'); if (nx > 0) to = nx; }
  }
  g.pos[user.id] = to;
  g.log = [...(g.log || []), { by: user.id, roll, wind, from, to, effect: to === end ? '' : effect, at: Date.now() }].slice(-12);
  g.at = Date.now();
  let won = null;
  for (const id of couple.members) if ((g.pos[id] || 0) >= end) won = id;
  if (won) {
    g.status = 'done'; g.winner = won;
    couple.points = couple.points || {};
    couple.points[won] = (couple.points[won] || 0) + DICE.prize;
    if (!couple.week || couple.week.key !== weekKey(new Date(), couple.tz)) couple.week = { key: weekKey(new Date(), couple.tz), pts: {} };
    couple.week.pts[won] = (couple.week.pts[won] || 0) + DICE.prize;
    couple.diceWins = couple.diceWins || {};
    couple.diceWins[won] = (couple.diceWins[won] || 0) + 1;
  } else g.turn = again ? user.id : partner.id;
  save();
  res.json(stateFor(user));
  if (canReceive(partner) && (won || !again)) {
    const pl = langOf(partner);
    const body = won ? I18N.t(pl, 'diceWinPush', { p: db.users[won].name }) : I18N.t(pl, 'diceTurnPush', { p: user.name, n: I18N.fmtNum(pl, roll) });
    pushTo(partner, { title: 'Sahar 🎲', body, tag: 'sahar-dice' }).catch(() => {});
  }
});
app.post('/api/dice/quit', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  if (couple && couple.dice && couple.dice.status === 'live' && couple.dice.id === req.body.id) { couple.dice.status = 'quit'; save(); }
  res.json(stateFor(req.user));
});

// ---------------------------------------------------------------------------
// Memorama con sus fotos: el mismo tablero para los dos cada día; gana quien
// use menos movimientos (+1 punto; empate, +1 a cada uno).
// ---------------------------------------------------------------------------
const MEMO = { pairs: 8, prize: 1 };
function memoState(couple, user, partner) {
  const day = dayKey(new Date(), couple.tz);
  const e = (couple.memo || {})[day] || {};
  const mine = e[user.id] ?? null, theirs = partner ? e[partner.id] ?? null : null;
  return { day, seed: hashNum(day + couple.members.join('')), pairs: MEMO.pairs, mine, partner: mine != null ? theirs : null, partnerPlayed: theirs != null };
}
app.post('/api/memo', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const moves = Math.round(Number(req.body.moves));
  if (!Number.isInteger(moves) || moves < MEMO.pairs || moves > 500) return fail(res, 400, 'invalid_message');
  const day = dayKey(new Date(), couple.tz);
  couple.memo = couple.memo || {};
  const e = couple.memo[day] || (couple.memo[day] = {});
  if (e[user.id] != null) return res.json(stateFor(user));
  e[user.id] = moves;
  const theirs = e[partner.id];
  if (theirs != null) {
    const winners = moves === theirs ? [user.id, partner.id] : [moves < theirs ? user.id : partner.id];
    couple.points = couple.points || {};
    if (!couple.week || couple.week.key !== weekKey(new Date(), couple.tz)) couple.week = { key: weekKey(new Date(), couple.tz), pts: {} };
    for (const w of winners) { couple.points[w] = (couple.points[w] || 0) + MEMO.prize; couple.week.pts[w] = (couple.week.pts[w] || 0) + MEMO.prize; }
  }
  const keys = Object.keys(couple.memo).sort();
  while (keys.length > 14) delete couple.memo[keys.shift()];
  save();
  res.json(stateFor(user));
  if (canReceive(partner)) { const pl = langOf(partner); pushTo(partner, { title: 'Sahar 🃏', body: I18N.t(pl, 'memoPush', { p: user.name, n: I18N.fmtNum(pl, moves) }) }).catch(() => {}); }
});
// Título de una carta (foto del álbum)
app.post('/api/photo/title', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  const m = couple && (couple.media || []).find((x) => x.id === req.body.id && x.kind === 'photo');
  if (!m) return fail(res, 400, 'invalid_media');
  m.title = clean(req.body.title, 40);
  remember(couple, m.title, req.user);
  save();
  res.json(stateFor(req.user));
  translatePending(1).catch(() => {});
});

// ---------------------------------------------------------------------------
// Cofre: recuerdos que se dejan, lecciones aprendidas y planes de futuro
// ---------------------------------------------------------------------------
app.post('/api/chest', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const kind = Number(req.body.kind);
  const text = clean(req.body.text, 300);
  if (![0, 1, 2].includes(kind) || !text) return fail(res, 400, 'invalid_message');
  if (recentCount(couple.chest, user.id, DAY_MS) >= 30) return fail(res, 429, 'invalid_message');
  couple.chest = [...(couple.chest || []), { id: crypto.randomBytes(6).toString('hex'), by: user.id, kind, text, at: Date.now() }].slice(-300);
  remember(couple, text, user);
  save();
  res.json(stateFor(user));
  translatePending(1).catch(() => {});
  if (canReceive(partner)) { const pl = langOf(partner); pushTo(partner, { title: 'Sahar 💫', body: I18N.t(pl, 'chestPush', { p: user.name, k: I18N.t(pl, 'chestKinds.' + kind) }) }).catch(() => {}); }
});
app.delete('/api/chest', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  couple.chest = (couple.chest || []).filter((x) => !(x.id === req.body.id && x.by === req.user.id));
  save();
  res.json(stateFor(req.user));
});

// Mes de cumpleaños y su tema (la app se viste con ese tema ese mes)
app.post('/api/birth', auth, (req, res) => {
  const month = Number(req.body.month);
  const theme = clean(req.body.theme, 20).replace(/[^a-z]/g, '');
  req.user.birth = { month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null, theme: theme || null };
  save();
  res.json(stateFor(req.user));
});

// ---------------------------------------------------------------------------
// Nuestro sueño: viaje a Tokio, Seúl o Singapur (fecha, bote y lista)
// ---------------------------------------------------------------------------
const dreamOf = (couple) => (couple.dream = couple.dream || { city: 'tokyo', date: null, goal: 3000, saved: 0, ticks: {} });
app.post('/api/dream', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  const d = dreamOf(couple);
  if (I18N.DREAM_CITIES.includes(req.body.city)) d.city = req.body.city;
  if (req.body.date === null || req.body.date === '') d.date = null;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') && !isNaN(Date.parse(req.body.date + 'T00:00:00Z'))) d.date = req.body.date;
  const goal = Math.round(Number(req.body.goal));
  if (Number.isInteger(goal) && goal > 0 && goal <= 1000000) d.goal = goal;
  if (Number.isInteger(req.body.tick) && req.body.tick >= 0 && req.body.tick < 8) {
    const list = d.ticks[d.city] || [];
    d.ticks[d.city] = list.includes(req.body.tick) ? list.filter((x) => x !== req.body.tick) : [...list, req.body.tick];
  }
  save();
  res.json(stateFor(req.user));
});
app.post('/api/dream/save', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const amount = Math.round(Number(req.body.amount) * 100) / 100;
  if (!isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) return fail(res, 400, 'invalid_message');
  const d = dreamOf(couple);
  d.saved = Math.max(0, Math.round((d.saved + amount) * 100) / 100);
  d.log = [...(d.log || []), { by: user.id, amount, at: Date.now() }].slice(-50);
  save();
  res.json(stateFor(user));
  if (amount > 0 && canReceive(partner)) { const pl = langOf(partner); pushTo(partner, { title: 'Sahar ✈️', body: I18N.t(pl, 'dreamPush', { p: user.name, a: I18N.fmtNum(pl, amount) }) }).catch(() => {}); }
});

// ===========================================================================
// CIENCIA DEL AMOR — herramientas basadas en estudios de pareja
// ===========================================================================
const keepLast = (obj, n) => { const keys = Object.keys(obj).sort(); while (keys.length > n) delete obj[keys.shift()]; };
const addPoints = (couple, uid, n, now = new Date()) => {
  couple.points = couple.points || {};
  couple.points[uid] = (couple.points[uid] || 0) + n;
  if (!couple.week || couple.week.key !== weekKey(now, couple.tz)) couple.week = { key: weekKey(now, couple.tz), pts: {} };
  couple.week.pts[uid] = (couple.week.pts[uid] || 0) + n;
};
const pushPartner = (partner, title, key, vars) => {
  if (partner && canReceive(partner)) pushTo(partner, { title, body: I18N.t(langOf(partner), key, vars) }).catch(() => {});
};

// ---- Mapas del amor (Gottman): conocer el mundo interior del otro ----------
// Cada uno responde sobre sí y adivina lo del otro. Al ver las dos, quien
// respondió califica: ✓ acertó (2), ≈ casi (1), ✗ no (0). Suma a la semana.
const N_LMAP = I18N.LMAP.es.length;
function lmapState(couple, user, partner) {
  const day = dayKey(new Date(), couple.tz);
  const e = (couple.lmap || {})[day] || { ans: {}, grade: {} };
  const q = Number.isInteger(e.q) ? e.q : dayNum(day) % N_LMAP;
  const mine = e.ans[user.id] || null, theirs = partner ? e.ans[partner.id] || null : null;
  const both = !!(mine && theirs);
  return {
    day, q, mine, partner: both ? theirs : null, partnerPlayed: !!theirs,
    myGrade: e.grade[user.id] ?? null, // nota que recibió MI adivinanza
    partnerGrade: partner ? e.grade[partner.id] ?? null : null, // nota que le puse a su adivinanza
    total: couple.lmapTotal || 0,
  };
}
app.post('/api/lmap', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const me = clean(req.body.me, 200), guess = clean(req.body.guess, 200);
  if (!me || !guess) return fail(res, 400, 'invalid_message');
  const day = dayKey(new Date(), couple.tz);
  couple.lmap = couple.lmap || {};
  const e = couple.lmap[day] || (couple.lmap[day] = { q: dayNum(day) % N_LMAP, ans: {}, grade: {} });
  if (e.ans[user.id]) return res.json(stateFor(user));
  e.ans[user.id] = { me, guess };
  remember(couple, me, user); remember(couple, guess, user);
  keepLast(couple.lmap, 14);
  save();
  res.json(stateFor(user));
  translatePending(2).catch(() => {});
  pushPartner(partner, 'Sahar 🗺️', e.ans[partner.id] ? 'lmapBothPush' : 'lmapPush', { p: user.name });
});
app.post('/api/lmap/grade', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const g = Number(req.body.grade);
  if (![0, 1, 2].includes(g)) return fail(res, 400, 'invalid_message');
  const e = (couple.lmap || {})[dayKey(new Date(), couple.tz)];
  if (!e || !e.ans[user.id] || !e.ans[partner.id] || e.grade[partner.id] != null) return res.json(stateFor(user));
  e.grade[partner.id] = g; // califico lo que adivinó mi pareja sobre mí
  if (g) addPoints(couple, partner.id, g);
  if (e.grade[user.id] != null) couple.lmapTotal = (couple.lmapTotal || 0) + 1;
  save();
  res.json(stateFor(user));
  pushPartner(partner, 'Sahar 🗺️', 'lmapGradePush', { p: user.name, g: ['✗', '≈', '✓'][g] });
});

// ---- 36 preguntas para enamorarse (Aron y col., 1997) ------------------------
// Una sesión guiada que comparten: los dos ven la misma pregunta.
const N_ARON = I18N.ARON.es.length;
app.post('/api/aron', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const a = couple.aron = couple.aron || { i: 0, rounds: 0, at: null };
  const act = req.body.act;
  if (act === 'next' && a.i <= N_ARON) {
    if (a.i === 0) pushPartner(partner, 'Sahar 💞', 'aronPush', { p: user.name });
    a.i++; a.at = Date.now();
    if (a.i === N_ARON + 1) a.rounds++; // i = N+1: pantalla final (mirarse 4 minutos)
  } else if (act === 'prev' && a.i > 0) { a.i--; a.at = Date.now(); }
  else if (act === 'restart') { a.i = 0; a.at = Date.now(); }
  else return fail(res, 400, 'invalid_message');
  save();
  res.json(stateFor(user));
});

// ---- Pausa de 20 minutos y gestos de reparación (Gottman) -----------------
// Con el pulso alto («inundación») nadie escucha bien; hace falta ~20 min
// sin rumiar para calmarse. Quien pide la pausa se compromete a volver.
const PAUSE_MS = 20 * 60000;
const N_REPAIR = I18N.REPAIRS.es.length;
const pauseTimers = {};
function pauseEnd(code) {
  const couple = db.couples[code];
  const p = couple && couple.pause;
  if (!p || p.notified || Date.now() < p.until) return false;
  p.notified = true;
  save();
  for (const id of couple.members) {
    const u = db.users[id];
    if (u && canReceive(u)) pushTo(u, { title: 'Sahar 🕊️', body: I18N.t(langOf(u), 'pauseEndPush') }).catch(() => {});
  }
  return true;
}
app.post('/api/pause', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  if (req.body.act === 'start') {
    if (couple.pause && !couple.pause.notified && Date.now() < couple.pause.until) return res.json(stateFor(user));
    couple.pause = { by: user.id, at: Date.now(), until: Date.now() + PAUSE_MS, notified: false };
    couple.pauseCount = (couple.pauseCount || 0) + 1;
    clearTimeout(pauseTimers[user.code]);
    pauseTimers[user.code] = setTimeout(() => pauseEnd(user.code), PAUSE_MS + 500);
    pushPartner(partner, 'Sahar 🕊️', 'pausePush', { p: user.name });
  } else if (req.body.act === 'end' && couple.pause && !couple.pause.notified) {
    couple.pause.notified = true;
    clearTimeout(pauseTimers[user.code]);
    pushPartner(partner, 'Sahar 🕊️', 'pauseBackPush', { p: user.name });
  } else return fail(res, 400, 'invalid_message');
  save();
  res.json(stateFor(user));
});
app.post('/api/repair', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const i = Number(req.body.i);
  if (!Number.isInteger(i) || i < 0 || i >= N_REPAIR) return fail(res, 400, 'invalid_message');
  if (recentCount(couple.repairs, user.id, 60000) >= 3) return fail(res, 429, 'too_many');
  couple.repairs = [...(couple.repairs || []), { by: user.id, i, at: Date.now() }].slice(-100);
  save();
  res.json(stateFor(user));
  if (canReceive(partner)) pushTo(partner, { title: `${user.name} 🕊️`, body: (I18N.REPAIRS[I18N.pick(langOf(partner))] || I18N.REPAIRS.en)[i] }).catch(() => {});
});

// ---- Revisión semanal (Marriage Checkup, Cordova 2014; Gottman) -----------
// Cada semana: qué tan conectados (1–10), lo mejor y lo que necesito.
const checkinKey = (now = new Date(), tz) => weekKey(now, tz);
app.post('/api/checkin', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const score = Math.round(Number(req.body.score));
  if (!Number.isInteger(score) || score < 1 || score > 10) return fail(res, 400, 'invalid_message');
  const best = clean(req.body.best, 300), need = clean(req.body.need, 300);
  const key = checkinKey(new Date(), couple.tz);
  couple.checkins = couple.checkins || {};
  const w = couple.checkins[key] || (couple.checkins[key] = {});
  const first = !w[user.id];
  w[user.id] = { score, best, need, at: Date.now() };
  remember(couple, best, user); remember(couple, need, user);
  keepLast(couple.checkins, 26);
  save();
  res.json(stateFor(user));
  translatePending(2).catch(() => {});
  if (first) pushPartner(partner, 'Sahar 📈', 'checkinPush', { p: user.name });
});
function checkinState(couple, user, partner) {
  const key = checkinKey(new Date(), couple.tz);
  const all = couple.checkins || {};
  const cur = all[key] || {};
  const mine = cur[user.id] || null, theirs = partner ? cur[partner.id] || null : null;
  const hist = Object.keys(all).sort().slice(-8).map((k) => ({ week: k, me: (all[k][user.id] || {}).score ?? null, partner: partner && !(k === key && !mine) ? (all[k][partner.id] || {}).score ?? null : null }));
  return { week: key, mine, partner: mine ? theirs : null, partnerDone: !!theirs, hist };
}

// ---- Girarse hacia el otro (Gottman & Driver, 2006) ------------------------
// En parejas que siguieron juntas, se respondía al 86 % de los «intentos de
// conexión»; en las que se separaron, al 33 % (Driver & Gottman, 2004;
// Gottman & DeClaire, 2001). Aquí: de los toques que te
// llegaron en 30 días, ¿a cuántos respondiste (toque o reacción) en 4 horas?
function turnState(couple, user, partner) {
  if (!partner) return null;
  const since = Date.now() - 30 * DAY_MS, win = 4 * 3600000;
  const h = (couple.history || []).filter((x) => x.at > since - win);
  const rate = (who, other) => {
    const bids = h.filter((x) => x.to === who && x.fromId === other && x.type !== 'react' && x.at > since && x.at < Date.now() - 60000);
    if (!bids.length) return null;
    const ok = bids.filter((b) => h.some((x) => x.fromId === who && x.at > b.at && x.at - b.at <= win)).length;
    return { pct: Math.round((ok / bids.length) * 100), n: bids.length };
  };
  return { me: rate(user.id, partner.id), partner: rate(partner.id, user.id) };
}

// ---- Reto del día con ciencia --------------------------------------------
const N_CHAL = I18N.CHALLENGES.es.length;
function challengeState(couple, user, partner) {
  const day = dayKey(new Date(), couple.tz);
  const done = (couple.chal || {})[day] || [];
  return { day, i: (dayNum(day) * 7) % N_CHAL, me: done.includes(user.id), partner: !!partner && done.includes(partner.id), total: couple.chalTotal || 0 };
}
app.post('/api/challenge', auth, (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) return fail(res, 400, 'no_partner');
  const day = dayKey(new Date(), couple.tz);
  couple.chal = couple.chal || {};
  const done = couple.chal[day] || (couple.chal[day] = []);
  if (done.includes(user.id)) return res.json(stateFor(user));
  done.push(user.id);
  const both = couple.members.every((id) => done.includes(id));
  if (both) couple.chalTotal = (couple.chalTotal || 0) + 1;
  keepLast(couple.chal, 14);
  save();
  res.json(stateFor(user));
  pushPartner(partner, 'Sahar 🔬', both ? 'chalBothPush' : 'chalPush', { p: user.name });
});

const newId = () => crypto.randomBytes(6).toString('hex');
// Pareja lista para jugar (o error 400). Evita repetir lo mismo en cada ruta.
function duo(req, res) {
  const user = req.user;
  const couple = db.couples[user.code];
  const partner = couple && partnerOf(user);
  if (!partner) { fail(res, 400, 'no_partner'); return null; }
  return { user, couple, partner };
}

// ---- Buenas noticias: capitalización (Gable y col., 2004, 2006) -----------
// Cómo responde la pareja a NUESTRAS buenas noticias predice la relación más
// que cómo responde a las malas. La respuesta «activa y constructiva»
// (entusiasmo + preguntas) es la que une; la pasiva o la que cambia de tema, no.
const N_NEWS_REPLY = I18N.NEWS_REPLIES.es.length;
app.post('/api/news', auth, async (req, res) => {
  const d = duo(req, res); if (!d) return;
  const text = clean(req.body.text, 220);
  if (!text) return fail(res, 400, 'invalid_message');
  if (recentCount(d.couple.news, d.user.id, DAY_MS) >= 10) return fail(res, 429, 'too_many');
  d.couple.news = [...(d.couple.news || []), { id: newId(), by: d.user.id, text, at: Date.now(), reply: null }].slice(-40);
  remember(d.couple, text, d.user);
  save();
  res.json(stateFor(d.user));
  pushPartner(d.partner, 'Sahar 🎉', 'newsPush', { p: d.user.name, t: (await translateFor(d.couple, text, langOf(d.partner))).slice(0, 80) });
  translatePending(1).catch(() => {});
});
app.post('/api/news/reply', auth, async (req, res) => {
  const d = duo(req, res); if (!d) return;
  const n = (d.couple.news || []).find((x) => x.id === req.body.id);
  if (!n || n.by === d.user.id) return fail(res, 404, 'not_found');
  if (n.reply) return res.json(stateFor(d.user));
  const i = req.body.i == null ? null : Number(req.body.i);
  const text = clean(req.body.text, 220);
  if (i != null && (!Number.isInteger(i) || i < 0 || i >= N_NEWS_REPLY)) return fail(res, 400, 'invalid_message');
  if (i == null && !text) return fail(res, 400, 'invalid_message');
  n.reply = i != null ? { i, at: Date.now() } : { text, at: Date.now() };
  if (text) remember(d.couple, text, d.user);
  addPoints(d.couple, d.user.id, 1); // premiar la respuesta activa y constructiva
  save();
  res.json(stateFor(d.user));
  if (text) translatePending(1).catch(() => {});
  const pl = langOf(d.partner);
  if (canReceive(d.partner)) pushTo(d.partner, { title: `${d.user.name} 🎉`, body: i != null ? (I18N.NEWS_REPLIES[I18N.pick(pl)] || I18N.NEWS_REPLIES.en)[i] : await translateFor(d.couple, text, pl) }).catch(() => {});
});
function newsState(couple, user) {
  return (couple.news || []).slice(-8).reverse().map((n) => ({ id: n.id, mine: n.by === user.id, text: n.text, at: n.at, reply: n.reply }));
}

// ---- ¿Qué necesitas? Afrontar el estrés en pareja (Bodenmann) --------------
// El «afrontamiento diádico» —avisar del estrés y que el otro apoye como uno
// necesita— predice la satisfacción en pareja (metaanálisis de Falconier y
// col., 2015, con 72 estudios). Cada uno avisa qué tipo de apoyo le sirve hoy.
const N_NEEDS = I18N.NEEDS.es.length;
const STRESS_MS = 12 * 3600000;
app.post('/api/stress', auth, (req, res) => {
  const d = duo(req, res); if (!d) return;
  d.couple.stress = d.couple.stress || {};
  const act = req.body.act;
  if (act === 'send') {
    const need = Number(req.body.need), lvl = Number(req.body.lvl);
    if (!Number.isInteger(need) || need < 0 || need >= N_NEEDS || ![1, 2, 3].includes(lvl)) return fail(res, 400, 'invalid_message');
    if (recentCount(Object.values(d.couple.stress).filter((s) => s.by === d.user.id), d.user.id, 60000) >= 1) return fail(res, 429, 'too_many');
    const note = clean(req.body.note, 160);
    d.couple.stress[d.user.id] = { by: d.user.id, need, lvl, note, at: Date.now(), ack: null };
    if (note) remember(d.couple, note, d.user);
    save();
    res.json(stateFor(d.user));
    if (note) translatePending(1).catch(() => {});
    const pl = langOf(d.partner);
    if (canReceive(d.partner)) pushTo(d.partner, { title: 'Sahar 🫂', body: I18N.t(pl, 'stressPush', { p: d.user.name, n: (I18N.NEEDS[I18N.pick(pl)] || I18N.NEEDS.en)[need] }) }).catch(() => {});
  } else if (act === 'ack') {
    const s = d.couple.stress[d.partner.id];
    if (!s || s.ack || Date.now() - s.at > STRESS_MS) return res.json(stateFor(d.user));
    s.ack = Date.now();
    d.couple.stressAcks = (d.couple.stressAcks || 0) + 1;
    addPoints(d.couple, d.user.id, 1);
    save();
    res.json(stateFor(d.user));
    pushPartner(d.partner, 'Sahar 🫂', 'stressAckPush', { p: d.user.name });
  } else if (act === 'clear') {
    delete d.couple.stress[d.user.id];
    save();
    res.json(stateFor(d.user));
  } else fail(res, 400, 'invalid_message');
});
function stressState(couple, user, partner) {
  const live = (s) => (s && Date.now() - s.at < STRESS_MS ? { need: s.need, lvl: s.lvl, note: s.note, at: s.at, ack: s.ack } : null);
  const st = couple.stress || {};
  return { mine: live(st[user.id]), partner: partner ? live(st[partner.id]) : null, acks: couple.stressAcks || 0 };
}

// ---- Mirada neutral (Finkel y col., 2013) --------------------------------
// 120 matrimonios, 2 años: la calidad de la relación bajó en todos el primer
// año. En el segundo, las parejas que cada 4 meses escribieron 7 minutos sobre
// su último desacuerdo «como lo vería alguien neutral que quiere lo mejor
// para los dos» dejaron de empeorar (y discutieron con menos angustia).
// Lo escrito es PRIVADO: solo lo ve quien lo escribió.
const NEUTRAL_EVERY = 120 * DAY_MS;
app.post('/api/neutral', auth, (req, res) => {
  const d = duo(req, res); if (!d) return;
  const a = [0, 1, 2].map((i) => clean((req.body.a || [])[i], 1200));
  if (!a.some(Boolean)) return fail(res, 400, 'invalid_message');
  if (recentCount((d.couple.neutral || {})[d.user.id], d.user.id, 3600000) >= 3) return fail(res, 429, 'too_many');
  d.couple.neutral = d.couple.neutral || {};
  d.couple.neutral[d.user.id] = [...(d.couple.neutral[d.user.id] || []), { by: d.user.id, a, at: Date.now() }].slice(-12);
  save();
  res.json(stateFor(d.user));
});
function neutralState(couple, user) {
  const mine = ((couple.neutral || {})[user.id] || []).slice().reverse();
  const last = mine[0] ? mine[0].at : null;
  return { list: mine.map((x) => ({ a: x.a, at: x.at })), next: last ? last + NEUTRAL_EVERY : null, due: !last || Date.now() >= last + NEUTRAL_EVERY };
}

function scienceState(couple, user, partner) {
  const a = couple.aron || { i: 0, rounds: 0 };
  const p = couple.pause;
  return {
    lmap: lmapState(couple, user, partner),
    aron: { i: a.i, rounds: a.rounds || 0, n: N_ARON },
    pause: p && !p.notified && Date.now() < p.until ? { mine: p.by === user.id, until: p.until, at: p.at } : null,
    checkin: checkinState(couple, user, partner),
    turn: turnState(couple, user, partner),
    chal: challengeState(couple, user, partner),
    news: newsState(couple, user),
    stress: stressState(couple, user, partner),
    neutral: neutralState(couple, user),
  };
}

// ===========================================================================
// JUEGOS DE PAREJA 2: 4 en raya, ¿Quién es más probable…? y Nuestra historia
// ===========================================================================
// ---- 4 en raya de corazones (7 columnas × 6 filas) -----------------------
const C4_W = 7, C4_H = 6;
function c4Line(b) {
  const at = (r, c) => (r >= 0 && r < C4_H && c >= 0 && c < C4_W ? b[r * C4_W + c] : null);
  for (let r = 0; r < C4_H; r++) for (let c = 0; c < C4_W; c++) {
    const v = at(r, c);
    if (!v) continue;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const line = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
      if (line.every(([rr, cc]) => at(rr, cc) === v)) return line.map(([rr, cc]) => rr * C4_W + cc);
    }
  }
  return null;
}
app.post('/api/c4', auth, (req, res) => {
  const d = duo(req, res); if (!d) return;
  const { user, couple, partner } = d;
  const g = couple.c4;
  const act = req.body.act;
  if (act === 'new') {
    if (g && g.status === 'live' && g.moves > 0) return fail(res, 400, 'invalid_message');
    // Empieza quien perdió la anterior (o quien la pide)
    const first = g && g.winner && g.winner !== 'draw' ? (g.winner === user.id ? partner.id : user.id) : user.id;
    couple.c4 = { id: newId(), board: Array(C4_W * C4_H).fill(null), turn: first, status: 'live', moves: 0, last: null, line: null, winner: null, at: Date.now() };
    save();
    res.json(stateFor(user));
    pushPartner(partner, 'Sahar 🔴', 'c4Push', { p: user.name });
  } else if (act === 'drop') {
    const col = Number(req.body.col);
    if (!g || g.status !== 'live' || g.turn !== user.id) return fail(res, 400, 'not_your_turn');
    if (!Number.isInteger(col) || col < 0 || col >= C4_W) return fail(res, 400, 'invalid_message');
    let row = -1;
    for (let r = C4_H - 1; r >= 0; r--) if (!g.board[r * C4_W + col]) { row = r; break; }
    if (row < 0) return fail(res, 400, 'invalid_message');
    g.board[row * C4_W + col] = user.id;
    g.moves++; g.last = row * C4_W + col; g.at = Date.now();
    const line = c4Line(g.board);
    if (line) {
      g.status = 'done'; g.winner = user.id; g.line = line;
      couple.c4Wins = couple.c4Wins || {};
      couple.c4Wins[user.id] = (couple.c4Wins[user.id] || 0) + 1;
      addPoints(couple, user.id, 3);
    } else if (g.moves === C4_W * C4_H) { g.status = 'done'; g.winner = 'draw'; }
    else g.turn = partner.id;
    save();
    res.json(stateFor(user));
    pushPartner(partner, 'Sahar 🔴', g.status === 'done' ? (g.winner === 'draw' ? 'c4DrawPush' : 'c4WinPush') : 'c4TurnPush', { p: user.name });
  } else fail(res, 400, 'invalid_message');
});
function c4State(couple, user, partner) {
  const g = couple.c4;
  const who = (id) => (id == null ? null : id === 'draw' ? 'draw' : id === user.id ? 'me' : 'p');
  const w = couple.c4Wins || {};
  return {
    game: g ? { id: g.id, board: g.board.map(who), turn: who(g.turn), status: g.status, last: g.last, line: g.line, winner: who(g.winner), moves: g.moves } : null,
    wins: { me: w[user.id] || 0, p: partner ? w[partner.id] || 0 : 0 },
  };
}

// ---- Juegos de tablero por turnos: ajedrez, damas y reversi --------------
// Las reglas están en public/boards.js (las mismas en el servidor y en la app).
const BOARD_EMOJI = { chess: '♟️', checkers: '⚪', reversi: '⚫' };
const BOARD_KINDS = Object.keys(BOARDS.GAMES);
function pushBoard(partner, kind, key, vars) {
  if (!partner || !canReceive(partner)) return;
  const pl = langOf(partner);
  pushTo(partner, { title: `Sahar ${BOARD_EMOJI[kind]}`, body: I18N.t(pl, key, { ...vars, g: I18N.t(pl, kind + 'Title') }), tag: `sahar-${kind}` }).catch(() => {});
}
function boardWin(couple, g, uid, kind) {
  couple.boardWins = couple.boardWins || {};
  const w = couple.boardWins[kind] || (couple.boardWins[kind] = {});
  w[uid] = (w[uid] || 0) + 1;
  addPoints(couple, uid, BOARDS.GAMES[kind].points);
}
app.post('/api/board', auth, (req, res) => {
  const d = duo(req, res); if (!d) return;
  const { user, couple, partner } = d;
  const kind = String(req.body.game || '');
  const G = BOARDS.GAMES[kind];
  if (!G) return fail(res, 400, 'invalid_message');
  couple.boards = couple.boards || {};
  const g = couple.boards[kind];
  const act = req.body.act;
  if (act === 'new') {
    if (g && g.status === 'live' && g.moves > 0) return fail(res, 400, 'invalid_message');
    // Empieza quien perdió la anterior (o quien la pide)
    const first = g && g.winner && g.winner !== 'draw' ? (g.winner === user.id ? partner.id : user.id) : user.id;
    const second = first === user.id ? partner.id : user.id;
    couple.boards[kind] = { id: newId(), st: G.init(), colors: { [first]: G.first, [second]: BOARDS.other(G.first) }, status: 'live', moves: 0, last: null, winner: null, reason: null, at: Date.now() };
    save();
    res.json(stateFor(user));
    pushBoard(partner, kind, 'boardNewPush', { p: user.name });
  } else if (act === 'move') {
    if (!g || g.status !== 'live' || g.colors[user.id] !== g.st.turn) return fail(res, 400, 'not_your_turn');
    const m = req.body.move || {};
    const want = { from: m.from == null ? null : Number(m.from), to: Number(m.to), promo: m.promo || null };
    const legal = G.moves(g.st).find((x) => BOARDS.sameMove(x, want));
    if (!legal) return fail(res, 400, 'invalid_message');
    g.st = G.apply(g.st, legal);
    g.moves++; g.at = Date.now();
    g.last = { from: legal.from ?? null, to: legal.to, cap: legal.cap ?? null };
    const r = G.result(g.st);
    if (r) {
      g.status = 'done'; g.reason = r.reason;
      g.winner = r.winner === 'draw' ? 'draw' : Object.keys(g.colors).find((id) => g.colors[id] === r.winner);
      if (g.winner !== 'draw') boardWin(couple, g, g.winner, kind);
    }
    save();
    res.json(stateFor(user));
    // En damas, si sigue saltando con la misma ficha, todavía no le toca a la pareja
    if (g.status === 'done') pushBoard(partner, kind, g.winner === 'draw' ? 'boardDrawPush' : g.winner === user.id ? 'boardWinPush' : 'boardLosePush', { p: user.name });
    else if (g.colors[partner.id] === g.st.turn) pushBoard(partner, kind, 'boardTurnPush', { p: user.name });
  } else if (act === 'resign') {
    if (!g || g.status !== 'live') return fail(res, 400, 'invalid_message');
    g.status = 'done'; g.winner = partner.id; g.reason = 'resign'; g.at = Date.now();
    if (g.moves > 1) boardWin(couple, g, partner.id, kind); // rendirse al empezar no regala puntos
    save();
    res.json(stateFor(user));
    pushBoard(partner, kind, 'boardResignPush', { p: user.name });
  } else fail(res, 400, 'invalid_message');
});
function boardState(couple, user, partner, kind) {
  const g = (couple.boards || {})[kind];
  const who = (id) => (id == null ? null : id === 'draw' ? 'draw' : id === user.id ? 'me' : 'p');
  const w = (couple.boardWins || {})[kind] || {};
  let game = null;
  if (g) {
    const { seen, ...st } = g.st; // el historial de posiciones no hace falta en la app
    const mine = g.colors[user.id];
    game = { id: g.id, st, mine, turn: g.st.turn === mine ? 'me' : 'p', status: g.status, winner: who(g.winner), reason: g.reason, moves: g.moves, last: g.last };
  }
  return { game, wins: { me: w[user.id] || 0, p: partner ? w[partner.id] || 0 : 0 } };
}

// ---- ¿Quién es más probable…? ---------------------------------------------
// Cada día 5 frases; cada uno elige «yo» o «tú». Si coinciden, punto para los dos.
const WML_N = 5;
const N_WML = I18N.WML.es.length;
function wmlQs(day) {
  const n = dayNum(day), start = (n * WML_N) % N_WML;
  return Array.from({ length: WML_N }, (_, k) => (start + k) % N_WML);
}
app.post('/api/wml', auth, (req, res) => {
  const d = duo(req, res); if (!d) return;
  const { user, couple, partner } = d;
  const picks = req.body.picks;
  if (!Array.isArray(picks) || picks.length !== WML_N || !picks.every((x) => x === 0 || x === 1)) return fail(res, 400, 'invalid_message');
  const day = dayKey(new Date(), couple.tz);
  couple.wml = couple.wml || {};
  const e = couple.wml[day] || (couple.wml[day] = { qs: wmlQs(day), ans: {} });
  if (e.ans[user.id]) return res.json(stateFor(user));
  e.ans[user.id] = picks; // 0 = yo (quien responde), 1 = mi pareja
  const theirs = e.ans[partner.id];
  if (theirs) {
    // Coinciden si yo digo «yo» y mi pareja dice «tú» (o al revés)
    const m = picks.filter((x, i) => x !== theirs[i]).length;
    e.matches = m;
    if (m) { addPoints(couple, user.id, m); addPoints(couple, partner.id, m); }
    couple.wmlTotal = (couple.wmlTotal || 0) + 1;
  }
  keepLast(couple.wml, 14);
  save();
  res.json(stateFor(user));
  pushPartner(partner, 'Sahar 🤔', theirs ? 'wmlBothPush' : 'wmlPush', { p: user.name });
});
function wmlState(couple, user, partner) {
  const day = dayKey(new Date(), couple.tz);
  const e = (couple.wml || {})[day] || { qs: wmlQs(day), ans: {} };
  const mine = e.ans[user.id] || null, theirs = partner ? e.ans[partner.id] || null : null;
  return { day, qs: e.qs, mine, partner: mine && theirs ? theirs : null, partnerDone: !!theirs, matches: mine && theirs ? e.matches : null, total: couple.wmlTotal || 0 };
}

// ---- Nuestra historia: un cuento a cuatro manos ---------------------------
const N_STORY = I18N.STORY_STARTS.es.length;
const STORY_MIN = 6, STORY_MAX = 30;
app.post('/api/story', auth, (req, res) => {
  const d = duo(req, res); if (!d) return;
  const { user, couple, partner } = d;
  const act = req.body.act;
  let s = couple.story;
  if (act === 'new') {
    if (s && s.lines.length) return fail(res, 400, 'invalid_message');
    const start = Number(req.body.start);
    if (!Number.isInteger(start) || start < 0 || start >= N_STORY) return fail(res, 400, 'invalid_message');
    couple.story = { id: newId(), start, lines: [], at: Date.now() };
  } else if (act === 'add') {
    const text = clean(req.body.text, 240);
    if (!s || !text) return fail(res, 400, 'invalid_message');
    const lastBy = s.lines.length ? s.lines[s.lines.length - 1].by : null;
    if (lastBy === user.id) return fail(res, 400, 'not_your_turn');
    s.lines.push({ by: user.id, text, at: Date.now() });
    remember(couple, text, user);
    if (s.lines.length >= STORY_MAX) finishStory(couple);
    save();
    res.json(stateFor(user));
    translatePending(1).catch(() => {});
    return pushPartner(partner, 'Sahar 📖', 'storyPush', { p: user.name });
  } else if (act === 'end') {
    if (!s || s.lines.length < STORY_MIN) return fail(res, 400, 'invalid_message');
    finishStory(couple);
    pushPartner(partner, 'Sahar 📖', 'storyEndPush', { p: user.name });
  } else if (act === 'title') {
    const b = (couple.stories || []).find((x) => x.id === req.body.id);
    if (!b) return fail(res, 404, 'not_found');
    b.title = clean(req.body.title, 60);
    remember(couple, b.title, user);
    translatePending(1).catch(() => {});
  } else return fail(res, 400, 'invalid_message');
  save();
  res.json(stateFor(user));
});
function finishStory(couple) {
  const s = couple.story;
  if (!s) return;
  couple.stories = [...(couple.stories || []), { ...s, done: Date.now(), title: '' }].slice(-12);
  couple.story = null;
}
function storyState(couple, user) {
  const map = (s) => s && { id: s.id, start: s.start, title: s.title || '', at: s.at, done: s.done || null, lines: s.lines.map((l) => ({ mine: l.by === user.id, text: l.text, at: l.at })) };
  const s = couple.story;
  const lastBy = s && s.lines.length ? s.lines[s.lines.length - 1].by : null;
  return { cur: map(s), myTurn: !!s && lastBy !== user.id, min: STORY_MIN, max: STORY_MAX, books: (couple.stories || []).slice().reverse().map(map) };
}

function playState(couple, user, partner) {
  const boards = Object.fromEntries(BOARD_KINDS.map((k) => [k, boardState(couple, user, partner, k)]));
  return { c4: c4State(couple, user, partner), wml: wmlState(couple, user, partner), story: storyState(couple, user), boards };
}

function wishState(couple, user, partner) {
  const w = weeklyOf(couple);
  const m = missOf(couple);
  const r = rescueInfo(couple);
  const d = dreamOf(couple);
  const birthOf = (u) => (u && u.birth ? { month: u.birth.month, theme: u.birth.theme } : { month: null, theme: null });
  return {
    shields: shieldsOf(couple), shieldMax: SHIELD.max, shieldEvery: SHIELD.every, rescue: r ? r.n : null,
    weekly: { key: w.key, cook: w.cook, out: w.out, cookDone: !!w.cookDone, outDone: !!w.outDone, count: couple.weeklyCount || { cook: 0, out: 0 } },
    miss: {
      key: m.key, picks: m.picks, all: m.all, total: couple.missTotal || 0, pillars: couple.pillars || [0, 0, 0, 0],
      me: m.done.map((d2) => d2.includes(user.id)), partner: m.done.map((d2) => !!partner && d2.includes(partner.id)),
    },
    dice: diceState(couple, user, partner),
    memo: memoState(couple, user, partner),
    chest: (couple.chest || []).slice(-100).reverse().map((x) => ({ id: x.id, mine: x.by === user.id, kind: x.kind, text: x.text, at: x.at })),
    birth: { me: birthOf(user), partner: birthOf(partner) },
    dream: { city: d.city, date: d.date, goal: d.goal, saved: d.saved, ticks: d.ticks[d.city] || [] },
  };
}

// Responder la pregunta del día
app.post('/api/answer', auth, async (req, res) => {
  const user = req.user;
  const couple = db.couples[user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  const text = String(req.body.text || '').trim().slice(0, 300);
  if (!text) return fail(res, 400, 'invalid_message');
  const day = dayKey(new Date(), couple.tz);
  couple.qa = couple.qa || {};
  const entry = couple.qa[day] || (couple.qa[day] = { answers: {} });
  const first = !entry.answers[user.id];
  if (!Number.isInteger(entry.q)) entry.q = questionState(couple, user, null).q;
  entry.answers[user.id] = text;
  couple.src = couple.src || {};
  couple.src[text] = langOf(user);
  const keys = Object.keys(couple.qa).sort();
  while (keys.length > 30) delete couple.qa[keys.shift()];
  save();
  res.json(stateFor(user));
  translatePending(2).catch(() => {});
  const partner = partnerOf(user);
  if (first && partner && canReceive(partner)) {
    const n = await pushTo(partner, { title: 'Sahar 💭', body: I18N.t(langOf(partner), 'qPush', { p: user.name }) }).catch(() => 0);
    if (n) save();
  }
});

// Estado de ánimo del día
app.post('/api/mood', auth, (req, res) => {
  const emoji = String(req.body.emoji || '');
  const couple = db.couples[req.user.code];
  if (emoji && !MOODS.includes(emoji)) return fail(res, 400, 'invalid_message');
  req.user.mood = emoji ? { emoji, day: dayKey(new Date(), (couple && couple.tz) || req.user.tz) } : null;
  save();
  res.json(stateFor(req.user));
});

// Preferencias de avisos
app.post('/api/prefs', auth, (req, res) => {
  const p = req.body.prefs || {};
  const cur = prefsOf(req.user);
  req.user.prefs = { extra: typeof p.extra === 'boolean' ? p.extra : cur.extra };
  save();
  res.json(stateFor(req.user));
});

// Subir foto o audio (base64). Devuelve un id para adjuntarlo al próximo toque.
app.post('/api/media', auth, async (req, res) => {
  const couple = db.couples[req.user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  const kind = req.body.kind === 'audio' ? 'audio' : req.body.kind === 'photo' ? 'photo' : null;
  const mime = String(req.body.mime || '');
  const b64 = String(req.body.data || '');
  const okMime = kind === 'photo' ? /^image\/(jpeg|png|webp)$/.test(mime) : /^audio\/(mp4|aac|mpeg|webm|ogg|x-m4a)(;.*)?$/.test(mime);
  if (!kind || !okMime || !b64 || b64.length > MAX_MEDIA_B64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return fail(res, 400, 'invalid_media');
  if (!looksLike(kind, mime, Buffer.from(b64.slice(0, 64), 'base64'))) return fail(res, 400, 'invalid_media');
  if (limited('media', req.user.id, 60, 60 * 60000)) return fail(res, 429, 'too_many');
  const id = crypto.randomBytes(16).toString('hex');
  try { await putMedia(id, mime, b64); } catch (e) { console.error('media', e.message); return fail(res, 502, 'invalid_media'); }
  couple.media = [...(couple.media || []), { id, kind, mime, by: req.user.id, at: Date.now() }];
  // Conservar las 80 más recientes
  while (couple.media.length > 80) delMedia(couple.media.shift().id);
  save();
  res.json({ id, kind });
});
app.get('/api/media/:id', auth, async (req, res) => {
  const couple = db.couples[req.user.code];
  const m = couple && (couple.media || []).find((x) => x.id === req.params.id);
  if (!m) return res.status(404).end();
  const data = await getMedia(m.id).catch(() => null);
  if (!data) return res.status(404).end();
  res.setHeader('Content-Type', data.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=604800');
  res.end(data.buf);
});
// Borrar una foto o audio para siempre (cualquiera de los dos: el álbum es de ambos)
app.delete('/api/media/:id', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  const m = couple && (couple.media || []).find((x) => x.id === req.params.id);
  if (!m) return fail(res, 404, 'invalid_media');
  couple.media = couple.media.filter((x) => x !== m);
  for (const h of couple.history || []) if (h.media && h.media.id === m.id) h.media = null;
  delMedia(m.id);
  save();
  res.json(stateFor(req.user));
});

// ---------------------------------------------------------------------------
// Fechas persas (calendario solar hijri real, vía Intl)
//   nowruz = 1 Farvardin · sizdah = 13 Farvardin · yalda = 30 Azar (noche)
//   suri = último martes antes de Nowruz (noche)
// ---------------------------------------------------------------------------
const PERSIAN_FMT = new Intl.DateTimeFormat('en-US-u-ca-persian', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const persianCache = {};
function persianHolidays(gYear) {
  if (persianCache[gYear]) return persianCache[gYear];
  const out = {};
  for (let d = new Date(Date.UTC(gYear, 0, 1, 12)); d.getUTCFullYear() === gYear; d.setUTCDate(d.getUTCDate() + 1)) {
    const p = Object.fromEntries(PERSIAN_FMT.formatToParts(d).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
    const key = d.toISOString().slice(0, 10);
    if (p.month === 1 && p.day === 1) out.nowruz = key;
    if (p.month === 1 && p.day === 13) out.sizdah = key;
    if (p.month === 9 && p.day === 30) out.yalda = key;
  }
  if (out.nowruz) {
    const d = new Date(out.nowruz + 'T12:00:00Z');
    do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() !== 2);
    out.suri = d.toISOString().slice(0, 10);
  }
  return (persianCache[gYear] = out);
}
// Próxima fecha de cada fiesta a partir de hoy
function upcomingPersian(todayKey) {
  const y = Number(todayKey.slice(0, 4));
  const a = persianHolidays(y), b = persianHolidays(y + 1);
  return ['suri', 'nowruz', 'sizdah', 'yalda'].map((id) => ({ id, date: a[id] >= todayKey ? a[id] : b[id] })).filter((x) => x.date);
}

// ---------------------------------------------------------------------------
// Fechas especiales
// ---------------------------------------------------------------------------
const DATE_TYPES = ['birthday', 'anniv', 'date', 'call', 'plan', 'other'];
function nextOccurrence(d, todayKey) {
  if (!d.yearly) return d.date;
  const [ty] = todayKey.split('-').map(Number);
  const md = d.date.slice(5);
  const fix = (y) => (md === '02-29' && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? `${y}-02-28` : `${y}-${md}`);
  const thisYear = fix(ty);
  return thisYear >= todayKey ? thisYear : fix(ty + 1);
}
function nextDay(key) { const d = new Date(key + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
app.post('/api/dates', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  const name = String(req.body.name || '').trim().slice(0, 60);
  const date = String(req.body.date || '');
  const type = DATE_TYPES.includes(req.body.type) ? req.body.type : 'other';
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) return fail(res, 400, 'invalid_date');
  couple.dates = couple.dates || [];
  if (couple.dates.length >= 100) return fail(res, 400, 'invalid_date');
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.time || '') ? req.body.time : null;
  couple.dates.push({ id: crypto.randomBytes(6).toString('hex'), name, date, type, yearly: req.body.yearly !== false, by: req.user.id, ...(time ? { time } : {}) });
  remember(couple, name, req.user);
  save();
  res.json(stateFor(req.user));
  translatePending(1).catch(() => {});
});
app.post('/api/persian', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  couple.persianDates = !!req.body.on;
  save();
  res.json(stateFor(req.user));
});
app.delete('/api/dates', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  if (!couple) return fail(res, 400, 'no_partner');
  couple.dates = (couple.dates || []).filter((d) => d.id !== req.body.id);
  save();
  res.json(stateFor(req.user));
});
// Archivo .ics para añadir la fecha al calendario del iPhone. El enlace va
// firmado (t=…), así no hace falta poner la identidad en la dirección.
function icsToken(id) {
  if (!db.secret) { db.secret = crypto.randomBytes(32).toString('base64'); save(); }
  return crypto.createHmac('sha256', db.secret).update('ics:' + id).digest('base64url').slice(0, 22);
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
app.get('/api/ics/:id', (req, res, next) => {
  if (req.query.t) return next();
  return auth(req, res, next);
}, (req, res) => {
  let d = null;
  if (req.user) { const couple = db.couples[req.user.code]; d = couple && (couple.dates || []).find((x) => x.id === req.params.id); }
  else if (safeEq(req.query.t, icsToken(req.params.id))) {
    for (const c of Object.values(db.couples)) { d = (c.dates || []).find((x) => x.id === req.params.id); if (d) break; }
  }
  if (!d) return res.status(404).end();
  const esc = (t) => String(t).replace(/[\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const day = d.date.replace(/-/g, '');
  const end = nextDay(d.date).replace(/-/g, '');
  // Con hora: evento de 1 hora (hora local del teléfono) y aviso 30 min antes
  const tm = d.time ? d.time.replace(':', '') + '00' : null;
  const endTm = d.time ? String((Number(d.time.slice(0, 2)) + 1) % 24).padStart(2, '0') + d.time.slice(3) + '00' : null;
  const endDay = d.time && Number(d.time.slice(0, 2)) === 23 ? end : day;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sahar Love//ES', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${d.id}@sahar-love`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    ...(tm ? [`DTSTART:${day}T${tm}`, `DTEND:${endDay}T${endTm}`] : [`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end}`]), `SUMMARY:${esc('💗 ' + d.name)}`,
    ...(d.yearly ? ['RRULE:FREQ=YEARLY'] : []),
    'BEGIN:VALARM', tm ? 'TRIGGER:-PT30M' : 'TRIGGER:-PT15H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(d.name)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="sahar-${d.id}.ics"`);
  res.end(ics);
});

// ---------------------------------------------------------------------------
// Recordatorio de racha: entre las 20:00 y las 22:59 (hora de la pareja),
// a quien aún no envió hoy si hay una racha en juego. Una vez al día.
// (En el plan gratis de Render el servidor se duerme; ver /api/cron.)
// ---------------------------------------------------------------------------
async function runReminders(now = new Date()) {
  let sent = 0;
  for (const couple of Object.values(db.couples)) {
    if (couple.members.length < 2) continue;
    const h = hourIn(now, couple.tz);
    const today = dayKey(now, couple.tz);

    // Fechas especiales: el mismo día por la mañana y la víspera por la tarde
    couple.dateReminded = couple.dateReminded || [];
    const persianItems = couple.persianDates !== false
      ? upcomingPersian(today).map((p) => ({ id: 'p-' + p.id, persian: p.id, date: p.date, yearly: false })) : [];
    for (const d of [...(couple.dates || []), ...persianItems]) {
      const occ = nextOccurrence(d, today);
      let key = null, textKey = null;
      const soft = d.type === 'call' || d.type === 'plan'; // sin presión: sin aviso la víspera
      const left = d.time && occ === today ? Number(d.time.slice(0, 2)) * 60 + Number(d.time.slice(3)) - minuteIn(now, couple.tz) : null;
      if (left != null && left >= 0 && left <= 70) { key = `${d.id}:${occ}:h`; textKey = 'planSoon'; }
      else if (occ === today && h >= 8 && h <= 12 && !(d.time && Number(d.time.slice(0, 2)) < 10)) { key = `${d.id}:${occ}:t`; textKey = 'dateToday'; }
      else if (!soft && occ === nextDay(today) && h >= 19 && h <= 22) { key = `${d.id}:${occ}:m`; textKey = 'dateTomorrow'; }
      if (!key || couple.dateReminded.includes(key)) continue;
      couple.dateReminded = [...couple.dateReminded, key].slice(-200);
      for (const id of couple.members) {
        const u = db.users[id];
        if (!u || !canReceive(u)) continue;
        const name = d.persian ? I18N.t(langOf(u), d.persian) : textFor(couple, d.name, langOf(u));
        sent += await pushTo(u, { title: 'Sahar 📅', body: I18N.t(langOf(u), textKey, { name }) });
      }
      save();
    }

    // Racha en peligro: entre las 20:00 y las 22:59
    if (h < 20 || h > 22) continue;
    const s = streakInfo(couple, now);
    if (s.todayDone) continue;
    couple.reminded = couple.reminded && couple.reminded.day === today ? couple.reminded : { day: today, ids: [] };
    for (const id of couple.members) {
      if (s.todayMembers.includes(id) || couple.reminded.ids.includes(id)) continue;
      if (s.streak === 0 && s.todayMembers.length === 0) continue; // nada en juego
      const user = db.users[id];
      const partner = db.users[couple.members.find((m) => m !== id)];
      if (!user || !partner || !canReceive(user)) continue;
      couple.reminded.ids.push(id);
      sent += await pushTo(user, { title: 'Sahar 💗', body: I18N.t(langOf(user), 'reminderPush', { p: partner.name }) });
    }
  }
  // «Esto o aquello»: avisar por la tarde a quien aún no jugó si el otro ya jugó
  for (const couple of Object.values(db.couples)) {
    if (couple.members.length < 2) continue;
    const h = hourIn(now, couple.tz);
    if (h < 19 || h > 22) continue;
    const today = dayKey(now, couple.tz);
    const entry = (couple.tot || {})[today];
    if (!entry || !entry.answers) continue;
    couple.totReminded = couple.totReminded && couple.totReminded.day === today ? couple.totReminded : { day: today, ids: [] };
    for (const id of couple.members) {
      if (entry.answers[id] || couple.totReminded.ids.includes(id)) continue;
      const other = couple.members.find((m) => m !== id);
      if (!entry.answers[other]) continue;
      const u = db.users[id];
      if (!u || !canReceive(u)) continue;
      couple.totReminded.ids.push(id);
      sent += await pushTo(u, { title: 'Sahar 🎲', body: I18N.t(langOf(u), 'totRemind', { p: (db.users[other] || {}).name || '' }) });
    }
  }
  // Revisión semanal: el domingo por la tarde, a quien aún no la hizo
  for (const couple of Object.values(db.couples)) {
    if (couple.members.length < 2) continue;
    const today = dayKey(now, couple.tz);
    const h = hourIn(now, couple.tz);
    if (new Date(today + 'T12:00:00Z').getUTCDay() !== 0 || h < 18 || h > 21) continue;
    const w = (couple.checkins || {})[weekKey(now, couple.tz)] || {};
    couple.ciReminded = couple.ciReminded && couple.ciReminded.day === today ? couple.ciReminded : { day: today, ids: [] };
    for (const id of couple.members) {
      if (w[id] || couple.ciReminded.ids.includes(id)) continue;
      const u = db.users[id];
      if (!u || !canReceive(u)) continue;
      couple.ciReminded.ids.push(id);
      sent += await pushTo(u, { title: 'Sahar 📈', body: I18N.t(langOf(u), 'checkinRemind') });
    }
  }
  for (const code of Object.keys(db.couples)) if (pauseEnd(code)) sent++;
  for (const couple of Object.values(db.couples)) { settleTotBonus(couple, now); settleWeek(couple, now); settleShields(couple, now); }
  if (sent) save();
  return sent;
}
app.get('/api/cron', async (req, res) => {
  if (process.env.CRON_SECRET && req.query.key !== process.env.CRON_SECRET) return res.status(403).end();
  const reminders = await runReminders();
  const translated = await translatePending(6).catch(() => 0);
  res.json({ ok: true, reminders, translated });
});

// ---------------------------------------------------------------------------
function deleteCouple(code) {
  const couple = db.couples[code];
  if (!couple) return;
  for (const id of couple.members) if (db.users[id] && db.users[id].code === code) db.users[id].code = null;
  for (const m of couple.media || []) delMedia(m.id);
  delete db.couples[code];
  save();
}
// Parejas borradas a petición (vinculación equivocada)
const RESET_CODES = []; // (G7BDQF ya no se borra: es la pareja que funciona)
function migrate() {
  db.resets = db.resets || [];
  for (const code of RESET_CODES) {
    if (db.resets.includes(code)) continue;
    deleteCouple(code);
    db.resets.push(code);
    save();
  }
  for (const couple of Object.values(db.couples)) {
    if ((couple.defaultsV || 1) < 2) {
      for (let i = 10; i < I18N.MESSAGES.es.length; i++) if (!couple.messages.includes(`@${i}`)) couple.messages.push(`@${i}`);
      couple.defaultsV = 2;
      save();
    }
  }
}
const ready = loadDb().then(() => { migrate(); setupVapid(); });

if (require.main === module) {
  ready.then(() => {
    app.listen(PORT, () => console.log(`Sahar escuchando en http://localhost:${PORT} · datos: ${useUpstash ? 'Upstash' : DATA_FILE}`));
    setInterval(() => runReminders().catch((e) => console.error('recordatorios', e.message)), 10 * 60 * 1000);
    setTimeout(() => translatePending(10).catch(() => {}), 5000);
    setInterval(() => translatePending(6).catch(() => {}), 20 * 60 * 1000);
  }).catch((e) => { console.error('No se pudieron cargar los datos:', e.message); process.exit(1); });
}
module.exports = { guessSrc, settleShields, rescueInfo, SHIELD, DICE, missionPicks, persianHolidays, upcomingPersian, questionIndex, MOODS, app, ready, streakInfo, recordDay, dayKey, prevDay, localize, runReminders, flush, translatePending, nextOccurrence, totPairs, weekKey, settleWeek, settleTotBonus, races, RACE, db: () => db };
