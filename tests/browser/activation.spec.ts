import { test, expect } from "@playwright/test";
import { makeClient } from "../../server/db";
import { testPassword } from "../fixture";

for (const width of [1440, 320, 360, 390, 430])
  for (const theme of ["light", "dark"]) {
    test(`Ativação · ${width}px · ${theme}`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: {
          width,
          height: width < 700 ? Math.round(width * 2.16) : 1100,
        },
        isMobile: width < 700,
        hasTouch: width < 700,
      });
      await context.addInitScript(
        (value) => localStorage.setItem("recicla-theme", value),
        theme,
      );
      // Only presentation is simulated here; creation/security are tested against real PostgreSQL below.
      await context.route("**/api/auth/setup/status", (route) =>
        route.fulfill({ json: { available: true } }),
      );
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/ativar");
      await expect(
        page.getByRole("heading", { name: "Ative seu Recicla+" }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Código de ativação", { exact: true }),
      ).toHaveAttribute("type", "password");
      await expect(
        page.getByRole("button", {
          name: theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro",
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/activation-${width}-${theme}.png`,
        fullPage: true,
      });
      await page
        .getByLabel("Código de ativação", { exact: true })
        .fill("codigo-de-teste");
      await page
        .getByLabel("Seu nome", { exact: true })
        .fill("Teste de interface");
      await page
        .getByLabel("Seu e-mail", { exact: true })
        .fill("teste@teste.invalid");
      await page
        .getByLabel("Senha inicial", { exact: true })
        .fill(testPassword);
      await page
        .getByLabel("Confirme a senha", { exact: true })
        .fill(testPassword + "-diferente");
      await page
        .getByRole("button", { name: "Criar meu administrador" })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "As senhas não coincidem",
      );
      expect(
        await page.evaluate(() =>
          Object.values(localStorage).some(
            (v) =>
              v.includes("codigo-de-teste") || v.includes("Teste-local-frase"),
          ),
        ),
      ).toBe(false);
      await page
        .getByLabel("Confirme a senha", { exact: true })
        .fill(testPassword);
      await context.route("**/api/auth/setup/create", (route) =>
        route.fulfill({
          status: 403,
          json: {
            code: "INVALID_SETUP_CODE",
            error: "Código de ativação inválido.",
          },
        }),
      );
      await page
        .getByRole("button", { name: "Criar meu administrador" })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "Código de ativação inválido",
      );
      await context.route("**/api/auth/setup/create", (route) =>
        route.fulfill({ status: 201, json: { ok: true } }),
      );
      await page
        .getByRole("button", { name: "Criar meu administrador" })
        .click();
      await expect(
        page.getByRole("heading", { name: "Sua conta foi criada" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Ir para o login" }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      await context.close();
    });
  }

test("Ativação real pelo site → login → primeiro acesso obrigatório → fechamento", async ({
  page,
}) => {
  const db = makeClient(process.env.TEST_DATABASE_URL!);
  const saved = await db.user.findMany({
    where: { role: "administrador" },
    include: { accounts: true, sessions: true, twoFactor: true },
  });
  try {
    await db.user.deleteMany({ where: { role: "administrador" } });
    await db.rateLimit.deleteMany({ where: { key: { startsWith: "setup-" } } });
    await page.goto("/entrar");
    await page
      .getByRole("link", {
        name: "Primeiro acesso do administrador",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/ativar$/);
    await page
      .getByLabel("Código de ativação", { exact: true })
      .fill(process.env.RECICLA_TEST_SETUP_TOKEN!);
    await page
      .getByLabel("Seu nome", { exact: true })
      .fill("Administrador inicial");
    await page
      .getByLabel("Seu e-mail", { exact: true })
      .fill("bootstrap-navegador@teste.invalid");
    await page.getByLabel("Senha inicial", { exact: true }).fill(testPassword);
    await page
      .getByLabel("Confirme a senha", { exact: true })
      .fill(testPassword);
    await page.getByRole("button", { name: "Criar meu administrador" }).click();
    await expect(
      page.getByRole("heading", { name: "Sua conta foi criada" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Ir para o login" }).click();
    await page
      .getByLabel("E-mail", { exact: true })
      .fill("bootstrap-navegador@teste.invalid");
    await page.locator("#password").fill(testPassword);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/seguranca$/);
    await expect(
      page.getByRole("heading", { name: "Prepare seu acesso" }),
    ).toBeVisible();
    await page.goto("/ativar");
    await expect(
      page.getByText(
        "O administrador já foi criado. Entre com a conta existente.",
      ),
    ).toBeVisible();
    await expect(
      page.getByLabel("Código de ativação", { exact: true }),
    ).toHaveCount(0);
  } finally {
    const created = await db.user.findMany({
      where: { email: "bootstrap-navegador@teste.invalid" },
      select: { id: true },
    });
    await db.auditoria.deleteMany({
      where: { actorId: { in: created.map((u) => u.id) } },
    });
    await db.user.deleteMany({ where: { role: "administrador" } });
    for (const { accounts, sessions, twoFactor, ...user } of saved) {
      await db.user.create({ data: user });
      if (accounts.length) await db.account.createMany({ data: accounts });
      if (sessions.length) await db.session.createMany({ data: sessions });
      if (twoFactor) await db.twoFactor.create({ data: twoFactor });
    }
    await db.$disconnect();
  }
});
