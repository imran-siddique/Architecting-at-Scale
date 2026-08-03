import express from 'express';
import { searchRouter } from './routes/search.js';
import { zombieRouter } from './legacy/zombie-routes.js';
import { POOL_SIZE } from './db.js';
import { connectionsInUse, sustainableThroughput, utilization } from './saturation.js';

/**
 * ShopFlow at Stage 1: one process, one database, one deployable.
 *
 * Availability 99.0%, 5,000 orders/day, 450 of 500 connections in use, p99 latency 3.2s.
 * Everything is in here — catalog, search, orders, admin, the dead endpoints — because that
 * is what a monolith is, and the book spends fifteen chapters earning the right to change it.
 */
const app = express();
app.use(express.json());

app.use(searchRouter);
app.use(zombieRouter);

/**
 * The one piece of instrumentation Chapter 1 argues you cannot operate without: the saturation
 * headroom, derived rather than eyeballed. This is the snapshot the chapter opens with, computed
 * from whatever traffic the process is actually seeing.
 */
app.get('/internal/saturation', (req, res) => {
  const rps = Number(req.query.rps ?? 150);
  const holdMs = Number(req.query.holdMs ?? 3000);
  res.json({
    poolSize: POOL_SIZE,
    observedRps: rps,
    queryHoldMs: holdMs,
    connectionsInUse: Math.round(connectionsInUse(rps, holdMs)),
    tippingPointRps: Number(sustainableThroughput(POOL_SIZE, holdMs).toFixed(2)),
    utilization: Number(utilization(rps, POOL_SIZE, holdMs).toFixed(3)),
    note: 'Sustainable throughput = pool size / hold time (Little, 1961).',
  });
});

app.get('/health', (_req, res) => res.json({ ok: true, stage: 1 }));

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`ShopFlow monolith (Stage 1) listening on ${port}`));
}

export { app };
