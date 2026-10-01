import { afterAll, describe, it, expect } from "vitest";
import { authHandler, domainHandler } from "../server/http";
import { makeClient, disconnect } from "../server/db";
import { actor, ids, testPassword } from "./fixture";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
const owner = makeClient(process.env.TEST_DATABASE_URL!);
class Browser {
  cookies = new Map<string, string>();
  async call(
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
    origin = process.env.APP_ORIGIN!,
  ) {
    const headers = new Headers({
      origin,
      cookie: [...this.cookies].map(([k, v]) => k + "=" + v).join("; "),
    });
    if (body) headers.set("content-type", "application/json");
    const request = new Request(process.env.APP_ORIGIN + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const response = await (path.startsWith("/api/auth/")
      ? authHandler(request, "127.0.0.1")
      : domainHandler(request));
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(";")[0],
        i = first.indexOf("=");
      this.cookies.set(first.slice(0, i), first.slice(i + 1));
    }
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  }
  login(email = actor("gestor").email, password = testPassword) {
    return this.call("/api/auth/sign-in/email", { email, password });
  }
}
afterAll(async () => {
  await owner.$disconnect();
  await disconnect();
});
describe("Autenticação e revogação reais", () => {
  it("bloqueia cadastro público, endpoints administrativos e origem externa", async () => {
    const b = new Browser();
    expect(
      (
        await b.call("/api/auth/sign-up/email", {
          email: "x@teste.invalid",
          password: testPassword,
          name: "Teste",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await b.call("/api/auth/admin/create-user", {
          email: "x@teste.invalid",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await b.call(
          "/api/auth/sign-in/email",
          { email: actor("gestor").email, password: testPassword },
          "POST",
          "https://outro.example",
        )
      ).status,
    ).toBe(403);
  });
  it("usa cookies HttpOnly e não expõe token de sessão no JSON", async () => {
    const b = new Browser(),
      r = await b.login();
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(r.headers.get("set-cookie")).toMatch(/SameSite=Strict/i);
    expect(r.data.token).toBeUndefined();
    expect(
      (await b.call("/api/recicla?action=session")).data.user.municipioId,
    ).toBe(ids.a);
    expect(
      (await b.call("/api/recicla?action=moradores&municipioId=" + ids.b))
        .status,
    ).toBe(403);
  });
  it("logout invalida imediatamente um cookie copiado", async () => {
    const b = new Browser();
    await b.login();
    const old = new Browser();
    old.cookies = new Map(b.cookies);
    expect((await b.call("/api/auth/sign-out", {})).status).toBe(200);
    expect((await old.call("/api/recicla?action=session")).status).toBe(401);
  });
  it("desativação da conta e do município bloqueiam a sessão existente", async () => {
    const b = new Browser();
    await b.login();
    await owner.user.update({ where: { id: ids.ga }, data: { ativo: false } });
    try {
      expect((await b.call("/api/recicla?action=session")).status).toBe(401);
    } finally {
      await owner.user.update({ where: { id: ids.ga }, data: { ativo: true } });
    }
    await owner.municipio.update({
      where: { id: ids.a },
      data: { ativo: false },
    });
    try {
      expect((await b.call("/api/recicla?action=session")).status).toBe(401);
    } finally {
      await owner.municipio.update({
        where: { id: ids.a },
        data: { ativo: true },
      });
    }
  });
  it("primeiro acesso só permite trocar senha; redefinição e exclusão revogam sessões", async () => {
    const manager = new Browser();
    await manager.login();
    const created = await manager.call("/api/recicla?action=equipe", {
      nome: "Coletor de teste",
      email: "reset@teste.invalid",
      role: "coletor",
    });
    expect(created.status).toBe(200);
    const user = new Browser();
    expect(
      (await user.login("reset@teste.invalid", created.data.temporaryPassword))
        .status,
    ).toBe(200);
    expect((await user.call("/api/recicla?action=catalogo")).status).toBe(403);
    expect(
      (
        await user.call("/api/recicla?action=trocarSenha", {
          senhaAtual: created.data.temporaryPassword,
          novaSenha: testPassword,
        })
      ).status,
    ).toBe(200);
    expect((await user.call("/api/recicla?action=catalogo")).status).toBe(200);
    expect(
      (
        await manager.call(
          "/api/recicla?action=equipe",
          { id: created.data.user.id, redefinirSenha: true },
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect((await user.call("/api/recicla?action=session")).status).toBe(401);
    await manager.call(
      "/api/recicla?action=equipe",
      { id: created.data.user.id, excluir: true },
      "PATCH",
    );
    expect(
      (await owner.user.findUnique({ where: { id: created.data.user.id } }))
        ?.deletedAt,
    ).not.toBeNull();
  });
  it("exige TOTP para o administrador e códigos de recuperação funcionam", async () => {
    const b = new Browser();
    expect((await b.login("administrador@teste.invalid")).status).toBe(200);
    expect((await b.call("/api/recicla?action=municipios")).status).toBe(403);
    const enabled = await b.call("/api/auth/two-factor/enable", {
      password: testPassword,
    });
    expect(enabled.status).toBe(200);
    const uri = new URL(enabled.data.totpURI),
      secret = uri.searchParams.get("secret")!;
    const code = await createOTP(
      new TextDecoder().decode(base32.decode(secret)),
      { digits: 6, period: 30 },
    ).totp();
    expect(
      (await b.call("/api/auth/two-factor/verify-totp", { code })).status,
    ).toBe(200);
    expect((await b.call("/api/recicla?action=municipios")).status).toBe(200);
    expect(
      (await b.call("/api/auth/two-factor/disable", { password: testPassword }))
        .status,
    ).toBe(403);
    await b.call("/api/auth/sign-out", {});
    const fresh = new Browser();
    expect(
      (await fresh.login("administrador@teste.invalid")).data.twoFactorRedirect,
    ).toBe(true);
    expect((await fresh.call("/api/recicla?action=municipios")).status).toBe(
      401,
    );
    expect(
      (
        await fresh.call("/api/auth/two-factor/verify-backup-code", {
          code: enabled.data.backupCodes[0],
        })
      ).status,
    ).toBe(200);
    expect((await fresh.call("/api/recicla?action=municipios")).status).toBe(
      200,
    );
  });
});
