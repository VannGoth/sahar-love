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
// Las pruebas nunca salen a internet: el traductor real responde «sin cupo» al instante
const netFetch = global.fetch;
global.fetch = (url, opts) => (String(url).includes('mymemory.translated.net')
  ? Promise.resolve(new Response('{"responseStatus":429,"responseData":{"translatedText":"MYMEMORY WARNING"}}', { status: 429 }))
  : netFetch(url, opts));

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
  for (const l of I.LANGS) assert.strictEqual(I.QUESTIONS[l].length, 40, `preguntas ${l}`);
  for (const l of I.LANGS) assert.ok(I.TOT[l].length === 60 && I.FACTS[l].length === 12 && I.CARDS[l].length === 25 && I.CARD_WHY[l].length === 25, `juegos ${l}`);
  assert.ok(I.TOT_EMOJI.length === 60 && I.CARD_EMOJI.length === 25 && I.GIFT_CARDS.every((i) => i < 25) && I.GIFT_CARDS[0] === 24 && !I.GIFT_CARDS.includes(11));
  for (const l of I.LANGS) for (const [k, n] of [['issCats', 10], ['issFeels', 8], ['wishQs', 7]]) assert.strictEqual(I.STRINGS[l][k].length, n, `${k} ${l}`);
  // «Esto o aquello»: 15 días seguidos sin repetir ninguna pregunta
  {
    const { totPairs } = require('./server');
    let day = '2026-11-01'; const seen = new Set();
    const start = Math.floor(Date.parse(day + 'T12:00:00Z') / 86400000);
    for (let i = 0; i < 15; i++) { const d = new Date((start - (start % 15) + i) * 86400000 + 43200000).toISOString().slice(0, 10); for (const q of totPairs(d)) seen.add(q); }
    assert.strictEqual(seen.size, 60, 'las 60 preguntas salen antes de repetir');
  }
  assert.strictEqual(localize('?3', 'es'), I.QUESTIONS.es[3]);
  assert.strictEqual(localize('#morning', 'de'), I.STRINGS.de.morningBody);
  for (const v of I.HAFEZ) for (const l of I.LANGS) assert.ok(v[l] && v[l].length > 10, `hafez ${l}`);
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

    // Sin "no molestar" ni límite: todos los toques llegan al momento
    let st = (await c2('POST', '/api/prefs', { userId: 'p2', prefs: { extra: false, quiet: true, limit: 1 } })).json;
    assert.deepStrictEqual(st.prefs, { extra: false });
    const p0 = pushes.length;
    for (let i = 0; i < 5; i++) assert.strictEqual((await c2('POST', '/api/send', { userId: 'p1' })).status, 200);
    assert.strictEqual(pushes.length - p0, 5, '5 toques = 5 avisos');
    // Vibraciones extra: toque con todo = 3 avisos
    await c2('POST', '/api/prefs', { userId: 'p2', prefs: { extra: true } });
    const before = pushes.length;
    await c2('POST', '/api/send', { userId: 'p1', level: 3 });
    await new Promise((r) => setTimeout(r, 3200));
    assert.strictEqual(pushes.length - before, 3, 'toque con todo = 3 vibraciones');
    // Mensaje escrito al momento y pregunta al azar
    let rs = (await c2('POST', '/api/send', { userId: 'p1', text: 'Te veo a las 8 💕' })).json;
    assert.strictEqual(rs.body, 'Te veo a las 8 💕');
    assert.ok(pushes[pushes.length - 1].payload.body.startsWith('Te veo a las 8'));
    rs = (await c2('POST', '/api/send', { userId: 'p1', ask: true })).json;
    assert.match(rs.body, /^\?\d+$/);
    assert.strictEqual(pushes[pushes.length - 1].payload.body, localize(rs.body, 'fa'), 'pregunta en el idioma de quien recibe');
    // Nuevos tipos de toque
    rs = (await c2('POST', '/api/send', { userId: 'p1', type: 'morning' })).json;
    assert.strictEqual(rs.body, '#morning');
    // Sincronía: los dos tocan en menos de 90 s
    const sy = (await c2('POST', '/api/send', { userId: 'p2' })).json;
    assert.strictEqual(sy.sync, true, 'sincronía');
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(pushes.slice(-2).some((x) => x.payload.title.includes(I.t('es', 'syncTitle'))));
    // Reacción
    assert.strictEqual((await c2('POST', '/api/react', { userId: 'p2', emoji: '💩' })).status, 400);
    const pr = pushes.length;
    await c2('POST', '/api/react', { userId: 'p2', emoji: '😍' });
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(pushes.length - pr, 1);
    assert.strictEqual((await c2('GET', '/api/state?userId=p1')).json.received[0].type, 'react');
    console.log('✓ avisos al instante, mensajes, sincronía y reacciones');

    // «Esto o aquello» con puntos y vales semanales
    let tt = (await c2('GET', '/api/state?userId=p1')).json.tot;
    assert.strictEqual(tt.pairs.length, 4);
    assert.strictEqual((await c2('POST', '/api/tot', { userId: 'p1', mine: [0, 1], guess: [0, 0, 0, 0] })).status, 400);
    tt = (await c2('POST', '/api/tot', { userId: 'p1', mine: [0, 1, 0, 1], guess: [1, 1, 1, 1] })).json.tot;
    assert.ok(tt.mine && tt.partner === null && tt.myHits === null, 'no ve lo del otro hasta que juegue');
    let sp = (await c2('POST', '/api/tot', { userId: 'p2', mine: [1, 1, 0, 0], guess: [0, 1, 0, 1] })).json;
    assert.strictEqual(sp.tot.myHits, 4, 'Mina adivinó las 4');
    assert.strictEqual(sp.tot.partnerHits, 2, 'Carlos adivinó 2');
    assert.deepStrictEqual([sp.score.me, sp.score.partner, sp.score.weekMe, sp.score.weekPartner], [4, 2, 4, 2]);
    // Jugar otra vez el mismo día no suma
    sp = (await c2('POST', '/api/tot', { userId: 'p2', mine: [1, 1, 0, 0], guess: [0, 1, 0, 1] })).json;
    assert.strictEqual(sp.score.me, 4);
    // Cierre de la semana: Mina gana y se lleva un vale
    const cp = dbb.couples[code2];
    cp.week.key = '2020-01-06';
    const pw = pushes.length;
    sp = (await c2('GET', '/api/state?userId=p2')).json;
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(sp.cards.length, 1);
    assert.ok(sp.cards[0].mine && !sp.cards[0].used);
    assert.strictEqual(sp.score.weekMe, 0, 'la semana nueva empieza en 0');
    assert.strictEqual(sp.score.me, 4, 'el total se conserva');
    assert.strictEqual(pushes.length - pw, 2, 'aviso al ganador y al otro');
    assert.strictEqual((await c2('POST', '/api/card/use', { userId: 'p1', id: sp.cards[0].id })).status, 400, 'solo la dueña puede canjearlo');
    sp = (await c2('POST', '/api/card/use', { userId: 'p2', id: sp.cards[0].id })).json;
    assert.ok(sp.cards[0].used);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(pushes[pushes.length - 1].payload.body.startsWith('Mina'), 'aviso del canje');
    // Logros de racha: el séptimo día seguido avisa con el logro
    cp.days = {};
    let dd = S.dayKey(new Date(), cp.tz);
    for (let i = 1; i <= 6; i++) { dd = S.prevDay(dd); cp.days[dd] = ['p1', 'p2']; }
    const ms = (await c2('POST', '/api/send', { userId: 'p1' })).json;
    assert.strictEqual(ms.streak, 6, 'hoy aún no cuenta hasta que toquen los dos');
    assert.strictEqual(ms.milestone, null, 'hoy solo tocó uno');
    const ms2 = (await c2('POST', '/api/send', { userId: 'p2' })).json;
    assert.strictEqual(ms2.milestone, 7);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(pushes.slice(-2).some((x) => x.payload.body.includes('🌹')), 'aviso del logro');
    console.log('✓ esto o aquello, puntos, vales y logros');

    // Punto extra: ayer solo jugó Carlos → +1 para él
    {
      const yest = S.prevDay(S.dayKey(new Date(), cp.tz));
      cp.tot[yest] = { answers: { p1: { mine: [0, 0, 0, 0], guess: [0, 0, 0, 0] } }, pairs: [0, 1, 2, 3] };
      const before1 = (cp.points || {}).p1 || 0;
      const pp = pushes.length;
      S.settleTotBonus(cp);
      assert.strictEqual(cp.points.p1, before1 + 1, 'punto extra por constancia');
      assert.strictEqual(cp.tot[yest].bonus, 'p1');
      S.settleTotBonus(cp);
      assert.strictEqual(cp.points.p1, before1 + 1, 'solo una vez');
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(pushes.slice(pp).some((x) => x.payload.body.includes('Mina')), 'aviso del punto extra');
      // Si jugaron los dos, no hay punto extra
      const d2 = S.prevDay(yest);
      cp.tot[d2] = { answers: { p1: { mine: [0, 0, 0, 0], guess: [0, 0, 0, 0] }, p2: { mine: [0, 0, 0, 0], guess: [0, 0, 0, 0] } }, scored: true };
      S.settleTotBonus(cp);
      assert.strictEqual(cp.points.p1, before1 + 1);
    }
    console.log('✓ punto extra por constancia');

    // Armonía: contar un enojo, pedir perdón, compensar con un vale, gratitud y deseos
    {
      assert.strictEqual((await c2('POST', '/api/issue', { userId: 'p2', cat: 99, feel: 0 })).status, 400);
      const pi = pushes.length;
      let h = (await c2('POST', '/api/issue', { userId: 'p2', cat: 1, feel: 0, what: 'Estuviste con el móvil en la cena', need: 'Cenar sin pantallas' })).json.harmony;
      assert.strictEqual(h.issues.length, 1);
      assert.ok(h.issues[0].mine && h.issueCats[1] === 1 && h.ratio.i === 1);
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(pushes.slice(pi).some((x) => x.endpoint.endsWith('/a') && x.payload.body.includes('Mina')), 'aviso a Carlos');
      const iid = h.issues[0].id;
      assert.strictEqual((await c2('POST', '/api/issue/act', { userId: 'p2', id: iid, act: 'sorry' })).status, 400, 'no puede disculparse por su propio enojo');
      h = (await c2('POST', '/api/issue/act', { userId: 'p1', id: iid, act: 'sorry' })).json.harmony;
      assert.ok(h.issues[0].sorry && !h.issues[0].mine);
      // Vale regalado para compensar
      assert.strictEqual((await c2('POST', '/api/gift', { userId: 'p1', card: 11 })).status, 400, '«gano una discusión» no se regala');
      let g = (await c2('POST', '/api/gift', { userId: 'p1', card: 12, note: 'Perdón, mi amor', issue: iid })).json;
      const gc = g.cards.find((c) => c.card === 12);
      assert.ok(gc && !gc.mine && gc.fromMe && gc.note === 'Perdón, mi amor');
      assert.ok(g.harmony.issues[0].gift);
      g = (await c2('GET', '/api/state?userId=p2')).json;
      assert.ok(g.cards.find((c) => c.card === 12 && c.mine && c.gift), 'Mina recibe el vale');
      h = (await c2('POST', '/api/issue/act', { userId: 'p2', id: iid, act: 'solved' })).json.harmony;
      assert.ok(h.issues[0].solved);
      // Gratitud y proporción 5:1
      for (let i = 0; i < 5; i++) h = (await c2('POST', '/api/thanks', { userId: 'p1', text: `Gracias por todo ${i}` })).json.harmony;
      assert.deepStrictEqual(h.ratio, { g: 5, i: 1 });
      assert.strictEqual((await c2('POST', '/api/thanks', { userId: 'p1', text: '   ' })).status, 400);
      // Borrar: solo quien lo escribió
      assert.strictEqual((await c2('POST', '/api/issue/act', { userId: 'p1', id: iid, act: 'delete' })).status, 400);
      // 7 deseos
      assert.strictEqual((await c2('POST', '/api/wishes', { userId: 'p2', items: ['', ''] })).status, 400);
      const pw2 = pushes.length;
      const w = (await c2('POST', '/api/wishes', { userId: 'p2', items: ['Un juego de preguntas', 'Más colores'] })).json.harmony.wishes;
      assert.strictEqual(w.mine.length, 7);
      assert.strictEqual(w.mine[1], 'Más colores');
      assert.strictEqual((await c2('GET', '/api/state?userId=p1')).json.harmony.wishes.partner[0], 'Un juego de preguntas');
      await new Promise((r) => setTimeout(r, 100));
      assert.ok(pushes.slice(pw2).some((x) => x.endpoint.endsWith('/a')), 'aviso de deseos');
    }
    console.log('✓ armonía: enojos, vales regalados, gratitud y deseos');

    // Tira y afloja en vivo
    {
      const pr0 = pushes.length;
      let r = (await c2('POST', '/api/race/start', { userId: 'p1' })).json;
      assert.ok(r.status === 'waiting' && r.byMe);
      await new Promise((res) => setTimeout(res, 100));
      assert.ok(pushes.slice(pr0).some((x) => x.endpoint.endsWith('/b') && x.payload.body.includes('Carlos')), 'aviso del reto');
      let r2 = (await c2('GET', '/api/race?userId=p2')).json;
      assert.ok(r2.status === 'waiting' && !r2.byMe);
      r2 = (await c2('POST', '/api/race/accept', { userId: 'p2', id: r2.id })).json;
      assert.strictEqual(r2.status, 'live');
      assert.ok(r2.startIn > 2000, 'cuenta atrás');
      // Toques antes de empezar no cuentan
      r = (await c2('POST', '/api/race/tap', { userId: 'p1', id: r.id, n: 30 })).json;
      assert.strictEqual(r.me, 0);
      // Simular que ya pasaron 5 segundos de juego
      const race = S.races[code2];
      race.startAt = Date.now() - 5000; race.endAt = race.startAt + S.RACE.duration;
      const ptsBefore = (await c2('GET', '/api/state?userId=p1')).json.score.me;
      r2 = (await c2('POST', '/api/race/tap', { userId: 'p2', id: r.id, n: 6 })).json;
      assert.strictEqual(r2.status, 'live');
      r = (await c2('POST', '/api/race/tap', { userId: 'p1', id: r.id, n: 9999 })).json;
      assert.ok(r.me <= 5 * S.RACE.maxRate + 4, 'tope de toques por segundo');
      r2 = (await c2('POST', '/api/race/tap', { userId: 'p2', id: r.id, n: 10 })).json;
      assert.strictEqual(r2.status, 'done');
      assert.strictEqual(r2.winner, 'partner');
      r = (await c2('GET', '/api/race?userId=p1')).json;
      assert.ok(r.winner === 'me' && r.winsMe === 1);
      assert.strictEqual((await c2('GET', '/api/state?userId=p1')).json.score.me, ptsBefore + S.RACE.prize, '+2 puntos al ganador');
      // Cancelar un reto
      r = (await c2('POST', '/api/race/start', { userId: 'p2' })).json;
      assert.strictEqual(r.status, 'waiting');
      r = (await c2('POST', '/api/race/cancel', { userId: 'p1', id: r.id })).json;
      assert.strictEqual(r.status, 'cancelled');
      cp.week.pts = {}; // que no influya en las pruebas de recordatorios de más abajo
    }
    console.log('✓ tira y afloja');

    // Fotos y audios
    const jpeg = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), crypto.randomBytes(2000)]).toString('base64');
    assert.strictEqual((await c2('POST', '/api/media', { userId: 'p1', kind: 'photo', mime: 'text/html', data: jpeg })).status, 400);
    const up = (await c2('POST', '/api/media', { userId: 'p1', kind: 'photo', mime: 'image/jpeg', data: jpeg })).json;
    assert.match(up.id, /^[0-9a-f]{32}$/);
    // Un «JPEG» que en realidad es HTML se rechaza
    assert.strictEqual((await c2('POST', '/api/media', { userId: 'p1', kind: 'photo', mime: 'image/jpeg', data: Buffer.from('<html><script>x</script>').toString('base64') })).status, 400, 'contenido falso');
    // En disco la foto está cifrada (no se ve el JPEG)
    const MEDIA_DIR = path.join(path.dirname(process.env.DATA_FILE), 'media');
    const onDisk = JSON.parse(fs.readFileSync(path.join(MEDIA_DIR, up.id + '.json'), 'utf8'));
    assert.ok(onDisk.v === 1 && onDisk.iv && onDisk.tag && !onDisk.b64, 'cifrada en reposo');
    assert.ok(!Buffer.from(onDisk.data, 'base64').subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')));
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
        const u = new URL(url); asked.push({ pair: u.searchParams.get('langpair'), q: u.searchParams.get('q') });
        const tgt = u.searchParams.get('langpair').split('|')[1];
        return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `[${tgt}] ${u.searchParams.get('q')}` } }), { status: 200 });
      }
      return realFetch(url, opts);
    };
    await c2('POST', '/api/messages', { userId: 'p1', text: 'Eres mi sol' });
    await new Promise((r) => setTimeout(r, 200));
    await S.translatePending(10);
    global.fetch = realFetch;
    assert.ok(asked.filter((a) => a.q === 'Eres mi sol').every((a) => a.pair.startsWith('es|')), 'traduce desde el idioma de quien lo escribió');
    assert.ok(asked.filter((a) => a.q === 'Más colores').every((a) => a.pair.startsWith('fa-IR|')), 'los deseos de Mina se traducen desde su idioma');
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

    // Tipos de toque
    dbb.users.p2.pushLog = [];
    const kiss = (await c2('POST', '/api/send', { userId: 'p1', type: 'kiss' })).json;
    assert.strictEqual(kiss.body, '#kiss');
    await new Promise((r) => setTimeout(r, 100));
    const lastPush = pushes[pushes.length - 1].payload;
    assert.strictEqual(lastPush.title, 'Carlos 💋');
    assert.strictEqual(lastPush.body, I.t('fa', 'kissBody'));
    const recvK = (await c2('GET', '/api/state?userId=p2')).json.received[0];
    assert.strictEqual(recvK.type, 'kiss');
    console.log('✓ tipos de toque');

    // Pregunta del día
    let q1 = (await c2('GET', '/api/state?userId=p1')).json.question;
    assert.ok(q1.q >= 0 && q1.q < 40 && q1.mine === null);
    await c2('POST', '/api/answer', { userId: 'p2', text: 'سفر به شیراز' });
    q1 = (await c2('GET', '/api/state?userId=p1')).json.question;
    assert.strictEqual(q1.partnerAnswered, true); assert.strictEqual(q1.partner, null, 'oculta hasta que respondas');
    q1 = (await c2('POST', '/api/answer', { userId: 'p1', text: 'Ir a Isfahán contigo' })).json.question;
    assert.strictEqual(q1.mine, 'Ir a Isfahán contigo'); assert.strictEqual(q1.partner, 'سفر به شیراز');
    assert.notStrictEqual(S.questionIndex('2026-10-26'), S.questionIndex('2026-10-27'));
    console.log('✓ pregunta del día');

    // Ánimo y álbum
    assert.strictEqual((await c2('POST', '/api/mood', { userId: 'p2', emoji: '🥰' })).json.myMood, '🥰');
    assert.strictEqual((await c2('GET', '/api/state?userId=p1')).json.partnerMood, '🥰');
    assert.strictEqual((await c2('POST', '/api/mood', { userId: 'p2', emoji: 'x' })).status, 400);
    const alb = (await c2('GET', '/api/state?userId=p2')).json.album;
    assert.ok(alb.length >= 1 && alb[0].id && alb[0].mine === false);
    console.log('✓ ánimo y álbum');

    // Fechas persas (valores conocidos)
    assert.deepStrictEqual(S.persianHolidays(2025), { nowruz: '2025-03-21', sizdah: '2025-04-02', yalda: '2025-12-21', suri: '2025-03-18' });
    assert.strictEqual(S.persianHolidays(2024).nowruz, '2024-03-20');
    const upP = S.upcomingPersian('2026-10-26');
    assert.deepStrictEqual(upP.map((x) => x.id), ['suri', 'nowruz', 'sizdah', 'yalda']);
    assert.ok(upP.find((x) => x.id === 'yalda').date.startsWith('2026-12-2'));
    let pst = (await c2('GET', '/api/state?userId=p1')).json;
    assert.strictEqual(pst.persianOn, true); assert.strictEqual(pst.persian.length, 4);
    pst = (await c2('POST', '/api/persian', { userId: 'p1', on: false })).json;
    assert.strictEqual(pst.persianOn, false); assert.strictEqual(pst.persian.length, 0);
    await c2('POST', '/api/persian', { userId: 'p1', on: true });
    const pb2 = pushes.length;
    await S.runReminders(new Date(S.persianHolidays(2026).yalda + 'T08:30:00Z'));
    assert.ok(pushes.slice(pb2).some((x) => x.payload.body.includes(I.t('fa', 'yalda'))), 'aviso de Yalda en persa');
    console.log('✓ fechas persas');

    // ---- Deseos de Sahar ----
    {
      const wait = () => new Promise((r) => setTimeout(r, 80));
      // Protector de racha: ayer nadie tocó, pero había racha → se gasta un protector
      cp.days = {}; cp.frozen = {}; cp.shields = undefined; cp.rescued = false;
      const today = S.dayKey(new Date(), cp.tz);
      let k = S.prevDay(S.prevDay(today));
      for (let i = 0; i < 5; i++) { cp.days[k] = ['p1', 'p2']; k = S.prevDay(k); }
      let st2 = (await c2('GET', '/api/state?userId=p1')).json;
      assert.strictEqual(st2.shields, 1, 'se gastó 1 de los 2 protectores iniciales');
      assert.strictEqual(st2.streak, 6, 'la racha sigue (5 días + el día protegido)');
      await wait();
      assert.ok(pushes.some((x) => x.payload.title === 'Sahar 🛡️'), 'aviso del protector');
      // Hueco de 3 días: ya no alcanza el protector, pero se puede recuperar una vez
      cp.days = {}; cp.frozen = {}; cp.shields = 0;
      k = S.prevDay(S.prevDay(S.prevDay(S.prevDay(today))));
      for (let i = 0; i < 10; i++) { cp.days[k] = ['p1', 'p2']; k = S.prevDay(k); }
      st2 = (await c2('GET', '/api/state?userId=p2')).json;
      assert.strictEqual(st2.streak, 0);
      assert.strictEqual(st2.rescue, 13, '10 días + 3 de hueco');
      st2 = (await c2('POST', '/api/streak/rescue', { userId: 'p2' })).json;
      assert.strictEqual(st2.streak, 13);
      assert.strictEqual(st2.rescue, null, 'solo una vez');
      assert.strictEqual((await c2('POST', '/api/streak/rescue', { userId: 'p2' })).status, 400);
      // Se gana un protector al llegar a 7 días seguidos
      cp.days = {}; cp.frozen = {}; cp.shields = 0; cp.shieldAt = 0;
      k = S.prevDay(today);
      for (let i = 0; i < 6; i++) { cp.days[k] = ['p1', 'p2']; k = S.prevDay(k); }
      await c2('POST', '/api/send', { userId: 'p1' });
      const se = (await c2('POST', '/api/send', { userId: 'p2' })).json;
      assert.ok(se.shieldEarned && se.shields === 1, 'protector ganado a los 7 días');
      console.log('✓ protector de racha y recuperar racha');

      // Plan de la semana
      let wk = (await c2('GET', '/api/state?userId=p1')).json.weekly;
      assert.ok(wk.cook >= 0 && wk.cook < I.COOK_EMOJI.length && wk.out >= 0);
      const prevCook = wk.cook;
      wk = (await c2('POST', '/api/weekly', { userId: 'p1', kind: 'cook', act: 'other' })).json.weekly;
      assert.notStrictEqual(wk.cook, prevCook, 'otra idea');
      const pwk = pushes.length;
      wk = (await c2('POST', '/api/weekly', { userId: 'p2', kind: 'cook', act: 'done' })).json.weekly;
      assert.ok(wk.cookDone && wk.count.cook === 1);
      assert.strictEqual((await c2('POST', '/api/weekly', { userId: 'p1', kind: 'cook', act: 'other' })).status, 400, 'ya hecho');
      await wait();
      assert.ok(pushes.slice(pwk).some((x) => x.endpoint.endsWith('/a')), 'aviso a Carlos');
      console.log('✓ plan de la semana');

      // Misiones en equipo
      let ms3 = (await c2('POST', '/api/mission', { userId: 'p1', p: 0 })).json.miss;
      assert.deepStrictEqual(ms3.me, [true, false, false, false]);
      assert.strictEqual(ms3.total, 0, 'falta Mina');
      ms3 = (await c2('POST', '/api/mission', { userId: 'p2', p: 0 })).json.miss;
      assert.strictEqual(ms3.total, 1);
      const cardsBefore = (cp.cards || []).length;
      for (const p of [1, 2, 3]) { await c2('POST', '/api/mission', { userId: 'p1', p }); ms3 = (await c2('POST', '/api/mission', { userId: 'p2', p })).json.miss; }
      assert.ok(ms3.all && ms3.total === 4);
      assert.strictEqual(cp.cards.length, cardsBefore + 2, 'vale para cada uno');
      console.log('✓ misiones juntos');

      // Carrera de la suerte
      assert.strictEqual((await c2('POST', '/api/racer', { userId: 'p2', racer: '🦄' })).json.dice.racer, '🦄');
      let dg = (await c2('POST', '/api/dice/start', { userId: 'p1' })).json.dice;
      assert.ok(dg.id && dg.myTurn && dg.board.length === S.DICE.len);
      assert.strictEqual((await c2('GET', '/api/state?userId=p1')).json.dice.partnerRacer, '🦄');
      // Tirar fuera de turno no hace nada
      let dg2 = (await c2('POST', '/api/dice/roll', { userId: 'p2', id: dg.id })).json.dice;
      assert.strictEqual(dg2.log.length, 0);
      let guard = 0;
      while (dg.status === 'live' && guard++ < 400) {
        const who = dg.myTurn ? 'p1' : 'p2';
        const r = (await c2('POST', '/api/dice/roll', { userId: who, id: dg.id })).json.dice;
        const last = r.log[r.log.length - 1];
        assert.ok(last.roll >= 1 && last.roll <= 6);
        dg = (await c2('GET', '/api/state?userId=p1')).json.dice;
      }
      assert.strictEqual(dg.status, 'done');
      assert.ok(dg.me === S.DICE.len - 1 || dg.partner === S.DICE.len - 1);
      assert.strictEqual(dg.winsMe + dg.winsPartner, 1);
      console.log('✓ carrera de la suerte');

      // Memorama
      let mm = (await c2('GET', '/api/state?userId=p1')).json.memo;
      assert.ok(mm.seed > 0 && mm.pairs === 8 && mm.mine === null);
      assert.strictEqual((await c2('POST', '/api/memo', { userId: 'p1', moves: 3 })).status, 400);
      const sc0 = (await c2('GET', '/api/state?userId=p2')).json.score.me;
      mm = (await c2('POST', '/api/memo', { userId: 'p1', moves: 14 })).json.memo;
      assert.strictEqual(mm.partner, null);
      mm = (await c2('POST', '/api/memo', { userId: 'p2', moves: 12 })).json;
      assert.strictEqual(mm.memo.partner, 14);
      assert.strictEqual(mm.score.me, sc0 + 1, 'menos movimientos gana');
      // Título de carta
      const alb2 = (await c2('POST', '/api/photo/title', { userId: 'p2', id: up.id, title: 'Nuestra primera foto' })).json.album;
      assert.strictEqual(alb2.find((x) => x.id === up.id).title, 'Nuestra primera foto');
      console.log('✓ memorama y cartas');

      // Cofre, planes con hora y mes de cumpleaños
      assert.strictEqual((await c2('POST', '/api/chest', { userId: 'p1', kind: 5, text: 'x' })).status, 400);
      let ch = (await c2('POST', '/api/chest', { userId: 'p1', kind: 1, text: 'Hablar con calma funciona' })).json.chest;
      assert.ok(ch[0].mine && ch[0].kind === 1);
      ch = (await c2('DELETE', '/api/chest', { userId: 'p2', id: ch[0].id })).json.chest;
      assert.strictEqual(ch.length, 1, 'solo quien lo escribió lo borra');
      const call = (await c2('POST', '/api/dates', { userId: 'p1', name: 'Llamada', date: '2026-12-05', type: 'call', yearly: false, time: '19:30' })).json.dates.find((d) => d.type === 'call');
      assert.strictEqual(call.time, '19:30');
      const icsT = await c2('GET', `/api/ics/${call.id}?userId=p2`);
      assert.ok(/DTSTART:20261205T193000/.test(icsT.raw.toString()));
      const pc = pushes.length;
      await S.runReminders(new Date('2026-12-05T17:50:00Z')); // 18:50 en Berlín
      assert.ok(pushes.slice(pc).some((x) => x.payload.body.includes('Llamada')), 'aviso suave antes de la llamada');
      await S.runReminders(new Date('2026-12-04T19:30:00Z'));
      assert.ok(!pushes.slice(pc + 2).some((x) => x.payload.body.includes('Llamada')), 'sin aviso la víspera');
      const bt = (await c2('POST', '/api/birth', { userId: 'p2', month: 3, theme: 'sakura' })).json.birth;
      assert.deepStrictEqual(bt.me, { month: 3, theme: 'sakura' });
      assert.deepStrictEqual((await c2('GET', '/api/state?userId=p1')).json.birth.partner, { month: 3, theme: 'sakura' });
      console.log('✓ cofre, planes con hora y mes de cumpleaños');

      // Sueño
      let dr = (await c2('POST', '/api/dream', { userId: 'p2', city: 'seoul', goal: 4000, date: '2027-09-01', tick: 0 })).json.dream;
      assert.ok(dr.city === 'seoul' && dr.goal === 4000 && dr.ticks[0] === 0);
      dr = (await c2('POST', '/api/dream/save', { userId: 'p1', amount: 50 })).json.dream;
      assert.strictEqual(dr.saved, 50);
      assert.strictEqual((await c2('POST', '/api/dream/save', { userId: 'p1', amount: 'x' })).status, 400);
      console.log('✓ nuestro sueño');

      // ---- Seguridad ----
      const hdr = async (method, p, uid, body) => { const r = await fetch(B2 + p, { method, headers: { 'Content-Type': 'application/json', 'X-User-Id': uid }, body: body && JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null), headers: r.headers }; };
      const sh = await hdr('GET', '/api/state', 'p1');
      assert.strictEqual(sh.status, 200, 'identidad por cabecera');
      assert.strictEqual(sh.headers.get('x-content-type-options'), 'nosniff');
      assert.strictEqual(sh.headers.get('cache-control'), 'no-store');
      assert.strictEqual(sh.headers.get('x-powered-by'), null);
      const page = await fetch(B2 + '/');
      const csp = page.headers.get('content-security-policy') || '';
      assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/, 'CSP con huella del script');
      assert.match(csp, /frame-ancestors 'none'/);
      assert.strictEqual((await hdr('GET', '/api/state', '__proto__')).status, 401, 'no acepta ids raros');
      assert.strictEqual((await c2('POST', '/api/register', { userId: 'mal id!', name: 'X' })).status, 400);
      // Enlace de calendario firmado: sin identidad en la dirección
      const dd = sh.json.dates[0];
      assert.ok(dd.ics, 'token de calendario');
      const ics = await fetch(`${B2}/api/ics/${dd.id}?t=${dd.ics}`);
      assert.strictEqual(ics.status, 200);
      assert.strictEqual((await fetch(`${B2}/api/ics/${dd.id}?t=falso`)).status, 404);
      // Borrar una foto
      const ph = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), crypto.randomBytes(500)]).toString('base64');
      const up2 = (await hdr('POST', '/api/media', 'p2', { kind: 'photo', mime: 'image/png', data: ph })).json;
      assert.ok((await hdr('GET', '/api/state', 'p1')).json.album.some((m) => m.id === up2.id));
      const afterDel = (await hdr('DELETE', '/api/media/' + up2.id, 'p1', {})).json;
      assert.ok(!afterDel.album.some((m) => m.id === up2.id), 'foto borrada del álbum');
      assert.strictEqual((await c2('GET', `/api/media/${up2.id}?userId=p1`)).status, 404);
      // Límite de intentos al unirse con códigos
      let lim = 0;
      for (let i = 0; i < 12; i++) if ((await c2('POST', '/api/couple/join', { userId: 'p1', code: 'ZZZZZZ' })).status === 429) lim++;
      assert.ok(lim > 0, 'frena a quien adivina códigos');
      // Presencia
      assert.strictEqual((await hdr('GET', '/api/state', 'p2')).json.partnerOnline, true, 'p1 está en línea');
      console.log('✓ seguridad: cabeceras, CSP, fotos cifradas, borrar foto, calendario firmado y límites');

      // ---- Ciencia del amor ----
      let sc = (await hdr('GET', '/api/state', 'p1')).json.science;
      assert.ok(sc && sc.lmap && sc.aron && sc.checkin && sc.chal);
      // Mapas del amor
      assert.strictEqual((await hdr('POST', '/api/lmap', 'p1', { me: '', guess: 'x' })).status, 400);
      sc = (await hdr('POST', '/api/lmap', 'p1', { me: 'Pizza', guess: 'Sushi' })).json.science;
      assert.ok(sc.lmap.mine && sc.lmap.partner === null, 'no ve lo del otro antes de jugar');
      sc = (await hdr('POST', '/api/lmap', 'p2', { me: 'Sushi', guess: 'Pizza' })).json.science;
      assert.strictEqual(sc.lmap.partner.me, 'Pizza');
      const ptsBefore = (await hdr('GET', '/api/state', 'p1')).json.score.me;
      await hdr('POST', '/api/lmap/grade', 'p2', { grade: 2 }); // p2 califica lo que adivinó p1
      await hdr('POST', '/api/lmap/grade', 'p2', { grade: 0 }); // no se puede calificar dos veces
      const afterGrade = (await hdr('GET', '/api/state', 'p1')).json;
      assert.strictEqual(afterGrade.score.me, ptsBefore + 2, '✓ = 2 puntos');
      assert.strictEqual(afterGrade.science.lmap.myGrade, 2);
      await hdr('POST', '/api/lmap/grade', 'p1', { grade: 1 });
      assert.strictEqual((await hdr('GET', '/api/state', 'p1')).json.science.lmap.total, 1, 'ronda completa');
      // 36 preguntas
      let ar = (await hdr('POST', '/api/aron', 'p1', { act: 'next' })).json.science.aron;
      assert.strictEqual(ar.i, 1);
      for (let i = 0; i < 36; i++) ar = (await hdr('POST', '/api/aron', 'p2', { act: 'next' })).json.science.aron;
      assert.ok(ar.i === 37 && ar.rounds === 1, 'pantalla final y ronda contada');
      assert.strictEqual((await hdr('POST', '/api/aron', 'p2', { act: 'next' })).status, 400);
      ar = (await hdr('POST', '/api/aron', 'p1', { act: 'restart' })).json.science.aron;
      assert.strictEqual(ar.i, 0);
      // Pausa de 20 minutos
      let pz = (await hdr('POST', '/api/pause', 'p1', { act: 'start' })).json.science.pause;
      assert.ok(pz.mine && pz.until - Date.now() > 19 * 60000);
      assert.strictEqual((await hdr('GET', '/api/state', 'p2')).json.science.pause.mine, false);
      pz = (await hdr('POST', '/api/pause', 'p1', { act: 'end' })).json.science.pause;
      assert.strictEqual(pz, null);
      // Reparación
      assert.strictEqual((await hdr('POST', '/api/repair', 'p1', { i: 99 })).status, 400);
      assert.strictEqual((await hdr('POST', '/api/repair', 'p1', { i: 3 })).status, 200);
      // Revisión semanal: no se ve la del otro hasta hacer la propia
      await hdr('POST', '/api/checkin', 'p2', { score: 8, best: 'La cena', need: 'Más abrazos' });
      let ci = (await hdr('GET', '/api/state', 'p1')).json.science.checkin;
      assert.ok(ci.partnerDone && ci.partner === null && ci.hist.every((h) => h.partner == null), 'privado hasta responder');
      assert.strictEqual((await hdr('POST', '/api/checkin', 'p1', { score: 11 })).status, 400);
      ci = (await hdr('POST', '/api/checkin', 'p1', { score: 9, best: 'Paseo', need: '' })).json.science.checkin;
      assert.strictEqual(ci.partner.score, 8);
      assert.strictEqual(ci.hist[ci.hist.length - 1].partner, 8);
      // Reto del día
      let chq = (await hdr('POST', '/api/challenge', 'p1', {})).json.science.chal;
      assert.ok(chq.me && !chq.partner && chq.total === 0);
      chq = (await hdr("POST", "/api/challenge", "p2", {})).json.science.chal;
      assert.strictEqual(chq.total, 1);
      // Girarse hacia el otro: hay toques y respuestas en el historial
      const tr = (await hdr('GET', '/api/state', 'p2')).json.science.turn;
      assert.ok(tr && (tr.me === null || typeof tr.me.pct === 'number'));
      console.log('✓ ciencia del amor: mapas, 36 preguntas, pausa, reparación, revisión, retos');
    }

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
