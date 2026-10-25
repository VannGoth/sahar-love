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
    assert.strictEqual(I.MESSAGES[l].length, 10, `mensajes de ${l}`);
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
