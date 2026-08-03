import { describe, expect, it } from 'vitest';
import { Shell, type MicroApp } from '../src/error-boundary.js';
import { EventBus, assertDataOnly } from '../src/event-bus.js';
import { StateRegistry } from '../src/state-ownership.js';
import { checkBudgets } from '../src/budget.js';

/**
 * Chapter 5's contract, asserted: your code ships in your pipeline, fails in your blast radius,
 * and recovers on your timeline.
 */

const app = (over: Partial<MicroApp> & Pick<MicroApp, 'name'>): MicroApp => ({
  team: 'unspecified',
  criticality: 'enhancement',
  render: () => `<${over.name}/>`,
  fallback: () => `<${over.name}-fallback/>`,
  ...over,
});

const shopflowShell = () =>
  new Shell()
    .register(app({ name: 'header', team: 'platform', criticality: 'critical-path', fallback: undefined }))
    .register(app({ name: 'product-detail', team: 'catalog', criticality: 'critical-path', fallback: undefined }))
    .register(app({ name: 'add-to-cart', team: 'checkout', criticality: 'critical-path', fallback: undefined }))
    .register(app({ name: 'recommendations', team: 'growth' }))
    .register(app({ name: 'reviews', team: 'catalog' }))
    .register(app({ name: 'live-chat', team: 'support' }));

describe('error boundary isolation (Figure 5.5)', () => {
  it('CLAIM: one micro-app crashing does not stop any other from rendering', () => {
    const shell = new Shell()
      .register(app({ name: 'search', team: 'search', render: () => { throw new Error('boom'); } }))
      .register(app({ name: 'cart', team: 'checkout' }))
      .register(app({ name: 'nav', team: 'platform', criticality: 'critical-path', fallback: undefined }));

    const r = shell.render();

    expect(r.crashed).toEqual(['search']);
    expect(r.output['cart']).toBe('<cart/>');
    expect(r.output['nav']).toBe('<nav/>');
    expect(r.output['search']).toBe('<search-fallback/>');
    expect(r.criticalPathIntact).toBe(true);
  });

  it('CLAIM: attributes the failure to a team, which is what Dave could not do', () => {
    const shell = new Shell()
      .register(app({ name: 'recommendations', team: 'growth', render: () => { throw new Error('x'); } }))
      .register(app({ name: 'cart', team: 'checkout' }));

    // "I can't even tell you which team's code caused the regression." Now you can.
    expect(shell.render().teamsAffected).toEqual(['growth']);
  });

  it('CLAIM: the Critical Path Doctrine holds when EVERY enhancement fails at once', () => {
    // Not one enhancement. All of them, simultaneously. That is the doctrine's actual wording,
    // and it is a stronger claim than "we have error boundaries".
    const report = Shell.assertCriticalPathSurvivesTotalEnhancementFailure(shopflowShell);

    expect(report.criticalPathIntact).toBe(true);
    expect(report.crashed.sort()).toEqual(['live-chat', 'recommendations', 'reviews']);
    expect(report.output['header']).toBe('<header/>');
    expect(report.output['add-to-cart']).toBe('<add-to-cart/>');
  });

  it('the doctrine check FAILS loudly when the critical path depends on an enhancement', () => {
    // The realistic regression: someone wires checkout to a recommendations widget. It looks
    // harmless in review and is invisible until the widget is down.
    let recommendationsUp = true;
    const coupled = () =>
      new Shell()
        .register(app({
          name: 'recommendations', team: 'growth',
          render: () => { if (!recommendationsUp) throw new Error('down'); return '<rec/>'; },
        }))
        .register(app({
          name: 'add-to-cart', team: 'checkout', criticality: 'critical-path', fallback: undefined,
          render: () => {
            if (!recommendationsUp) throw new Error('cannot render without recommendations');
            return '<atc/>';
          },
        }));

    recommendationsUp = false;
    expect(() => Shell.assertCriticalPathSurvivesTotalEnhancementFailure(coupled))
      .toThrow(/Critical Path Doctrine violated/);
  });

  it('refuses to register an enhancement with no fallback', () => {
    // A missing fallback is invisible until the crash it was meant to cover.
    expect(() => new Shell().register(app({ name: 'widget', fallback: undefined })))
      .toThrow(/no fallback/);
  });

  it('a fallback that also throws degrades to blank, not to a page crash', () => {
    const shell = new Shell().register(app({
      name: 'flaky', team: 'growth',
      render: () => { throw new Error('a'); },
      fallback: () => { throw new Error('b'); },
    }));
    const r = shell.render();
    expect(r.blank).toEqual(['flaky']);
    expect(r.criticalPathIntact).toBe(true);
  });

  it('refuses a duplicate registration', () => {
    const shell = new Shell().register(app({ name: 'dupe' }));
    expect(() => shell.register(app({ name: 'dupe' }))).toThrow(/already registered/);
  });
});

describe('the event bus carries data, not behaviour', () => {
  it('CLAIM: publishing a function is REJECTED', () => {
    // The moment one team ships a callback through the bus, the bus is a coupling mechanism and
    // the isolation is gone. The degradation is gradual, so it is refused at the first instance.
    const bus = new EventBus();
    expect(() => bus.publish('cart:updated', { itemCount: 3, onUpdate: () => {} }))
      .toThrow(/events carry data, not behaviour/);
  });

  it('rejects behaviour nested anywhere in the payload, and names the path', () => {
    expect(() => assertDataOnly({ a: { b: { c: () => {} } } })).toThrow(/payload\.a\.b\.c/);
    expect(() => assertDataOnly({ tag: Symbol('x') })).toThrow(/symbol/);
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic['self'] = cyclic;
    expect(() => assertDataOnly(cyclic)).toThrow(/cycle/);
  });

  it('delivers a fact to every subscriber and stops on unsubscribe', () => {
    const bus = new EventBus({ now: () => 1_700_000_000_000 });
    const seen: number[] = [];
    const off = bus.subscribe('cart:updated', (p) => seen.push(p['itemCount'] as number));

    bus.publish('cart:updated', { itemCount: 1 });
    bus.publish('cart:updated', { itemCount: 2 });
    off();
    bus.publish('cart:updated', { itemCount: 3 });

    expect(seen).toEqual([1, 2]);
  });

  it('CLAIM: a consumer that loads late still renders from the last known value', () => {
    // The cart badge initializes from the bus rather than from a global store, so a publisher
    // that has not loaded or has crashed leaves it showing the last count instead of nothing.
    const bus = new EventBus({ now: () => 1_700_000_000_000 });
    bus.publish('cart:updated', { itemCount: 4, subtotal: 8999 });

    expect(bus.lastKnown('cart:updated')).toMatchObject({ itemCount: 4, subtotal: 8999 });
    expect(bus.lastKnown('never:published')).toBeNull();
  });

  it('the delivered payload is frozen, so a consumer cannot mutate another app’s fact', () => {
    const bus = new EventBus();
    let received: Record<string, unknown> | null = null;
    bus.subscribe('order:placed', (p) => { received = p as Record<string, unknown>; });
    bus.publish('order:placed', { orderId: 'o-1' });

    expect(Object.isFrozen(received)).toBe(true);
  });
});

describe('the State Ownership Rule', () => {
  it('CLAIM: a second owner for the same state is REFUSED', () => {
    const reg = new StateRegistry().claim({ key: 'cart', owner: 'checkout', fallback: { items: 0 } });
    expect(() => reg.claim({ key: 'cart', owner: 'catalog', fallback: null }))
      .toThrow(/already owned by checkout/);
  });

  it('re-claiming by the same owner is idempotent, not an error', () => {
    const reg = new StateRegistry().claim({ key: 'cart', owner: 'checkout', fallback: null });
    expect(() => reg.claim({ key: 'cart', owner: 'checkout', fallback: { items: 0 } })).not.toThrow();
    expect(reg.ownerOf('cart')).toBe('checkout');
  });

  it('degrades to the declared fallback when the owner is unavailable', () => {
    const reg = new StateRegistry().claim({ key: 'cart', owner: 'checkout', fallback: { items: 0 } });

    expect(reg.read('cart', () => ({ items: 3 }))).toEqual({ value: { items: 3 }, degraded: false });
    expect(reg.read('cart', () => { throw new Error('checkout down'); }))
      .toEqual({ value: { items: 0 }, degraded: true });
  });

  it('refuses to read state that has no owner, rather than inventing a default', () => {
    expect(() => new StateRegistry().read('orphan', () => 1)).toThrow(/no owner registered/);
  });
});

describe('performance budgets with attribution', () => {
  const budgets = [
    { name: 'header', team: 'platform', jsBudgetKb: 60, blockingBudgetMs: 100 },
    { name: 'product-detail', team: 'catalog', jsBudgetKb: 180, blockingBudgetMs: 300 },
    { name: 'recommendations', team: 'growth', jsBudgetKb: 120, blockingBudgetMs: 200 },
  ];

  it('CLAIM: a regression is attributed to the team that caused it', () => {
    const r = checkBudgets(budgets, [
      { name: 'header', jsKb: 55, blockingMs: 90 },
      { name: 'product-detail', jsKb: 170, blockingMs: 280 },
      { name: 'recommendations', jsKb: 310, blockingMs: 640 },
    ]);

    expect(r.teamsResponsible).toEqual(['growth']);
    expect(r.over.map((f) => f.metric).sort()).toEqual(['blockingMs', 'jsKb']);
  });

  it('separates "report it" from "fail the build", per the Budget Visibility Rule', () => {
    const r = checkBudgets(budgets, [
      { name: 'header', jsKb: 66, blockingMs: 90 },            // 1.1x: over, not blocking
      { name: 'product-detail', jsKb: 400, blockingMs: 280 },  // 2.2x: hard gate
      { name: 'recommendations', jsKb: 100, blockingMs: 150 },
    ]);

    expect(r.over).toHaveLength(2);
    expect(r.breaching).toHaveLength(1);
    expect(r.breaching[0]).toMatchObject({ name: 'product-detail', metric: 'jsKb' });
  });

  it('passes cleanly when every app is inside its budget', () => {
    const r = checkBudgets(budgets, [
      { name: 'header', jsKb: 50, blockingMs: 80 },
      { name: 'product-detail', jsKb: 150, blockingMs: 250 },
      { name: 'recommendations', jsKb: 100, blockingMs: 150 },
    ]);
    expect(r.over).toEqual([]);
    expect(r.breaching).toEqual([]);
    expect(r.totalJsKb).toBe(300);
  });

  it('refuses a measurement for a micro-app nobody registered', () => {
    // An unregistered app has no budget and therefore no owner, which is the monolith problem
    // returning through the side door.
    expect(() => checkBudgets(budgets, [{ name: 'mystery-widget', jsKb: 900, blockingMs: 1200 }]))
      .toThrow(/unregistered micro-app/);
  });
});
