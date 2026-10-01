import { createHash } from "node:crypto";
import { authDb } from "./db.js";
import { ApiError } from "./errors.js";
export async function limitLogin(email: string) {
  const bucket = Math.floor(Date.now() / 900000);
  const key =
    "email:" +
    createHash("sha256")
      .update(email.trim().toLowerCase() + ":" + bucket)
      .digest("hex");
  const rows = await authDb().$queryRaw<Array<{ count: number }>>`
    INSERT INTO "rateLimit" (id,key,count,"lastRequest") VALUES (gen_random_uuid(),${key},1,${BigInt(Date.now())})
    ON CONFLICT (key) DO UPDATE SET count="rateLimit".count+1 RETURNING count`;
  if (rows[0].count > 8)
    throw new ApiError(
      429,
      "Muitas tentativas para esta conta. Aguarde 15 minutos.",
      "RATE_LIMITED",
    );
}
