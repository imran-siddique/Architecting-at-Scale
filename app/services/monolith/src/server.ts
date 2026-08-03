import express from 'express';
import { correlationMiddleware } from '@shopflow/platform';
import { searchRouter } from './routes/search.js';
import { zombieRouter } from './legacy/zombie-routes.js';
import { POOL_SIZE } from './db.js';
import { connectionsInUse, sustainableThroughput, utilization } from './saturation.js';

/**
 * ShopFlow: one process, one database, one deployable.
 *
 * Stage 1 (Chapter 1): availability 99.0%, 5,000 orders/day, 450 of 500 connections, p99 3.2s.
 * Stage 2 (Chapter 2): the biggest instance AWS sells, 4,800 of 5,000 connections, $2,500/mo.
 * Vertical scaling bought headroom and changed nothing structural - which is the finding.
 *
 * Everything is still in here — catalog, search, orders, admin, the dead endpoints — because
 * that is what a monolith is, and the book spends fifteen chapters earning the right to change
 * it. What Chapter 2 adds is the two things that make horizontal scaling *possible* later:
 * externalized session state and a correlation ID minted at the edge.
 */
const app = express();

// Chapter 2. Mounted FIRST, before anything that logs, so every downstream line can carry the
// ID - and echoed back on the response so a customer reporting a failure can hand you the exact
// identifier instead of an approximate timestamp.
app.use(correlationMiddleware());
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

app.get('/health', (req, res) =>
  res.json({ ok: true, stage: 2, correlationId: req.correlation?.correlationId }));

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => console.log(`ShopFlow monolith (Stage 1) listening on ${port}`));
}

export { app };
