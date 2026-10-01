import type { IncomingMessage, ServerResponse } from "node:http";
import { handleNode } from "../server/http.js";
export default (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || "/", "https://recicla.invalid");
  const path =
    url.searchParams.get("__authPath") ||
    url.pathname.replace(/^\/api\/auth\/?/, "");
  if (!/^[a-z-]+\/[a-z-]+$|^sign-out$/.test(path)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  return handleNode(req, res, "/api/auth/" + path);
};
