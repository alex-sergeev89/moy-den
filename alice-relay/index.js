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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
const reply = (status, body) => ({
  statusCode: status,
  headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, CORS),
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

module.exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
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
    max_tokens: 2000,
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
