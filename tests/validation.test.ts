import { describe, it, expect } from "vitest";
import {
  lerQr,
  pesoGramas,
  rangeDatas,
  contaSchema,
  municipioSchema,
} from "../shared/validation";
import { municipiosMS, sedeMunicipal } from "../shared/municipios";
import { ids } from "./fixture";
describe("Validação compartilhada", () => {
  it("localiza as sedes de MS sem depender de geocodificação externa", () => {
    expect(municipiosMS).toHaveLength(79);
    expect(new Set(municipiosMS.map((c) => c.ibge)).size).toBe(79);
    expect(sedeMunicipal("  coxim  ")?.lat).toBeCloseTo(-18.5033, 4);
    expect(sedeMunicipal("PARAISO DAS AGUAS")?.nome).toBe("Paraíso das Águas");
    expect(sedeMunicipal("Coxim", "MT")).toBeUndefined();
    expect(municipioSchema.parse({ nome: "agua clara" }).nome).toBe(
      "Água Clara",
    );
    expect(() => municipioSchema.parse({ nome: "Cidade inventada" })).toThrow();
  });
  it("usa somente QR UUID sem dados pessoais", () => {
    expect(lerQr("recicla:morador:" + ids.ra)).toBe(ids.ra);
    for (const text of [
      "Ana",
      ids.ra,
      "recicla:morador:12",
      "https://example.com/" + ids.ra,
    ])
      expect(() => lerQr(text)).toThrow();
  });
  it("converte peso decimal para gramas sem arredondar dados inválidos", () => {
    expect(pesoGramas("2,501")).toBe(2501);
    expect(pesoGramas(0.001)).toBe(1);
    for (const value of [0, -1, "NaN", "1e4", "1.0001", 10001, "Infinity"])
      expect(() => pesoGramas(value)).toThrow();
  });
  it("rejeita permissões e cidade fornecidas no cadastro de conta", () => {
    expect(() =>
      contaSchema.parse({
        nome: "Maria",
        email: "m@teste.invalid",
        role: "administrador",
      }),
    ).toThrow();
    expect(() =>
      contaSchema.parse({
        nome: "Maria",
        email: "m@teste.invalid",
        role: "gestor",
        municipioId: ids.b,
      }),
    ).toThrow();
  });
  it("usa o fuso de MS e valida datas reais", () => {
    expect(rangeDatas("2026-10-01", "2026-10-01").gte.toISOString()).toBe(
      "2026-10-01T04:00:00.000Z",
    );
    expect(() => rangeDatas("2026-02-30", "2026-03-01")).toThrow();
  });
});
