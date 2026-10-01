import pg from "pg";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.env.DIRECT_URL)
  throw new Error("Defina DIRECT_URL apenas no ambiente de administração.");
const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
try {
  for (const [role, key] of [
    ["recicla_app", "APP_DB_PASSWORD"],
    ["recicla_auth", "AUTH_DB_PASSWORD"],
  ]) {
    const password = process.env[key];
    if (!password || !/^[A-Za-z0-9_-]{32,128}$/.test(password))
      throw new Error(
        `Defina ${key} com 32 a 128 caracteres aleatórios (base64url).`,
      );
    // Identifiers and literals are constrained above; PostgreSQL utility statements do not accept bind parameters.
    await client.query(
      `ALTER ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
    );
  }
  console.log("Credenciais das funções de execução configuradas.");
} finally {
  await client.end();
}
