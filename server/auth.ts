import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, twoFactor } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { authDb } from "./db.js";
import { ApiError } from "./errors.js";
import type { Role, User } from "../shared/contracts.js";
let instance: ReturnType<typeof buildAuth> | undefined;
export function buildAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || !process.env.APP_ORIGIN)
    throw new Error("AUTH_NOT_CONFIGURED");
  return betterAuth({
    secret,
    baseURL: process.env.APP_ORIGIN,
    basePath: "/api/auth",
    trustedOrigins: [process.env.APP_ORIGIN],
    database: prismaAdapter(authDb(), {
      provider: "postgresql",
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        municipioId: { type: "string", required: false, input: false },
        ativo: { type: "boolean", defaultValue: true, input: false },
        deletedAt: {
          type: "date",
          required: false,
          input: false,
          returned: false,
        },
        mustChangePassword: {
          type: "boolean",
          defaultValue: true,
          input: false,
        },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: process.env.NODE_ENV === "production",
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict" },
      ipAddress: { ipAddressHeaders: ["x-recicla-client-ip"] },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: { "/sign-in/email": { window: 900, max: 100 } },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const u = await authDb().user.findUnique({
              where: { id: session.userId },
              include: { municipio: true },
            });
            if (
              !u ||
              !u.ativo ||
              u.deletedAt ||
              (u.role !== "administrador" && !u.municipio?.ativo)
            )
              return false;
          },
        },
      },
    },
    plugins: [
      admin({
        defaultRole: "coletor",
        adminRoles: ["administrador"],
        roles: { administrador: adminAc, gestor: userAc, coletor: userAc },
      }),
      twoFactor({ issuer: "Recicla+", totpOptions: { digits: 6, period: 30 } }),
    ],
  });
}
export const auth = () => (instance ??= buildAuth());
export const resetAuth = () => {
  instance = undefined;
};
export async function principal(
  headers: Headers,
  allowPending = false,
): Promise<User> {
  const session = await auth().api.getSession({ headers });
  if (!session)
    throw new ApiError(401, "Entre novamente para continuar.", "AUTH_REQUIRED");
  const u = await authDb().user.findUnique({
    where: { id: session.user.id },
    include: { municipio: true },
  });
  if (
    !u ||
    !u.ativo ||
    u.deletedAt ||
    (u.role !== "administrador" && !u.municipio?.ativo)
  )
    throw new ApiError(
      401,
      "Sua conta ou município está indisponível.",
      "AUTH_REQUIRED",
    );
  const user: User = {
    id: u.id,
    nome: u.name,
    email: u.email,
    role: u.role as Role,
    municipioId: u.municipioId,
    municipio: u.municipio,
    ativo: u.ativo,
    mustChangePassword: u.mustChangePassword,
    twoFactorEnabled: u.twoFactorEnabled,
  };
  if (!allowPending) {
    if (user.mustChangePassword)
      throw new ApiError(
        403,
        "Troque sua senha inicial para continuar.",
        "PASSWORD_CHANGE_REQUIRED",
      );
    if (user.role === "administrador" && !user.twoFactorEnabled)
      throw new ApiError(
        403,
        "Configure a verificação em duas etapas.",
        "MFA_SETUP_REQUIRED",
      );
  }
  return user;
}
