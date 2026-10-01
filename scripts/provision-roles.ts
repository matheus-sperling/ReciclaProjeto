import pg from "pg";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.env.DIRECT_URL)
  throw new Error("Defina DIRECT_URL apenas no ambiente de administração.");
const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
try {
  await client.query("BEGIN");
  for (const [role, groupRole, key] of [
    ["recicla_app_login", "recicla_app", "APP_DB_PASSWORD"],
    ["recicla_auth_login", "recicla_auth", "AUTH_DB_PASSWORD"],
  ]) {
    const existing = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [role],
    );
    if (existing.rowCount)
      throw new Error(
        `A role ${role} já existe. Faça a rotação por um procedimento administrativo protegido.`,
      );
    const password = process.env[key];
    if (!password || !/^[A-Za-z0-9_-]{32,128}$/.test(password))
      throw new Error(
        `Defina ${key} com 32 a 128 caracteres aleatórios (base64url).`,
      );
    // Identifiers and literals are constrained above; PostgreSQL utility statements do not accept bind parameters.
    await client.query(
      `CREATE ROLE ${role} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
    );
    await client.query(`GRANT ${groupRole} TO ${role}`);
  }
  await client.query("COMMIT");
  console.log("Credenciais das funções de execução configuradas.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
