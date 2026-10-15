import { expect, test } from "@playwright/test";
import { actor, ids } from "../fixture";

// These valid legacy H-level cards expose false alignment detections in the
// bundled ZXing reader. Keep their payloads and the production QR generator.
const residentIds = [
  "c9aa471e-f40f-4daa-9e6f-7ea0b44dcbd3",
  "41a5052e-3abc-4762-a170-86f4352b7df3",
  "babef265-3ca8-4562-bdba-08ab6161c11b",
  "5b9e449a-e9a3-4faa-a60f-1e9520339cdc",
  "fee2ab05-8578-4b13-bc2d-04c65436c1cf",
];

for (const width of [320, 1440])
  test(`Leitor real aceita PNGs legados com alinhamento ambíguo · ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const user = actor("coletor");
    await page.route("**/api/recicla?**", (route) => {
      const action = new URL(route.request().url()).searchParams.get("action");
      return route.fulfill({
        json:
          action === "session"
            ? { user }
            : action === "catalogo"
              ? {
                  municipio: user.municipio,
                  moradores: residentIds.map((id, index) => ({
                    id,
                    municipioId: ids.a,
                    nome: `Morador do cartão ${index + 1}`,
                    bairro: "Centro",
                    ativo: true,
                    version: 1,
                  })),
                  pontos: [],
                  materiais: [],
                  atualizadoEm: new Date().toISOString(),
                }
              : {},
      });
    });
    await page.addInitScript(() => {
      delete (Navigator.prototype as { serviceWorker?: unknown }).serviceWorker;
    });
    await page.goto("/coletor");
    await expect(
      page.getByRole("button", { name: "Ler com a câmera", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Carregando informações")).toHaveCount(0);
    await page.addScriptTag({ path: "node_modules/qrious/dist/qrious.js" });
    for (const [index, id] of residentIds.entries()) {
      const png = await page.evaluate((id) => {
        const canvas = document.createElement("canvas");
        new (window as any).QRious({
          element: canvas,
          value: "recicla:morador:" + id,
          size: 300,
          level: "H",
        });
        return canvas.toDataURL("image/png");
      }, id);
      await page.locator("input[type=file]").setInputFiles({
        name: "cartao-legado.png",
        mimeType: "image/png",
        buffer: Buffer.from(png.split(",")[1], "base64"),
      });
      await expect(
        page.getByText(`Morador do cartão ${index + 1}`, { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Trocar", exact: true }).click();
    }
  });
