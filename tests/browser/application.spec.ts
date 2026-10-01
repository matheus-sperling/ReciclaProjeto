import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { ids, testPassword } from "../fixture";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
let storage: Awaited<
  ReturnType<import("@playwright/test").BrowserContext["storageState"]>
>;
test.beforeAll(async ({ browser }) => {
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  await db.query('DELETE FROM "rateLimit"');
  await db.end();
  const context = await browser.newContext(),
    page = await context.newPage();
  await login(page, "gestor-a@teste.invalid");
  storage = await context.storageState();
  await context.close();
});
async function login(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.locator("#password").fill(testPassword);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/(painel|coletor)$/);
}
async function expectMapCenter(page: Page, lat: number, lng: number) {
  const text = await page.locator(".point-picker-selection").innerText();
  const coordinates = text.split("·")[1]?.split(",").map(Number);
  // Leaflet rounds projected centers to pixels; verify the city, not subpixel precision.
  expect(coordinates?.[0]).toBeCloseTo(lat, 3);
  expect(coordinates?.[1]).toBeCloseTo(lng, 3);
}
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  for (const theme of ["light", "dark"])
    test(`Todas as telas municipais · ${viewport.width}px · ${theme}`, async ({
      browser,
    }) => {
      const publicContext = await browser.newContext({ viewport });
      await publicContext.addInitScript(
        (value) => localStorage.setItem("recicla-theme", value),
        theme,
      );
      const publicPage = await publicContext.newPage();
      await publicPage.goto("/entrar");
      await expect(
        publicPage.getByRole("button", { name: "Entrar", exact: true }),
      ).toBeVisible();
      await expect(
        publicPage.getByRole("button", {
          name: theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro",
        }),
      ).toBeVisible();
      expect(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await publicPage.screenshot({
        path: `test-results/${viewport.width}-${theme}-login.png`,
        fullPage: true,
        animations: "disabled",
      });
      await publicContext.close();
      const context = await browser.newContext({
        storageState: storage,
        viewport,
      });
      await context.addInitScript(
        (value) => localStorage.setItem("recicla-theme", value),
        theme,
      );
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      for (const [path, title] of [
        ["/painel", "Painel municipal"],
        ["/moradores", "Moradores e QR"],
        ["/equipe", "Equipe municipal"],
        ["/pontos", "Pontos de coleta"],
        ["/entregas", "Entregas recebidas"],
        ["/seguranca", "Segurança da conta"],
        ["/coletor", "Vamos coletar."],
      ]) {
        await page.goto(path);
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        await expect(page.getByText("Carregando informações")).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/${viewport.width}-${theme}-${path.slice(1)}.png`,
          fullPage: true,
          animations: "disabled",
        });
        if (path === "/pontos") {
          await page
            .getByRole("button", {
              name: "Cadastrar ponto de coleta",
              exact: true,
            })
            .click();
          await expect(page.locator(".point-picker")).toHaveAttribute(
            "data-municipio-ibge",
            "5003306",
          );
          await page
            .getByRole("button", {
              name: "Marcar no centro do mapa",
              exact: true,
            })
            .click();
          await expectMapCenter(page, -18.5033, -54.760601);
          expect(
            await page
              .getByRole("dialog")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          ).toBe(true);
          await page.screenshot({
            path: `test-results/point-picker-${viewport.width}-${theme}.png`,
            fullPage: true,
            animations: "disabled",
          });
          await page
            .getByRole("button", { name: "Fechar", exact: true })
            .click();
        }
      }
      expect(errors).toEqual([]);
      await context.close();
    });
test("O tema acompanha login, coletor, painel e saída da conta", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/entrar");
  await page.getByRole("button", { name: "Ativar modo escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await login(page, "gestor-a@teste.invalid");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "Coletor", exact: true }).click();
  await page.getByRole("button", { name: "Ativar modo claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("link", { name: "Voltar ao painel" }).click();
  await page.getByRole("button", { name: "Ativar modo escuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Sair da conta" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Ativar modo claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await context.close();
});

test("Gestor cadastra pelo clique no mapa, move o marcador e exclui o ponto", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: storage });
  const page = await context.newPage();
  const name = "Ponto cadastrado no mapa " + Date.now();
  await page.goto("/pontos");
  await page
    .getByRole("button", { name: "Cadastrar ponto de coleta", exact: true })
    .click();
  await page.getByLabel("Nome", { exact: true }).fill(name);
  await page
    .getByLabel("Endereço ou referência", { exact: true })
    .fill("Praça do teste");
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Selecione a localização do ponto no mapa.",
  );
  const map = page.locator(".point-picker-map");
  await map.click({ position: { x: 210, y: 150 } });
  await expect(page.locator(".point-picker-selection")).toContainText(
    "Local selecionado",
  );
  const position = await page.locator(".point-picker-selection").innerText();
  await map.click({ position: { x: 260, y: 170 } });
  await expect(page.locator(".point-picker-selection")).not.toHaveText(
    position,
  );
  const response = page.waitForResponse(
    (r) => r.url().includes("action=pontos") && r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  const { ponto } = await (await response).json();
  expect(ponto.municipioId).toBe(ids.a);
  expect(ponto.lat).toBeGreaterThan(-18.6);
  expect(ponto.lat).toBeLessThan(-18.4);
  await expect(page.getByText("Cadastro salvo com sucesso.")).toBeVisible();
  await page
    .getByRole("button", { name: "Editar " + name, exact: true })
    .click();
  await expect(page.locator(".point-picker-selection")).toContainText(
    `${ponto.lat.toFixed(6)}, ${ponto.lng.toFixed(6)}`,
  );
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  await page
    .getByRole("button", { name: "Excluir " + name, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Excluir ponto de coleta",
  );
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Excluir " + name, exact: true })
    .click();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(page.getByText("Ponto de coleta excluído.")).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await context.close();
});

test("Gestor → cadastro e QR → coleta offline → sincronização → recibo → painel", async ({
  browser,
}) => {
  const manager = await browser.newContext({ storageState: storage }),
    page = await manager.newPage();
  const residentName = "Morador do fluxo " + Date.now();
  await page.goto("/moradores");
  await page
    .getByRole("button", { name: "Cadastrar morador", exact: true })
    .click();
  await page.getByLabel("Nome", { exact: true }).fill(residentName);
  await page.getByLabel("Bairro", { exact: true }).fill("Centro");
  await page.getByRole("button", { name: "Salvar cadastro" }).click();
  await expect(page.getByText("Cadastro salvo com sucesso.")).toBeVisible();
  await page
    .getByRole("button", {
      name: "QR de " + residentName,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const qr = await page.locator(".qr-code").innerText();
  expect(qr).toMatch(/^recicla:morador:/);
  const qrImage = await page
    .getByRole("dialog")
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL("image/png"));
  await page.getByRole("button", { name: "Fechar", exact: true }).click();
  const collector = await browser.newContext(),
    collect = await collector.newPage();
  await login(collect, "coletor-a@teste.invalid");
  await expect(
    collect.getByText("Pronto para coleta offline", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await collector.setOffline(true);
  await collect.reload();
  await expect(
    collect.getByRole("heading", { name: "Vamos coletar." }),
  ).toBeVisible();
  await collect.locator("input[type=file]").setInputFiles({
    name: "qr.png",
    mimeType: "image/png",
    buffer: Buffer.from(qrImage.split(",")[1], "base64"),
  });
  await expect(collect.getByText(residentName, { exact: true })).toBeVisible();
  await collect.getByRole("button", { name: "Trocar", exact: true }).click();
  await collect.getByRole("button", { name: "Código manual" }).click();
  await collect.getByLabel("QR ou identificador do morador").fill(qr);
  await collect.getByRole("button", { name: "Localizar morador" }).click();
  await collect
    .getByLabel("Ponto de coleta", { exact: true })
    .selectOption(ids.pa);
  await collect.getByLabel("Material", { exact: true }).selectOption("papel");
  await collect.getByLabel("Peso em quilogramas").fill("3,501");
  await collect.getByRole("button", { name: "Revisar entrega" }).click();
  await expect(collect.getByRole("dialog")).toContainText("3,501 kg");
  await collect.getByRole("button", { name: "Confirmar entrega" }).click();
  await expect(
    collect.getByText("1 entrega(s) aguardando envio"),
  ).toBeVisible();
  await collector.setOffline(false);
  await collect
    .getByRole("button", { name: "Sincronizar", exact: true })
    .click();
  await expect(
    collect.getByText("Sua fila está em dia", { exact: true }),
  ).toBeVisible();
  await collect.getByRole("button", { name: "Histórico", exact: true }).click();
  await expect(
    collect.getByText("Recibo confirmado", { exact: true }),
  ).toBeVisible();
  await page.goto("/entregas");
  await expect(page.getByText(residentName, { exact: true })).toBeVisible();
  await page.goto("/painel");
  await expect(page.locator(".metric-value").first()).not.toHaveText("0 kg");
  const cacheKeys = await collect.evaluate(async () => {
    const names = await caches.keys();
    const urls: string[] = [];
    for (const name of names)
      for (const r of await (await caches.open(name)).keys()) urls.push(r.url);
    return urls;
  });
  expect(cacheKeys.some((u) => u.includes("/api/"))).toBe(false);
  await manager.close();
  await collector.close();
});
test("Atualização do aplicativo espera o formulário seguro", async ({
  browser,
}) => {
  const context = await browser.newContext(),
    page = await context.newPage();
  const original = await readFile("dist/coletor-sw.js", "utf8");
  try {
    await login(page, "coletor-a@teste.invalid");
    // A document opened at /entrar can remain outside /coletor's worker scope
    // after SPA navigation. Reload within the scope to exercise a waiting update.
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    await expect(
      page.getByText("Pronto para coleta offline", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "Código manual" }).click();
    await page
      .getByLabel("QR ou identificador do morador")
      .fill("recicla:morador:" + ids.ra);
    await page.getByRole("button", { name: "Localizar morador" }).click();
    await expect(page.getByText("Ana da Silva", { exact: true })).toBeVisible();
    await writeFile(
      "dist/coletor-sw.js",
      original + "\n// verificação de atualização " + Date.now(),
    );
    await page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration("/coletor");
      await r!.update();
    });
    const button = page.getByRole("button", {
      name: "Atualizar aplicativo",
      exact: true,
    });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
    await page.getByRole("button", { name: "Trocar", exact: true }).click();
    await expect(button).toBeEnabled();
    await button.click();
    await expect(
      page.getByRole("heading", { name: "Vamos coletar." }),
    ).toBeVisible();
    await expect(page.getByText("Ana da Silva", { exact: true })).toHaveCount(
      0,
    );
  } finally {
    await writeFile("dist/coletor-sw.js", original);
    await context.close();
  }
});
test("Estados vazio, erro e falta de permissão", async ({ browser }) => {
  const context = await browser.newContext({ storageState: storage }),
    page = await context.newPage();
  await page.goto("/moradores");
  await page.getByLabel("Buscar Moradores e QR").fill("ninguém-cadastrado-xyz");
  await expect(page.getByText("Nenhum resultado encontrado")).toBeVisible();
  await page.route("**/api/recicla?action=moradores*", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Falha de teste" }),
    }),
  );
  await page.reload();
  await expect(page.getByText("Falha de teste")).toBeVisible();
  const forged = await context.request.get(
    "http://127.0.0.1:5173/api/recicla?action=entregas&municipioId=" + ids.b,
    {
      headers: {
        cookie: (await context.cookies())
          .map((c) => c.name + "=" + c.value)
          .join("; "),
      },
    },
  );
  expect(forged.status()).toBe(403);
  await context.close();
});

test("Administrador: primeiro acesso, autenticador e telas da plataforma nos dois temas", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  await db.query('DELETE FROM "twoFactor" WHERE "userId"=$1', [ids.admin]);
  await db.query('DELETE FROM "session" WHERE "userId"=$1', [ids.admin]);
  await db.query(
    'UPDATE "user" SET "mustChangePassword"=true, "twoFactorEnabled"=false WHERE id=$1',
    [ids.admin],
  );
  await db.end();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/entrar");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("administrador@teste.invalid");
  await page.locator("#password").fill(testPassword);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Prepare seu acesso", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Antes de continuar, substitua sua senha temporária por uma senha pessoal.",
    ),
  ).toBeVisible();
  const newPassword = testPassword + "-Nova";
  await page.getByLabel("Senha atual", { exact: true }).fill(testPassword);
  await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Repita a nova senha", { exact: true })
    .fill(newPassword);
  await page
    .getByRole("button", { name: "Salvar nova senha", exact: true })
    .click();
  await expect(
    page.getByText("Senha alterada. As outras sessões foram encerradas."),
  ).toBeVisible();
  await page
    .getByLabel("Confirme sua senha", { exact: true })
    .fill(newPassword);
  const setupResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/two-factor/enable"),
  );
  await page
    .getByRole("button", { name: "Configurar autenticador", exact: true })
    .click();
  const setup = await (await setupResponse).json();
  expect(setup.backupCodes).toHaveLength(10);
  await expect(
    page.getByLabel("QR para configurar o autenticador"),
  ).toBeVisible();
  const secret = new URL(setup.totpURI).searchParams.get("secret")!;
  const code = await createOTP(
    new TextDecoder().decode(base32.decode(secret)),
    { digits: 6, period: 30 },
  ).totp();
  await page.getByLabel("Código do aplicativo", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Confirmar e ativar", exact: true })
    .click();
  await expect(
    page.getByText("Verificação em duas etapas ativada."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continuar para o sistema", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Municípios", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate((value) => {
        document.documentElement.classList.toggle("dark", value === "dark");
      }, theme);
      for (const [path, title] of [
        ["/municipios", "Municípios"],
        ["/painel", "Painel municipal"],
        ["/moradores", "Moradores e QR"],
        ["/pontos", "Pontos de coleta"],
        ["/equipe", "Equipe municipal"],
        ["/entregas", "Entregas recebidas"],
        ["/seguranca", "Segurança da conta"],
      ]) {
        if (path === "/painel") {
          await page
            .getByRole("row")
            .filter({ hasText: "Coxim" })
            .getByRole("button", { name: "Abrir", exact: true })
            .click();
        } else if ((await page.url()).endsWith(path) === false) {
          if (width === 390)
            await page
              .getByRole("button", { name: "Abrir menu", exact: true })
              .click();
          await page.locator(`.nav-link[href="${path}"]`).click();
        }
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        await expect(page.getByText("Carregando informações")).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `test-results/admin-${width}-${theme}-${path.slice(1)}.png`,
          fullPage: true,
          animations: "disabled",
        });
      }
    }
  // The administrator changes the explicitly selected city before opening the map.
  await page.goto("/municipios");
  await page
    .getByRole("row")
    .filter({ hasText: "Campo Grande" })
    .getByRole("button", { name: "Abrir", exact: true })
    .click();
  if ((await page.viewportSize())!.width === 390)
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.locator('.nav-link[href="/pontos"]').click();
  await page
    .getByRole("button", { name: "Cadastrar ponto de coleta", exact: true })
    .click();
  await expect(page.locator(".point-picker")).toHaveAttribute(
    "data-municipio-ibge",
    "5002704",
  );
  const pointName = "Ponto do administrador " + Date.now();
  await page.getByLabel("Nome", { exact: true }).fill(pointName);
  await page
    .getByLabel("Endereço ou referência", { exact: true })
    .fill("Teste em Campo Grande");
  await page
    .getByRole("button", { name: "Marcar no centro do mapa", exact: true })
    .click();
  await expectMapCenter(page, -20.462601, -54.608601);
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(page.getByText("Cadastro salvo com sucesso.")).toBeVisible();
  await page
    .getByRole("button", { name: "Excluir " + pointName, exact: true })
    .click();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(page.getByText("Ponto de coleta excluído.")).toBeVisible();
  if ((await page.viewportSize())!.width === 390)
    await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.locator('.nav-link[href="/equipe"]').click();
  await page
    .getByRole("button", { name: "Cadastrar integrante", exact: true })
    .click();
  const accountName = "Conta para exclusão " + Date.now(),
    email = "exclusao-" + Date.now() + "@teste.invalid";
  await page.getByLabel("Nome", { exact: true }).fill(accountName);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Perfil", { exact: true }).selectOption("gestor");
  await page
    .getByRole("button", { name: "Salvar cadastro", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Acesso preparado", exact: true }),
  ).toBeVisible();
  const temporaryPassword = await page
    .locator(".temporary-password")
    .innerText();
  await page
    .getByRole("button", { name: "Já guardei a senha", exact: true })
    .click();
  const removedContext = await browser.newContext();
  const removedPage = await removedContext.newPage();
  await removedPage.goto("/entrar");
  await removedPage.getByLabel("E-mail", { exact: true }).fill(email);
  await removedPage.locator("#password").fill(temporaryPassword);
  await removedPage
    .getByRole("button", { name: "Entrar", exact: true })
    .click();
  await expect(
    removedPage.getByRole("heading", {
      name: "Prepare seu acesso",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Excluir conta de " + accountName,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "O acesso será revogado imediatamente",
  );
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(
    page.getByText("Conta excluída. O acesso foi revogado."),
  ).toBeVisible();
  await expect(page.getByText(accountName, { exact: true })).toHaveCount(0);
  const expired = removedPage.waitForResponse((r) =>
    r.url().includes("action=session"),
  );
  await removedPage.reload();
  expect((await expired).status()).toBe(401);
  await expect(removedPage).toHaveURL(/\/entrar/);
  await removedContext.close();
  expect(errors).toEqual([]);
  await context.close();
});
