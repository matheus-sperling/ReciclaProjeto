import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { nome, senha } from "../shared/validation.js";
import { authDb } from "./db.js";
import { ApiError } from "./errors.js";
import { limitSetup } from "./limits.js";

export const initialAdministratorSchema = z
  .object({
    name: nome,
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: senha,
  })
  .strict();

function activationToken() {
  // One private variable contains the expiry (milliseconds) and 256 random bits.
  const value = process.env.ADMIN_SETUP_TOKEN || "";
  const match = /^(\d{13})\.([a-f0-9]{64})$/.exec(value);
  if (!match || Number(match[1]) <= Date.now()) return null;
  return { value, expiresAt: new Date(Number(match[1])).toISOString() };
}

export async function setupStatus() {
  // Include inactive/deleted administrators: activation cannot become recovery.
  if (
    await authDb().user.findFirst({
      where: { role: "administrador" },
      select: { id: true },
    })
  )
    return { available: false, reason: "completed" as const };
  const token = activationToken();
  return token
    ? { available: true, expiresAt: token.expiresAt }
    : { available: false, reason: "not_enabled" as const };
}

export async function createInitialAdministrator(
  input: z.infer<typeof initialAdministratorSchema>,
  expiresAt?: string,
) {
  const data = initialAdministratorSchema.parse(input);
  const password = await hashPassword(data.password);
  return authDb().$transaction(
    async (tx) => {
      // Serializes the protected CLI and HTTP flows; the unique index is a second guard.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(726543210)`;
      if (expiresAt && Date.parse(expiresAt) <= Date.now())
        throw new ApiError(
          410,
          "O código de ativação expirou.",
          "SETUP_CLOSED",
        );
      if (
        await tx.user.findFirst({
          where: { role: "administrador" },
          select: { id: true },
        })
      )
        throw new ApiError(
          410,
          "A ativação já foi concluída. Entre com sua conta.",
          "SETUP_CLOSED",
        );
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email,
          role: "administrador",
          municipioId: null,
          mustChangePassword: true,
        },
        select: { id: true },
      });
      await tx.account.create({
        data: {
          userId: user.id,
          accountId: user.id,
          providerId: "credential",
          password,
        },
      });
      await tx.$executeRaw`INSERT INTO "Auditoria" (id,"actorId",acao,"alvoId") VALUES (${randomUUID()}::uuid,${user.id}::uuid,'administrador.criado',${user.id})`;
      return user;
    },
    { timeout: 15000, maxWait: 15000 },
  );
}

export async function activateAdministrator(
  body: Record<string, unknown>,
  clientIp: string,
) {
  const status = await setupStatus();
  if (!status.available)
    throw new ApiError(
      410,
      "A ativação está encerrada ou indisponível. Use a página de acesso.",
      "SETUP_CLOSED",
    );
  const token = activationToken();
  if (!token)
    throw new ApiError(410, "O código de ativação expirou.", "SETUP_CLOSED");
  await limitSetup(clientIp, token.value);
  const input = initialAdministratorSchema
    .extend({
      code: z.string().max(100),
    })
    .strict()
    .parse(body);
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(input.code.trim()), digest(token.value)))
    throw new ApiError(
      403,
      "Código de ativação inválido. Confira o código e tente novamente.",
      "INVALID_SETUP_CODE",
    );
  // The token can expire while the password is being hashed: recheck before writing.
  const { code: _code, ...account } = input;
  await createInitialAdministrator(account, token.expiresAt);
  return { ok: true };
}
