import { createHash } from "node:crypto";
import { authDb } from "./db.js";
import { ApiError } from "./errors.js";
export async function limitLogin(email: string) {
  await limit(
    "email",
    email.trim().toLowerCase(),
    8,
    "Muitas tentativas para esta conta. Aguarde 15 minutos.",
  );
}
async function limit(
  namespace: string,
  identity: string,
  maximum: number,
  message: string,
) {
  const bucket = Math.floor(Date.now() / 900000);
  const key =
    namespace +
    ":" +
    createHash("sha256")
      .update(identity + ":" + bucket)
      .digest("hex");
  const rows = await authDb().$queryRaw<Array<{ count: number }>>`
    INSERT INTO "rateLimit" (id,key,count,"lastRequest") VALUES (gen_random_uuid(),${key},1,${BigInt(Date.now())})
    ON CONFLICT (key) DO UPDATE SET count="rateLimit".count+1 RETURNING count`;
  if (rows[0].count > maximum) throw new ApiError(429, message, "RATE_LIMITED");
}
export async function limitSetup(clientIp: string, token: string) {
  const message = "Muitas tentativas de ativação. Aguarde 15 minutos.";
  await limit("setup-ip", clientIp, 8, message);
  await limit("setup-installation", token, 64, message);
}
