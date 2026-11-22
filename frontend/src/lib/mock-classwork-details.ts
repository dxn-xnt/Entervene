import type {
  AssignmentTracking,
  TeacherClasswork,
  TeacherSubmissionDetail,
} from "@/types/classwork";

export const MOCK_CLASSWORKS_MAP: Record<string, TeacherClasswork> = {
  "cw-101": {
    classwork_id: 101,
    title: "Linear Equations Worksheet",
    description: "Solve linear equations with one variable and check your solutions.",
    instructions: "Complete all items and show each intermediate equation transformation step.",
    classwork_type: "ASSIGNMENT",
    total_points: 100,
    is_published: true,
    show_scores: true,
    is_locked: false,
    is_archived: false,
    subject_id: 1,
    subject_name: "Mathematics 7",
    attachments: [],
    reference_links: [],
    assignments: [
      {
        classwork_assignment_id: 101,
        classwork_id: 101,
        class_id: 1,
        title: "Linear Equations Worksheet",
        due_date: "2026-11-22T23:59:00Z",
        is_published: true,
        show_scores: true,
      },
    ],
    due_date: "2026-11-22T23:59:00Z",
  },
  "101": {
    classwork_id: 101,
    title: "Linear Equations Worksheet",
    description: "Solve linear equations with one variable and check your solutions.",
    instructions: "Complete all items and show each intermediate equation transformation step.",
    classwork_type: "ASSIGNMENT",
    total_points: 100,
    is_published: true,
    show_scores: true,
    is_locked: false,
    is_archived: false,
    subject_id: 1,
    subject_name: "Mathematics 7",
    attachments: [],
    reference_links: [],
    assignments: [
      {
        classwork_assignment_id: 101,
        classwork_id: 101,
        class_id: 1,
        title: "Linear Equations Worksheet",
        due_date: "2026-11-22T23:59:00Z",
        is_published: true,
        show_scores: true,
      },
    ],
    due_date: "2026-11-22T23:59:00Z",
  },
  "cw-102": {
    classwork_id: 102,
    title: "Plant and Animal Cells Diagram",
    description: "Identify and label organelle components in plant and animal cells.",
    instructions: "Upload or draw a detailed diagram with accurate organelle labels and definitions.",
    classwork_type: "ACTIVITY",
    total_points: 50,
    is_published: true,
    show_scores: true,
    is_locked: false,
    is_archived: false,
    subject_id: 2,
    subject_name: "Science 7",
    attachments: [],
    reference_links: [],
    assignments: [
      {
        classwork_assignment_id: 102,
        classwork_id: 102,
        class_id: 1,
        title: "Plant and Animal Cells Diagram",
        due_date: "2026-11-21T23:59:00Z",
        is_published: true,
        show_scores: true,
      },
    ],
    due_date: "2026-11-21T23:59:00Z",
  },
  "102": {
    classwork_id: 102,
    title: "Plant and Animal Cells Diagram",
    description: "Identify and label organelle components in plant and animal cells.",
    instructions: "Upload or draw a detailed diagram with accurate organelle labels and definitions.",
    classwork_type: "ACTIVITY",
    total_points: 50,
    is_published: true,
    show_scores: true,
    is_locked: false,
    is_archived: false,
    subject_id: 2,
    subject_name: "Science 7",
    attachments: [],
    reference_links: [],
    assignments: [
      {
        classwork_assignment_id: 102,
        classwork_id: 102,
        class_id: 1,
        title: "Plant and Animal Cells Diagram",
        due_date: "2026-11-21T23:59:00Z",
        is_published: true,
        show_scores: true,
      },
    ],
    due_date: "2026-11-21T23:59:00Z",
  },
  "cw-103": {
    classwork_id: 103,
    title: "Reading Comprehension Support Exercise",
    description: "Targeted reading remediation on key supporting details and context clues.",
    instructions: "Read the assigned short excerpt and answer the accompanying comprehension questions.",
    classwork_type: "ACTIVITY",
    total_points: 40,
    is_published: true,
    show_scores: true,
    is_locked: false,
    is_archived: false,
    subject_id: 3,
    subject_name: "English 7",
    attachments: [],
    reference_links: [],
    assignments: [
      {
        classwork_assignment_id: 103,
        classwork_id: 103,
        class_id: 1,
        title: "Reading Comprehension Support Exercise",
        due_date: "2026-11-23T23:59:00Z",
        is_published: true,
        show_scores: true,
      },
    ],
    due_date: "2026-11-23T23:59:00Z",
  },
  "103": {
    classwork_id: 103,
    title: "Reading Comprehension Support Exercise",
    description: "Targeted reading remediation on key supporting details and context clues.",
    instructions: "Read the assigned short excerpt and answer the accompanying comprehension questions.",
    classwork_type: "ACTIVITY",
    total_points: 40,
    is_published: true,
    show_scores: true,
    is_locked: false,
    is_archived: false,
    subject_id: 3,
    subject_name: "English 7",
    attachments: [],
    reference_links: [],
    assignments: [
      {
        classwork_assignment_id: 103,
        classwork_id: 103,
        class_id: 1,
        title: "Reading Comprehension Support Exercise",
        due_date: "2026-11-23T23:59:00Z",
        is_published: true,
        show_scores: true,
      },
    ],
    due_date: "2026-11-23T23:59:00Z",
  },
};

export function getMockClassworkDetail(classworkId: string | number): TeacherClasswork | null {
  const key = String(classworkId);
  if (MOCK_CLASSWORKS_MAP[key]) {
    return MOCK_CLASSWORKS_MAP[key];
  }
  const stripped = key.replace(/^cw-/, "");
  if (MOCK_CLASSWORKS_MAP[stripped]) {
    return MOCK_CLASSWORKS_MAP[stripped];
  }
  if (MOCK_CLASSWORKS_MAP[`cw-${stripped}`]) {
    return MOCK_CLASSWORKS_MAP[`cw-${stripped}`];
  }
  return null;
}

export function getMockClassworkTracking(
  id: string | number,
  fallbackTitle?: string,
): AssignmentTracking {
  const key = String(id);
  const cw = getMockClassworkDetail(key);
  const numId = parseInt(key.replace(/^cw-/, ""), 10) || 101;
  const title = cw?.title || fallbackTitle || "Classwork";

  return {
    classwork_assignment_id: numId,
    classwork_id: numId,
    classwork_title: title,
    class_id: 1,
    due_date: cw?.due_date || "2026-11-22T23:59:00Z",
    total_students: 4,
    submitted_count: 3,
    missing_count: 1,
    submitted: [
      {
        student_id: "std-001",
        student_name: "Juan Dela Cruz",
        first_name: "Juan",
        last_name: "Dela Cruz",
        student_lrn: "109283746501",
        status: "submitted",
        submission_id: 1001,
        submitted_at: "2026-11-22T14:30:00Z",
        grade: null,
        attachment_count: 1,
      },
      {
        student_id: "std-002",
        student_name: "Elena Aquino",
        first_name: "Elena",
        last_name: "Aquino",
        student_lrn: "109283746502",
        status: "submitted",
        submission_id: 1002,
        submitted_at: "2026-11-22T13:15:00Z",
        grade: null,
        attachment_count: 1,
      },
      {
        student_id: "std-003",
        student_name: "Ricardo Magbanua",
        first_name: "Ricardo",
        last_name: "Magbanua",
        student_lrn: "109283746503",
        status: "submitted",
        submission_id: 1003,
        submitted_at: "2026-11-21T09:15:00Z",
        grade: null,
        attachment_count: 1,
      },
    ],
    missing: [
      {
        student_id: "std-004",
        student_name: "Angel Alcantara",
        first_name: "Angel",
        last_name: "Alcantara",
        student_lrn: "109283746504",
        status: "missing",
        submission_id: null,
        submitted_at: null,
        grade: null,
        attachment_count: 0,
      },
    ],
  };
}

export function getMockSubmissionDetail(
  submissionId: number | string,
): TeacherSubmissionDetail {
  const numId = typeof submissionId === "number" ? submissionId : parseInt(submissionId, 10) || 1001;
  const nameMap: Record<number, string> = {
    1001: "Juan Dela Cruz",
    1002: "Elena Aquino",
    1003: "Ricardo Magbanua",
  };

  return {
    submission_id: numId,
    student_id: `std-00${numId % 10 || 1}`,
    student_name: nameMap[numId] || "Student",
    classwork_assignment_id: 101,
    status: "submitted",
    grade: null,
    feedback: "",
    feedback_fingerprint: `fp-${numId}`,
    submitted_at: "2026-11-22T14:30:00Z",
    total_points: 100,
    attachments: [
      {
        submission_attachment_id: 501,
        file_name: "completed_classwork.pdf",
        file_size: 148500,
        file_type: "application/pdf",
        uploaded_at: "2026-11-22T14:30:00Z",
      },
    ],
    links: [],
    feedback_focus_points: [],
  };
}
