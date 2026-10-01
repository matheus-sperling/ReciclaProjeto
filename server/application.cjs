const { randomUUID } = require('node:crypto');
const { hashKey, hashPassword, verifyPassword, equalSecret, signSession, verifySession } = require('./security.cjs');
const defaults = require('./config.cjs');
const core = require('../coletor/core.js');
class ApiError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR') { super(message); this.status = status; this.code = code; }
}
const publicUser = ({ id, nome, email, role, municipio, ativo }) => ({ id, nome, email, role, municipio, ativo });
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function text(value, label, max = 120, min = 1) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length < min || result.length > max) throw new ApiError(400, `${label} deve ter de ${min} a ${max} caracteres.`);
  return result;
}
function emailAddress(value) {
  const result = text(value, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new ApiError(400, 'Informe um e-mail válido.');
  return result;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new ApiError(400, 'A senha deve ter de 12 a 128 caracteres.');
  return value;
}
function periodo(inicio, fim) {
  for (const date of [inicio, fim]) {
    if (typeof date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new ApiError(400, 'Período inválido.');
  }
  if (inicio > fim) throw new ApiError(400, 'A data inicial deve ser anterior à data final.');
  return { inicio, fim, de: Date.parse(`${inicio}T00:00:00-04:00`), ate: Date.parse(`${fim}T23:59:59.999-04:00`), rotulo: `${inicio.split('-').reverse().join('/')} a ${fim.split('-').reverse().join('/')}` };
}
function summarize(config, entregas, range) {
  const rows = entregas.filter(r => Date.parse(r.criadoEm) >= range.de && Date.parse(r.criadoEm) <= range.ate);
  const pontos = config.pontos.map(p => ({ ...p, coletas: Object.fromEntries(config.materiais.map(m => [m.id, 0])) }));
  const byId = new Map(pontos.map(p => [p.id, p]));
  for (const r of rows) {
    const p = byId.get(r.pontoId);
    if (p && Object.hasOwn(p.coletas, r.materialId)) p.coletas[r.materialId] += Math.round(r.kg * 1000);
  }
  pontos.forEach(p => Object.keys(p.coletas).forEach(id => { p.coletas[id] /= 1000; }));
  return { ...config, demonstrativo: false, pontos, periodo: { inicio: range.inicio, fim: range.fim, rotulo: range.rotulo }, entregas: rows.length, atualizadoEm: new Date().toISOString() };
}
function createApplication({ store, secret, setupToken, configured = true, missing = [] }) {
  const userKey = email => `users/${hashKey(email)}`;
  async function findUser(email) {
    const normal = await store.read(userKey(email));
    if (normal) return { ...normal, key: userKey(email) };
    const first = await store.read('bootstrap/gestor');
    return first?.value.email === email ? { ...first, key: 'bootstrap/gestor' } : null;
  }
  async function configFor(municipio) {
    const key = `config/${hashKey(municipio.toLowerCase())}`;
    const saved = await store.read(key);
    const config = saved?.value || (municipio === 'Coxim' ? structuredClone(defaults) : { municipio, uf: 'MS', materiais: defaults.materiais, pontos: [] });
    return { config, saved, key };
  }
  async function throttle(key) {
    const bucket = Math.floor(Date.now() / 900000);
    const path = `auth-rates/${hashKey(key + ':' + bucket)}`;
    for (let retry = 0; retry < 5; retry++) {
      const current = await store.read(path);
      if ((current?.value.count || 0) >= 8) throw new ApiError(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.');
      try {
        const value = { count: (current?.value.count || 0) + 1 };
        if (current) await store.replace(path, value, current.etag); else await store.create(path, value);
        return;
      } catch (error) { if (error.code !== 'CONFLICT') throw error; }
    }
    throw new ApiError(503, 'Tente novamente em alguns instantes.');
  }
  async function authenticate(token) {
    let claims;
    try {
      claims = await verifySession(token, secret);
    } catch { throw new ApiError(401, 'Entre novamente para continuar.', 'AUTH_REQUIRED'); }
    const row = await findUser(claims.email);
    if (!row || !row.value.ativo || claims.sub !== row.value.id || claims.version !== row.value.authVersion)
      throw new ApiError(401, 'Entre novamente para continuar.', 'AUTH_REQUIRED');
    return row.value;
  }
  const gestor = user => { if (user.role !== 'gestor') throw new ApiError(403, 'Esta ação está disponível apenas para o gestor.'); };
  const scopePath = (type, user) => `${type}/${hashKey(user.municipio.toLowerCase())}/`;
  async function execute({ action, method = 'GET', body = {}, query = {}, token, ip = 'unknown' }) {
    if (action === 'status' && method === 'GET') {
      if (!configured) return { configured: false, missing };
      return { configured: true, setupNeeded: !(await store.read('bootstrap/gestor')) };
    }
    if (!configured) throw new ApiError(503, 'O armazenamento central ainda precisa ser configurado na Vercel.', 'NOT_CONFIGURED');
    if (action === 'setup' && method === 'POST') {
      await throttle(`setup:${ip}`);
      if (!equalSecret(body.setupToken, setupToken) || (setupToken || '').length < 32) throw new ApiError(403, 'Código de configuração inválido.');
      if (await store.read('bootstrap/gestor')) throw new ApiError(409, 'O primeiro gestor já foi configurado. Entre com sua conta.');
      const email = emailAddress(body.email);
      const user = { id: randomUUID(), nome: text(body.nome, 'Nome', 120, 2), email, role: 'gestor', municipio: text(body.municipio || 'Coxim', 'Município', 80, 2), ativo: true,
        passwordHash: await hashPassword(password(body.password)), authVersion: 1, criadoEm: new Date().toISOString() };
      try { await store.create('bootstrap/gestor', user); }
      catch (error) { if (error.code === 'CONFLICT') throw new ApiError(409, 'O primeiro gestor já foi configurado.'); throw error; }
      return { user: publicUser(user), sessionToken: await signSession(user, secret) };
    }
    if (action === 'login' && method === 'POST') {
      const email = emailAddress(body.email);
      await throttle(`login:${ip}:${email}`);
      const row = await findUser(email);
      const pass = typeof body.password === 'string' && body.password.length <= 128 ? body.password : '';
      const valid = row && await verifyPassword(pass, row.value.passwordHash);
      if (!valid || !row.value.ativo) throw new ApiError(401, 'E-mail ou senha inválidos.');
      return { user: publicUser(row.value), sessionToken: await signSession(row.value, secret) };
    }
    if (action === 'logout' && method === 'POST') return { logout: true };
    const user = await authenticate(token);
    if (action === 'session' && method === 'GET') return { user: publicUser(user) };
    if (action === 'catalogo' && method === 'GET') {
      const { config } = await configFor(user.municipio);
      const moradores = await store.list(scopePath('moradores', user));
      return { ...config, moradores: user.role === 'gestor' ? moradores : moradores.filter(r => r.ativo), user: publicUser(user), atualizadoEm: new Date().toISOString() };
    }
    if (action === 'moradores' && method === 'POST') {
      gestor(user);
      const resident = { id: randomUUID(), nome: text(body.nome, 'Nome', 120, 2), bairro: typeof body.bairro === 'string' ? body.bairro.trim().slice(0, 80) : '', municipio: user.municipio,
        ativo: true, criadoEm: new Date().toISOString() };
      await store.create(scopePath('moradores', user) + resident.id, resident);
      return { morador: resident };
    }
    if (action === 'moradores' && method === 'PATCH') {
      gestor(user);
      if (!uuid(body.id) || typeof body.ativo !== 'boolean') throw new ApiError(400, 'Morador ou situação inválidos.');
      const key = scopePath('moradores', user) + body.id; const current = await store.read(key);
      if (!current) throw new ApiError(404, 'Morador não encontrado.');
      const value = { ...current.value, ativo: body.ativo };
      await store.replace(key, value, current.etag); return { morador: value };
    }
    if (action === 'equipe' && method === 'GET') {
      gestor(user);
      const first = await store.read('bootstrap/gestor');
      const users = [...(await store.list('users/')), ...(first ? [first.value] : [])];
      return { users: users.filter(r => r.municipio === user.municipio).map(publicUser) };
    }
    if (action === 'equipe' && method === 'POST') {
      gestor(user);
      const email = emailAddress(body.email);
      if (await findUser(email)) throw new ApiError(409, 'Este e-mail já possui uma conta.');
      if (!['coletor', 'gestor'].includes(body.role)) throw new ApiError(400, 'Perfil inválido.');
      const account = { id: randomUUID(), nome: text(body.nome, 'Nome', 120, 2), email, role: body.role, municipio: user.municipio, ativo: true,
        passwordHash: await hashPassword(password(body.password)), authVersion: 1, criadoEm: new Date().toISOString() };
      await store.create(userKey(email), account); return { user: publicUser(account) };
    }
    if (action === 'equipe' && method === 'PATCH') {
      gestor(user);
      const row = await findUser(emailAddress(body.email));
      if (!row || row.value.municipio !== user.municipio) throw new ApiError(404, 'Conta não encontrada.');
      const value = { ...row.value };
      if (typeof body.ativo === 'boolean') {
        if (value.id === user.id && !body.ativo) throw new ApiError(400, 'Sua própria conta deve permanecer ativa.');
        value.ativo = body.ativo;
      }
      if (body.password) { value.passwordHash = await hashPassword(password(body.password)); value.authVersion++; }
      await store.replace(row.key, value, row.etag); return { user: publicUser(value) };
    }
    if (action === 'pontos' && method === 'POST') {
      gestor(user);
      const { config, saved, key } = await configFor(user.municipio);
      if ([body.lat, body.lng].some(v => v === null || v === undefined || String(v).trim() === '')) throw new ApiError(400, 'Informe as coordenadas do ponto.');
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 || typeof body.ativo !== 'boolean') throw new ApiError(400, 'Coordenadas ou situação inválidas.');
      const id = body.id ? Number(body.id) : Math.max(0, ...config.pontos.map(p => p.id)) + 1;
      if (!Number.isInteger(id) || id < 1 || (body.id && !config.pontos.some(p => p.id === id))) throw new ApiError(400, 'Ponto inválido.');
      const point = { id, nome: text(body.nome, 'Nome do ponto', 120, 2), local: text(body.local, 'Local', 180, 2), lat, lng, ativo: body.ativo, demonstrativo: false };
      const updated = { ...config, pontos: [...config.pontos.filter(p => p.id !== id), point].sort((a, b) => a.id - b.id) };
      if (saved) await store.replace(key, updated, saved.etag); else await store.create(key, updated);
      return { ponto: point };
    }
    if (action === 'entregas' && method === 'POST') {
      if (!uuid(body.id) || !uuid(body.moradorId)) throw new ApiError(400, 'Identificador de entrega ou morador inválido.');
      if (body.coletorId && body.coletorId !== user.id) throw new ApiError(403, 'Entre na conta que registrou esta entrega para enviá-la.');
      let kg;
      try { kg = core.pesoKg(body.kg); } catch (error) { throw new ApiError(400, error.message); }
      const created = Date.parse(body.criadoEm);
      if (!Number.isFinite(created) || created > Date.now() + 300000 || created < Date.parse('2020-01-01')) throw new ApiError(400, 'Data ou hora da entrega inválida. Confira o relógio do dispositivo.');
      const identity = { id: body.id.toLowerCase(), moradorId: body.moradorId.toLowerCase(), pontoId: Number(body.pontoId), materialId: body.materialId, kg,
        criadoEm: new Date(created).toISOString(), coletorId: user.id, municipio: user.municipio };
      const key = scopePath('entregas', user) + identity.id;
      const previous = await store.read(key);
      const same = value => Object.keys(identity).every(k => value[k] === identity[k]);
      if (previous) {
        if (!same(previous.value)) throw new ApiError(409, 'Este identificador já pertence a outra entrega.');
        return { entrega: previous.value, duplicate: true };
      }
      const { config } = await configFor(user.municipio);
      const material = config.materiais.find(m => m.id === identity.materialId);
      const point = config.pontos.find(p => p.id === identity.pontoId && p.ativo);
      const resident = await store.read(scopePath('moradores', user) + identity.moradorId);
      if (!material || !point) throw new ApiError(400, 'Material ou ponto de coleta indisponível.');
      if (!resident?.value.ativo) throw new ApiError(400, 'Morador não encontrado ou inativo.');
      const record = { ...identity, materialNome: material.nome, pontoNome: point.nome, moradorNome: resident.value.nome, coletorNome: user.nome,
        uf: 'MS', recebidoEm: new Date().toISOString(), status: 'sincronizado' };
      try { await store.create(key, record); }
      catch (error) {
        if (error.code !== 'CONFLICT') throw error;
        const concurrent = await store.read(key);
        if (!concurrent || !same(concurrent.value)) throw new ApiError(409, 'Este identificador já pertence a outra entrega.');
        return { entrega: concurrent.value, duplicate: true };
      }
      return { entrega: record };
    }
    if (action === 'entregas' && method === 'GET') {
      const rows = await store.list(scopePath('entregas', user));
      return { entregas: rows.filter(r => user.role === 'gestor' || r.coletorId === user.id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)) };
    }
    if (action === 'painel' && method === 'GET') {
      gestor(user);
      const { config } = await configFor(user.municipio);
      const range = periodo(query.inicio, query.fim);
      return summarize(config, await store.list(scopePath('entregas', user)), range);
    }
    throw new ApiError(405, 'Ação ou método não permitido.');
  }
  return { execute };
}
module.exports = { createApplication, ApiError, summarize, periodo };
