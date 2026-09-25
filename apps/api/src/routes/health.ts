import { Hono } from "hono";
import type { AppDeps } from "../app.js";

export function healthRoutes(deps: AppDeps): Hono {
  const r = new Hono();
  r.get("/health", (c) => {
    const ix = deps.indexer;
    const head = ix?.head();
    const latest = ix?.latestBlock;
    const lag = head !== undefined && latest !== undefined ? Number(latest > head ? latest - head : 0n) : null;
    return c.json({
      ok: true,
      chainId: deps.config.chainId,
      indexerHead: head !== undefined ? head.toString() : null,
      latestBlock: latest !== undefined ? latest.toString() : null,
      lag,
      ...(ix?.lastError ? { indexerError: ix.lastError } : {}),
    });
  });
  return r;
}
