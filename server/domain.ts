import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "./errors.js";
import { scoped } from "./db.js";
import {
  contaSchema,
  entregaSchema,
  municipioSchema,
  moradorSchema,
  nome,
  pontoSchema,
  rangeDatas,
  uuid,
} from "../shared/validation.js";
import type { User } from "../shared/contracts.js";

type Query = Record<string, string>;
const manager = (u: User) => {
  if (!["gestor", "administrador"].includes(u.role))
    throw new ApiError(403, "Acesso disponível apenas à gestão.");
};
const platform = (u: User) => {
  if (u.role !== "administrador")
    throw new ApiError(
      403,
      "Acesso disponível apenas ao administrador da plataforma.",
    );
};
const publicAccount = (u: {
  id: string;
  name: string;
  email: string;
  role: string;
  municipioId: string | null;
  ativo: boolean;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
}) => ({
  id: u.id,
  nome: u.name,
  email: u.email,
  role: u.role,
  municipioId: u.municipioId,
  ativo: u.ativo,
  mustChangePassword: u.mustChangePassword,
  twoFactorEnabled: u.twoFactorEnabled,
});
const dtoEntrega = (
  r: { gramas: number; criadoEm: Date; recebidoEm: Date } & Record<
    string,
    unknown
  >,
) => ({
  ...r,
  gramas: undefined,
  kg: r.gramas / 1000,
  criadoEm: r.criadoEm.toISOString(),
  recebidoEm: r.recebidoEm.toISOString(),
  status: "sincronizado",
});
export function municipalityScope(actor: User, requested: unknown) {
  if (actor.role === "administrador") {
    if (!requested)
      throw new ApiError(
        400,
        "Selecione um município para continuar.",
        "MUNICIPALITY_REQUIRED",
      );
    return uuid.parse(requested);
  }
  if (requested && requested !== actor.municipioId)
    throw new ApiError(403, "Você não tem acesso a este município.");
  if (!actor.municipioId)
    throw new ApiError(403, "Conta sem vínculo municipal.");
  return actor.municipioId;
}
function pagination(query: Query) {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(100000)
    .parse(query.page || 1);
  const search = z
    .string()
    .trim()
    .max(120)
    .parse(query.search || "");
  return { page, search, skip: (page - 1) * 30, take: 30 };
}
function extract(body: Record<string, unknown>) {
  const { municipioId, ...rest } = body;
  return rest;
}
const edited = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({ id: uuid, version: z.number().int().positive(), ...shape })
    .strict();
async function audit(
  tx: Prisma.TransactionClient,
  actor: User,
  municipioId: string | null,
  acao: string,
  alvoId: string,
) {
  await tx.$executeRaw`INSERT INTO "Auditoria" (id,"actorId","municipioId",acao,"alvoId") VALUES (${crypto.randomUUID()}::uuid,${actor.id}::uuid,${municipioId}::uuid,${acao},${alvoId})`;
}
async function lockMunicipality(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id},0))`;
}
export function createDomain(db: PrismaClient, accounts: PrismaClient) {
  return async function execute(
    actor: User,
    action: string,
    method: string,
    body: Record<string, unknown> = {},
    query: Query = {},
  ) {
    if (action === "municipios") {
      platform(actor);
      return scoped(db, actor, null, async (tx) => {
        if (method === "GET") {
          const p = pagination(query),
            where = {
              nome: { contains: p.search, mode: "insensitive" as const },
            };
          const [municipios, total] = await Promise.all([
            tx.municipio.findMany({
              where,
              orderBy: { nome: "asc" },
              skip: p.skip,
              take: p.take,
            }),
            tx.municipio.count({ where }),
          ]);
          return { municipios, total, page: p.page };
        }
        if (method === "POST") {
          const input = municipioSchema.parse(body);
          const municipio = await tx.municipio.create({
            data: {
              ...input,
              nomeNormalizado: input.nome
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase(),
            },
          });
          await audit(
            tx,
            actor,
            municipio.id,
            "municipio.criado",
            municipio.id,
          );
          return { municipio };
        }
        if (method === "PATCH") {
          const { id, version, ...input } = edited(municipioSchema.shape).parse(
            body,
          );
          await lockMunicipality(tx, id);
          const result = await tx.municipio.updateMany({
            where: { id, version },
            data: {
              ...input,
              nomeNormalizado: input.nome
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase(),
              version: { increment: 1 },
            },
          });
          if (!result.count)
            throw new ApiError(
              409,
              "O município foi alterado. Atualize e tente novamente.",
            );
          if (!input.ativo)
            await accounts.session.deleteMany({
              where: { user: { municipioId: id } },
            });
          await audit(tx, actor, id, "municipio.alterado", id);
          return {
            municipio: await tx.municipio.findUnique({ where: { id } }),
          };
        }
        throw new ApiError(405, "Método não permitido.");
      });
    }
    const municipioId = municipalityScope(
      actor,
      body.municipioId ?? query.municipioId,
    );
    if (action === "equipe") {
      manager(actor);
      return accounts.$transaction(
        async (tx) => {
          await lockMunicipality(tx, municipioId);
          const municipio = await tx.municipio.findUnique({
            where: { id: municipioId },
          });
          if (!municipio) throw new ApiError(404, "Município não encontrado.");
          if (method === "GET") {
            const p = pagination(query),
              where = {
                municipioId,
                deletedAt: null,
                OR: [
                  {
                    name: { contains: p.search, mode: "insensitive" as const },
                  },
                  {
                    email: { contains: p.search, mode: "insensitive" as const },
                  },
                ],
              };
            const [users, total] = await Promise.all([
              tx.user.findMany({
                where,
                orderBy: { name: "asc" },
                skip: p.skip,
                take: p.take,
              }),
              tx.user.count({ where }),
            ]);
            return { users: users.map(publicAccount), total, page: p.page };
          }
          if (!municipio.ativo)
            throw new ApiError(
              403,
              "Reative o município antes de alterar sua equipe.",
            );
          if (method === "POST") {
            const input = contaSchema.parse(extract(body)),
              temporaryPassword = randomBytes(18).toString("base64url");
            const created = await tx.user.create({
              data: {
                name: input.nome,
                email: input.email,
                role: input.role,
                municipioId,
                mustChangePassword: true,
                accounts: {
                  create: {
                    accountId: input.email,
                    providerId: "credential",
                    password: await hashPassword(temporaryPassword),
                  },
                },
              },
            });
            await tx.account.updateMany({
              where: { userId: created.id },
              data: { accountId: created.id },
            });
            await audit(tx, actor, municipioId, "conta.criada", created.id);
            return { user: publicAccount(created), temporaryPassword };
          }
          if (method === "PATCH") {
            const patch = z
              .object({
                id: uuid,
                nome: nome.optional(),
                role: z.enum(["gestor", "coletor"]).optional(),
                ativo: z.boolean().optional(),
                excluir: z.boolean().optional(),
                redefinirSenha: z.boolean().optional(),
              })
              .strict()
              .parse(extract(body));
            const target = await tx.user.findFirst({
              where: { id: patch.id, municipioId, deletedAt: null },
            });
            if (!target || target.role === "administrador")
              throw new ApiError(404, "Conta não encontrada.");
            if (target.id === actor.id)
              throw new ApiError(
                400,
                "Use a área Segurança para alterar seu próprio acesso.",
              );
            const removing =
              patch.excluir === true ||
              patch.ativo === false ||
              patch.role === "coletor";
            if (target.role === "gestor" && target.ativo && removing) {
              const count = await tx.user.count({
                where: {
                  municipioId,
                  role: "gestor",
                  ativo: true,
                  deletedAt: null,
                },
              });
              if (count <= 1)
                throw new ApiError(
                  409,
                  "O município precisa manter pelo menos um gestor ativo.",
                  "LAST_MANAGER",
                );
            }
            const temporaryPassword = patch.redefinirSenha
              ? randomBytes(18).toString("base64url")
              : undefined;
            if (temporaryPassword)
              await tx.account.updateMany({
                where: { userId: target.id, providerId: "credential" },
                data: { password: await hashPassword(temporaryPassword) },
              });
            const updated = await tx.user.update({
              where: { id: target.id },
              data: {
                ...(patch.nome ? { name: patch.nome } : {}),
                ...(patch.role ? { role: patch.role } : {}),
                ...(typeof patch.ativo === "boolean"
                  ? { ativo: patch.ativo }
                  : {}),
                ...(patch.excluir
                  ? { ativo: false, deletedAt: new Date() }
                  : {}),
                ...(temporaryPassword ? { mustChangePassword: true } : {}),
              },
            });
            await tx.session.deleteMany({ where: { userId: target.id } });
            await audit(
              tx,
              actor,
              municipioId,
              patch.excluir
                ? "conta.excluida"
                : temporaryPassword
                  ? "conta.senha_redefinida"
                  : "conta.alterada",
              target.id,
            );
            return {
              user: publicAccount(updated),
              ...(temporaryPassword ? { temporaryPassword } : {}),
            };
          }
          throw new ApiError(405, "Método não permitido.");
        },
        { timeout: 15000, maxWait: 15000 },
      );
    }
    return scoped(db, actor, municipioId, async (tx) => {
      const municipio = await tx.municipio.findUnique({
        where: { id: municipioId },
      });
      if (!municipio) throw new ApiError(404, "Município não encontrado.");
      if (method !== "GET" && !municipio.ativo)
        throw new ApiError(403, "Município inativo.");
      if (action === "catalogo" && method === "GET") {
        const [moradores, pontos, materiais] = await Promise.all([
          tx.morador.findMany({
            where: {
              municipioId,
              ...(actor.role === "coletor" ? { ativo: true } : {}),
            },
            orderBy: { nome: "asc" },
          }),
          tx.ponto.findMany({
            where: { municipioId },
            orderBy: { nome: "asc" },
          }),
          tx.material.findMany({ orderBy: { nome: "asc" } }),
        ]);
        return {
          municipio,
          moradores,
          pontos,
          materiais,
          atualizadoEm: new Date().toISOString(),
        };
      }
      if (action === "moradores" || action === "pontos") {
        manager(actor);
        const isResident = action === "moradores";
        if (method === "GET") {
          const p = pagination(query),
            where = {
              municipioId,
              nome: { contains: p.search, mode: "insensitive" as const },
            };
          const rows = isResident
            ? await tx.morador.findMany({
                where,
                orderBy: { nome: "asc" },
                skip: p.skip,
                take: p.take,
              })
            : await tx.ponto.findMany({
                where,
                orderBy: { nome: "asc" },
                skip: p.skip,
                take: p.take,
              });
          const total = isResident
            ? await tx.morador.count({ where })
            : await tx.ponto.count({ where });
          return { [action]: rows, total, page: p.page };
        }
        if (method === "POST") {
          const row = isResident
            ? await tx.morador.create({
                data: { ...moradorSchema.parse(extract(body)), municipioId },
              })
            : await tx.ponto.create({
                data: { ...pontoSchema.parse(extract(body)), municipioId },
              });
          await audit(tx, actor, municipioId, action + ".criado", row.id);
          return { [isResident ? "morador" : "ponto"]: row };
        }
        if (method === "PATCH") {
          if (isResident) {
            const { id, version, ...input } = edited(moradorSchema.shape).parse(
              extract(body),
            );
            const result = await tx.morador.updateMany({
              where: { id, municipioId, version },
              data: { ...input, version: { increment: 1 } },
            });
            if (!result.count)
              throw new ApiError(
                409,
                "Cadastro não encontrado ou alterado. Atualize a lista.",
              );
            await audit(tx, actor, municipioId, "moradores.alterado", id);
            return { morador: await tx.morador.findUnique({ where: { id } }) };
          }
          const { id, version, ...input } = edited(pontoSchema.shape).parse(
            extract(body),
          );
          const result = await tx.ponto.updateMany({
            where: { id, municipioId, version },
            data: { ...input, version: { increment: 1 } },
          });
          if (!result.count)
            throw new ApiError(
              409,
              "Ponto não encontrado ou alterado. Atualize a lista.",
            );
          await audit(tx, actor, municipioId, "pontos.alterado", id);
          return { ponto: await tx.ponto.findUnique({ where: { id } }) };
        }
      }
      if (action === "entregas") {
        if (method === "GET") {
          const snapshot = query.snapshot
            ? new Date(z.iso.datetime({ offset: true }).parse(query.snapshot))
            : undefined;
          const p = pagination(query),
            where = {
              municipioId,
              ...(snapshot ? { recebidoEm: { lte: snapshot } } : {}),
              ...(actor.role === "coletor" ? { coletorId: actor.id } : {}),
            };
          const [rows, total] = await Promise.all([
            tx.entrega.findMany({
              where,
              orderBy: [{ criadoEm: "desc" }, { id: "asc" }],
              skip: p.skip,
              take: p.take,
            }),
            tx.entrega.count({ where }),
          ]);
          return {
            entregas: rows.map((r) => dtoEntrega(r)),
            total,
            page: p.page,
          };
        }
        if (method === "POST") {
          if (actor.role === "administrador")
            throw new ApiError(
              403,
              "Use uma conta municipal para registrar entregas.",
            );
          const input = entregaSchema.parse(body);
          if (input.municipioId !== municipioId || input.coletorId !== actor.id)
            throw new ApiError(
              403,
              "A entrega pertence a outra conta ou município.",
            );
          const date = new Date(input.criadoEm);
          if (
            date.getTime() > Date.now() + 300000 ||
            date.getTime() < Date.parse("2020-01-01")
          )
            throw new ApiError(400, "Confira a data e a hora do dispositivo.");
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${municipioId + ":" + input.id},0))`;
          const where = { municipioId_id: { municipioId, id: input.id } },
            previous = await tx.entrega.findUnique({ where });
          if (previous) {
            const same =
              previous.coletorId === actor.id &&
              previous.moradorId === input.moradorId &&
              previous.pontoId === input.pontoId &&
              previous.materialId === input.materialId &&
              previous.gramas === input.kg &&
              previous.criadoEm.getTime() === date.getTime();
            if (!same)
              throw new ApiError(
                409,
                "Este identificador pertence a outra entrega.",
              );
            return { entrega: dtoEntrega(previous), duplicate: true };
          }
          const [resident, point, material] = await Promise.all([
            tx.morador.findFirst({
              where: { id: input.moradorId, municipioId, ativo: true },
            }),
            tx.ponto.findFirst({
              where: { id: input.pontoId, municipioId, ativo: true },
            }),
            tx.material.findUnique({ where: { id: input.materialId } }),
          ]);
          if (!resident || !point || !material)
            throw new ApiError(
              400,
              "Morador, ponto ou material indisponível neste município.",
            );
          const { kg, ...delivery } = input;
          const created = await tx.entrega.create({
            data: {
              ...delivery,
              gramas: kg,
              criadoEm: date,
              moradorNome: resident.nome,
              pontoNome: point.nome,
              materialNome: material.nome,
              coletorNome: actor.nome,
            },
          });
          return { entrega: dtoEntrega(created), duplicate: false };
        }
      }
      if (action === "painel" && method === "GET") {
        manager(actor);
        let criadoEm;
        try {
          criadoEm = rangeDatas(query.inicio, query.fim);
        } catch {
          throw new ApiError(400, "Selecione um período válido.");
        }
        const where = { municipioId, criadoEm };
        const [pontos, materiais, byPoint, byMaterial, totals] =
          await Promise.all([
            tx.ponto.findMany({
              where: { municipioId },
              orderBy: { nome: "asc" },
            }),
            tx.material.findMany(),
            tx.entrega.groupBy({
              by: ["pontoId"],
              where,
              _sum: { gramas: true },
            }),
            tx.entrega.groupBy({
              by: ["materialId"],
              where,
              _sum: { gramas: true },
            }),
            tx.entrega.aggregate({
              where,
              _sum: { gramas: true },
              _count: true,
            }),
          ]);
        return {
          municipio,
          totalKg: (totals._sum.gramas || 0) / 1000,
          entregas: totals._count,
          ativos: pontos.filter((p) => p.ativo).length,
          pontos: pontos.map((p) => ({
            ...p,
            kg:
              (byPoint.find((r) => r.pontoId === p.id)?._sum.gramas || 0) /
              1000,
          })),
          materiais: materiais.map((m) => ({
            ...m,
            kg:
              (byMaterial.find((r) => r.materialId === m.id)?._sum.gramas ||
                0) / 1000,
          })),
          atualizadoEm: new Date().toISOString(),
        };
      }
      if (action === "auditoria" && method === "GET") {
        manager(actor);
        const p = pagination(query);
        const [registros, total] = await Promise.all([
          tx.auditoria.findMany({
            where: { municipioId },
            orderBy: { criadoEm: "desc" },
            skip: p.skip,
            take: p.take,
          }),
          tx.auditoria.count({ where: { municipioId } }),
        ]);
        return { registros, total, page: p.page };
      }
      throw new ApiError(405, "Ação ou método não permitido.");
    });
  };
}
