import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { User } from "../shared/contracts.js";
let appClient: PrismaClient | undefined, authClient: PrismaClient | undefined;
export function makeClient(url: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 5 }),
  });
}
export function appDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  return (appClient ??= makeClient(process.env.DATABASE_URL));
}
export function authDb() {
  if (!process.env.AUTH_DATABASE_URL)
    throw new Error("AUTH_DATABASE_NOT_CONFIGURED");
  return (authClient ??= makeClient(process.env.AUTH_DATABASE_URL));
}
export async function disconnect() {
  await Promise.all([appClient?.$disconnect(), authClient?.$disconnect()]);
  appClient = undefined;
  authClient = undefined;
}
export async function scoped<T>(
  db: PrismaClient,
  actor: User,
  municipioId: string | null,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('recicla.user_id', ${actor.id}, true), set_config('recicla.municipio_id', ${municipioId ?? ""}, true), set_config('recicla.role', ${actor.role}, true)`;
      return work(tx);
    },
    { timeout: 15000, maxWait: 15000 },
  );
}
let rolesVerified: Promise<void> | undefined;
export function verifyRuntimeRoles() {
  return (rolesVerified ??= (async () => {
    const rows = await appDb().$queryRaw<
      Array<{
        rolname: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolbypassrls: boolean;
        rolinherit: boolean;
        rolreplication: boolean;
        app_role_member: boolean;
        owns: boolean;
      }>
    >`
      SELECT r.rolname,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
        r.rolbypassrls,r.rolinherit,r.rolreplication,
        pg_has_role(r.oid,'recicla_app','USAGE') AS app_role_member,
        EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid) AS owns
      FROM pg_roles r
      WHERE r.rolname=current_user AND r.rolname='recicla_app_login'`;
    if (
      rows.length !== 1 ||
      rows[0].rolsuper ||
      rows[0].rolcreatedb ||
      rows[0].rolcreaterole ||
      rows[0].rolbypassrls ||
      !rows[0].rolinherit ||
      rows[0].rolreplication ||
      !rows[0].app_role_member ||
      rows[0].owns
    )
      throw new Error("UNSAFE_DATABASE_ROLE");
    const auth = await authDb().$queryRaw<
      Array<{
        rolname: string;
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolbypassrls: boolean;
        rolinherit: boolean;
        rolreplication: boolean;
        auth_role_member: boolean;
        owns: boolean;
      }>
    >`
      SELECT r.rolname,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
        r.rolbypassrls,r.rolinherit,r.rolreplication,
        pg_has_role(r.oid,'recicla_auth','USAGE') AS auth_role_member,
        EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid) AS owns
      FROM pg_roles r
      WHERE r.rolname=current_user AND r.rolname='recicla_auth_login'`;
    if (
      auth.length !== 1 ||
      auth[0].rolsuper ||
      auth[0].rolcreatedb ||
      auth[0].rolcreaterole ||
      auth[0].rolbypassrls ||
      !auth[0].rolinherit ||
      auth[0].rolreplication ||
      !auth[0].auth_role_member ||
      auth[0].owns
    )
      throw new Error("UNSAFE_AUTH_DATABASE_ROLE");
  })().catch((error) => {
    rolesVerified = undefined;
    throw error;
  }));
}
