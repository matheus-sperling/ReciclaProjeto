import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { auth, principal } from "./auth.js";
import { appDb, authDb, verifyRuntimeRoles } from "./db.js";
import { createDomain } from "./domain.js";
import { ApiError } from "./errors.js";
import { senha } from "../shared/validation.js";
import { limitLogin } from "./limits.js";

const allowedAuth = new Set([
  "sign-in/email",
  "sign-out",
  "two-factor/enable",
  "two-factor/disable",
  "two-factor/verify-totp",
  "two-factor/verify-backup-code",
  "two-factor/get-totp-uri",
  "two-factor/generate-backup-codes",
]);
export function configured() {
  return Boolean(
    process.env.DATABASE_URL &&
    process.env.AUTH_DATABASE_URL &&
    (process.env.BETTER_AUTH_SECRET || "").length >= 32 &&
    process.env.APP_ORIGIN,
  );
}
export function ensureOrigin(request: Request) {
  if (
    request.method !== "GET" &&
    request.headers.get("origin") !== process.env.APP_ORIGIN
  )
    throw new ApiError(403, "Origem da solicitação inválida.");
}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
function errorResponse(error: unknown) {
  if (error instanceof ApiError)
    return json({ error: error.message, code: error.code }, error.status);
  if (error instanceof z.ZodError)
    return json(
      {
        error: error.issues[0]?.message || "Dados inválidos.",
        code: "VALIDATION_ERROR",
      },
      400,
    );
  if (error instanceof Error && "code" in error && error.code === "P2002")
    return json({ error: "Este cadastro já existe.", code: "CONFLICT" }, 409);
  console.error("recicla-api", {
    type: error instanceof Error ? error.name : "UnknownError",
  });
  return json(
    {
      error: "Não foi possível concluir a solicitação. Tente novamente.",
      code: "SERVICE_ERROR",
    },
    503,
  );
}
async function bodyObject(request: Request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 65536)
    throw new ApiError(413, "Solicitação muito grande.");
  let value;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, "Dados inválidos.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "Dados inválidos.");
  return value as Record<string, unknown>;
}
export async function domainHandler(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url),
      action = url.searchParams.get("action") || "";
    if (action === "status" && request.method === "GET")
      return json({ configured: configured() });
    if (!configured())
      throw new ApiError(
        503,
        "O ambiente precisa ser configurado pelo administrador.",
        "NOT_CONFIGURED",
      );
    ensureOrigin(request);
    await verifyRuntimeRoles();
    const actor = await principal(
      request.headers,
      ["session", "trocarSenha"].includes(action),
    );
    if (action === "session" && request.method === "GET")
      return json({ user: actor });
    const body = request.method === "GET" ? {} : await bodyObject(request);
    if (action === "trocarSenha" && request.method === "POST") {
      const input = z
        .object({ senhaAtual: z.string().max(128), novaSenha: senha })
        .strict()
        .parse(body);
      const result = await auth().api.changePassword({
        headers: request.headers,
        body: {
          currentPassword: input.senhaAtual,
          newPassword: input.novaSenha,
          revokeOtherSessions: true,
        },
        asResponse: true,
      });
      if (!result.ok) return sanitizedAuth(result);
      await authDb().user.update({
        where: { id: actor.id },
        data: { mustChangePassword: false },
      });
      const response = json({ ok: true });
      for (const cookie of result.headers.getSetCookie())
        response.headers.append("Set-Cookie", cookie);
      return response;
    }
    return json(
      await createDomain(appDb(), authDb())(
        actor,
        action,
        request.method,
        body,
        Object.fromEntries(url.searchParams),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
async function sanitizedAuth(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  if (!headers.get("Content-Type")?.includes("json"))
    return new Response(response.body, { status: response.status, headers });
  const payload = await response.json();
  function removeTokens(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(removeTokens);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => !["token", "password", "secret"].includes(k))
          .map(([k, v]) => [k, removeTokens(v)]),
      );
    return value;
  }
  return new Response(JSON.stringify(removeTokens(payload)), {
    status: response.status,
    headers,
  });
}
export async function authHandler(
  request: Request,
  clientIp = "unknown",
): Promise<Response> {
  try {
    if (!configured())
      throw new ApiError(
        503,
        "Ambiente ainda não configurado.",
        "NOT_CONFIGURED",
      );
    ensureOrigin(request);
    await verifyRuntimeRoles();
    const url = new URL(request.url),
      path = url.pathname.replace(/^\/api\/auth\/?/, "");
    if (!allowedAuth.has(path) || request.method !== "POST")
      throw new ApiError(404, "Operação indisponível.");
    const body = await bodyObject(request);
    if (path === "sign-in/email") {
      const email = z.email().max(254).parse(body.email);
      await limitLogin(email);
    }
    if (
      [
        "two-factor/enable",
        "two-factor/disable",
        "two-factor/get-totp-uri",
        "two-factor/generate-backup-codes",
      ].includes(path)
    ) {
      const actor = await principal(request.headers, true);
      if (actor.role === "administrador" && path === "two-factor/disable")
        throw new ApiError(
          403,
          "O administrador deve manter a verificação em duas etapas.",
        );
    }
    // Device trust is deliberately disabled: each login requires the configured factor.
    if ("trustDevice" in body) body.trustDevice = false;
    const headers = new Headers(request.headers);
    headers.set("x-recicla-client-ip", clientIp);
    headers.delete("content-length");
    return sanitizedAuth(
      await auth().handler(
        new Request(request.url, {
          method: request.method,
          headers,
          body: JSON.stringify(body),
        }),
      ),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function nodeRequest(
  req: IncomingMessage & { body?: unknown },
  originalPath?: string,
) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers))
    if (value !== undefined)
      headers.set(key, Array.isArray(value) ? value.join(",") : value);
  const url = new URL(
    originalPath || req.url || "/",
    process.env.APP_ORIGIN || "http://localhost:5173",
  );
  const method = req.method || "GET";
  let body: string | undefined;
  if (!["GET", "HEAD"].includes(method)) {
    if (req.body !== undefined)
      body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    else {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const b = Buffer.from(chunk);
        bytes += b.length;
        if (bytes > 65536) throw new ApiError(413, "Solicitação muito grande.");
        chunks.push(b);
      }
      body = Buffer.concat(chunks).toString("utf8");
    }
  }
  return new Request(url, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });
}
export async function sendResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
export async function handleNode(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  authPath?: string,
) {
  try {
    const request = await nodeRequest(req, authPath),
      isAuth = new URL(request.url).pathname.startsWith("/api/auth/");
    const forwarded = process.env.VERCEL
      ? String(
          req.headers["x-vercel-forwarded-for"] ||
            req.socket.remoteAddress ||
            "unknown",
        )
      : String(req.socket.remoteAddress || "local");
    await sendResponse(
      res,
      await (isAuth
        ? authHandler(request, forwarded.split(",")[0].trim())
        : domainHandler(request)),
    );
  } catch (error) {
    await sendResponse(res, errorResponse(error));
  }
}
