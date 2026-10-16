import { expect, test, type Page } from "@playwright/test";
import { actor, ids, testPassword } from "../fixture";

const owner = actor("coletor");
const ownerKey = `recicla-v3:${owner.municipioId}:${owner.id}:`;
const lockKey = "recicla-device-lock-v1";

async function login(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.locator("#password").fill(testPassword);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/coletor$/);
  await expect(
    page.getByText("Pronto para coleta offline", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await expect(
    page.getByText("Pronto para coleta offline", { exact: true }),
  ).toBeVisible();
  // The worker can confirm cached files before the catalog refresh finishes.
  // Wait for mounted initialization, including expiry/connection monitoring.
  await expect(
    page.getByRole("heading", { name: "Identifique o morador", exact: true }),
  ).toBeVisible();
}

async function seedPending(page: Page) {
  return page.evaluate(
    ({ key, owner, ids }) => {
      const record = {
        id: crypto.randomUUID(),
        municipioId: owner.municipioId,
        coletorId: owner.id,
        moradorId: ids.ra,
        pontoId: ids.pa,
        materialId: "papel",
        kg: 1.001,
        criadoEm: new Date().toISOString(),
        moradorNome: "Pendência preservada da conta original",
        coletorNome: owner.nome,
        pontoNome: "PEV Centro",
        materialNome: "Papel",
        status: "pendente",
      };
      const queue = JSON.stringify([record]);
      localStorage.setItem(key + "outbox", queue);
      localStorage.setItem(
        key + "receipts",
        JSON.stringify([{ ...record, status: "sincronizado" }]),
      );
      return queue;
    },
    { key: ownerKey, owner, ids },
  );
}

test("saída offline bloqueia abas e reload, revoga antes de outro login e preserva a fila original", async ({
  page,
  context,
}) => {
  await login(page, owner.email);
  const sibling = await context.newPage();
  await sibling.goto("/coletor");
  await expect(
    sibling.getByRole("heading", { name: "Vamos coletar." }),
  ).toBeVisible();
  await context.setOffline(true);
  const queue = await seedPending(page);
  await page
    .getByRole("button", { name: "Sair da conta", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Sair da conta",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Sair da conta", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Sair da conta", exact: true })
    .click();
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(sibling).toHaveURL(/\/entrar$/);
  const stored = await page.evaluate(
    ({ key, lockKey }) => ({
      lock: localStorage.getItem(lockKey),
      identity: localStorage.getItem("recicla-current-collector-v1"),
      catalog: localStorage.getItem(key + "catalog"),
      receipts: localStorage.getItem(key + "receipts"),
      queue: localStorage.getItem(key + "outbox"),
    }),
    { key: ownerKey, lockKey },
  );
  expect(stored).toEqual({
    lock: expect.stringMatching(/^pending:/),
    identity: null,
    catalog: null,
    receipts: null,
    queue,
  });

  // The HttpOnly session still exists while offline; even a new document must
  // respect the durable local lock instead of restoring that cookie's account.
  await page.goto("/coletor");
  await expect(page).toHaveURL(/\/entrar\?redirect=(?:%2F|\/)coletor$/);
  let signIns = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/sign-in/email")) signIns++;
  });
  await context.route("**/api/auth/sign-out", (route) => route.abort("failed"));
  await context.setOffline(false);
  await page.goto("/coletor");
  await expect(page).toHaveURL(/\/entrar\?redirect=(?:%2F|\/)coletor$/);
  const originalSession = await page.evaluate(async () => {
    const response = await fetch("/api/recicla?action=session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    return { status: response.status, body: await response.json() };
  });
  expect(originalSession.status).toBe(200);
  expect(originalSession.body.user.id).toBe(owner.id);
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("coletor-b@teste.invalid");
  await page.locator("#password").fill(testPassword);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByText(/Não foi possível encerrar a sessão anterior/),
  ).toBeVisible();
  expect(signIns).toBe(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), lockKey),
  ).toMatch(/^pending:/);

  await context.unroute("**/api/auth/sign-out");
  const revoked = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/sign-out") && response.ok(),
  );
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await revoked;
  await expect(page).toHaveURL(/\/coletor$/);
  await expect(
    page.getByText("Coletor b · Campo Grande", { exact: true }),
  ).toBeVisible();
  expect(signIns).toBe(1);
  expect(
    await page.evaluate(
      (key) =>
        localStorage.getItem(key) ===
        localStorage.getItem("recicla-device-unlocked-v1"),
      lockKey,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key + "outbox"),
      ownerKey,
    ),
  ).toBe(queue);
  await page.getByRole("button", { name: "Pendências", exact: false }).click();
  await expect(
    page.getByText("Pendência preservada da conta original", { exact: true }),
  ).toHaveCount(0);
  await sibling.close();
});

test("24h sem verificação expiram o acesso offline sem renovar no reload ou apagar a fila", async ({
  page,
  context,
}) => {
  // Install before the app registers its interval so the clock controls the
  // actual expiry timer as well as Date.now().
  await page.clock.install();
  await login(page, owner.email);
  await context.setOffline(true);
  const queue = await seedPending(page);
  const identity = await page.evaluate(() =>
    localStorage.getItem("recicla-current-collector-v1"),
  );
  const verifiedAt = JSON.parse(identity!).offlineVerifiedAt;
  await page.clock.setSystemTime(new Date(verifiedAt));
  await page.clock.fastForward(24 * 60 * 60 * 1000 + 31000);
  await expect(page).toHaveURL(/\/entrar\?.*reason=offline-expired/);
  await expect(
    page.getByText("Conecte-se para renovar o acesso offline.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/coletor");
  await expect(page).toHaveURL(/\/entrar\?.*reason=offline-expired/);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("recicla-current-collector-v1"),
    ),
  ).toBe(identity);
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key + "outbox"),
      ownerKey,
    ),
  ).toBe(queue);
});

test("expiração e mudança de conexão são reconhecidas durante a inicialização do catálogo", async ({
  page,
  context,
}) => {
  await page.clock.install();
  const waiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route("**/api/recicla?**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "session") return route.fulfill({ json: { user: owner } });
    if (action !== "catalogo") return route.continue();
    waiting.resolve();
    await release.promise;
    await route.abort().catch(() => {});
  });
  await page.addInitScript((user) => {
    delete (Navigator.prototype as { serviceWorker?: unknown }).serviceWorker;
    localStorage.setItem(
      "recicla-current-collector-v1",
      JSON.stringify({ ...user, offlineVerifiedAt: Date.now() }),
    );
  }, owner);
  try {
    await page.goto("/coletor");
    await waiting.promise;
    await expect(page.getByText("Carregando informações")).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText("Sem conexão", { exact: true })).toBeVisible();
    await page.clock.fastForward(24 * 60 * 60 * 1000 + 31000);
    await expect(page).toHaveURL(/\/entrar\?.*reason=offline-expired/);
  } finally {
    release.resolve();
  }
});
