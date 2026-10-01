const { createBlobStore } = require('../server/blob.cjs');
const { createApplication, ApiError } = require('../server/application.cjs');

function createHandler(options = {}) { return async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const method = req.method || 'GET';
  const host = req.headers.host;
  if (!['GET', 'POST', 'PATCH'].includes(method)) { res.statusCode = 405; res.end(JSON.stringify({ error: 'Método não permitido.' })); return; }
  if (method !== 'GET') {
    const origin = req.headers.origin;
    try { if (!origin || new URL(origin).host !== host) throw new Error(); }
    catch { res.statusCode = 403; res.end(JSON.stringify({ error: 'Origem da solicitação inválida.' })); return; }
  }
  const url = new URL(req.url, `https://${host}`);
  const missing = [];
  if (!process.env.BLOB_READ_WRITE_TOKEN && !(process.env.BLOB_STORE_ID && process.env.VERCEL_OIDC_TOKEN)) missing.push('Blob privado conectado ao projeto');
  if ((process.env.AUTH_SECRET || '').length < 32) missing.push('AUTH_SECRET');
  const app = createApplication({ store: options.store || createBlobStore(), secret: options.secret || process.env.AUTH_SECRET,
    setupToken: options.setupToken || process.env.RECICLA_SETUP_TOKEN, configured: options.store ? true : missing.length === 0, missing });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Dados inválidos.');
    if (JSON.stringify(body).length > 65536) throw new ApiError(413, 'Solicitação muito grande.');
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')));
    const result = await app.execute({ action: url.searchParams.get('action'), method, body,
      query: Object.fromEntries(url.searchParams), token: cookies.recicla_session,
      ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim() });
    const secure = process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
    if (result.sessionToken) {
      res.setHeader('Set-Cookie', `recicla_session=${result.sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
      delete result.sessionToken;
    }
    if (result.logout) res.setHeader('Set-Cookie', `recicla_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch (error) {
    const status = error instanceof ApiError ? error.status : error.code === 'CONFLICT' ? 409 : error instanceof SyntaxError ? 400 : 503;
    const message = error instanceof ApiError ? error.message : status === 409 ? 'Os dados foram alterados por outra pessoa. Atualize e tente novamente.' : status === 400 ? 'Dados inválidos.' : 'Não foi possível acessar o armazenamento central. Tente novamente.';
    if (status === 503) console.error('recicla-api', { action: url.searchParams.get('action'), type: error.name });
    res.statusCode = status; res.end(JSON.stringify({ error: message, code: error.code || 'SERVICE_ERROR' }));
  }
}; }
module.exports = createHandler();
module.exports.createHandler = createHandler;
