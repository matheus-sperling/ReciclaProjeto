(function () {
  'use strict';
  const USER_KEY = 'recicla-user-v2';
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }
  async function request(action, options = {}) {
    const url = new URL('/api/recicla', location.origin);
    url.searchParams.set('action', action);
    Object.entries(options.query || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    let response;
    try {
      response = await fetch(url, { method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(45000) });
    } catch { throw new ApiError('Não foi possível conectar ao servidor. Confira a conexão.', 0, 'NETWORK'); }
    let result;
    try { result = await response.json(); } catch { throw new ApiError('O servidor retornou uma resposta inválida.', response.status, 'INVALID_RESPONSE'); }
    if (!response.ok) throw new ApiError(result.error || 'A solicitação não foi concluída.', response.status, result.code);
    return result;
  }
  const cacheUser = user => { localStorage.setItem(USER_KEY, JSON.stringify(user)); return user; };
  const cachedUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } };
  async function session({ offline = false } = {}) {
    try { return cacheUser((await request('session')).user); }
    catch (error) {
      if (offline && error.status === 0) return cachedUser();
      if (error.status === 401) localStorage.removeItem(USER_KEY);
      if (error.status === 401) return null;
      throw error;
    }
  }
  const userPrefix = id => `recicla-v2:${id}:`;
  const read = (id, name, fallback) => { try { return JSON.parse(localStorage.getItem(userPrefix(id) + name)) ?? fallback; } catch { return fallback; } };
  function write(id, name, value) {
    try { localStorage.setItem(userPrefix(id) + name, JSON.stringify(value)); }
    catch { throw new Error('Não há espaço para salvar neste navegador. Exporte o histórico e libere espaço antes de continuar.'); }
    window.dispatchEvent(new Event('recicla-data'));
  }
  async function lock(id, task) {
    if (!navigator.locks) throw new Error('Este navegador não permite proteger a fila de envios. Use uma versão atual do Chrome, Edge, Firefox ou Safari.');
    return navigator.locks.request(`recicla-queue:${id}`, task);
  }
  async function enqueue(user, record) {
    await lock(user.id, async () => {
      const queue = read(user.id, 'outbox', []);
      if (queue.some(r => r.id === record.id)) return;
      if (queue.length >= 500) throw new Error('A fila possui 500 entregas. Conecte-se para enviá-las antes de registrar novas entregas.');
      write(user.id, 'outbox', [...queue, record]);
    });
  }
  async function acknowledge(user, record) {
    await lock(user.id, async () => {
      // Primeiro guarda o recibo. Uma recarga neste ponto só repete o envio,
      // que o servidor reconhece pelo UUID; nenhuma entrega é perdida.
      const receipts = read(user.id, 'receipts', []);
      write(user.id, 'receipts', [record, ...receipts.filter(r => r.id !== record.id)].slice(0, 1000));
      write(user.id, 'outbox', read(user.id, 'outbox', []).filter(r => r.id !== record.id));
    });
  }
  async function markFailure(user, id, message) {
    await lock(user.id, async () => {
      write(user.id, 'outbox', read(user.id, 'outbox', []).map(r => r.id === id ? { ...r, erroEnvio: message } : r));
    });
  }
  function history(user) {
    const byId = new Map(read(user.id, 'receipts', []).map(r => [r.id, r]));
    read(user.id, 'outbox', []).forEach(r => byId.set(r.id, r));
    return [...byId.values()].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
  }
  let syncing = false;
  async function sync(user, onProgress = () => {}) {
    if (syncing || !navigator.onLine) return;
    syncing = true;
    try {
      for (const record of read(user.id, 'outbox', [])) {
        try {
          const result = await request('entregas', { method: 'POST', body: record });
          await acknowledge(user, result.entrega); onProgress(result.entrega);
        } catch (error) {
          if (error.status === 0 || error.status === 401 || error.status >= 500) throw error;
          await markFailure(user, record.id, error.message);
        }
      }
    } finally { syncing = false; }
  }
  function download(payload, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  window.ReciclaAPI = { request, session, cachedUser, cacheUser, read, write, enqueue, sync, history, download,
    pending: user => read(user.id, 'outbox', []),
    async logout() {
      await request('logout', { method: 'POST', body: {} });
      const user = cachedUser();
      if (user) { localStorage.removeItem(userPrefix(user.id) + 'catalog'); localStorage.removeItem(userPrefix(user.id) + 'receipts'); }
      localStorage.removeItem(USER_KEY);
    }, ApiError };
})();
