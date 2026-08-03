import { Router } from 'express';
import { db, POOL_SIZE } from '../db.js';

/**
 * The ShopFlow "Legacy" Search.
 *
 * This is the listing from Chapter 1, kept deliberately intact. A simple, synchronous query
 * that worked fine for 100 users and becomes the bottleneck for the whole system at 5,000
 * orders a day. Nothing here is a mistake anyone would flag in review, that is the point of
 * the chapter. It is correct code with a scaling property nobody measured.
 *
 * Do not "fix" this file. Chapter 2 onward is where it gets fixed, and the git history is
 * the argument. `test/full-table-scan.spec.ts` and `test/pool-saturation.spec.ts` demonstrate
 * exactly why it fails, in numbers.
 */
export const searchRouter = Router();

searchRouter.get('/search', async (req, res) => {
  const query = String(req.query.q ?? '');

  // SCALABILITY TIME BOMB:
  // This 'LIKE' query forces a full table scan.
  // As the 'products' table grows to 100k rows, this locks the database CPU.
  //
  // A leading-wildcard LIKE cannot use a B-tree index: the index is ordered by prefix, and
  // '%oak%' has no prefix to seek on. So every row is read and every description compared.
  try {
    const products = await db.query('SELECT * FROM products WHERE description LIKE ?', [
      `%${query}%`,
    ]);

    // If the DB takes 3 seconds, the connection is held open for 3 seconds.
    // With 500 connections and a ~3s hold, ~166 requests/second
    // is enough to saturate the pool and stall every request.
    //
    // That is Little's Law, not a rule of thumb: sustainable throughput = pool size / hold
    // time. See `test/littles-law.spec.ts`, which asserts the 166 figure from the chapter.
    res.json(products);
  } catch (err) {
    // "Dave's Log Cleaner" is needed because we log full error stacks to disk.
    // Every 500 writes an unbounded stack trace to the local disk with no rotation, which is
    // why a human is clearing logs every four hours to stop the volume filling up. The
    // failure is not the logging; it is that recovery depends on a person remembering.
    console.error(err);
    res.status(500).send('Server Error');
  }
});

/** Exposed so the diagnostics endpoint can report what the chapter's telemetry snapshot shows. */
export const searchPoolSize = POOL_SIZE;
