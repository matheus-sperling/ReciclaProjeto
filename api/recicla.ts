import type { IncomingMessage, ServerResponse } from "node:http";
import { handleNode } from "../server/http.ts";
export default (req: IncomingMessage, res: ServerResponse) =>
  handleNode(req, res);
