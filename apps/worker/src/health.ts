import { createServer, type Server } from "node:http";
import type { Logger } from "./logger.js";
import type { Poller } from "./services/poller.js";

/**
 * Minimal HTTP endpoint so the worker can also run as a Render "web service" (which requires a bound port).
 * GET /healthz → 200 {ok, lastLoopAt, intervalSec, ...}; 503 when the loop is lagging > 3× interval.
 * Started only when PORT (or HEALTH_PORT) is set; a true Background Worker leaves it unset.
 */
export function startHealthServer(port: number, poller: Poller, meta: { version: string; dryRun: boolean }, log: Logger): Server {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/healthz") || req.url === "/") {
      const s = poller.stats;
      const lagMs = s.lastLoopAt ? Date.now() - s.lastLoopAt : 0;
      const lagging = s.cycles > 0 && s.intervalSec > 0 && lagMs > 3 * s.intervalSec * 1000;
      res.writeHead(lagging ? 503 : 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: !lagging, ...meta, lastLoopAt: s.lastLoopAt ? new Date(s.lastLoopAt).toISOString() : null, lagMs, intervalSec: s.intervalSec, walletsPolled: s.walletsPolled, cycles: s.cycles }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(port, "0.0.0.0", () => log.info({ port }, "health server listening"));
  return server;
}
