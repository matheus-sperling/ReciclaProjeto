import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
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
  offlineAccessExpired,
  offlineAccessLifetime,
  pending,
  readLocal,
  restoreOfflineUser,
  synchronize,
} from "../src/lib/offline";
import {
  beginDeviceLock,
  confirmDeviceLogout,
  deviceLock,
  deviceLockKey,
  deviceUnlockedKey,
  unlockDevice,
} from "../src/lib/device-lock";
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
afterEach(() => vi.useRealTimers());
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
  it("bloqueia o dispositivo sem rede, limpa catálogos/recibos e preserva todas as filas", async () => {
    const record = delivery();
    await enqueue(user, record);
    cacheCollector(user, {
      municipio: user.municipio!,
      moradores: [],
      pontos: [],
      materiais: [],
      atualizadoEm: new Date().toISOString(),
    });
    storage.setItem(accountKey(user) + "receipts", JSON.stringify([record]));
    storage.setItem(accountKey(other) + "catalog", "{}");
    storage.setItem(accountKey(other) + "outbox", "[]");
    vi.stubGlobal("navigator", { onLine: false, locks: navigator.locks });
    const marker = beginDeviceLock();
    expect(deviceLock()).toBe(marker);
    expect(restoreOfflineUser()).toBeNull();
    expect(storage.getItem("recicla-current-collector-v1")).toBeNull();
    expect(readLocal(user, "catalog", null)).toBeNull();
    expect(readLocal(user, "receipts", null)).toBeNull();
    expect(readLocal(other, "catalog", null)).toBeNull();
    expect(storage.getItem(accountKey(other) + "outbox")).toBe("[]");
    expect(pending(user)).toEqual([record]);
    await expect(enqueue(user, delivery())).rejects.toThrow(/Entre novamente/);
    await expect(acknowledge(user, record)).rejects.toThrow(/bloqueado/);
  });
  it("continua bloqueado após revogar a sessão e exige um novo login sem sobrescrever bloqueios mais recentes", () => {
    const first = beginDeviceLock();
    const current = beginDeviceLock();
    confirmDeviceLogout(first);
    expect(deviceLock()).toBe(current);
    confirmDeviceLogout(current);
    expect(deviceLock()).toBe(current.replace("pending:", "signed-out:"));
    expect(() => unlockDevice(first)).toThrow(/bloqueado/);
    unlockDevice(deviceLock());
    expect(deviceLock()).toBeNull();
  });
  it("um logout em outra aba durante o desbloqueio não pode ser apagado por um login anterior", () => {
    const first = beginDeviceLock();
    confirmDeviceLogout(first);
    const verified = deviceLock();
    let newer = "";
    const racedStorage = new Proxy(storage, {
      get(target, property) {
        if (property === "setItem")
          return (key: string, value: string) => {
            if (key === deviceUnlockedKey) newer = beginDeviceLock(target);
            target.setItem(key, value);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    unlockDevice(verified, racedStorage);
    expect(deviceLock()).toBe(newer);
    expect(deviceLock()).toMatch(/^pending:/);
    expect(restoreOfflineUser()).toBeNull();
  });
  it("falha ao persistir o bloqueio não apaga dados nem simula uma saída concluída", async () => {
    await enqueue(user, delivery());
    cacheCollector(user, {
      municipio: user.municipio!,
      moradores: [],
      pontos: [],
      materiais: [],
      atualizadoEm: new Date().toISOString(),
    });
    const before = [...storage.map.entries()];
    storage.fail = deviceLockKey;
    expect(() => beginDeviceLock()).toThrow(/Não foi possível bloquear/);
    expect([...storage.map.entries()]).toEqual(before);
    expect(restoreOfflineUser()?.id).toBe(user.id);
  });
  it("o acesso offline expira após 24h e reloads não renovam o prazo ou apagam pendências", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
    const record = delivery();
    await enqueue(user, record);
    const catalog = {
      municipio: user.municipio!,
      moradores: [],
      pontos: [],
      materiais: [],
      atualizadoEm: new Date().toISOString(),
    };
    cacheCollector(user, catalog);
    const identity = storage.getItem("recicla-current-collector-v1");
    vi.advanceTimersByTime(offlineAccessLifetime - 1);
    expect(restoreOfflineUser()?.id).toBe(user.id);
    expect(offlineAccessExpired()).toBe(false);
    expect(storage.getItem("recicla-current-collector-v1")).toBe(identity);
    vi.advanceTimersByTime(1);
    expect(restoreOfflineUser()).toBeNull();
    expect(offlineAccessExpired()).toBe(true);
    expect(pending(user)).toEqual([record]);
    // onLine can stay true while the API is unreachable; it cannot renew access.
    await expect(enqueue(user, delivery())).rejects.toThrow(/renovar/);
    expect(pending(user)).toEqual([record]);
    cacheCollector(user, catalog);
    expect(restoreOfflineUser()?.id).toBe(user.id);
  });
});
