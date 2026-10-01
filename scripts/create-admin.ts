import { hashPassword } from "better-auth/crypto";
import { authDb, disconnect } from "../server/db.ts";
import { nome, senha } from "../shared/validation.ts";
import { z } from "zod";
try {
  process.loadEnvFile(".env.local");
} catch {}
try {
  const name = nome.parse(process.env.ADMIN_NAME),
    email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase(),
    password = senha.parse(process.env.ADMIN_PASSWORD);
  const hash = await hashPassword(password);
  await authDb().$transaction(async (tx) => {
    if (await tx.user.findFirst({ where: { role: "administrador" } }))
      throw new Error(
        "O administrador já existe. Use o procedimento de recuperação.",
      );
    const user = await tx.user.create({
      data: { name, email, role: "administrador", mustChangePassword: false },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hash,
      },
    });
    await tx.$executeRaw`INSERT INTO "Auditoria" (id,"actorId",acao,"alvoId") VALUES (${crypto.randomUUID()}::uuid,${user.id}::uuid,'administrador.criado',${user.id})`;
  });
  console.log(
    "Administrador criado. Configure o autenticador no primeiro acesso.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Falha na configuração.",
  );
  process.exitCode = 1;
} finally {
  delete process.env.ADMIN_PASSWORD;
  await disconnect();
}
