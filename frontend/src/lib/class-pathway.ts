export type ClassPathwayContext = {
  gradeLevel: number;
  requiresPathway?: boolean;
  pathwayId?: number | null;
  pathwayName?: string | null;
  pathwayEnabled?: boolean | null;
};

/** Display assignment state from the class record, never from its section name. */
export function classPathwayLabel(context: ClassPathwayContext): string | null {
  if (context.gradeLevel < 11) return null;
  if (context.pathwayId == null) {
    return context.requiresPathway ? "Unassigned pathway" : "No pathway assigned";
  }
  const name = context.pathwayName?.trim() || `Unknown pathway (#${context.pathwayId})`;
  return context.pathwayEnabled === false ? `${name} (inactive)` : name;
}
