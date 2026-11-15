/*
 * Посредник для приложения «Мой день».
 * Принимает запрос ИИ-тренера с телефона и передаёт его в Alice AI (Yandex AI Studio).
 * Нужен потому, что API Яндекса не принимает запросы напрямую из веб-страницы.
 *
 * Среда выполнения: Node.js 18 или новее. Точка входа: index.handler
 * Рядом должен лежать package.json: при сохранении версии Яндекс сам установит библиотеку imapflow для чтения почты.
 * Переменные окружения:
 *   APP_SECRET — код доступа, который вы придумали (тот же вводится в приложении)
 *   MODEL      — необязательно, по умолчанию aliceai-llm
 *   FOLDER_ID  — необязательно, по умолчанию каталог самой функции
 * Функции должен быть назначен сервисный аккаунт с ролью ai.languageModels.user.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
const reply = (status, body) => ({
  statusCode: status,
  headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS),
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const pad = n => String(n).padStart(2, '0');

// GET ?cal=1&w=0730,0900&m=0730,1300,1630,1830&s=2215 — файл календаря с ежедневными напоминаниями
function calendar(q) {
  const d = new Date();
  const day = d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
  const kinds = ['Завтрак', 'Обед', 'Перекус', 'Ужин'];
  const ok = t => /^[0-2][0-9][0-5][0-9]$/.test(t);
  const ev = (uid, t, title) => ['BEGIN:VEVENT', 'UID:moyden-' + uid + '@moy-den', 'DTSTAMP:' + day + 'T000000Z', 'DTSTART:' + day + 'T' + t + '00',
    'DURATION:PT5M', 'RRULE:FREQ=DAILY', 'SUMMARY:' + title, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + title, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT'];
  let lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//moy-den//RU', 'CALSCALE:GREGORIAN'];
  String(q.w || '').split(',').filter(ok).slice(0, 24).forEach(t => { lines = lines.concat(ev('w' + t, t, 'Выпить стакан воды')); });
  String(q.m || '').split(',').slice(0, 4).forEach((t, i) => { if (ok(t)) lines = lines.concat(ev('m' + i, t, kinds[i] + ': время поесть')); });
  if (ok(String(q.s || ''))) lines = lines.concat(ev('s', q.s, 'Пора готовиться ко сну'));
  if (ok(String(q.r || ''))) lines = lines.concat(ev('r', q.r, 'Мой день: анализ дня'));
  // e=ГГГГММДДЧЧММ~длительность~за_сколько_минут_напомнить~название;… — разовые дела с напоминанием
  String(q.e || '').split(';').slice(0, 30).forEach((x, i) => {
    const p = x.split('~');
    if (p.length < 4 || !/^[0-9]{12}$/.test(p[0])) return;
    const title = p.slice(3).join(' ').slice(0, 80);
    lines = lines.concat(['BEGIN:VEVENT', 'UID:moyden-t' + p[0] + '-' + i + '@moy-den', 'DTSTAMP:' + day + 'T000000Z', 'DTSTART:' + p[0].slice(0, 8) + 'T' + p[0].slice(8) + '00',
      'DURATION:PT' + (Number(p[1]) || 30) + 'M', 'SUMMARY:' + title, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + title, 'TRIGGER:-PT' + (Number(p[2]) || 0) + 'M', 'END:VALARM', 'END:VEVENT']);
  });
  lines.push('END:VCALENDAR');
  return { statusCode: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="moy-den.ics"' }, body: lines.join('\r\n') };
}

// POST {secret, mail: {provider, user, pass, days, limit, all}} — новые письма для Робота Секретаря.
// Ящик открывается только для чтения: письма не помечаются прочитанными и не удаляются.
async function mail(m) {
  const hosts = { gmail: 'imap.gmail.com', yandex: 'imap.yandex.ru', mailru: 'imap.mail.ru' };
  const host = hosts[m.provider];
  if (!host || !m.user || !m.pass) return reply(400, { error: 'Mail settings are incomplete' });
  let ImapFlow;
  try { ImapFlow = require('imapflow').ImapFlow; } catch (e) { return reply(500, { error: 'imapflow is not installed: ' + e.message }); }
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: String(m.user), pass: String(m.pass) }, logger: false, socketTimeout: 30000 });
  try { await client.connect(); } catch (e) { return reply(401, { error: 'Mail login failed: ' + (e.responseText || e.message) }); }
  const out = [];
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const since = new Date(Date.now() - Math.min(Number(m.days) || 2, 14) * 86400000);
      const found = await client.search(m.all ? { since } : { since, seen: false }, { uid: true });
      const uids = (found || []).slice(-Math.min(Number(m.limit) || 15, 30));
      const list = uids.length ? await client.fetchAll(uids, { uid: true, envelope: true, bodyStructure: true, flags: true }, { uid: true }) : [];
      for (const msg of list) {
        const env = msg.envelope || {};
        const from = (env.from && env.from[0]) || {};
        const item = { uid: msg.uid, from: ((from.name || '') + ' <' + (from.address || '') + '>').trim(), subject: env.subject || '',
          date: env.date ? new Date(env.date).toISOString() : '', unread: !(msg.flags && msg.flags.has('\\Seen')), text: '' };
        try {
          const stack = [msg.bodyStructure];
          let part = null;
          while (stack.length && !part) { const n = stack.shift(); if (!n) continue; if (n.type === 'text/plain') part = n.part || '1'; else (n.childNodes || []).forEach(c => stack.push(c)); }
          if (part) {
            const dl = await client.download(String(msg.uid), part, { uid: true, maxBytes: 4000 });
            const chunks = [];
            for await (const c of dl.content) chunks.push(c);
            item.text = Buffer.concat(chunks).toString('utf8').replace(/\s+/g, ' ').slice(0, 500);
          }
        } catch (e) { /* письмо без текстовой части — оставляем только тему */ }
        out.push(item);
      }
    } finally { lock.release(); }
  } catch (e) { try { await client.logout(); } catch (x) {} return reply(502, { error: 'Mail read failed: ' + e.message }); }
  try { await client.logout(); } catch (x) {}
  return reply(200, { ok: true, messages: out });
}

module.exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod === 'GET') return calendar(event.queryStringParameters || {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Поддерживается только POST' });

  const secret = process.env.APP_SECRET;
  if (!secret) return reply(500, { error: 'В функции не задана переменная APP_SECRET' });

  let req;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    req = JSON.parse(raw);
  } catch (e) {
    return reply(400, { error: 'Тело запроса должно быть JSON' });
  }
  if (!req || req.secret !== secret) return reply(401, { error: 'Неверный код доступа' });
  if (req.ping) return reply(200, { ok: true });   // проверка кода из настроек приложения, без обращения к Алисе
  if (req.mail) return mail(req.mail);
  if (!Array.isArray(req.messages) || !req.messages.length) return reply(400, { error: 'Нет сообщений' });
  if (JSON.stringify(req.messages).length > 200000) return reply(400, { error: 'Слишком длинный запрос' });

  const folder = process.env.FOLDER_ID || (context && context.functionFolderId);
  const token = context && context.token && context.token.access_token;
  const auth = process.env.API_KEY ? 'Api-Key ' + process.env.API_KEY : (token ? 'Bearer ' + token : null);
  if (!auth) return reply(500, { error: 'Функции не назначен сервисный аккаунт' });
  if (!folder) return reply(500, { error: 'Не удалось определить каталог: задайте FOLDER_ID' });

  const payload = {
    model: 'gpt://' + folder + '/' + (process.env.MODEL || 'aliceai-llm'),
    messages: req.messages,
    temperature: 0.4,
    max_tokens: Math.min(Number(req.max_tokens) || 2000, 8000),
  };
  if (Array.isArray(req.tools) && req.tools.length) payload.tools = req.tools;

  try {
    const r = await fetch('https://llm.api.cloud.yandex.net/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(payload),
    });
    return reply(r.status, await r.text());
  } catch (e) {
    return reply(502, { error: 'Нет связи с Alice AI: ' + (e && e.message) });
  }
};
