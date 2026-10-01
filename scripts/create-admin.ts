import { hashPassword } from "better-auth/crypto";
import { authDb, disconnect } from "../server/db.js";
import { nome, senha } from "../shared/validation.js";
import { z } from "zod";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
try {
  process.loadEnvFile(".env.local");
} catch {}

async function interactive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Abra um terminal pessoal para usar o modo interativo.");
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!hidden) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const input = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  const ask = async (label: string, secret = false) => {
    if (!secret) return input.question(label);
    process.stdout.write(label);
    hidden = true;
    try {
      return await input.question("");
    } finally {
      hidden = false;
      process.stdout.write("\n");
    }
  };
  try {
    console.log("Criação protegida do administrador inicial do Recicla+.");
    const defaultName = process.env.ADMIN_NAME || "Administrador";
    const defaultEmail = process.env.ADMIN_EMAIL || "";
    process.env.ADMIN_NAME =
      (await ask(`Nome [${defaultName}]: `)).trim() || defaultName;
    process.env.ADMIN_EMAIL =
      (
        await ask(defaultEmail ? `E-mail [${defaultEmail}]: ` : "E-mail: ")
      ).trim() || defaultEmail;
    process.env.AUTH_DATABASE_URL = (
      await ask("Conexão PostgreSQL do Neon (digitação oculta): ", true)
    ).trim();
    const password = await ask(
      "Senha temporária (mínimo 12 caracteres, digitação oculta): ",
      true,
    );
    if (
      password !==
      (await ask("Confirme a senha temporária (digitação oculta): ", true))
    )
      throw new Error("As senhas não coincidem. Execute novamente.");
    process.env.ADMIN_PASSWORD = password;
  } finally {
    input.close();
    output.end();
  }
}

try {
  if (process.argv.includes("--interactive")) await interactive();
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
      data: { name, email, role: "administrador", mustChangePassword: true },
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
    "Administrador criado. Troque a senha temporária e configure o autenticador no primeiro acesso.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Falha na configuração.",
  );
  process.exitCode = 1;
} finally {
  delete process.env.ADMIN_PASSWORD;
  if (process.argv.includes("--interactive")) {
    delete process.env.AUTH_DATABASE_URL;
    delete process.env.ADMIN_NAME;
    delete process.env.ADMIN_EMAIL;
  }
  await disconnect();
}
