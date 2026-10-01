const blob = require('@vercel/blob');

function createBlobStore(prefix = process.env.RECICLA_BLOB_PREFIX || 'recicla-v1') {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(prefix)) throw new Error('Prefixo de armazenamento inválido.');
  const pathname = key => `${prefix}/${key}.json`;
  const conflict = error => error instanceof blob.BlobPreconditionFailedError ||
    (error instanceof blob.BlobError && /already exists/i.test(error.message));
  return {
    async read(key) {
      const result = await blob.get(pathname(key), { access: 'private', useCache: false });
      if (!result) return null;
      const value = JSON.parse(await new Response(result.stream).text());
      return { value, etag: result.blob.etag };
    },
    async create(key, value) {
      try {
        return await blob.put(pathname(key), JSON.stringify(value), { access: 'private', addRandomSuffix: false,
          allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 60 });
      } catch (error) { if (conflict(error)) { error.code = 'CONFLICT'; } throw error; }
    },
    async replace(key, value, etag) {
      try {
        return await blob.put(pathname(key), JSON.stringify(value), { access: 'private', addRandomSuffix: false,
          allowOverwrite: true, ifMatch: etag, contentType: 'application/json', cacheControlMaxAge: 60 });
      } catch (error) { if (conflict(error)) { error.code = 'CONFLICT'; } throw error; }
    },
    async list(prefixKey) {
      let cursor;
      const keys = [];
      do {
        const page = await blob.list({ prefix: `${prefix}/${prefixKey}`, limit: 1000, cursor });
        keys.push(...page.blobs.map(item => item.pathname.slice(prefix.length + 1).replace(/\.json$/, '')));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      const rows = [];
      for (let i = 0; i < keys.length; i += 20) {
        const batch = await Promise.all(keys.slice(i, i + 20).map(key => this.read(key)));
        rows.push(...batch.filter(Boolean).map(row => row.value));
      }
      return rows;
    }
  };
}
module.exports = { createBlobStore };
