import { SubjectCard, type SubjectCardProps } from "@/components/subject-card";
import type { TodoItem } from "@/lib/api";

export type StudentSubjectSectionCardProps = {
  to?: string;
  subjectName?: string;
  sectionName?: string;
  teacherName?: string;
  teacherAvatar?: string | null;
  classworks?: TodoItem[] | null;
  pendingCount?: number;
  completionRate?: number;
  latestActivityTitle?: string;
  latestActivityDue?: string;
  onClick?: () => void;
  className?: string;
} & Omit<SubjectCardProps, "variant">;

export function StudentSubjectSectionCard(props: StudentSubjectSectionCardProps) {
  return <SubjectCard variant="student" {...props} />;
}
