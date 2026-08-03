import { describe, expect, it } from 'vitest';

/**
 * Why `LIKE '%oak%'` cannot use an index, demonstrated by counting comparisons.
 *
 * The chapter states that the leading-wildcard LIKE forces a full table scan. That is a claim
 * about access paths, and it is worth being able to *see* rather than take on faith — so this
 * models both access paths over the same data and counts the rows each one touches.
 *
 * A B-tree is ordered by prefix. `'oak%'` has a prefix to seek on, so the engine descends to
 * the first match and walks forward. `'%oak%'` does not, so there is nowhere to seek: every
 * row must be read and every value compared. No amount of indexing changes that, which is why
 * Chapter 10 reaches for a search engine rather than another index.
 */

interface Row {
  id: number;
  description: string;
}

function makeTable(n: number): Row[] {
  const words = ['oak', 'linen', 'ceramic', 'brass', 'walnut', 'glass'];
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    // Deterministic, so comparison counts are stable across runs.
    description: `${words[i % words.length]} item ${i} for the home`,
  }));
}

/** Full table scan: read every row, compare every value. What `LIKE '%x%'` compiles to. */
function scanContains(rows: Row[], needle: string): { matches: number; rowsRead: number } {
  let matches = 0;
  let rowsRead = 0;
  for (const r of rows) {
    rowsRead++;
    if (r.description.includes(needle)) matches++;
  }
  return { matches, rowsRead };
}

/**
 * Index range seek: binary search to the first key with the prefix, then walk while it holds.
 * What `LIKE 'x%'` can compile to when the column is indexed.
 */
function seekPrefix(sorted: Row[], prefix: string): { matches: number; rowsRead: number } {
  let lo = 0;
  let hi = sorted.length;
  let rowsRead = 0;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    rowsRead++; // an index page touched
    if (sorted[mid]!.description < prefix) lo = mid + 1;
    else hi = mid;
  }
  let matches = 0;
  for (let i = lo; i < sorted.length && sorted[i]!.description.startsWith(prefix); i++) {
    rowsRead++;
    matches++;
  }
  return { matches, rowsRead };
}

describe("the legacy search route's access path", () => {
  it('CLAIM: a leading-wildcard LIKE reads every row in the table', () => {
    const rows = makeTable(100_000); // the chapter's "as the products table grows to 100k rows"
    const { matches, rowsRead } = scanContains(rows, 'oak');

    expect(matches).toBeGreaterThan(0);
    expect(rowsRead).toBe(100_000); // every single row, to answer one search
  });

  it('CLAIM: scan cost grows linearly with the table — this is the time bomb', () => {
    // The route was written when the table was small. Nothing about the code changed; the
    // data grew. That is the entire mechanism behind "worked fine for 100 users".
    const small = scanContains(makeTable(1_000), 'oak');
    const large = scanContains(makeTable(100_000), 'oak');

    expect(small.rowsRead).toBe(1_000);
    expect(large.rowsRead).toBe(100_000);
    expect(large.rowsRead / small.rowsRead).toBe(100); // 100x the data, 100x the work
  });

  it('an indexable prefix search over the same data touches a tiny fraction of it', () => {
    const sorted = makeTable(100_000).sort((a, b) =>
      a.description < b.description ? -1 : a.description > b.description ? 1 : 0,
    );
    const seek = seekPrefix(sorted, 'oak');
    const scan = scanContains(sorted, 'oak');

    expect(seek.matches).toBeGreaterThan(0);
    // ~17 index pages to seek, plus the matches themselves - versus 100,000 rows.
    expect(seek.rowsRead).toBeLessThan(scan.rowsRead / 4);
  });

  it('the hold time is the consequence, and the hold time is what saturates the pool', () => {
    // Chapter 1's causal chain in one assertion: rows read -> query duration -> connection
    // held -> pool exhausted. The scan is not slow because the database is weak; it is slow
    // because it was asked to read everything, and it holds a connection for the whole time.
    const rowsRead = scanContains(makeTable(100_000), 'oak').rowsRead;
    const microsecondsPerRow = 30; // ~3s over 100k rows, matching the chapter's stated hold
    const holdMs = (rowsRead * microsecondsPerRow) / 1000;

    expect(holdMs).toBeCloseTo(3000, -2); // the ~3s hold the search route comments describe
  });
});
