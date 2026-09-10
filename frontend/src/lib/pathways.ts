/**
 * Centralized Academic Pathway definitions and canonicalization.
 *
 * Defines canonical DB codes, legacy alias resolution, and compatibility rules.
 * Kept strictly synchronized with backend/app/core/pathways.py.
 */

export const CANONICAL_PATHWAYS = {
  MEDICAL: "medical-courses",
  ENGINEERING: "engineering-math",
  BOTH: "both",
  GENERAL: "general",
} as const;

export type CanonicalPathway =
  | (typeof CANONICAL_PATHWAYS)[keyof typeof CANONICAL_PATHWAYS]
  | string;

export const PATHWAY_ALIAS_MAP: Record<string, string> = {
  // Canonical DB codes
  "medical-courses": CANONICAL_PATHWAYS.MEDICAL,
  "engineering-math": CANONICAL_PATHWAYS.ENGINEERING,
  "general": CANONICAL_PATHWAYS.GENERAL,
  "both": CANONICAL_PATHWAYS.BOTH,
  // In-use legacy aliases
  "stem_medical": CANONICAL_PATHWAYS.MEDICAL,
  "stem_engineering": CANONICAL_PATHWAYS.ENGINEERING,
};

/**
 * Normalizes any pathway code or alias to its canonical value.
 */
export function canonicalizePathway(raw?: string | null): string {
  if (!raw) return CANONICAL_PATHWAYS.GENERAL;
  const normalized = String(raw).trim().toLowerCase();
  return PATHWAY_ALIAS_MAP[normalized] ?? normalized;
}

/**
 * Checks if a subject offering's pathway is compatible with a class's pathway.
 */
export function isOfferingCompatibleWithClass(
  offeringPathway?: string | null,
  classPathway?: string | null
): boolean {
  const canonOffering = canonicalizePathway(offeringPathway);
  const canonClass = canonicalizePathway(classPathway);

  if (canonOffering === CANONICAL_PATHWAYS.BOTH) {
    return true;
  }
  if (canonOffering === canonClass) {
    return true;
  }
  if (canonOffering === CANONICAL_PATHWAYS.GENERAL && canonClass === CANONICAL_PATHWAYS.GENERAL) {
    return true;
  }

  return false;
}

/**
 * Returns human-readable label for a pathway, using the loaded pathways list from DB if available.
 */
export function getPathwayDisplayName(
  code?: string | null,
  pathwaysList?: Array<{ code: string; name: string }>
): string {
  const canon = canonicalizePathway(code);
  if (canon === CANONICAL_PATHWAYS.BOTH) return "Shared / All Pathways";
  if (canon === CANONICAL_PATHWAYS.GENERAL) return "General";

  const found = pathwaysList?.find((p) => canonicalizePathway(p.code) === canon);
  if (found?.name) return found.name;

  if (canon === CANONICAL_PATHWAYS.MEDICAL) return "Medical Courses and Sciences Related";
  if (canon === CANONICAL_PATHWAYS.ENGINEERING) return "Engineering and Mathematics Related";

  return canon;
}
