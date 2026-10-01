import { z } from "zod";
export const uuid = z.uuid().transform((v) => v.toLowerCase());
export const nome = z
  .string()
  .trim()
  .min(2, "Informe pelo menos 2 caracteres.")
  .max(120);
export const senha = z
  .string()
  .min(12, "A senha deve ter pelo menos 12 caracteres.")
  .max(128);
export function lerQr(value: string) {
  const prefix = "recicla:morador:";
  if (!value.trim().startsWith(prefix))
    throw new Error("Este QR não pertence ao Recicla+.");
  const result = uuid.safeParse(value.trim().slice(prefix.length));
  if (!result.success) throw new Error("Código de morador inválido.");
  return result.data;
}
export function pesoGramas(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:[.,]\d{1,3})?$/.test(text))
    throw new Error("Informe o peso com até três casas decimais, como 2,500.");
  const grams = Math.round(Number(text.replace(",", ".")) * 1000);
  if (!Number.isSafeInteger(grams) || grams < 1 || grams > 10000000)
    throw new Error("O peso deve ser de 0,001 a 10.000 kg.");
  return grams;
}
export const moradorSchema = z
  .object({
    nome,
    bairro: z.string().trim().max(80).default(""),
    ativo: z.boolean().default(true),
  })
  .strict();
export const pontoSchema = z
  .object({
    nome,
    local: z.string().trim().min(2).max(180),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    ativo: z.boolean(),
  })
  .strict();
export const municipioSchema = z
  .object({
    nome,
    uf: z.literal("MS").default("MS"),
    ativo: z.boolean().default(true),
  })
  .strict();
export const contaSchema = z
  .object({
    nome,
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    role: z.enum(["gestor", "coletor"]),
  })
  .strict();
export const entregaSchema = z
  .object({
    id: uuid,
    municipioId: uuid,
    moradorId: uuid,
    pontoId: uuid,
    materialId: z.string().max(40),
    kg: z.union([z.string(), z.number()]).transform((value, ctx) => {
      try {
        return pesoGramas(value);
      } catch (error) {
        ctx.addIssue({ code: "custom", message: (error as Error).message });
        return z.NEVER;
      }
    }),
    criadoEm: z.iso.datetime({ offset: true }),
    coletorId: uuid,
  })
  .strict();
export function rangeDatas(inicio: string, fim: string) {
  const valid = (s: string) =>
    /^20\d\d-\d\d-\d\d$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(inicio) || !valid(fim) || inicio > fim)
    throw new Error("Selecione um período válido.");
  return {
    gte: new Date(`${inicio}T00:00:00-04:00`),
    lte: new Date(`${fim}T23:59:59.999-04:00`),
  };
}
