import { test, expect, type Page } from "@playwright/test";
import { actor, ids } from "../fixture";

// Exercise the real QR reader and video layout without a physical camera or
// database. Authentication and municipal isolation have separate integration tests.
async function collector(
  page: Page,
  permission: "granted" | "denied" = "granted",
) {
  const user = actor("coletor");
  await page.route("**/api/recicla?**", async (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    await route.fulfill({
      json:
        action === "session"
          ? { user }
          : action === "catalogo"
            ? {
                municipio: user.municipio,
                moradores: [
                  {
                    id: ids.ra,
                    municipioId: ids.a,
                    nome: "Ana da Silva",
                    bairro: "Centro",
                    ativo: true,
                    version: 1,
                  },
                ],
                pontos: [],
                materiais: [],
                atualizadoEm: new Date().toISOString(),
              }
            : {},
    });
  });
  await page.addInitScript((permission) => {
    // Offline caching is covered by application.spec.ts. Keep these tests
    // independent of cached builds and the service worker's installation.
    delete (Navigator.prototype as { serviceWorker?: unknown }).serviceWorker;
    const camera = {
      streams: [] as MediaStream[],
      tracks: [] as MediaStreamTrack[],
      canvases: [] as HTMLCanvasElement[],
      permission,
    };
    Object.assign(window, { reciclaCameraTest: camera });
    navigator.mediaDevices.getUserMedia = async () => {
      if (camera.permission === "denied")
        throw new DOMException("Permission denied", "NotAllowedError");
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Keep delivering frames; tests can paint an actual QR into this feed.
      let frame = 0;
      setInterval(() => {
        context.fillStyle = ++frame % 2 ? "white" : "black";
        context.fillRect(0, 0, 1, 1);
      }, 100);
      const stream = canvas.captureStream(10);
      camera.canvases.push(canvas);
      camera.streams.push(stream);
      camera.tracks.push(stream.getVideoTracks()[0]);
      return stream;
    };
  }, permission);
  await page.goto("/coletor");
  await expect(
    page.getByRole("button", { name: "Ler com a câmera", exact: true }),
  ).toBeVisible();
}

for (const width of [320, 390, 1440])
  test(`Câmera abre, lê QR e reabre · ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await collector(page);
    const region = page.locator("#recicla-scanner");
    expect(await region.evaluate((el) => el.clientWidth)).toBeGreaterThan(200);
    await page.getByRole("button", { name: "Ler com a câmera" }).click();
    await expect(
      page.getByRole("button", { name: "Fechar câmera" }),
    ).toBeVisible();
    await expect(region.locator("video")).toBeVisible();
    await expect(region.locator("canvas")).toHaveCount(1);
    const dimensions = await region.evaluate((el) => {
      const video = el.querySelector("video")!,
        canvas = el.querySelector("canvas")!;
      return {
        width: video.clientWidth,
        height: video.clientHeight,
        scanWidth: canvas.width,
        scanHeight: canvas.height,
      };
    });
    expect(dimensions.scanWidth).toBeGreaterThanOrEqual(50);
    expect(dimensions.scanWidth).toBeLessThan(dimensions.width);
    expect(dimensions.scanHeight).toBeLessThan(dimensions.height);
    await page.getByRole("button", { name: "Fechar câmera" }).click();
    await expect(region.locator("video")).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const state = (window as any).reciclaCameraTest;
        return state.tracks[0].readyState;
      }),
    ).toBe("ended");

    await page.getByRole("button", { name: "Ler com a câmera" }).click();
    await expect(region.locator("video")).toBeVisible();
    await expect(region.locator("canvas")).toHaveCount(1);
    await page.addScriptTag({
      path: "node_modules/qrious/dist/qrious.js",
    });
    await page.evaluate((id) => {
      const qr = document.createElement("canvas");
      new (window as any).QRious({
        element: qr,
        value: "recicla:morador:" + id,
        size: 240,
        level: "H",
      });
      const camera = (window as any).reciclaCameraTest;
      camera.canvases[1].getContext("2d").drawImage(qr, 200, 60);
    }, ids.ra);
    await expect(page.getByText("Ana da Silva", { exact: true })).toBeVisible();
    await expect(region.locator("video")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (window as any).reciclaCameraTest.tracks.every(
          (track: MediaStreamTrack) => track.readyState === "ended",
        ),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });

test("Permissão negada permite tentar novamente", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await collector(page, "denied");
  const open = page.getByRole("button", { name: "Ler com a câmera" });
  await open.click();
  await expect(page.getByRole("alert")).toContainText(
    "O acesso à câmera foi bloqueado.",
  );
  await expect(open).toBeEnabled();
  await page.evaluate(() => {
    (window as any).reciclaCameraTest.permission = "granted";
  });
  await open.click();
  await expect(page.locator("#recicla-scanner video")).toBeVisible();
  await page.getByRole("button", { name: "Fechar câmera" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
