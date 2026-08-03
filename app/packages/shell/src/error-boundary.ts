/**
 * Figure 5.5: Error Boundary Isolation, and the Critical Path Doctrine.
 *
 * Chapter 5's contract for a micro-frontend is one sentence: your code ships in your pipeline,
 * fails in your blast radius, and recovers on your timeline. Dave's complaint is the absence of
 * it: "It's all one giant bundle. We rolled back everything because we couldn't roll back
 * anything."
 *
 * The Critical Path Doctrine states the acceptance test for a page: it must render and function
 * even if every enhancement component fails simultaneously. Not one of them. All of them. That
 * is a stronger claim than "we have error boundaries", and it is the one worth asserting.
 */

export type Criticality = 'critical-path' | 'enhancement';

export interface MicroApp {
  name: string;
  /** Owning team, because an unattributable regression is Dave's actual problem. */
  team: string;
  criticality: Criticality;
  /** Render the app. Throwing simulates any client-side crash. */
  render: () => string;
  /**
   * What to show instead when `render` throws. An enhancement without a fallback is not
   * degradable, it is just absent, so the registry insists on one.
   */
  fallback?: () => string;
}

export interface RenderReport {
  /** Rendered output per micro-app, or its fallback, keyed by name. */
  output: Record<string, string>;
  crashed: string[];
  /** Micro-apps that crashed AND had no fallback, so the user sees nothing there. */
  blank: string[];
  /** True when every critical-path app rendered. The doctrine's pass condition. */
  criticalPathIntact: boolean;
  /** Teams whose code crashed. Attribution is the point of the split. */
  teamsAffected: string[];
}

export class Shell {
  private readonly apps: MicroApp[] = [];

  /**
   * Register a micro-app.
   *
   * An enhancement must supply a fallback. The Shell Gravity Rule says every Shell capability
   * becomes a cross-team dependency, so the Shell should enforce as little as possible; this is
   * one of the few things worth enforcing, because a missing fallback is invisible until the
   * crash it was meant to cover.
   */
  register(app: MicroApp): this {
    if (this.apps.some((a) => a.name === app.name)) {
      throw new Error(`micro-app already registered: ${app.name}`);
    }
    if (app.criticality === 'enhancement' && !app.fallback) {
      throw new Error(
        `enhancement "${app.name}" has no fallback: it would degrade to a blank region`,
      );
    }
    this.apps.push(app);
    return this;
  }

  /**
   * Render the page. A crash in one micro-app is caught, its fallback substituted, and every
   * other micro-app renders normally. Nothing here rethrows, which is the entire difference
   * between this and one bundle.
   */
  render(): RenderReport {
    const output: Record<string, string> = {};
    const crashed: string[] = [];
    const blank: string[] = [];
    const teams = new Set<string>();
    let criticalPathIntact = true;

    for (const app of this.apps) {
      try {
        output[app.name] = app.render();
      } catch {
        crashed.push(app.name);
        teams.add(app.team);
        if (app.criticality === 'critical-path') criticalPathIntact = false;
        if (app.fallback) {
          try {
            output[app.name] = app.fallback();
          } catch {
            // A fallback that also throws is a blank region, not a crash of the page.
            blank.push(app.name);
          }
        } else {
          blank.push(app.name);
        }
      }
    }

    return {
      output,
      crashed,
      blank,
      criticalPathIntact,
      teamsAffected: [...teams],
    };
  }

  /** Names of registered apps by criticality. Used by the doctrine check below. */
  namesBy(criticality: Criticality): string[] {
    return this.apps.filter((a) => a.criticality === criticality).map((a) => a.name);
  }

  /**
   * The Critical Path Doctrine as an executable check: fail every enhancement at once and
   * confirm the critical path still renders.
   *
   * Worth running in CI rather than trusting by inspection, because the failure mode is a
   * dependency someone added from checkout to a recommendations widget, which looks harmless in
   * review and is invisible until the widget is down.
   */
  static assertCriticalPathSurvivesTotalEnhancementFailure(build: () => Shell): RenderReport {
    const shell = build();
    const enhancements = new Set(shell.namesBy('enhancement'));

    const sabotaged = new Shell();
    for (const app of shell.apps) {
      sabotaged.register(
        enhancements.has(app.name)
          ? { ...app, render: () => { throw new Error(`forced failure: ${app.name}`); } }
          : app,
      );
    }

    const report = sabotaged.render();
    if (!report.criticalPathIntact) {
      throw new Error(
        `Critical Path Doctrine violated: ${report.crashed
          .filter((n) => !enhancements.has(n))
          .join(', ')} failed when enhancements were disabled`,
      );
    }
    return report;
  }
}
