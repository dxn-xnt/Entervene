import { routes } from "@/../routes";

export function studentClassworkPath(assignmentId: number, returnTo?: string): string {
  const path = routes.student.classworkDetail.replace(":assignmentId", String(assignmentId));
  if (!returnTo?.startsWith("/student/") || returnTo.startsWith("//")) return path;
  return `${path}?from=${encodeURIComponent(returnTo)}`;
}

export function studentClassworkReturnPath(from: string | null, classId?: number, subjectId?: number): string {
  if (from?.startsWith("/student/") && !from.startsWith("//") && !from.includes("classworkAssignmentId=")) {
    return from;
  }
  if (classId && subjectId) {
    return `/student/subjects/${classId}/${subjectId}?tab=classwork`;
  }
  return routes.student.subjects;
}

export function studentClassworkSourceLabel(returnPath: string): string {
  const [pathname, query = ""] = returnPath.split("?");
  if (pathname === routes.student.todo || pathname.startsWith(`${routes.student.todo}/`)) return "To Do";
  if (pathname.startsWith("/student/subjects/")) {
    return new URLSearchParams(query).get("tab") === "lessons" ? "Lessons" : "Classwork";
  }
  if (pathname.startsWith("/student/grades")) return "Grades";
  if (pathname.startsWith("/student/studyboard")) return "Study Board";
  if (pathname.startsWith("/student/interventions")) return "Interventions";
  return "Subjects";
}
