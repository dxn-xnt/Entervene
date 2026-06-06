import type { AvailableStudent, ClassRecord, GradeFilter, Student, YearFilter } from "@/types/adminClasses";

export const GRADE_FILTERS: GradeFilter[] = ["All", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];
export const YEAR_OPTIONS: YearFilter[] = ["All", "2025-2026", "2024-2025", "2023-2024"];

export const students: Student[] = [
  { id: "s1", name: "Daniel Victor Santos", lrn: "100000000001", gender: "Male", score: 77, risk: true },
  { id: "s2", name: "Mia Gabriela Rodriguez", lrn: "100000000002", gender: "Female", score: 76, risk: true },
  { id: "s3", name: "Lucas Henry Wallace", lrn: "100000000003", gender: "Male", score: 74, risk: true },
  { id: "s4", name: "Emma Grace Foster", lrn: "100000000004", gender: "Female", score: 98 },
  { id: "s5", name: "Benjamin Isaac Ortiz", lrn: "100000000005", gender: "Male", score: 97 },
  { id: "s6", name: "Lily Rose Patel", lrn: "100000000006", gender: "Female", score: 97 },
  { id: "s7", name: "Samuel Nathaniel Brooks", lrn: "100000000007", gender: "Male", score: 98 },
  { id: "s8", name: "Sofia Elena Morales", lrn: "100000000008", gender: "Female", score: 90 },
];

export const classData: ClassRecord[] = [
  {
    id: "grade-7-sapphire", grade: "Grade 7", section: "Sapphire", adviser: "Raymart Gabutan",
    adviserEmail: "raymart.gabutan@entervene.edu", academicYear: "2025-2026", status: "Active", students,
    subjects: [
      { name: "Computer Programming", teacher: "John Doe", time: "7:45 - 8:45 AM", progress: 87 },
      { name: "Filipino", teacher: "Ana Reyes", time: "8:45 - 9:45 AM", progress: 93 },
      { name: "Science", teacher: "Maria Santos", time: "10:00 - 11:00 AM", progress: 90 },
      { name: "English", teacher: "Paolo Cruz", time: "1:00 - 2:00 PM", progress: 85 },
    ],
  },
  {
    id: "grade-7-ruby", grade: "Grade 7", section: "Ruby", adviser: "Maria Santos",
    adviserEmail: "maria.santos@entervene.edu", academicYear: "2025-2026", status: "Active", students: students.slice(0, 6),
    subjects: [
      { name: "Computer Programming", teacher: "John Doe", time: "7:45 - 8:45 AM", progress: 82 },
      { name: "Mathematics", teacher: "Ben Santos", time: "9:00 - 10:00 AM", progress: 88 },
      { name: "Science", teacher: "Maria Santos", time: "10:00 - 11:00 AM", progress: 84 },
    ],
  },
  {
    id: "grade-8-sampaguita", grade: "Grade 8", section: "Sampaguita", adviser: "Juan Dela Cruz",
    adviserEmail: "juan.delacruz@entervene.edu", academicYear: "2025-2026", status: "Active",
    students: [...students, { id: "s9", name: "Aaron Cruz", lrn: "100000000009", gender: "Male", score: 91 }],
    subjects: [
      { name: "English", teacher: "Paolo Cruz", time: "8:00 - 9:00 AM", progress: 89 },
      { name: "Science", teacher: "Maria Santos", time: "10:00 - 11:00 AM", progress: 91 },
    ],
  },
  {
    id: "grade-8-rose", grade: "Grade 8", section: "Rose", adviser: "Ana Reyes",
    adviserEmail: "ana.reyes@entervene.edu", academicYear: "2025-2026", status: "Active",
    students: [...students, ...students.slice(0, 3)].map((student, index) => ({ ...student, id: `${student.id}-rose-${index}` })),
    subjects: [
      { name: "Filipino", teacher: "Ana Reyes", time: "8:45 - 9:45 AM", progress: 95 },
      { name: "Mathematics", teacher: "Ben Santos", time: "11:00 - 12:00 PM", progress: 86 },
    ],
  },
  {
    id: "grade-9-hope", grade: "Grade 9", section: "Hope", adviser: "Ben Santos",
    adviserEmail: "ben.santos@entervene.edu", academicYear: "2024-2025", status: "Archived", students: students.slice(0, 5),
    subjects: [{ name: "Science", teacher: "Maria Santos", time: "10:00 - 11:00 AM", progress: 80 }],
  },
  {
    id: "grade-9-love", grade: "Grade 9", section: "Love", adviser: "Clara Lim",
    adviserEmail: "clara.lim@entervene.edu", academicYear: "2025-2026", status: "Active",
    students: [...students, ...students.slice(0, 4)].map((student, index) => ({ ...student, id: `${student.id}-love-${index}` })),
    subjects: [{ name: "English", teacher: "Paolo Cruz", time: "1:00 - 2:00 PM", progress: 88 }],
  },
  {
    id: "grade-10-gold", grade: "Grade 10", section: "Gold", adviser: "John Doe",
    adviserEmail: "john.doe@entervene.edu", academicYear: "2025-2026", status: "Active", students: students.slice(0, 7),
    subjects: [{ name: "Computer Programming", teacher: "John Doe", time: "7:45 - 8:45 AM", progress: 92 }],
  },
];

export const availableStudents: AvailableStudent[] = [
  { id: "a1", name: "Aaron Cruz", lrn: "900000000001", gender: "Male" },
  { id: "a2", name: "Carlos Reyes", lrn: "900000000002", gender: "Male" },
  { id: "a3", name: "Alexa Lim", lrn: "900000000003", gender: "Female" },
  { id: "a4", name: "Claire Torres", lrn: "900000000004", gender: "Female" },
];
