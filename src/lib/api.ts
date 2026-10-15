import { reactive } from "vue";
import { createAuthClient } from "better-auth/vue";
import { twoFactorClient } from "better-auth/client/plugins";
import type { Municipio, User } from "../../shared/contracts";
import {
  beginDeviceLock,
  confirmDeviceLogout,
  deviceLock,
  unlockDevice,
} from "./device-lock";
export const state = reactive({
  user: null as User | null,
  municipio: null as Municipio | null,
  checking: true,
  notice: "",
});
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
let generation = 0;
export function clearContext() {
  generation++;
  state.municipio = null;
  state.notice = "";
}
export function selectMunicipio(municipio: Municipio) {
  generation++;
  state.municipio = municipio;
  sessionStorage.setItem("recicla-municipio", municipio.id);
}
type RequestOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number>;
  scope?: boolean;
};
function lockedError() {
  return new ApiError(
    "Entre novamente para desbloquear este dispositivo.",
    401,
    "DEVICE_LOCKED",
  );
}
export function lockCurrentDevice() {
  beginDeviceLock();
  state.user = null;
  clearContext();
  sessionStorage.removeItem("recicla-municipio");
}
let authenticationFallback = Promise.resolve();
async function authenticationLock<T>(task: () => Promise<T>) {
  if (navigator.locks)
    return navigator.locks.request("recicla-authentication", task);
  // Collectors already require Web Locks for their queue. Without cross-tab
  // locking, refuse a pending revocation rather than race a new session.
  if (deviceLock())
    throw new Error(
      "Use um navegador atualizado para encerrar a sessão anterior e entrar novamente.",
    );
  const result = authenticationFallback.then(task);
  authenticationFallback = result.then(
    () => {},
    () => {},
  );
  return result;
}
async function revokePendingLogout() {
  const value = deviceLock();
  if (!value?.startsWith("pending:")) return;
  if (!navigator.onLine)
    throw new ApiError(
      "Dispositivo bloqueado. Conecte-se para entrar novamente.",
      0,
      "LOGOUT_PENDING",
    );
  try {
    const result = await authClient.signOut({
      fetchOptions: { signal: AbortSignal.timeout(10000) },
    });
    if (result.error) throw new Error(authError(result.error));
    confirmDeviceLogout(value);
  } catch {
    throw new ApiError(
      "Dispositivo bloqueado. Não foi possível encerrar a sessão anterior; confira a conexão e tente entrar novamente.",
      0,
      "LOGOUT_PENDING",
    );
  }
}
let logoutAttempt: Promise<void> | null = null;
export function flushPendingLogout() {
  if (!logoutAttempt)
    logoutAttempt = authenticationLock(async () => {
      while (deviceLock()?.startsWith("pending:")) await revokePendingLogout();
    }).finally(() => {
      logoutAttempt = null;
    });
  return logoutAttempt;
}
export async function authenticate<T>(
  task: (lock: { value: string | null }) => Promise<T>,
) {
  return authenticationLock(async () => {
    await revokePendingLogout();
    if (deviceLock()?.startsWith("pending:")) throw lockedError();
    return task({ value: deviceLock() });
  });
}
export async function request<T = Record<string, unknown>>(
  action: string,
  options: RequestOptions = {},
): Promise<T> {
  if (action !== "status" && deviceLock()) throw lockedError();
  const result = await sendRequest<T>(action, options);
  if (action !== "status" && deviceLock()) throw lockedError();
  return result;
}
async function sendRequest<T = Record<string, unknown>>(
  action: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = new URL("/api/recicla", location.origin);
  url.searchParams.set("action", action);
  for (const [k, v] of Object.entries(options.query || {}))
    url.searchParams.set(k, String(v));
  if (options.scope !== false && state.municipio)
    url.searchParams.set("municipioId", state.municipio.id);
  const before = generation;
  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: options.body
        ? { "Content-Type": "application/json" }
        : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new ApiError(
      "Não foi possível conectar. Confira a conexão e tente novamente.",
      0,
      "NETWORK",
    );
  }
  if (options.scope !== false && before !== generation)
    throw new ApiError(
      "O município selecionado mudou.",
      409,
      "CONTEXT_CHANGED",
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      "Resposta inválida do servidor.",
      response.status,
      "INVALID_RESPONSE",
    );
  }
  if (!response.ok) {
    if (response.status === 401) {
      state.user = null;
      clearContext();
    }
    throw new ApiError(
      data.error || "Não foi possível concluir a solicitação.",
      response.status,
      data.code || "REQUEST_ERROR",
    );
  }
  return data as T;
}
export async function session(signIn?: { value: string | null }) {
  const before = generation;
  const lock = deviceLock();
  if (signIn ? lock !== signIn.value || lock?.startsWith("pending:") : !!lock)
    throw lockedError();
  const result = await sendRequest<{ user: User }>("session", { scope: false });
  if (generation !== before || deviceLock() !== lock) throw lockedError();
  if (signIn) unlockDevice(lock);
  if (deviceLock()) throw lockedError();
  try {
    const previous = JSON.parse(
      localStorage.getItem("recicla-current-collector-v1") || "null",
    ) as User | null;
    if (
      previous &&
      (previous.id !== result.user.id ||
        previous.municipioId !== result.user.municipioId)
    ) {
      const prefix = `recicla-v3:${previous.municipioId}:${previous.id}:`;
      localStorage.removeItem(prefix + "catalog");
      localStorage.removeItem(prefix + "receipts");
      localStorage.removeItem("recicla-current-collector-v1");
    }
  } catch {}
  if (state.user && state.user.id !== result.user.id) clearContext();
  state.user = result.user;
  if (result.user.role !== "administrador")
    state.municipio = result.user.municipio;
  return result.user;
}
export function authError(
  error: { message?: string; code?: string } | null | undefined,
) {
  const messages: Record<string, string> = {
    INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha inválidos.",
    INVALID_PASSWORD: "Senha inválida.",
    INVALID_TWO_FACTOR_COOKIE: "O acesso expirou. Entre novamente.",
    INVALID_TOTP: "Código inválido. Confira seu autenticador.",
    INVALID_BACKUP_CODE: "Código de recuperação inválido.",
    TOO_MANY_REQUESTS: "Muitas tentativas. Aguarde alguns minutos.",
  };
  return (
    messages[error?.code || ""] ||
    error?.message ||
    "Não foi possível concluir a solicitação."
  );
}
export const number = (value: number) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Campo_Grande",
  }).format(new Date(value));
