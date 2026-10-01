import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  disconnect,
  makeClient,
  scoped,
  verifyRuntimeRoles,
} from "../server/db";
import { createDomain, municipalityScope } from "../server/domain";
import { ids, actor } from "./fixture";
const urls = [
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
  process.env.AUTH_DATABASE_URL,
];
if (urls.some((v) => !v))
  throw new Error(
    "Testes de segurança exigem PostgreSQL real e três credenciais. Execute test:setup em um banco descartável.",
  );
const owner = makeClient(urls[0]!),
  db = makeClient(urls[1]!),
  auth = makeClient(urls[2]!),
  domain = createDomain(db, auth),
  ga = actor("gestor"),
  ca = actor("coletor"),
  root = actor("administrador");
afterAll(async () => {
  await Promise.all([
    db.$disconnect(),
    auth.$disconnect(),
    owner.$disconnect(),
    disconnect(),
  ]);
});
beforeAll(async () => {
  await verifyRuntimeRoles();
  const r = await db.$queryRaw<
    Array<{ current_user: string }>
  >`SELECT current_user`;
  expect(r[0].current_user).toBe("recicla_app_login");
});
describe("Isolamento municipal com a credencial operacional", () => {
  it("retorna zero registros sem contexto, mesmo sem filtro", async () => {
    expect(await db.morador.findMany()).toEqual([]);
    expect(await db.entrega.findMany()).toEqual([]);
  });
  it("limita consultas sem filtro à cidade do contexto e limpa o contexto ao terminar", async () => {
    const rows = await scoped(db, ga, ids.a, (tx) => tx.morador.findMany());
    expect(rows.map((r) => r.id)).toEqual([ids.ra]);
    expect(await db.morador.findMany()).toEqual([]);
  });
  it("bloqueia leitura, alteração e exportação de outra cidade por chamadas diretas", async () => {
    expect(() => municipalityScope(ga, ids.b)).toThrow();
    for (const action of [
      "moradores",
      "pontos",
      "entregas",
      "painel",
      "equipe",
    ])
      await expect(
        domain(ga, action, "GET", {}, { municipioId: ids.b }),
      ).rejects.toMatchObject({ status: 403 });
    await expect(
      domain(ga, "moradores", "PATCH", {
        id: ids.rb,
        version: 1,
        nome: "Intrusão",
        bairro: "",
        ativo: true,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("não permite forjar administrador, promover contas ou alcançar o administrador", async () => {
    await expect(
      domain(ga, "municipios", "POST", {
        nome: "Outra cidade",
        uf: "MS",
        ativo: true,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      domain(ga, "equipe", "PATCH", { id: ids.admin, ativo: false }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      domain(ga, "equipe", "PATCH", { id: ids.gb, ativo: false }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      domain(ga, "equipe", "PATCH", { id: ids.ca, role: "administrador" }),
    ).rejects.toThrow();
  });
  it("impede remoção própria e do último gestor, com requisições simultâneas", async () => {
    await expect(
      domain(ga, "equipe", "PATCH", { id: ga.id, excluir: true }),
    ).rejects.toMatchObject({ status: 400 });
    const results = await Promise.allSettled([
      domain(
        root,
        "equipe",
        "PATCH",
        { id: ga.id, ativo: false },
        { municipioId: ids.a },
      ),
      domain(
        root,
        "equipe",
        "PATCH",
        { id: ga.id, excluir: true },
        { municipioId: ids.a },
      ),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
  });
  it("um gestor cria e administra outro gestor e o bloqueio concorrente preserva o último", async () => {
    const result = (await domain(ga, "equipe", "POST", {
      nome: "Gestora adicional",
      email: "segunda@teste.invalid",
      role: "gestor",
    })) as any;
    expect(result.user.role).toBe("gestor");
    expect(result.temporaryPassword.length).toBeGreaterThan(20);
    const admin2 = { ...ga, id: result.user.id };
    const results = await Promise.allSettled([
      domain(
        root,
        "equipe",
        "PATCH",
        { id: ga.id, ativo: false },
        { municipioId: ids.a },
      ),
      domain(
        root,
        "equipe",
        "PATCH",
        { id: admin2.id, ativo: false },
        { municipioId: ids.a },
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await auth.user.count({
        where: {
          municipioId: ids.a,
          ativo: true,
          role: "gestor",
          deletedAt: null,
        },
      }),
    ).toBe(1);
    await owner.user.updateMany({
      where: { municipioId: ids.a, role: "gestor" },
      data: { ativo: true },
    });
    await domain(ga, "equipe", "PATCH", { id: admin2.id, excluir: true });
  });
  it("limita o coletor a leitura de catálogo e suas próprias entregas", async () => {
    await expect(domain(ca, "moradores", "GET")).rejects.toMatchObject({
      status: 403,
    });
    await expect(domain(ca, "equipe", "GET")).rejects.toMatchObject({
      status: 403,
    });
    const catalog = (await domain(ca, "catalogo", "GET")) as any;
    expect(catalog.moradores.map((r: any) => r.id)).toEqual([ids.ra]);
  });
});
describe("Entregas e recibos", () => {
  const input = () => ({
    id: crypto.randomUUID(),
    municipioId: ids.a,
    coletorId: ids.ca,
    moradorId: ids.ra,
    pontoId: ids.pa,
    materialId: "papel",
    kg: 2.501,
    criadoEm: new Date().toISOString(),
  });
  it("preserva UUID e retorna o mesmo recibo em reenvios simultâneos", async () => {
    const body = input(),
      results = (await Promise.all([
        domain(ca, "entregas", "POST", body),
        domain(ca, "entregas", "POST", body),
      ])) as any[];
    expect(results[0].entrega.id).toBe(body.id);
    expect(results[1].entrega.kg).toBe(2.501);
    expect(await owner.entrega.count({ where: { id: body.id } })).toBe(1);
    await expect(
      domain(ca, "entregas", "POST", { ...body, kg: 2.502 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejeita QR, autor e ponto de outra cidade e peso inválido", async () => {
    for (const body of [
      { ...input(), moradorId: ids.rb },
      { ...input(), pontoId: ids.pb },
      { ...input(), coletorId: ids.cb },
      { ...input(), kg: 0 },
    ])
      await expect(domain(ca, "entregas", "POST", body)).rejects.toThrow();
  });
  it("impede relações cruzadas também no banco", async () => {
    await expect(
      scoped(db, ca, ids.a, (tx) =>
        tx.entrega.create({
          data: {
            id: crypto.randomUUID(),
            municipioId: ids.a,
            coletorId: ids.ca,
            moradorId: ids.rb,
            pontoId: ids.pa,
            materialId: "papel",
            gramas: 1000,
            criadoEm: new Date(),
            coletorNome: "Coletor",
            moradorNome: "Morador",
            pontoNome: "Ponto",
            materialNome: "Papel",
          },
        }),
      ),
    ).rejects.toThrow();
  });
  it("rejeita cadastros inativos, mas aceita reenvio idêntico de entrega já recebida", async () => {
    const body = input();
    await domain(ca, "entregas", "POST", body);
    await owner.morador.update({
      where: { id: ids.ra },
      data: { ativo: false },
    });
    try {
      await expect(
        domain(ca, "entregas", "POST", input()),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        ((await domain(ca, "entregas", "POST", body)) as any).duplicate,
      ).toBe(true);
    } finally {
      await owner.morador.update({
        where: { id: ids.ra },
        data: { ativo: true },
      });
    }
  });
  it("bloqueia dados de cidade desativada e permite consulta histórica pelo administrador", async () => {
    await owner.municipio.update({
      where: { id: ids.a },
      data: { ativo: false },
    });
    try {
      expect(
        await scoped(db, ga, ids.a, (tx) => tx.morador.findMany()),
      ).toEqual([]);
      expect(
        (
          (await domain(
            root,
            "entregas",
            "GET",
            {},
            { municipioId: ids.a },
          )) as any
        ).total,
      ).toBeGreaterThan(0);
    } finally {
      await owner.municipio.update({
        where: { id: ids.a },
        data: { ativo: true },
      });
    }
  });
});
