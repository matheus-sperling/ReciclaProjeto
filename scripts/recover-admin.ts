import { makeClient } from "../server/db.ts";
import { hashPassword } from "better-auth/crypto";
import { senha } from "../shared/validation.ts";
// Recovery is available only with the migration credential, never over HTTP.
if (process.env.ADMIN_RECOVERY_CONFIRM !== "RECUPERAR_ADMINISTRADOR")
  throw new Error("Confirmação explícita ausente.");
if (!process.env.DIRECT_URL)
  throw new Error("Credencial de migrações ausente.");
const password = senha.parse(process.env.ADMIN_PASSWORD),
  db = makeClient(process.env.DIRECT_URL);
try {
  await db.$transaction(async (tx) => {
    const admin = await tx.user.findFirst({
      where: { role: "administrador", deletedAt: null },
    });
    if (!admin) throw new Error("Administrador não encontrado.");
    await tx.session.deleteMany({ where: { userId: admin.id } });
    await tx.twoFactor.deleteMany({ where: { userId: admin.id } });
    await tx.account.updateMany({
      where: { userId: admin.id, providerId: "credential" },
      data: { password: await hashPassword(password) },
    });
    await tx.user.update({
      where: { id: admin.id },
      data: {
        twoFactorEnabled: false,
        mustChangePassword: true,
        ativo: true,
        banned: false,
      },
    });
    await tx.auditoria.create({
      data: {
        actorId: admin.id,
        municipioId: null,
        acao: "administrador.recuperado",
        alvoId: admin.id,
      },
    });
  });
  console.log(
    "Acesso recuperado. Troque a senha e configure um novo autenticador antes de operar.",
  );
} finally {
  delete process.env.ADMIN_PASSWORD;
  await db.$disconnect();
}
