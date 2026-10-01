import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "better-auth/crypto";
import { makeClient, disconnect } from "../server/db";
import { authHandler, domainHandler } from "../server/http";
import { createInitialAdministrator } from "../server/bootstrap";
import { testPassword } from "./fixture";

const owner = makeClient(process.env.TEST_DATABASE_URL!);
const originalToken = process.env.ADMIN_SETUP_TOKEN;
const secret = "b".repeat(64);
let token = "";
let saved: Awaited<ReturnType<typeof snapshot>>;
const createdIds = new Set<string>();
function snapshot() {
  return owner.user.findMany({
    where: { role: "administrador" },
    include: { accounts: true, sessions: true, twoFactor: true },
  });
}
function call(
  path: string,
  body?: unknown,
  ip = "203.0.113.40",
  origin = process.env.APP_ORIGIN!,
) {
  return authHandler(
    new Request(process.env.APP_ORIGIN + "/api/auth/" + path, {
      method: body ? "POST" : "GET",
      headers: { origin, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    ip,
  );
}
function input(overrides: Record<string, unknown> = {}) {
  return {
    code: token,
    name: "Administrador inicial",
    email: "ativacao@teste.invalid",
    password: testPassword,
    ...overrides,
  };
}
async function clearAdministrators() {
  for (const row of await owner.user.findMany({
    where: { role: "administrador" },
    select: { id: true },
  }))
    createdIds.add(row.id);
  await owner.user.deleteMany({ where: { role: "administrador" } });
}
beforeAll(async () => {
  saved = await snapshot();
});
beforeEach(async () => {
  await clearAdministrators();
  await owner.rateLimit.deleteMany({
    where: { key: { startsWith: "setup-" } },
  });
  token = `${Date.now() + 3600000}.${secret}`;
  process.env.ADMIN_SETUP_TOKEN = token;
});
afterAll(async () => {
  await clearAdministrators();
  await owner.auditoria.deleteMany({
    where: {
      actorId: {
        in: [...createdIds].filter((id) => !saved.some((u) => u.id === id)),
      },
    },
  });
  await owner.$transaction(async (tx) => {
    for (const { accounts, sessions, twoFactor, ...user } of saved) {
      await tx.user.create({ data: user });
      if (accounts.length) await tx.account.createMany({ data: accounts });
      if (sessions.length) await tx.session.createMany({ data: sessions });
      if (twoFactor) await tx.twoFactor.create({ data: twoFactor });
    }
  });
  if (originalToken === undefined) delete process.env.ADMIN_SETUP_TOKEN;
  else process.env.ADMIN_SETUP_TOKEN = originalToken;
  await owner.$disconnect();
  await disconnect();
});

describe("Ativação inicial protegida com PostgreSQL real", () => {
  it("fica fechada sem código válido ou depois do prazo", async () => {
    for (const value of ["", "senha-curta", `${Date.now() - 1000}.${secret}`]) {
      process.env.ADMIN_SETUP_TOKEN = value;
      expect(await (await call("setup/status")).json()).toEqual({
        available: false,
        reason: "not_enabled",
      });
      expect((await call("setup/create", input())).status).toBe(410);
    }
    expect(await owner.user.count({ where: { role: "administrador" } })).toBe(
      0,
    );
  });
  it("rejeita origem externa, código errado e alteração de perfil/cidade", async () => {
    expect(
      (
        await call(
          "setup/create",
          input(),
          "203.0.113.41",
          "https://outro.example",
        )
      ).status,
    ).toBe(403);
    const wrong = await call(
      "setup/create",
      input({ code: "codigo-incorreto" }),
    );
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).code).toBe("INVALID_SETUP_CODE");
    expect(
      (
        await call(
          "setup/create",
          input({ role: "administrador", municipioId: crypto.randomUUID() }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await call("setup/create", input({ password: "curta" }))).status,
    ).toBe(400);
    expect(await owner.user.count({ where: { role: "administrador" } })).toBe(
      0,
    );
  });
  it("limita tentativas por IP e guarda somente chaves derivadas", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++)
      statuses.push(
        (await call("setup/create", input({ code: "errado" }))).status,
      );
    expect(statuses.slice(0, 8)).toEqual(Array(8).fill(403));
    expect(statuses[8]).toBe(429);
    const limits = await owner.rateLimit.findMany({
      where: { key: { startsWith: "setup-" } },
    });
    for (const row of limits) {
      expect(row.key).not.toContain(token);
      expect(row.key).not.toContain("203.0.113.40");
    }
  });
  it("limita tentativas distribuídas por instalação", async () => {
    for (let i = 0; i < 64; i++)
      expect(
        (
          await call(
            "setup/create",
            input({ code: "errado" }),
            `203.0.113.${i}`,
          )
        ).status,
      ).toBe(403);
    expect((await call("setup/create", input(), "203.0.113.200")).status).toBe(
      429,
    );
  });
  it("cria conta e auditoria, sem segredo na resposta, e exige o primeiro acesso", async () => {
    const status = await call("setup/status");
    expect(status.headers.get("cache-control")).toBe("no-store");
    expect(await status.json()).toEqual({
      available: true,
      expiresAt: new Date(Number(token.split(".")[0])).toISOString(),
    });
    const response = await call("setup/create", input());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    const user = (await owner.user.findFirst({
      where: { role: "administrador" },
      include: { accounts: true },
    }))!;
    expect(user.municipioId).toBeNull();
    expect(user.mustChangePassword).toBe(true);
    expect(user.twoFactorEnabled).toBe(false);
    expect(
      await verifyPassword({
        hash: user.accounts[0].password!,
        password: testPassword,
      }),
    ).toBe(true);
    const audit = await owner.auditoria.findMany({
      where: { actorId: user.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].acao).toBe("administrador.criado");
    expect(JSON.stringify(audit)).not.toContain(token);
    const login = await call("sign-in/email", {
      email: user.email,
      password: testPassword,
    });
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const operation = await domainHandler(
      new Request(process.env.APP_ORIGIN + "/api/recicla?action=municipios", {
        headers: { cookie },
      }),
    );
    expect(operation.status).toBe(403);
    expect(await (await call("setup/status")).json()).toEqual({
      available: false,
      reason: "completed",
    });
    expect((await call("setup/create", input())).status).toBe(410);
  });
  it("pedidos simultâneos criam somente um administrador", async () => {
    const responses = await Promise.all([
      call("setup/create", input({ email: "primeiro@teste.invalid" })),
      call(
        "setup/create",
        input({ email: "segundo@teste.invalid" }),
        "203.0.113.42",
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 410]);
    expect(await owner.user.count({ where: { role: "administrador" } })).toBe(
      1,
    );
  });
  it("não reabre a ativação quando o administrador está inativo ou removido", async () => {
    expect((await call("setup/create", input())).status).toBe(201);
    await owner.user.updateMany({
      where: { role: "administrador" },
      data: { ativo: false, deletedAt: new Date() },
    });
    expect(
      (await call("setup/create", input({ email: "outro@teste.invalid" })))
        .status,
    ).toBe(410);
    expect(await owner.user.count({ where: { role: "administrador" } })).toBe(
      1,
    );
  });
  it("confere a validade novamente na transação antes de gravar", async () => {
    await expect(
      createInitialAdministrator(
        {
          name: "Administrador inicial",
          email: "expirou@teste.invalid",
          password: testPassword,
        },
        new Date(Date.now() - 1000).toISOString(),
      ),
    ).rejects.toMatchObject({ code: "SETUP_CLOSED" });
    expect(await owner.user.count({ where: { role: "administrador" } })).toBe(
      0,
    );
  });
});
