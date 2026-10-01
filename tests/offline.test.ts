import { beforeEach, describe, it, expect, vi } from "vitest";
import { ids, actor } from "./fixture";
import type { Entrega } from "../shared/contracts";
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../src/lib/api", () => ({ request: send }));
import {
  acknowledge,
  accountKey,
  cacheCollector,
  enqueue,
  logoutOffline,
  pending,
  readLocal,
  synchronize,
} from "../src/lib/offline";
class MemoryStorage implements Storage {
  map = new Map<string, string>();
  fail = "";
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  key(i: number) {
    return [...this.map.keys()][i] || null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    if (this.fail && k.endsWith(this.fail)) throw new Error("quota");
    this.map.set(k, v);
  }
}
let storage: MemoryStorage;
const user = actor("coletor"),
  other = actor("coletor", "b"),
  delivery = (): Entrega => ({
    id: crypto.randomUUID(),
    municipioId: ids.a,
    coletorId: user.id,
    moradorId: ids.ra,
    pontoId: ids.pa,
    materialId: "papel",
    kg: 1.234,
    criadoEm: new Date().toISOString(),
    moradorNome: "Ana",
    pontoNome: "PEV Centro",
    materialNome: "Papel",
    coletorNome: "Coletor",
    status: "pendente",
  });
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {
    onLine: true,
    locks: {
      request: async (_key: string, task: () => Promise<unknown>) => task(),
    },
  });
  send.mockReset();
});
describe("Fila offline", () => {
  it("separa as contas e preserva pendências ao sair", async () => {
    const record = delivery();
    await enqueue(user, record);
    cacheCollector(user, {
      municipio: user.municipio!,
      moradores: [],
      pontos: [],
      materiais: [],
      atualizadoEm: new Date().toISOString(),
    });
    logoutOffline(user);
    expect(pending(user)[0].id).toBe(record.id);
    expect(pending(other)).toEqual([]);
    expect(readLocal(user, "catalog", null)).toBeNull();
    expect(storage.getItem("recicla-current-collector-v1")).toBeNull();
  });
  it("rejeita troca de autor e fila corrompida", async () => {
    await expect(enqueue(other, delivery())).rejects.toThrow();
    storage.setItem(accountKey(user) + "outbox", "{");
    expect(() => pending(user)).toThrow();
  });
  it("armazenamento cheio deixa a entrega fora da fila e permite tentar novamente", async () => {
    const record = delivery();
    storage.fail = "outbox";
    await expect(enqueue(user, record)).rejects.toThrow(/espaço/);
    expect(pending(user)).toEqual([]);
    storage.fail = "";
    await enqueue(user, record);
    expect(pending(user)).toHaveLength(1);
  });
  it("recibo é guardado antes da remoção e falha preserva a pendência", async () => {
    const record = delivery();
    await enqueue(user, record);
    storage.fail = "receipts";
    await expect(
      acknowledge(user, { ...record, status: "sincronizado" }),
    ).rejects.toThrow();
    expect(pending(user)).toHaveLength(1);
    storage.fail = "outbox";
    await expect(
      acknowledge(user, { ...record, status: "sincronizado" }),
    ).rejects.toThrow();
    expect(readLocal<Entrega[]>(user, "receipts", [])).toHaveLength(1);
    expect(pending(user)).toHaveLength(1);
  });
  it("sessão expirada preserva todos os registros sem enviar com outra conta", async () => {
    await enqueue(user, delivery());
    send.mockRejectedValue({ status: 401, message: "Sessão expirada" });
    await expect(synchronize(user)).rejects.toMatchObject({ status: 401 });
    expect(pending(user)).toHaveLength(1);
    expect(send.mock.calls[0][1].body.coletorId).toBe(user.id);
  });
  it("rejeição mantém o motivo; recibo confirmado remove somente o registro correspondente", async () => {
    const record = delivery();
    await enqueue(user, record);
    send.mockRejectedValueOnce({ status: 409, message: "Conflito" });
    await synchronize(user);
    expect(pending(user)).toHaveLength(1);
    send.mockResolvedValue({ entrega: { ...record, status: "sincronizado" } });
    await synchronize(user);
    expect(pending(user)).toEqual([]);
    expect(readLocal<Entrega[]>(user, "receipts", [])[0].id).toBe(record.id);
  });
});
