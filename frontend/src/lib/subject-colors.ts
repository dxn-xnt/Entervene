/**
 * Palette of accessible, RetroUI-themed pastel background colors for subjects.
 */
const FALLBACK_SUBJECT_PALETTE = [
  "bg-blue-100 hover:bg-blue-200/80",
  "bg-emerald-100 hover:bg-emerald-200/80",
  "bg-amber-100 hover:bg-amber-200/80",
  "bg-rose-100 hover:bg-rose-200/80",
  "bg-purple-100 hover:bg-purple-200/80",
  "bg-orange-100 hover:bg-orange-200/80",
  "bg-teal-100 hover:bg-teal-200/80",
  "bg-indigo-100 hover:bg-indigo-200/80",
  "bg-lime-100 hover:bg-lime-200/80",
  "bg-pink-100 hover:bg-pink-200/80",
  "bg-cyan-100 hover:bg-cyan-200/80",
  "bg-fuchsia-100 hover:bg-fuchsia-200/80",
];

/**
 * Returns respective RetroUI background color class for a subject name / id.
 */
export function getSubjectColor(subjectName?: string | null, subjectId?: number | null): string {
  if (!subjectName) return "bg-white";
  const norm = subjectName.toLowerCase().trim();

  // 1. Mathematics
  if (
    norm.includes("math") ||
    norm.includes("algebra") ||
    norm.includes("geometry") ||
    norm.includes("calculus") ||
    norm.includes("stat")
  ) {
    return "bg-blue-100 hover:bg-blue-200/80";
  }

  // 2. Science
  if (
    norm.includes("sci") ||
    norm.includes("bio") ||
    norm.includes("chem") ||
    norm.includes("physics") ||
    norm.includes("astronomy") ||
    norm.includes("geology")
  ) {
    return "bg-emerald-100 hover:bg-emerald-200/80";
  }

  // 3. English / Language Arts
  if (
    norm.includes("eng") ||
    norm.includes("read") ||
    norm.includes("lit") ||
    norm.includes("grammar")
  ) {
    return "bg-amber-100 hover:bg-amber-200/80";
  }

  // 4. Filipino
  if (norm.includes("fil") || norm.includes("panitik")) {
    return "bg-rose-100 hover:bg-rose-200/80";
  }

  // 5. Araling Panlipunan / Social Studies / History
  if (
    norm.includes("araling") ||
    norm.includes("panlipunan") ||
    norm.startsWith("ap ") ||
    norm.includes(" ap ") ||
    norm.endsWith(" ap") ||
    norm.includes("history") ||
    norm.includes("kasaysayan") ||
    norm.includes("soc") ||
    norm.includes("econ")
  ) {
    return "bg-orange-100 hover:bg-orange-200/80";
  }

  // 6. MAPEH (Music, Arts, PE, Health)
  if (
    norm.includes("mapeh") ||
    norm.includes("music") ||
    norm.includes("art") ||
    norm.includes("pe") ||
    norm.includes("physical") ||
    norm.includes("health")
  ) {
    return "bg-purple-100 hover:bg-purple-200/80";
  }

  // 7. TLE / TVL / ICT / Tech
  if (
    norm.includes("tle") ||
    norm.includes("tvl") ||
    norm.includes("tech") ||
    norm.includes("ict") ||
    norm.includes("computer") ||
    norm.includes("livelihood")
  ) {
    return "bg-teal-100 hover:bg-teal-200/80";
  }

  // 8. EsP / Values / Homeroom / Guidance
  if (
    norm.includes("esp") ||
    norm.includes("values") ||
    norm.includes("homeroom") ||
    norm.includes("guidance") ||
    norm.includes("edukasyon sa pagpapakatao")
  ) {
    return "bg-indigo-100 hover:bg-indigo-200/80";
  }

  // Fallback: deterministic palette based on ID or string hash
  let hash = 0;
  if (subjectId != null) {
    hash = subjectId;
  } else {
    for (let i = 0; i < norm.length; i++) {
      hash = (hash << 5) - hash + norm.charCodeAt(i);
      hash |= 0;
    }
  }
  const index = Math.abs(hash) % FALLBACK_SUBJECT_PALETTE.length;
  return FALLBACK_SUBJECT_PALETTE[index];
}
