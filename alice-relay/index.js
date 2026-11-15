/*
 * Посредник для приложения «Мой день».
 * Принимает запрос ИИ-тренера с телефона и передаёт его в Alice AI (Yandex AI Studio).
 * Нужен потому, что API Яндекса не принимает запросы напрямую из веб-страницы.
 *
 * Среда выполнения: Node.js 18 или новее. Точка входа: index.handler
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

// GET ?cal=1&w=0730,0900&m=0730,1300,1630,1830 — файл календаря с ежедневными напоминаниями
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
  lines.push('END:VCALENDAR');
  return { statusCode: 200, headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="moy-den.ics"' }, body: lines.join('\r\n') };
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
