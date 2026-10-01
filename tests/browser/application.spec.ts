import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { readFile, writeFile } from "node:fs/promises";
import { ids, testPassword } from "../fixture";
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
for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])
  for (const theme of ["light", "dark"])
    test(`Todas as telas municipais · ${viewport.width}px · ${theme}`, async ({
      browser,
    }) => {
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
        });
      }
      expect(errors).toEqual([]);
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
  await collect
    .locator("input[type=file]")
    .setInputFiles({
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
