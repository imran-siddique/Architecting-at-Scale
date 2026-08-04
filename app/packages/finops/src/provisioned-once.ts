/**
 * The Provisioned-Once Rule and the review cadence.
 *
 * The cost that surprises you is always a platform service you configured once and never revisited.
 * Compute and storage are watched daily and rarely surprise. Backup, retention, replication, egress and
 * idle managed endpoints are set with a default and forgotten.
 *
 * The useful move is to make "watched daily" a property of the resource rather than an assumption, so a
 * resource that nobody looks at cannot be silently classified as safe.
 */

export type ResourceKind =
  // Watched daily. Rarely surprises.
  | 'compute'
  | 'storage'
  // Provisioned once. Where unexamined spend accumulates.
  | 'backup'
  | 'retention'
  | 'replication'
  | 'egress'
  | 'idle-managed-endpoint';

export const PROVISIONED_ONCE: readonly ResourceKind[] = [
  'backup',
  'retention',
  'replication',
  'egress',
  'idle-managed-endpoint',
];

export function isProvisionedOnce(k: ResourceKind): boolean {
  return PROVISIONED_ONCE.includes(k);
}

/**
 * The Review Cadence Rule: monthly for resources that scale with traffic, quarterly for the rest.
 * A resource with no interval at all is the default state, and it is the one the rule exists to
 * eliminate.
 */
export interface ProvisionedResource {
  name: string;
  kind: ResourceKind;
  monthlyUsd: number;
  scalesWithTraffic: boolean;
  reviewIntervalMonths: number | null;
  monthsSinceReview: number | null;
  owner: string | null;
}

export function requiredInterval(r: ProvisionedResource): number {
  return r.scalesWithTraffic ? 1 : 3;
}

export type ReviewStatus =
  | { status: 'ok' }
  | { status: 'never-reviewed'; monthlyUsd: number; reason: string }
  | { status: 'overdue'; monthlyUsd: number; monthsOverdue: number }
  | { status: 'interval-too-long'; monthlyUsd: number; required: number };

export function reviewStatus(r: ProvisionedResource): ReviewStatus {
  if (r.reviewIntervalMonths === null || r.monthsSinceReview === null) {
    return {
      status: 'never-reviewed',
      monthlyUsd: r.monthlyUsd,
      reason: 'set with a default and forgotten. This is where the unexamined spend accumulates.',
    };
  }
  const required = requiredInterval(r);
  if (r.reviewIntervalMonths > required) {
    return { status: 'interval-too-long', monthlyUsd: r.monthlyUsd, required };
  }
  if (r.monthsSinceReview > r.reviewIntervalMonths) {
    return { status: 'overdue', monthlyUsd: r.monthlyUsd, monthsOverdue: r.monthsSinceReview - r.reviewIntervalMonths };
  }
  return { status: 'ok' };
}

export interface CadenceReport {
  totalMonthlyUsd: number;
  unexaminedMonthlyUsd: number;
  unexaminedFraction: number;
  byStatus: Record<string, string[]>;
}

export function cadenceReport(resources: ProvisionedResource[]): CadenceReport {
  const byStatus: Record<string, string[]> = {};
  let unexaminedMonthlyUsd = 0;
  const totalMonthlyUsd = resources.reduce((a, r) => a + r.monthlyUsd, 0);

  for (const r of resources) {
    const s = reviewStatus(r);
    (byStatus[s.status] ??= []).push(r.name);
    if (s.status !== 'ok') unexaminedMonthlyUsd += r.monthlyUsd;
  }

  return {
    totalMonthlyUsd,
    unexaminedMonthlyUsd,
    unexaminedFraction: totalMonthlyUsd === 0 ? 0 : unexaminedMonthlyUsd / totalMonthlyUsd,
    byStatus,
  };
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The backup tier audit, which is the chapter's cleanest example of the rule paying off: $710 of
 * $1,180 was geo-redundancy on rebuildable replicas and 35-day retention on non-production.
 *
 * The condition that makes it zero-risk is the one to encode. Geo-redundancy is droppable only where
 * the data is rebuildable from source, and retention is cuttable only where no recovery objective or
 * regulatory hold depends on the longer window. Without those two guards this is a rule for deleting
 * backups.
 */
export interface BackupTier {
  name: string;
  monthlyUsd: number;
  geoRedundant: boolean;
  retentionDays: number;
  environment: 'production' | 'non-production';
  /** Can this data be rebuilt from a source of truth that is itself backed up? */
  rebuildableFromSource: boolean;
  /** A recovery objective or regulatory hold that depends on the current retention window. */
  retentionRequiredDays: number;
}

export interface BackupSaving {
  tier: string;
  monthlySavingUsd: number;
  changes: string[];
}

export function auditBackups(tiers: BackupTier[]): { savings: BackupSaving[]; totalMonthlyUsd: number; refused: string[] } {
  const savings: BackupSaving[] = [];
  const refused: string[] = [];

  for (const t of tiers) {
    const changes: string[] = [];
    let fraction = 0;

    if (t.geoRedundant && t.rebuildableFromSource) {
      changes.push('drop geo-redundancy: the data is rebuildable from a backed-up source');
      fraction += 0.4;
    }
    if (t.environment === 'non-production' && t.retentionDays > 7 && t.retentionRequiredDays <= 7) {
      changes.push(`cut retention from ${t.retentionDays} to 7 days: non-production, nothing depends on the longer window`);
      fraction += 0.4;
    }

    if (changes.length === 0) {
      refused.push(
        t.geoRedundant && !t.rebuildableFromSource
          ? `${t.name}: geo-redundancy retained, the data is not rebuildable from source`
          : `${t.name}: retention retained, a recovery objective depends on ${t.retentionRequiredDays} days`,
      );
      continue;
    }

    savings.push({ tier: t.name, monthlySavingUsd: t.monthlyUsd * fraction, changes });
  }

  return {
    savings,
    totalMonthlyUsd: savings.reduce((a, s) => a + s.monthlySavingUsd, 0),
    refused,
  };
}
