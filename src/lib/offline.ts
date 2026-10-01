import type { Catalogo, Entrega, User } from "../../shared/contracts";
import { entregaSchema } from "../../shared/validation";
import { request } from "./api";
const identityKey = "recicla-current-collector-v1";
export const accountKey = (user: Pick<User, "id" | "municipioId">) =>
  `recicla-v3:${user.municipioId}:${user.id}:`;
export function readLocal<T>(
  user: Pick<User, "id" | "municipioId">,
  name: string,
  fallback: T,
  storage: Storage = localStorage,
): T {
  const raw = storage.getItem(accountKey(user) + name);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      "Há dados locais que não puderam ser lidos. Preserve este navegador e procure o gestor.",
    );
  }
}
export function writeLocal(
  user: Pick<User, "id" | "municipioId">,
  name: string,
  value: unknown,
  storage: Storage = localStorage,
) {
  try {
    storage.setItem(accountKey(user) + name, JSON.stringify(value));
  } catch {
    throw new Error(
      "Não há espaço para salvar. A entrega continua no formulário. Exporte o histórico e libere espaço.",
    );
  }
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("recicla-data"));
}
export function pending(
  user: User,
  storage: Storage = localStorage,
): Entrega[] {
  const queue = readLocal<Entrega[]>(user, "outbox", [], storage);
  if (!Array.isArray(queue))
    throw new Error(
      "Fila local inválida. Preserve os dados e procure o gestor.",
    );
  for (const record of queue) {
    entregaSchema.parse({
      id: record.id,
      municipioId: record.municipioId,
      moradorId: record.moradorId,
      pontoId: record.pontoId,
      materialId: record.materialId,
      kg: record.kg,
      criadoEm: record.criadoEm,
      coletorId: record.coletorId,
    });
    if (record.coletorId !== user.id || record.municipioId !== user.municipioId)
      throw new Error(
        "A fila contém um registro de outra conta. O envio foi interrompido.",
      );
  }
  return queue;
}
async function queueLock<T>(user: User, task: () => Promise<T>) {
  if (!navigator.locks)
    throw new Error(
      "Este navegador não permite proteger a fila. Use um navegador atualizado.",
    );
  return navigator.locks.request(accountKey(user) + "lock", task);
}
export async function enqueue(user: User, record: Entrega) {
  if (record.coletorId !== user.id || record.municipioId !== user.municipioId)
    throw new Error("Conta ou município da entrega inválido.");
  await queueLock(user, async () => {
    const rows = pending(user);
    if (rows.some((r) => r.id === record.id)) return;
    if (rows.length >= 500)
      throw new Error(
        "A fila tem 500 entregas. Conecte-se para enviar antes de registrar novas.",
      );
    writeLocal(user, "outbox", [...rows, record]);
  });
}
export function history(user: User) {
  const rows = readLocal<Entrega[]>(user, "receipts", []),
    map = new Map(
      rows
        .filter(
          (r) => r.coletorId === user.id && r.municipioId === user.municipioId,
        )
        .map((r) => [r.id, r]),
    );
  pending(user).forEach((r) => map.set(r.id, r));
  return [...map.values()].sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}
export async function acknowledge(user: User, record: Entrega) {
  if (record.coletorId !== user.id || record.municipioId !== user.municipioId)
    throw new Error("O recibo pertence a outra conta.");
  await queueLock(user, async () => {
    const receipts = readLocal<Entrega[]>(user, "receipts", []);
    writeLocal(
      user,
      "receipts",
      [record, ...receipts.filter((r) => r.id !== record.id)].slice(0, 1000),
    );
    writeLocal(
      user,
      "outbox",
      pending(user).filter((r) => r.id !== record.id),
    );
  });
}
const syncing = new Set<string>();
export async function synchronize(user: User) {
  const key = accountKey(user);
  if (syncing.has(key) || !navigator.onLine) return;
  syncing.add(key);
  try {
    for (const record of pending(user)) {
      try {
        const body = {
          id: record.id,
          municipioId: record.municipioId,
          moradorId: record.moradorId,
          pontoId: record.pontoId,
          materialId: record.materialId,
          kg: record.kg,
          criadoEm: record.criadoEm,
          coletorId: record.coletorId,
        };
        const result = await request<{ entrega: Entrega }>("entregas", {
          method: "POST",
          body,
        });
        await acknowledge(user, result.entrega);
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (!status || status === 401 || status === 403 || status >= 500)
          throw error;
        await queueLock(user, async () =>
          writeLocal(
            user,
            "outbox",
            pending(user).map((r) =>
              r.id === record.id
                ? {
                    ...r,
                    erroEnvio:
                      error instanceof Error
                        ? error.message
                        : "Envio rejeitado.",
                  }
                : r,
            ),
          ),
        );
      }
    }
  } finally {
    syncing.delete(key);
  }
}
export function cacheCollector(user: User, catalog: Catalogo) {
  if (
    user.role === "administrador" ||
    catalog.municipio.id !== user.municipioId
  )
    throw new Error("Catálogo de outro município.");
  writeLocal(user, "catalog", catalog);
  localStorage.setItem(identityKey, JSON.stringify(user));
}
export function restoreOfflineUser(): User | null {
  try {
    const raw = localStorage.getItem(identityKey);
    if (!raw) return null;
    const u = JSON.parse(raw) as User;
    if (
      !["gestor", "coletor"].includes(u.role) ||
      !u.id ||
      !u.municipioId ||
      u.mustChangePassword
    )
      return null;
    const catalog = readLocal<Catalogo | null>(u, "catalog", null);
    return catalog?.municipio.id === u.municipioId ? u : null;
  } catch {
    return null;
  }
}
export function logoutOffline(user: User) {
  localStorage.removeItem(accountKey(user) + "catalog");
  localStorage.removeItem(accountKey(user) + "receipts");
  localStorage.removeItem(identityKey);
}
export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
