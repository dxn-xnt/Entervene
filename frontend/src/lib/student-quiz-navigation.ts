import { routes } from "@/../routes";

export function quizReturnContext(search: string): { path: string; label: string } {
  const from = new URLSearchParams(search).get("from");
  if (from?.startsWith("/student/classworks/") && !from.startsWith("//")) {
    return { path: from, label: "Classwork" };
  }
  return { path: routes.student.todo, label: "To Do" };
}

export function quizPathWithContext(path: string, search: string): string {
  const { path: from, label } = quizReturnContext(search);
  return label === "Classwork" ? `${path}?from=${encodeURIComponent(from)}` : path;
}
