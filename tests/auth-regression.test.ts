import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { hashPassword } from "better-auth/crypto";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { authDb, disconnect, makeClient } from "../server/db";
import { authHandler, domainHandler } from "../server/http";
import { ids, testPassword } from "./fixture";

const owner = makeClient(process.env.TEST_DATABASE_URL!);
const created: string[] = [];
let passwordHash: string,
  nextIp = 1;
const ipPrefix = randomUUID().replace(/-/g, "").slice(0, 10);
const uniqueIp = () =>
  `fd${ipPrefix.slice(0, 2)}:${ipPrefix.slice(2, 6)}:${ipPrefix.slice(6)}:${(nextIp++).toString(16)}::1`;
class Browser {
  cookies = new Map<string, string>();
  constructor(public clientIp = uniqueIp()) {}
  async call(
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    const headers = new Headers({
      origin: process.env.APP_ORIGIN!,
      cookie: [...this.cookies]
        .map(([key, value]) => `${key}=${value}`)
        .join("; "),
      ...extraHeaders,
    });
    if (body !== undefined) headers.set("content-type", "application/json");
    const request = new Request(process.env.APP_ORIGIN + path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await (path.startsWith("/api/auth/")
      ? authHandler(request, this.clientIp)
      : domainHandler(request, this.clientIp));
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(";")[0],
        separator = first.indexOf("=");
      this.cookies.set(first.slice(0, separator), first.slice(separator + 1));
    }
    return { status: response.status, data: await response.json() };
  }
  login(email: string, password = testPassword) {
    return this.call("/api/auth/sign-in/email", { email, password });
  }
  copy() {
    const other = new Browser();
    other.cookies = new Map(this.cookies);
    return other;
  }
}
async function account(mustChangePassword = false) {
  const id = randomUUID();
  created.push(id);
  return owner.user.create({
    data: {
      id,
      name: "Regressão de segurança",
      email: `regression-${id}@teste.invalid`,
      role: "gestor",
      municipioId: ids.a,
      mustChangePassword,
      accounts: {
        create: {
          accountId: id,
          providerId: "credential",
          password: passwordHash,
        },
      },
    },
  });
}
async function factorCode(uri: string) {
  const secret = new URL(uri).searchParams.get("secret")!;
  return createOTP(new TextDecoder().decode(base32.decode(secret)), {
    digits: 6,
    period: 30,
  }).totp();
}
async function enroll(browser: Browser, password = testPassword) {
  browser.clientIp = uniqueIp();
  const enabled = await browser.call("/api/auth/two-factor/enable", {
    password,
  });
  expect(enabled.status).toBe(200);
  const confirmed = await browser.call("/api/auth/two-factor/verify-totp", {
    code: await factorCode(enabled.data.totpURI),
  });
  expect(confirmed.status).toBe(200);
  return enabled.data.backupCodes as string[];
}
beforeAll(async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  if (
    !["localhost", "127.0.0.1", "postgres"].includes(url.hostname) ||
    !url.pathname.startsWith("/recicla_test")
  )
    throw new Error(
      "Regressões permitidas somente no PostgreSQL local descartável.",
    );
  passwordHash = await hashPassword(testPassword);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (created.length) {
    await owner.verification.deleteMany({
      where: { OR: created.map((id) => ({ value: { startsWith: id + ":" } })) },
    });
    await owner.user.deleteMany({ where: { id: { in: created.splice(0) } } });
  }
});
afterAll(async () => {
  await owner.$disconnect();
  await disconnect();
});

describe("Regressões de senha e MFA com PostgreSQL real", () => {
  it("rejeita a mesma senha sem liberar o primeiro acesso ou alterar a credencial", async () => {
    const user = await account(true),
      browser = new Browser();
    expect((await browser.login(user.email)).status).toBe(200);
    const rejected = await browser.call("/api/recicla?action=trocarSenha", {
      senhaAtual: testPassword,
      novaSenha: testPassword,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.data.error).toMatch(/diferente/);
    expect(
      (
        await browser.call("/api/recicla?action=trocarSenha", {
          senhaAtual: testPassword,
          novaSenha: testPassword.replace("T", "Ｔ"),
        })
      ).status,
    ).toBe(400);
    expect(
      (await owner.user.findUniqueOrThrow({ where: { id: user.id } }))
        .mustChangePassword,
    ).toBe(true);
    expect((await browser.call("/api/recicla?action=catalogo")).status).toBe(
      403,
    );
    const newPassword = testPassword + "-pessoal";
    expect(
      (
        await browser.call("/api/recicla?action=trocarSenha", {
          senhaAtual: testPassword,
          novaSenha: newPassword,
        })
      ).status,
    ).toBe(200);
    expect((await browser.call("/api/recicla?action=catalogo")).status).toBe(
      200,
    );
    expect(
      (
        await browser.call("/api/recicla?action=trocarSenha", {
          senhaAtual: newPassword,
          novaSenha: newPassword,
        })
      ).status,
    ).toBe(400);
  });

  it("limita atomicamente a troca por conta mesmo com requisições simultâneas de IPs diferentes", async () => {
    const user = await account(),
      browser = new Browser();
    expect((await browser.login(user.email)).status).toBe(200);
    const responses = await Promise.all(
      Array.from({ length: 9 }, () => {
        const attempt = browser.copy();
        return attempt.call("/api/recicla?action=trocarSenha", {
          senhaAtual: "Palpite-incorreto-de-senha",
          novaSenha: testPassword + "-nova",
        });
      }),
    );
    expect(responses.filter((result) => result.status === 400)).toHaveLength(8);
    expect(responses.filter((result) => result.status === 429)).toHaveLength(1);
    expect((await browser.call("/api/recicla?action=session")).status).toBe(
      200,
    );
  });

  it("limita o IP confiável mesmo alternando contas e forjando cabeçalhos de IP", async () => {
    const sharedIp = uniqueIp();
    for (let userIndex = 0; userIndex < 5; userIndex++) {
      const user = await account(),
        browser = new Browser();
      expect((await browser.login(user.email)).status).toBe(200);
      browser.clientIp = sharedIp;
      for (let attempt = 0; attempt < (userIndex === 4 ? 1 : 8); attempt++) {
        const result = await browser.call(
          "/api/recicla?action=trocarSenha",
          {
            senhaAtual: "Palpite-incorreto-de-senha",
            novaSenha: testPassword + "-nova",
          },
          { "x-recicla-client-ip": uniqueIp(), "x-forwarded-for": uniqueIp() },
        );
        expect(result.status).toBe(userIndex === 4 ? 429 : 400);
      }
    }
  });

  it("matrícula de MFA revoga sessões antigas e só libera a sessão que confirmou o fator", async () => {
    const user = await account(),
      confirmed = new Browser(),
      old = new Browser();
    expect((await confirmed.login(user.email)).status).toBe(200);
    expect((await old.login(user.email)).status).toBe(200);
    await enroll(confirmed);
    expect((await confirmed.call("/api/recicla?action=catalogo")).status).toBe(
      200,
    );
    expect((await old.call("/api/recicla?action=session")).status).toBe(401);
    expect((await old.call("/api/recicla?action=catalogo")).status).toBe(401);
    const sessions = await owner.session.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(1);
    const proof = await owner.verification.findFirstOrThrow({
      where: { identifier: "recicla:mfa-session:" + sessions[0].id },
    });
    expect(proof.expiresAt.getTime()).toBeLessThanOrEqual(
      sessions[0].expiresAt.getTime(),
    );
    await owner.verification.update({
      where: { id: proof.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await confirmed.call("/api/recicla?action=session")).status).toBe(
      401,
    );
  });

  it("login iniciado antes da matrícula e concluído depois não recebe prova de MFA", async () => {
    const user = await account(),
      confirmed = new Browser(),
      late = new Browser();
    expect((await confirmed.login(user.email)).status).toBe(200);
    const enabled = await confirmed.call("/api/auth/two-factor/enable", {
      password: testPassword,
    });
    expect(enabled.status).toBe(200);
    const entered = Promise.withResolvers<void>(),
      resume = Promise.withResolvers<void>();
    const delegate = authDb().user;
    const original = delegate.findUnique.bind(delegate);
    // Pause the real sign-in at its session hook after its credential/user read.
    const spy = vi
      .spyOn(delegate, "findUnique")
      .mockImplementationOnce(async (args) => {
        const result = await original(args);
        entered.resolve();
        await resume.promise;
        return result;
      });
    const pendingLogin = late.login(user.email);
    try {
      await entered.promise;
      expect(
        (
          await confirmed.call("/api/auth/two-factor/verify-totp", {
            code: await factorCode(enabled.data.totpURI),
          })
        ).status,
      ).toBe(200);
    } finally {
      resume.resolve();
      spy.mockRestore();
    }
    expect((await pendingLogin).status).toBe(200);
    expect((await late.call("/api/recicla?action=session")).status).toBe(401);
    expect((await confirmed.call("/api/recicla?action=catalogo")).status).toBe(
      200,
    );
  });

  it("preserva MFA na rotação da senha e em um novo login com código de recuperação", async () => {
    const user = await account(),
      browser = new Browser();
    expect((await browser.login(user.email)).status).toBe(200);
    const backupCodes = await enroll(browser);
    const old = browser.copy(),
      newPassword = testPassword + "-pessoal";
    expect(
      (
        await browser.call("/api/recicla?action=trocarSenha", {
          senhaAtual: testPassword,
          novaSenha: newPassword,
        })
      ).status,
    ).toBe(200);
    expect((await old.call("/api/recicla?action=session")).status).toBe(401);
    expect((await browser.call("/api/recicla?action=catalogo")).status).toBe(
      200,
    );
    expect((await browser.call("/api/auth/sign-out", {})).status).toBe(200);
    const fresh = new Browser();
    expect(
      (await fresh.login(user.email, newPassword)).data.twoFactorRedirect,
    ).toBe(true);
    expect((await fresh.call("/api/recicla?action/session")).status).toBe(401);
    expect(
      (
        await fresh.call("/api/auth/two-factor/verify-backup-code", {
          code: backupCodes[0],
        })
      ).status,
    ).toBe(200);
    expect((await fresh.call("/api/recicla?action=catalogo")).status).toBe(200);
  });

  it("desativação e nova matrícula removem provas e sessões do fator antigo", async () => {
    const user = await account(),
      browser = new Browser();
    expect((await browser.login(user.email)).status).toBe(200);
    await enroll(browser);
    const old = browser.copy();
    const oldFactor = await owner.twoFactor.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(
      (
        await browser.call("/api/auth/two-factor/disable", {
          password: testPassword,
        })
      ).status,
    ).toBe(200);
    expect(
      await owner.verification.count({
        where: { value: { startsWith: user.id + ":" } },
      }),
    ).toBe(0);
    expect((await old.call("/api/recicla?action=session")).status).toBe(401);
    expect((await browser.call("/api/recicla?action=catalogo")).status).toBe(
      200,
    );
    await enroll(browser);
    const newFactor = await owner.twoFactor.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(newFactor.id).not.toBe(oldFactor.id);
    expect((await old.call("/api/recicla?action=session")).status).toBe(401);
    expect((await browser.call("/api/recicla?action=catalogo")).status).toBe(
      200,
    );
  });
});
