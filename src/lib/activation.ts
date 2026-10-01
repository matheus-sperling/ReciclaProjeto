import { ApiError } from "./api";

export interface ActivationStatus {
  available: boolean;
  reason?: "completed" | "not_enabled";
  expiresAt?: string;
}
export async function activationRequest<T>(
  path: "status" | "create",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/setup/${path}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new ApiError(
      "Não foi possível conectar. Confira sua conexão e tente novamente.",
      0,
      "NETWORK",
    );
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error || "Não foi possível concluir a ativação.",
      response.status,
      data.code,
    );
  return data as T;
}
