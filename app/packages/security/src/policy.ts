/**
 * Default-deny service-to-service authorization.
 *
 * Chapter 3's tactic is the allowlist: explicitly deny all ingress by default, then permit the
 * specific calls the architecture actually requires. The chapter uses OPA/Rego for this in
 * production; what is here is the same decision model in TypeScript so the *properties* can be
 * asserted, and so that the Tool Tax the chapter names (a declarative language to learn and a policy
 * engine in the deploy path) is visible as a real trade rather than a footnote.
 *
 * The terminology is deliberate. `allowlist` and `denylist`, never the older pair. See the
 * inclusive-language decision recorded for the whole book.
 *
 * Two properties matter more than the implementation, and both are tested:
 *
 *   1. An unlisted call is denied. Not logged-and-allowed, not allowed-with-a-warning.
 *   2. Adding a new service grants it nothing. This is what makes Assume Breach tractable: a
 *      compromised workload inherits no reachability it was not explicitly given.
 */

export interface Grant {
  /** Calling workload identity. */
  caller: string;
  /** Called workload identity. */
  callee: string;
  /** Operations permitted on the callee. `*` is rejected at construction; see below. */
  operations: string[];
  /** Why this grant exists. Required, because an unexplained grant is one nobody dares remove. */
  justification: string;
}

export interface Action {
  caller: string;
  callee: string;
  operation: string;
  /** Scopes carried by the caller's verified workload token. */
  callerScopes?: string[];
}

export type Decision =
  | { allow: true; matched: Grant }
  | { allow: false; reason: 'no-matching-grant' | 'operation-not-granted' | 'scope-not-held' };

export class PolicyEngine {
  private readonly grants: Grant[];

  constructor(grants: Grant[]) {
    for (const g of grants) {
      // A wildcard operation is how an allowlist quietly becomes a denylist. Refused at
      // construction rather than at review time, because review time is optional.
      if (g.operations.includes('*')) {
        throw new Error(
          `wildcard operation in grant ${g.caller} -> ${g.callee}: enumerate the operations instead`,
        );
      }
      if (g.operations.length === 0) {
        throw new Error(`empty grant ${g.caller} -> ${g.callee}: remove it rather than leaving it`);
      }
      if (!g.justification.trim()) {
        throw new Error(`grant ${g.caller} -> ${g.callee} has no justification`);
      }
    }
    this.grants = grants;
  }

  /**
   * Decide one action. Default deny: if nothing explicitly permits it, it is refused.
   *
   * Returns a structured reason rather than a boolean, because the reason is what makes the
   * audit trail useful and the on-call debuggable. "Denied" with no cause is how teams end up
   * disabling the policy engine to ship a fix.
   */
  decide(action: Action): Decision {
    const forPair = this.grants.filter(
      (g) => g.caller === action.caller && g.callee === action.callee,
    );
    if (forPair.length === 0) return { allow: false, reason: 'no-matching-grant' };

    const matched = forPair.find((g) => g.operations.includes(action.operation));
    if (!matched) return { allow: false, reason: 'operation-not-granted' };

    // Belt and braces: the grant permits it AND the caller's verified token must carry the
    // scope. Two independent controls, so a policy mistake alone is not sufficient to authorize.
    if (action.callerScopes !== undefined && !action.callerScopes.includes(action.operation)) {
      return { allow: false, reason: 'scope-not-held' };
    }

    return { allow: true, matched };
  }

  /** Every workload this caller can reach. Used by the blast-radius model. */
  reachableFrom(caller: string): string[] {
    return [...new Set(this.grants.filter((g) => g.caller === caller).map((g) => g.callee))];
  }
}

/**
 * ShopFlow's actual allowlist at the Chapter 3 state.
 *
 * Note what is absent. Nothing reaches Payments except Orders, nothing reaches the database
 * directly, and no service has a grant to the admin operations. That is the difference between
 * this and the "open door" the chapter opens with.
 */
export const SHOPFLOW_GRANTS: Grant[] = [
  {
    caller: 'api-gateway',
    callee: 'auth',
    operations: ['session.read', 'session.create'],
    justification: 'The gateway resolves a session before routing any authenticated request.',
  },
  {
    caller: 'api-gateway',
    callee: 'catalog',
    operations: ['product.read', 'product.search'],
    justification: 'Browse and search are served through the gateway.',
  },
  {
    caller: 'cart',
    callee: 'inventory',
    operations: ['stock.read', 'stock.reserve'],
    justification: 'Adding to cart checks availability; checkout reserves it.',
  },
  {
    caller: 'orders',
    callee: 'inventory',
    operations: ['stock.reserve', 'stock.release'],
    justification: 'Order placement reserves stock and releases it on cancellation.',
  },
  {
    caller: 'orders',
    callee: 'payments',
    operations: ['payment.authorize', 'payment.capture'],
    justification: 'Only Orders may move money, and only for an order it owns.',
  },
];
