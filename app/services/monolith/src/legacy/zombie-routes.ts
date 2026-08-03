import { Router } from 'express';

/**
 * Zombie endpoints.
 *
 * Every one of these is reachable, authenticated by nothing in particular, and called by no
 * client. They are here because Chapter 1's second Architect's Prompt — the Zombie Hunter —
 * exists to find exactly this, and a prompt with nothing to find teaches nothing.
 *
 * The cost is not the dead code. It is that each one is attack surface, each one appears in
 * every dependency audit, and each one has to be reasoned about during any refactor because
 * nobody can prove it is unused. That last property is what makes them expensive: the work is
 * in establishing the absence of a caller.
 *
 * Run Prompt 1.2 against this file and the client folder to see the intended workflow.
 */
export const zombieRouter = Router();

// Added for a 2019 mobile app that was cancelled before launch.
zombieRouter.get('/v1/legacy/product-feed.xml', (_req, res) => {
  res.type('application/xml').send('<products/>');
});

// Replaced by /search two years ago. Never removed, still indexed by crawlers.
zombieRouter.get('/v1/product-lookup', (_req, res) => {
  res.json({ deprecated: true, use: '/search' });
});

// A debug helper someone shipped to production during an incident.
zombieRouter.get('/v1/debug/echo-headers', (req, res) => {
  res.json(req.headers); // leaks cookies and auth headers to anyone who asks
});

// Batch import for a partner integration that ended in 2021.
zombieRouter.post('/v1/partners/bulk-import', (_req, res) => {
  res.status(202).json({ accepted: true });
});

// The original admin price override. No authorization check; there never was one, because
// when it was written the endpoint was not routable from outside the office network.
zombieRouter.post('/v1/admin/price-override', (_req, res) => {
  res.status(200).json({ ok: true });
});
