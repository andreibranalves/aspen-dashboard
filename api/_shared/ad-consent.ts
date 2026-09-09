export const AD_CONSENT_POLICY_VERSION = '2026-08-18' as const;
export const AD_CONSENT_SOURCE = 'site_cookie_preferences' as const;

export interface AdConsentEvidence {
  adUserData: 'CONSENT_GRANTED';
  adPersonalization: 'CONSENT_GRANTED';
  policyVersion: typeof AD_CONSENT_POLICY_VERSION;
  reviewedAt: string;
  source: typeof AD_CONSENT_SOURCE;
  evidenceId?: string;
}

const REQUIRED_FIELDS = [
  'adPersonalization',
  'adUserData',
  'policyVersion',
  'reviewedAt',
  'source',
] as const;
const EVIDENCE_ID_PATTERN = /^[\w-]{1,128}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalRfc3339(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length !== 24 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    return false;
  }
  const instant = Date.parse(value);
  return Number.isFinite(instant) && new Date(instant).toISOString() === value;
}

export function parseAdConsentEvidence(value: unknown): AdConsentEvidence | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort();
  const allowed =
    value.evidenceId === undefined
      ? [...REQUIRED_FIELDS]
      : [...REQUIRED_FIELDS, 'evidenceId'].sort();
  if (keys.length !== allowed.length || keys.some((key, index) => key !== allowed[index])) {
    return null;
  }
  if (
    value.adUserData !== 'CONSENT_GRANTED' ||
    value.adPersonalization !== 'CONSENT_GRANTED' ||
    value.policyVersion !== AD_CONSENT_POLICY_VERSION ||
    !isCanonicalRfc3339(value.reviewedAt) ||
    value.source !== AD_CONSENT_SOURCE ||
    (value.evidenceId !== undefined &&
      (typeof value.evidenceId !== 'string' || !EVIDENCE_ID_PATTERN.test(value.evidenceId)))
  ) {
    return null;
  }
  return {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_GRANTED',
    policyVersion: AD_CONSENT_POLICY_VERSION,
    reviewedAt: value.reviewedAt,
    source: AD_CONSENT_SOURCE,
    ...(value.evidenceId !== undefined ? { evidenceId: value.evidenceId } : {}),
  };
}
