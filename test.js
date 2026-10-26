// Pruebas: node test.js
const assert = require('assert');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Clave APNs falsa para probar la firma JWT
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
process.env.APNS_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.APNS_KEY_ID = 'ABC123DEFG';
process.env.APNS_TEAM_ID = 'TEAM123456';
process.env.APNS_BUNDLE_ID = 'com.test.sahar';
process.env.DATA_FILE = path.join(os.tmpdir(), `sahar-test-${Date.now()}.json`);

const { app, ready, streakInfo, recordDay, prevDay, runReminders, flush } = require('./server');

(async () => {
  await ready;
  // ---- Racha ----
  assert.strictEqual(prevDay('2026-03-01'), '2026-02-28');
  assert.strictEqual(prevDay('2026-01-01'), '2025-12-31');
  const c = { tz: 'Europe/Berlin', days: {} };
  const d = (s) => new Date(s);
  recordDay(c, 'a', d('2026-10-20T10:00:00Z')); recordDay(c, 'b', d('2026-10-20T20:00:00Z'));
  recordDay(c, 'a', d('2026-10-21T10:00:00Z')); recordDay(c, 'b', d('2026-10-21T11:00:00Z'));
  recordDay(c, 'a', d('2026-10-22T10:00:00Z')); // solo uno el 22
  assert.strictEqual(streakInfo(c, d('2026-10-22T12:00:00Z')).streak, 2, 'hoy incompleto no rompe');
  recordDay(c, 'b', d('2026-10-22T13:00:00Z'));
  assert.strictEqual(streakInfo(c, d('2026-10-22T14:00:00Z')).streak, 3);
  assert.strictEqual(streakInfo(c, d('2026-10-24T12:00:00Z')).streak, 0, 'un día sin los dos rompe');
  assert.strictEqual(c.bestStreak, 3);
  // zona horaria: 23:30 UTC del 22 = 01:30 del 23 en Berlín
  const c2 = { tz: 'Europe/Berlin', days: {} };
  recordDay(c2, 'a', d('2026-10-22T23:30:00Z'));
  assert.deepStrictEqual(Object.keys(c2.days), ['2026-10-23']);
  console.log('✓ rachas');

  // ---- API ----
  const server = app.listen(0);
  const B = `http://localhost:${server.address().port}`;
  const call = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  await call('POST', '/api/register', { userId: 'a', name: 'Yo', tz: 'Europe/Berlin' });
  await call('POST', '/api/register', { userId: 'b', name: 'Ella', tz: 'Europe/Berlin' });
  const { json: created } = await call('POST', '/api/couple/create', { userId: 'a' });
  assert.match(created.code, /^[A-Z2-9]{6}$/);
  const { json: joined } = await call('POST', '/api/couple/join', { userId: 'b', code: created.code.toLowerCase() });
  assert.strictEqual(joined.partnerName, 'Yo');
  assert.strictEqual(joined.streak, 0);
  const third = await call('POST', '/api/register', { userId: 'c', name: 'X' });
  assert.strictEqual(third.status, 200);
  assert.strictEqual((await call('POST', '/api/couple/join', { userId: 'c', code: created.code })).status, 409);
  assert.strictEqual((await call('POST', '/api/device', { userId: 'b', token: 'nope' })).status, 400);
  assert.strictEqual((await call('POST', '/api/send', { userId: 'a' })).status, 409, 'sin dispositivos');
  assert.strictEqual((await call('POST', '/api/device', { userId: 'b', token: 'a'.repeat(64) })).status, 200);
  // Idiomas
  const { localize } = require('./server');
  const I = require('./public/i18n.js');
  const DEFAULT_TEXTS = I.MESSAGES;
  // Todas las claves de cada idioma existen
  const keys = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && k !== 'days' ? keys(v, pre + k + '.') : [pre + k]));
  const enKeys = keys(I.STRINGS.en).sort();
  for (const l of I.LANGS) {
    assert.deepStrictEqual(keys(I.STRINGS[l]).sort(), enKeys, `claves de ${l}`);
    assert.strictEqual(I.MESSAGES[l].length, 20, `mensajes de ${l}`);
    assert.ok(!/\{(n|days)\}/.test(I.streakPush(l, 5)), l);
  }
  assert.strictEqual(I.streakPush('ru', 5), '🔥 5 дней подряд!');
  assert.strictEqual(I.streakPush('ru', 3), '🔥 3 дня подряд!');
  assert.strictEqual(I.streakPush('de', 1), '🔥 1 Tag in Folge!');
  assert.strictEqual(I.streakPush('fa', 7), '🔥 ۷ روز پشت سر هم!');
  assert.strictEqual(I.detect(['fa-IR', 'de']), 'fa');
  assert.strictEqual(I.detect(['ja']), 'de');
  assert.strictEqual(localize('@2', 'de'), 'Ich liebe dich so sehr');
  assert.strictEqual(localize('@0', 'fa'), DEFAULT_TEXTS.fa[0]);
  assert.strictEqual(localize('Hola mi vida', 'fa'), 'Hola mi vida');
  
  const fa = await call('POST', '/api/lang', { userId: 'b', lang: 'fa' });
  assert.strictEqual(fa.json.lang, 'fa');
  assert.strictEqual((await call('POST', '/api/lang', { userId: 'b', lang: 'xx' })).json.code, 'invalid_lang');
  assert.ok(joined.messages.every((m) => /^@\d+$/.test(m)));
  console.log('✓ idiomas');
  // Días juntos
  assert.strictEqual((await call('POST', '/api/since', { userId: 'a', date: '2024-02-14' })).json.since, '2024-02-14');
  assert.strictEqual((await call('POST', '/api/since', { userId: 'a', date: '2999-01-01' })).json.code, 'invalid_date');
  assert.strictEqual((await call('POST', '/api/since', { userId: 'a', date: 'hola' })).json.code, 'invalid_date');
  assert.strictEqual((await call('GET', '/api/state?userId=b')).json.since, '2024-02-14');
  assert.strictEqual((await call('POST', '/api/subscribe', { userId: 'a', subscription: { endpoint: 'javascript:x' } })).status, 400);
  // Recordatorios: no falla y no avisa sin nada en juego
  assert.strictEqual(await runReminders(new Date('2026-10-22T19:30:00Z')), 0);
  console.log('✓ días juntos y recordatorios');
  // Guardado en archivo (incluye claves VAPID generadas)
  await flush();
  const saved = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  assert.ok(saved.vapid && saved.vapid.publicKey && saved.couples[created.code].since === '2024-02-14');
  console.log('✓ guardado');
  const health = await call('GET', '/api/health');
  assert.strictEqual(health.json.apns, true);
  console.log('✓ API');

  // ---- JWT de APNs válido ----
  // Se reproduce la firma con la misma lógica y se verifica con la clave pública
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'ABC123DEFG' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: 'TEAM123456', iat: 1 })).toString('base64url');
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: process.env.APNS_KEY, dsaEncoding: 'ieee-p1363' });
  assert.strictEqual(sig.length, 64, 'firma ES256 en formato JOSE (64 bytes)');
  assert.ok(crypto.verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig));
  console.log('✓ firma APNs');

  server.close();
  fs.rmSync(process.env.DATA_FILE, { force: true });

  // ---- Funciones nuevas con un servidor de notificaciones simulado ----
  {
    const http = require('http');
    const pushes = [];
    const pushSrv = http.createServer((req, res) => res.end()).listen(0);
    // Simular el servicio de notificaciones (web-push solo habla https)
    const wp = require('web-push');
    const realSend = wp.sendNotification;
    wp.sendNotification = async (s2, payload) => { pushes.push({ endpoint: s2.endpoint, payload: JSON.parse(payload) }); return { statusCode: 201 }; };
    const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
    const sub = { endpoint: `http://localhost:${pushSrv.address().port}/push/b`, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
    // Guardar la suscripción directamente (la API exige https)
    const S = require('./server');
    const dbb = S.db();
    const server2 = app.listen(0);
    const B2 = `http://localhost:${server2.address().port}`;
    const c2 = async (method, p, body) => { const r = await fetch(B2 + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const ct = r.headers.get('content-type') || ''; return { status: r.status, json: ct.includes('json') ? await r.json() : null, raw: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()), ct }; };
    await c2('POST', '/api/register', { userId: 'p1', name: 'Carlos', tz: 'Europe/Berlin', lang: 'es' });
    await c2('POST', '/api/register', { userId: 'p2', name: 'Mina', tz: 'Europe/Berlin', lang: 'fa' });
    const code2 = (await c2('POST', '/api/couple/create', { userId: 'p1' })).json.code;
    const j2 = (await c2('POST', '/api/couple/join', { userId: 'p2', code: code2 })).json;
    assert.strictEqual(j2.messages.length, 20, '20 mensajes predeterminados');
    dbb.users.p2.subs = [sub];
    dbb.users.p1.subs = [{ ...sub, endpoint: sub.endpoint.replace('/b', '/a') }];

    // Límite 2 cada 10 min, sin vibraciones extra
    let st = (await c2('POST', '/api/prefs', { userId: 'p2', prefs: { limit: 2, extra: false } })).json;
    assert.deepStrictEqual([st.prefs.limit, st.prefs.extra], [2, false]);
    const r1 = (await c2('POST', '/api/send', { userId: 'p1', level: 3 })).json;
    const r2 = (await c2('POST', '/api/send', { userId: 'p1' })).json;
    const r3 = (await c2('POST', '/api/send', { userId: 'p1' })).json;
    await new Promise((r) => setTimeout(r, 300));
    assert.deepStrictEqual([r1.held, r2.held, r3.held], [false, false, true], 'el tercero se guarda sin aviso');
    assert.strictEqual(pushes.length, 2, 'sin vibraciones extra y con límite: 2 avisos');
    const recv = (await c2('GET', '/api/state?userId=p2')).json.received;
    assert.strictEqual(recv.length, 3, 'los 3 quedan en el historial');
    assert.strictEqual(recv[0].held, true);

    // No molestar todo el día → todo se guarda
    dbb.users.p2.pushLog = [];
    await c2('POST', '/api/prefs', { userId: 'p2', prefs: { limit: 0, quiet: true, from: '00:00', to: '23:59' } });
    assert.strictEqual((await c2('POST', '/api/send', { userId: 'p1' })).json.held, true);
    await c2('POST', '/api/prefs', { userId: 'p2', prefs: { quiet: false } });
    // Sin límite + vibraciones extra: toque fuerte = 3 avisos
    await c2('POST', '/api/prefs', { userId: 'p2', prefs: { extra: true } });
    const before = pushes.length;
    await c2('POST', '/api/send', { userId: 'p1', level: 3 });
    await new Promise((r) => setTimeout(r, 3200));
    assert.strictEqual(pushes.length - before, 3, 'toque con todo = 3 vibraciones');
    console.log('✓ control de avisos');

    // Fotos y audios
    const jpeg = crypto.randomBytes(2000).toString('base64');
    assert.strictEqual((await c2('POST', '/api/media', { userId: 'p1', kind: 'photo', mime: 'text/html', data: jpeg })).status, 400);
    const up = (await c2('POST', '/api/media', { userId: 'p1', kind: 'photo', mime: 'image/jpeg', data: jpeg })).json;
    assert.match(up.id, /^[0-9a-f]{24}$/);
    const sentPhoto = (await c2('POST', '/api/send', { userId: 'p1', mediaId: up.id })).json;
    assert.ok(sentPhoto.ok);
    const got = (await c2('GET', '/api/state?userId=p2')).json.received[0];
    assert.deepStrictEqual(got.media, { id: up.id, kind: 'photo' });
    const dl = await c2('GET', `/api/media/${up.id}?userId=p2`);
    assert.strictEqual(dl.ct, 'image/jpeg'); assert.strictEqual(dl.raw.toString('base64'), jpeg);
    assert.strictEqual((await c2('GET', `/api/media/${up.id}?userId=a`)).status, 404, 'otra pareja no puede verla');
    assert.strictEqual((await c2('POST', '/api/send', { userId: 'p2', mediaId: up.id })).json.code, 'invalid_media', 'no se puede reenviar media ajena');
    const big = 'A'.repeat(1500000);
    assert.strictEqual((await c2('POST', '/api/media', { userId: 'p1', kind: 'audio', mime: 'audio/mp4', data: big })).status, 400);
    console.log('✓ fotos y audios');

    // Fechas especiales
    assert.strictEqual(S.nextOccurrence({ date: '1995-03-10', yearly: true }, '2026-10-26'), '2027-03-10');
    assert.strictEqual(S.nextOccurrence({ date: '1995-12-24', yearly: true }, '2026-10-26'), '2026-12-24');
    assert.strictEqual(S.nextOccurrence({ date: '2000-02-29', yearly: true }, '2026-10-26'), '2027-02-28');
    let ds = (await c2('POST', '/api/dates', { userId: 'p1', name: 'Cumpleaños de Mina', date: '1998-12-24', type: 'birthday' })).json.dates;
    assert.strictEqual(ds.length, 1); assert.strictEqual(ds[0].yearly, true);
    assert.strictEqual((await c2('POST', '/api/dates', { userId: 'p1', name: '', date: '2026-01-01' })).json.code, 'invalid_date');
    const ics = await c2('GET', `/api/ics/${ds[0].id}?userId=p2`);
    assert.ok(ics.ct.startsWith('text/calendar') && /RRULE:FREQ=YEARLY/.test(ics.raw.toString()) && /DTSTART;VALUE=DATE:19981224/.test(ics.raw.toString()));
    // Recordatorio el mismo día por la mañana (hora de Berlín)
    const pb = pushes.length;
    await S.runReminders(new Date('2026-12-24T09:30:00Z'));
    assert.strictEqual(pushes.length - pb, 2, 'aviso de fecha a los dos');
    await S.runReminders(new Date('2026-12-24T09:40:00Z'));
    assert.strictEqual(pushes.length - pb, 2, 'solo una vez');
    ds = (await c2('DELETE', '/api/dates', { userId: 'p1', id: ds[0].id })).json.dates;
    assert.strictEqual(ds.length, 0);
    console.log('✓ fechas especiales');

    // Traducción automática (servicio simulado)
    const realFetch = global.fetch;
    const asked = [];
    global.fetch = async (url, opts) => {
      if (String(url).startsWith('https://api.mymemory.translated.net/')) {
        const u = new URL(url); asked.push(u.searchParams.get('langpair'));
        const tgt = u.searchParams.get('langpair').split('|')[1];
        return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `[${tgt}] ${u.searchParams.get('q')}` } }), { status: 200 });
      }
      return realFetch(url, opts);
    };
    await c2('POST', '/api/messages', { userId: 'p1', text: 'Eres mi sol' });
    await new Promise((r) => setTimeout(r, 200));
    await S.translatePending(10);
    global.fetch = realFetch;
    assert.ok(asked.every((p) => p.startsWith('es|')), 'traduce desde el idioma de quien lo escribió');
    const stFa = (await c2('GET', '/api/state?userId=p2')).json;
    assert.strictEqual(stFa.trans['Eres mi sol'], '[fa-IR] Eres mi sol');
    const stEs = (await c2('GET', '/api/state?userId=p1')).json;
    assert.strictEqual(stEs.trans['Eres mi sol'], undefined, 'el autor lo ve tal cual');
    // Fallo del servicio: se reintenta más tarde sin romper nada
    global.fetch = async (url, opts) => (String(url).includes('mymemory') ? new Response('{"responseStatus":429,"responseData":{"translatedText":"MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS"}}', { status: 429 }) : realFetch(url, opts));
    await c2('POST', '/api/messages', { userId: 'p2', text: 'دوستت دارم عزیزم' });
    await new Promise((r) => setTimeout(r, 200));
    await S.translatePending(10);
    global.fetch = realFetch;
    assert.strictEqual((await c2('GET', '/api/state?userId=p1')).json.trans['دوستت دارم عزیزم'], undefined);
    console.log('✓ traducción automática');

    // Desvincular: el último en salir borra la pareja
    assert.strictEqual((await c2('POST', '/api/couple/leave', { userId: 'p1' })).json.code, null);
    assert.strictEqual((await c2('GET', '/api/state?userId=p2')).json.partnerName, null);
    await c2('POST', '/api/couple/leave', { userId: 'p2' });
    assert.strictEqual(dbb.couples[code2], undefined);
    console.log('✓ desvincular');
    wp.sendNotification = realSend;
    server2.close(); pushSrv.close();
  }

  // ---- Upstash (servidor simulado) ----
  const http = require('http');
  const { spawn } = require('child_process');
  let store = null, auths = [];
  const mock = http.createServer((req, res) => {
    auths.push(req.headers.authorization);
    let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
      if (req.url === '/get/sahar-db') res.end(JSON.stringify({ result: store }));
      else if (req.url === '/set/sahar-db' && req.method === 'POST') { store = body; res.end(JSON.stringify({ result: 'OK' })); }
      else { res.statusCode = 404; res.end('{}'); }
    });
  }).listen(0);
  const mockUrl = `http://localhost:${mock.address().port}`;
  const runChild = (code) => new Promise((resolve, reject) => {
    const env = { ...process.env, UPSTASH_REDIS_REST_URL: mockUrl, UPSTASH_REDIS_REST_TOKEN: 'tok', APNS_KEY: '' };
    const ch = spawn(process.execPath, ['-e', code], { cwd: __dirname, env });
    let out = ''; ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (out += d));
    ch.on('exit', (c) => (c === 0 ? resolve(out) : reject(new Error(out))));
  });
  await runChild(`const s=require('./server');s.ready.then(async()=>{s.db().users.z={id:'z',name:'Zoe',subs:[],devices:[]};await s.flush();process.exit(0)})`);
  const out = await runChild(`const s=require('./server');s.ready.then(()=>{console.log(s.db().users.z.name, !!s.db().vapid);process.exit(0)})`);
  assert.strictEqual(out.trim(), 'Zoe true');
  assert.ok(auths.every((a) => a === 'Bearer tok'));
  mock.close();
  console.log('✓ Upstash');
  console.log('Todo OK');
})().catch((e) => { console.error(e); process.exit(1); });
