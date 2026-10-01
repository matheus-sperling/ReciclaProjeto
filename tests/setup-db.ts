import { Client } from "pg";
import { readFile } from "node:fs/promises";
import { makeClient } from "../server/db.ts";
import { hashPassword } from "better-auth/crypto";
import { ids, actor, testPassword } from "./fixture.ts";
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("Informe TEST_DATABASE_URL de um banco descartável.");
const parsed = new URL(url);
if (
  !parsed.pathname.startsWith("/recicla_test") ||
  !["127.0.0.1", "localhost", "postgres"].includes(parsed.hostname)
)
  throw new Error("Preparação permitida apenas no banco local recicla_test.");
const owner = new Client({ connectionString: url });
await owner.connect();
try {
  await owner.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  for (const migration of ["202610010001_initial", "202610010002_security"])
    await owner.query(
      await readFile(
        new URL(
          "../prisma/migrations/" + migration + "/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  await owner.query(
    "ALTER ROLE recicla_app LOGIN PASSWORD 'teste-app-local'; ALTER ROLE recicla_auth LOGIN PASSWORD 'teste-auth-local'",
  );
} finally {
  await owner.end();
}
const db = makeClient(url),
  password = await hashPassword(testPassword);
try {
  await db.municipio.createMany({
    data: [
      { id: ids.a, nome: "Coxim", nomeNormalizado: "coxim", uf: "MS" },
      {
        id: ids.b,
        nome: "Campo Grande",
        nomeNormalizado: "campo grande",
        uf: "MS",
      },
    ],
  });
  for (const role of ["gestor", "coletor"] as const)
    for (const city of ["a", "b"] as const) {
      const u = actor(role, city);
      await db.user.create({
        data: {
          id: u.id,
          name: u.nome,
          email: u.email,
          role,
          municipioId: u.municipioId,
          mustChangePassword: false,
          accounts: {
            create: { accountId: u.id, providerId: "credential", password },
          },
        },
      });
    }
  await db.user.create({
    data: {
      id: ids.admin,
      name: "Administrador",
      email: "administrador@teste.invalid",
      role: "administrador",
      mustChangePassword: false,
      accounts: {
        create: { accountId: ids.admin, providerId: "credential", password },
      },
    },
  });
  await db.morador.createMany({
    data: [
      {
        id: ids.ra,
        municipioId: ids.a,
        nome: "Ana da Silva",
        bairro: "Centro",
      },
      {
        id: ids.rb,
        municipioId: ids.b,
        nome: "Bruno Santos",
        bairro: "Vila Nova",
      },
    ],
  });
  await db.ponto.createMany({
    data: [
      {
        id: ids.pa,
        municipioId: ids.a,
        nome: "PEV Centro",
        local: "Praça central",
        lat: -18.506,
        lng: -54.755,
      },
      {
        id: ids.pb,
        municipioId: ids.b,
        nome: "PEV Parque",
        local: "Parque municipal",
        lat: -20.469,
        lng: -54.62,
      },
    ],
  });
  console.log(
    "Banco local de testes preparado: dois municípios, gestores, coletores e cadastros.",
  );
} finally {
  await db.$disconnect();
}
