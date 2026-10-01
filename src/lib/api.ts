import { reactive } from "vue";
import { createAuthClient } from "better-auth/vue";
import { twoFactorClient } from "better-auth/client/plugins";
import type { Municipio, User } from "../../shared/contracts";
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
export async function request<T = Record<string, unknown>>(
  action: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number>;
    scope?: boolean;
  } = {},
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
export async function session() {
  const result = await request<{ user: User }>("session", { scope: false });
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
