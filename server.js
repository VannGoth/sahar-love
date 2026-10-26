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
  if (/^@\d+$/.test(msg || '')) return localize(msg, lang);
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
let translating = false;
async function translatePending(limit = 6) {
  if (!TRANSLATE || translating) return 0;
  translating = true;
  let done = 0;
  try {
    for (const couple of Object.values(db.couples)) {
      couple.tr = couple.tr || {};
      const texts = new Set([...(couple.messages || []), ...(couple.history || []).slice(-50).map((h) => h.body)]);
      for (const text of texts) {
        if (done >= limit) return done;
        if (!text || /^@\d+$/.test(text) || onlyEmoji(text)) continue;
        const entry = couple.tr[text] || (couple.tr[text] = { _src: couple.src?.[text] || null, _tries: 0 });
        if (entry._tries >= 5) continue;
        const src = entry._src || langOf(db.users[couple.members[0]]);
        entry._src = src;
        entry[src] = text;
        const missing = LANGS.filter((l) => !entry[l]);
        if (!missing.length) continue;
        let any = false;
        for (const l of missing) {
          const out = await translateOne(text, src, l);
          if (out) { entry[l] = out; any = true; }
          else break; // límite o error: seguir más tarde
        }
        if (!any) entry._tries++;
        done++;
        save();
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
async function putMedia(id, mime, b64) {
  if (useUpstash) {
    const r = await fetch(`${UP_URL}/set/sahar-media:${id}`, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}` }, body: JSON.stringify({ mime, b64 }) });
    if (!r.ok) throw new Error('upstash ' + r.status);
  } else {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, id + '.json'), JSON.stringify({ mime, b64 }));
  }
}
async function getMedia(id) {
  if (useUpstash) {
    const r = await fetch(`${UP_URL}/get/sahar-media:${id}`, { headers: { Authorization: `Bearer ${UP_TOKEN}` } });
    const j = await r.json();
    return j.result ? JSON.parse(j.result) : null;
  }
  try { return JSON.parse(fs.readFileSync(path.join(MEDIA_DIR, id + '.json'), 'utf8')); } catch (_) { return null; }
}
async function delMedia(id) {
  try {
    if (useUpstash) await fetch(`${UP_URL}/del/sahar-media:${id}`, { method: 'POST', headers: { Authorization: `Bearer ${UP_TOKEN}` } });
    else fs.rmSync(path.join(MEDIA_DIR, id + '.json'), { force: true });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Preferencias de avisos de quien recibe
// ---------------------------------------------------------------------------
const DEFAULT_PREFS = { limit: 3, extra: true, quiet: false, from: '23:00', to: '07:00' };
const prefsOf = (u) => ({ ...DEFAULT_PREFS, ...(u && u.prefs) });
function minutesIn(date, tz) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).split(':').map(Number);
  return h * 60 + m;
}
function inQuiet(user, now = new Date()) {
  const p = prefsOf(user);
  if (!p.quiet) return false;
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
  const cur = minutesIn(now, user.tz), a = toMin(p.from), b = toMin(p.to);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}
// ¿Cuántos avisos más se le pueden mandar ahora? (Infinity = sin límite)
function pushBudget(user, now = Date.now()) {
  if (inQuiet(user, new Date(now))) return 0;
  const p = prefsOf(user);
  user.pushLog = (user.pushLog || []).filter((t) => now - t < 10 * 60 * 1000);
  return p.limit > 0 ? Math.max(0, p.limit - user.pushLog.length) : Infinity;
}
function logPush(user, now = Date.now()) { user.pushLog = [...(user.pushLog || []), now].slice(-20); }

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
  const both = (k) => (days[k] || []).length >= 2;
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
  couple.bestStreak = streakInfo(couple, now).bestStreak;
}

function stateFor(user) {
  const couple = user.code ? db.couples[user.code] : null;
  const partner = couple ? partnerOf(user) : null;
  const s = couple ? streakInfo(couple) : { streak: 0, bestStreak: 0, todayMembers: [], todayDone: false };
  const received = couple ? couple.history.filter((h) => h.to === user.id) : [];
  const lang = langOf(user);
  // Traducciones al idioma de este usuario de los mensajes escritos a mano
  const trans = {};
  if (couple) {
    for (const t of new Set([...couple.messages, ...received.slice(-50).map((h) => h.body)])) {
      if (!t || /^@\d+$/.test(t)) continue;
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
    received: received.slice(-50).reverse().map(({ from, body, at, level, media, held }) => ({ from, body, at, level: level || 1, media: media || null, held: !!held })),
    streak: s.streak,
    bestStreak: s.bestStreak,
    iSentToday: s.todayMembers.includes(user.id),
    partnerSentToday: partner ? s.todayMembers.includes(partner.id) : false,
    totalSent: couple ? couple.counts?.[user.id] ?? couple.history.filter((h) => h.fromId === user.id).length : 0,
    totalReceived: couple && partner ? couple.counts?.[partner.id] ?? received.length : 0,
    since: couple ? couple.since || null : null,
    dates: couple ? (couple.dates || []) : [],
    prefs: prefsOf(user),
    notifReady: canReceive(user),
    partnerNotifReady: partner ? canReceive(partner) : false,
  };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const app = express();
const jsonSmall = express.json({ limit: '50kb' });
const jsonBig = express.json({ limit: '2mb' });
app.use((req, res, next) => (req.path === '/api/media' ? jsonBig : jsonSmall)(req, res, next));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(html|js|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

function auth(req, res, next) {
  const id = (req.body && req.body.userId) || req.query.userId;
  const user = id && db.users[id];
  if (!user) return fail(res, 401, 'unknown_user');
  req.user = user;
  next();
}

const APP_VERSION = (() => { try { return /const APP_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'))[1]; } catch (_) { return null; } })();
app.get('/api/health', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ ok: true, version: APP_VERSION, storage: useUpstash ? 'upstash' : 'file', apns: apnsEnabled }); });
app.get('/api/vapid', (_req, res) => res.json({ publicKey: vapid.publicKey }));

app.post('/api/register', (req, res) => {
  const { userId, name, tz, lang } = req.body;
  if (!userId || !name || String(userId).length > 100 || !String(name).trim()) return fail(res, 400, 'missing');
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
  if (couple.tr && couple.tr[text]) couple.tr[text]._tries = 0;
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

  const body = nextMessage(couple);
  const lang = langOf(partner);
  const prevStreak = streakInfo(couple).streak;
  const prevDays = JSON.stringify(couple.days || {});
  const prevBest = couple.bestStreak;
  recordDay(couple, user.id);
  const s = streakInfo(couple);
  const subtitle = s.streak > prevStreak && s.streak > 1 ? I18N.streakPush(lang, s.streak) : '';
  const icon = media ? (media.kind === 'photo' ? ' 📷' : ' 🎤') : '';

  // Control de avisos de quien recibe: límite cada 10 min y "no molestar"
  let delivered = 0, held = false;
  if (pushBudget(partner) > 0) {
    delivered = await pushTo(partner, { title: `${user.name} ${'💗'.repeat(level)}`, body: textFor(couple, body, lang) + icon, subtitle });
    if (!delivered) {
      couple.days = JSON.parse(prevDays); // si no llegó, no cuenta para la racha
      couple.bestStreak = prevBest;
      save();
      return fail(res, 502, 'delivery_failed');
    }
    logPush(partner);
  } else held = true;

  couple.history.push({ to: partner.id, fromId: user.id, from: user.name, body, at: Date.now(), level, media: media ? { id: media.id, kind: media.kind } : null, held });
  couple.history = couple.history.slice(-500);
  couple.counts = couple.counts || {};
  couple.counts[user.id] = (couple.counts[user.id] ?? couple.history.filter((h) => h.fromId === user.id).length - 1) + 1;
  save();
  res.json({ ok: true, body, level, held, ...stateFor(user) });

  // Vibraciones extra según la fuerza, si quien recibe las quiere y no pasa su límite
  if (held || !prefsOf(partner).extra) return;
  for (let i = 2; i <= level; i++) {
    await new Promise((r) => setTimeout(r, 1300));
    if (pushBudget(partner) <= 0) break;
    const n = await pushTo(partner, { title: `${user.name} ${'💗'.repeat(i)}`, body: '💗'.repeat(i), tag: `sahar-extra-${Date.now()}-${i}` }).catch(() => 0);
    if (n) logPush(partner);
  }
  save();
});

// Preferencias de avisos
app.post('/api/prefs', auth, (req, res) => {
  const p = req.body.prefs || {};
  const cur = prefsOf(req.user);
  const hhmm = (v, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  req.user.prefs = {
    limit: [0, 1, 2, 3, 5, 10].includes(Number(p.limit)) ? Number(p.limit) : cur.limit,
    extra: typeof p.extra === 'boolean' ? p.extra : cur.extra,
    quiet: typeof p.quiet === 'boolean' ? p.quiet : cur.quiet,
    from: hhmm(p.from, cur.from),
    to: hhmm(p.to, cur.to),
  };
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
  const id = crypto.randomBytes(12).toString('hex');
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
  const data = await getMedia(m.id);
  if (!data) return res.status(404).end();
  res.setHeader('Content-Type', data.mime);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(Buffer.from(data.b64, 'base64'));
});

// ---------------------------------------------------------------------------
// Fechas especiales
// ---------------------------------------------------------------------------
const DATE_TYPES = ['birthday', 'anniv', 'date', 'other'];
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
  couple.dates.push({ id: crypto.randomBytes(6).toString('hex'), name, date, type, yearly: req.body.yearly !== false, by: req.user.id });
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
// Archivo .ics para añadir la fecha al calendario del iPhone
app.get('/api/ics/:id', auth, (req, res) => {
  const couple = db.couples[req.user.code];
  const d = couple && (couple.dates || []).find((x) => x.id === req.params.id);
  if (!d) return res.status(404).end();
  const esc = (t) => String(t).replace(/[\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const day = d.date.replace(/-/g, '');
  const end = nextDay(d.date).replace(/-/g, '');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sahar Love//ES', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${d.id}@sahar-love`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${end}`, `SUMMARY:${esc('💗 ' + d.name)}`,
    ...(d.yearly ? ['RRULE:FREQ=YEARLY'] : []),
    'BEGIN:VALARM', 'TRIGGER:-PT15H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(d.name)}`, 'END:VALARM',
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
    for (const d of couple.dates || []) {
      const occ = nextOccurrence(d, today);
      let key = null, textKey = null;
      if (occ === today && h >= 8 && h <= 12) { key = `${d.id}:${occ}:t`; textKey = 'dateToday'; }
      else if (occ === nextDay(today) && h >= 19 && h <= 22) { key = `${d.id}:${occ}:m`; textKey = 'dateTomorrow'; }
      if (!key || couple.dateReminded.includes(key)) continue;
      couple.dateReminded = [...couple.dateReminded, key].slice(-200);
      for (const id of couple.members) {
        const u = db.users[id];
        if (!u || !canReceive(u) || inQuiet(u, now)) continue;
        sent += await pushTo(u, { title: 'Sahar 📅', body: I18N.t(langOf(u), textKey, { name: d.name }) });
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
      if (!user || !partner || !canReceive(user) || pushBudget(user) <= 0) continue;
      couple.reminded.ids.push(id);
      sent += await pushTo(user, { title: 'Sahar 💗', body: I18N.t(langOf(user), 'reminderPush', { p: partner.name }) });
    }
  }
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
const RESET_CODES = ['G7BDQF'];
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
module.exports = { app, ready, streakInfo, recordDay, dayKey, prevDay, localize, runReminders, flush, translatePending, nextOccurrence, inQuiet, pushBudget, db: () => db };
