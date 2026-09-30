/**
 * ─── Managing posting profiles (ADR-040 §4) ─────────────────────────────────────
 *
 * A posting profile maps a stable code (what a supplier bill line names) onto the GL account it
 * posts to. Until ADR-040 they were read-only — created only by the seed — so a supplier bill
 * could not be raised in an organisation the seed never ran against.
 *
 * Re-pointing a profile adds a new effective-dated version; the old version stays, so a bill
 * posted last year still resolves to the account it was posted to.
 */

import { currentVersion } from './account-display';
import type { Account, AccountClass, PostingProfile, PostingProfileVersion } from './types';

export interface CreatePostingProfileBody {
  code: string;
  name: string;
  accountCode: string;
  effectiveFrom?: string;
}

export interface RepointPostingProfileBody {
  name?: string;
  accountCode: string;
  effectiveFrom: string;
}

/** The classes a profile may point at — the ones a bill line or revenue flow posts to. */
export const PROFILE_TARGET_CLASSES: readonly AccountClass[] = [
  'INCOME',
  'COST_OF_SALES',
  'EXPENSE',
];

/** The newest version — the controller returns only that one (`take: 1`). */
export function latestProfileVersion(profile: PostingProfile): PostingProfileVersion | null {
  if (profile.versions.length === 0) return null;
  return profile.versions.reduce((latest, v) =>
    v.versionNumber > latest.versionNumber ? v : latest,
  );
}

/** "Site materials" → "SITE_MATERIALS". Capped at 50 characters. */
export function profileCodeFromName(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/g, '');
}

export const PROFILE_CODE_PATTERN = /^[A-Z0-9_]{1,50}$/;

/**
 * The accounts a profile may point at: ACTIVE, open to posting, in INCOME / COST_OF_SALES /
 * EXPENSE. Headings and control accounts are excluded — the server answers
 * `POSTING_PROFILE_ACCOUNT_INVALID` for them. Sorted by code.
 */
export function profileTargetAccounts(accounts: readonly Account[]): Account[] {
  return accounts
    .filter((account) => {
      if (account.status !== 'ACTIVE') return false;
      const version = currentVersion(account);
      return Boolean(
        version &&
        version.isPostingAllowed &&
        !version.isControlAccount &&
        PROFILE_TARGET_CLASSES.includes(version.accountClass),
      );
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type CreateProfileProblem = 'name' | 'code' | 'code-taken' | 'account';

export function createProfileProblems(
  draft: { name: string; code: string; accountCode: string },
  takenCodes: ReadonlySet<string>,
): CreateProfileProblem[] {
  const problems: CreateProfileProblem[] = [];
  if (!draft.name.trim()) problems.push('name');
  const code = draft.code.trim();
  if (!PROFILE_CODE_PATTERN.test(code)) problems.push('code');
  else if (takenCodes.has(code)) problems.push('code-taken');
  if (!draft.accountCode) problems.push('account');
  return problems;
}

export type RepointProblem = 'account' | 'same-account' | 'effective-from' | 'effective-from-early';

/**
 * A re-point is a new version, so it must start after the latest one does (the server answers
 * `POSTING_PROFILE_VERSION_INVALID` otherwise), and it must actually change the account.
 */
export function repointProblems(
  draft: { accountCode: string; effectiveFrom: string },
  latest: { accountCode: string | null; effectiveFrom: string | null },
): RepointProblem[] {
  const problems: RepointProblem[] = [];
  if (!draft.accountCode) problems.push('account');
  else if (draft.accountCode === latest.accountCode) problems.push('same-account');
  if (!ISO_DATE.test(draft.effectiveFrom)) problems.push('effective-from');
  else if (latest.effectiveFrom && draft.effectiveFrom <= latest.effectiveFrom.slice(0, 10)) {
    problems.push('effective-from-early');
  }
  return problems;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `yyyy-MM-dd` shifted by whole days, computed in UTC so no timezone moves the date. */
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The first date a re-point may take effect: today, or the day after the latest version starts. */
export function earliestRepointDate(latestEffectiveFrom: string | null, today: string): string {
  if (!latestEffectiveFrom) return today;
  const after = shiftIsoDate(latestEffectiveFrom, 1);
  return after > today ? after : today;
}

/**
 * What the profile points at today: the server's `currentAccount`, else the in-force version's
 * own account label. `null` when no version is in force yet (a profile created future-dated).
 */
export function profileTarget(
  profile: PostingProfile,
  today: string,
): {
  code: string;
  name: string | null;
  accountClass: AccountClass | null;
  accountId: string;
} | null {
  if (profile.currentAccount) {
    return {
      code: profile.currentAccount.code,
      name: profile.currentAccount.name,
      accountClass: profile.currentAccount.accountClass,
      accountId: profile.currentAccount.id,
    };
  }
  const inForce = profileVersionOn(profile, today);
  if (!inForce?.accountCode) return null;
  return {
    code: inForce.accountCode,
    name: inForce.accountName ?? null,
    accountClass: null,
    accountId: inForce.accountId,
  };
}

/** The version covering `date` — `[effectiveFrom, effectiveTo)`. */
export function profileVersionOn(
  profile: PostingProfile,
  date: string,
): PostingProfileVersion | null {
  return (
    profile.versions.find((v) => {
      const from = v.effectiveFrom.slice(0, 10);
      const to = v.effectiveTo?.slice(0, 10) ?? null;
      return from <= date && (to === null || date < to);
    }) ?? null
  );
}

/** The latest version when it starts after `today` — a re-point that has not taken effect yet. */
export function scheduledVersion(
  profile: PostingProfile,
  today: string,
): PostingProfileVersion | null {
  const latest = latestProfileVersion(profile);
  return latest && latest.effectiveFrom.slice(0, 10) > today ? latest : null;
}

export function toCreateProfileBody(draft: {
  name: string;
  code: string;
  accountCode: string;
  effectiveFrom: string;
}): CreatePostingProfileBody {
  return {
    code: draft.code.trim(),
    name: draft.name.trim(),
    accountCode: draft.accountCode,
    ...(draft.effectiveFrom ? { effectiveFrom: draft.effectiveFrom } : {}),
  };
}

/** Today as `yyyy-MM-dd` in local time. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
