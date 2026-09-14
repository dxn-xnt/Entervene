"""
Centralized Academic Pathway definitions and canonicalization.

Defines canonical DB codes, legacy alias resolution, and compatibility rules.
Kept strictly synchronized with frontend/src/lib/pathways.ts.
"""

from __future__ import annotations

# Canonical DB codes matching academic_pathway.code
CANONICAL_MEDICAL = "medical-courses"
CANONICAL_ENGINEERING = "engineering-math"
PATHWAY_BOTH = "both"
PATHWAY_GENERAL = "general"

# Exact, evidence-based alias mapping: legacy codes -> canonical DB codes
PATHWAY_ALIAS_MAP: dict[str, str] = {
    # Canonical DB codes
    "medical-courses": CANONICAL_MEDICAL,
    "engineering-math": CANONICAL_ENGINEERING,
    "general": PATHWAY_GENERAL,
    "both": PATHWAY_BOTH,
    # In-use legacy aliases
    "stem_medical": CANONICAL_MEDICAL,
    "stem_engineering": CANONICAL_ENGINEERING,
}


def canonicalize_pathway(code: str | None) -> str:
    """Normalize a pathway code or alias to its canonical value."""
    if not code:
        return PATHWAY_GENERAL
    normalized = str(code).strip().lower()
    return PATHWAY_ALIAS_MAP.get(normalized, normalized)


def are_pathways_compatible(offering_pathway: str | None, class_pathway: str | None) -> bool:
    """
    Check if a subject offering's pathway is compatible with a class's pathway.
    
    Compatible if:
    - Offering is shared across pathways ('both')
    - Both resolve to the same canonical pathway
    - Both resolve to 'general'
    """
    canon_offering = canonicalize_pathway(offering_pathway)
    canon_class = canonicalize_pathway(class_pathway)

    if canon_offering == PATHWAY_BOTH:
        return True
    if canon_offering == canon_class:
        return True
    if canon_offering == PATHWAY_GENERAL and canon_class == PATHWAY_GENERAL:
        return True

    return False
