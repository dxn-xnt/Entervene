import SetupPassword from "../src/pages/SetupPassword";

export const routes = {
  auth: {
    login: "/login",
    register: "/register",
  },

  admin: {
    dashboard: "/admin/dashboard",
    subjects: "/admin/subjects",
    subjectLevel: "/admin/subjects/:grade",
    subjectView: "/admin/subjects/:grade/:subject",
    classes: "/admin/classes",
    classDetail: "/admin/classes/:classId",
    users: "/admin/users",
    userDetail: "/admin/users/:role/:userId",
    interventions: "/admin/interventions",
    notifications: "/admin/notifications",
    settings: "/admin/settings",
    academicPeriods: "/admin/academic-periods",
  },

  // teacher: {
  //   dashboard: "/teacher/dashboard",
  //   classes: "/teacher/classes",
  //   classworks: "/teacher/classworks",
  //   interventions: "/teacher/interventions",
  //   grades: "/teacher/grades",
  //   notifications: "/teacher/notifications"
  // },

  teacher: {
    dashboard: "/teacher/dashboard",
    classes: "/teacher/classes",
    classSections: "/teacher/classes/sections",
    classDetail: "/teacher/classes/:classId",
    subjects: "/teacher/classes/subjects",
    classSubjects: "/teacher/classes/:classId/subjects",
    subjectDetail: "/teacher/classes/:classId/subjects/:subjectId",
    createLesson: "/teacher/lessons/create",
    classworks: "/teacher/classworks",
    lessons: "/teacher/lessons",
    interventions: "/teacher/interventions",
    grades: "/teacher/grades",
    notifications: "/teacher/notifications",
  },

  student: {
    board: "/student/studyboard",
    profile: "/student/profile",
    subjects: "/student/subjects",
    subjectDetail: "/student/subjects/:classId/:subjectId",
    interventions: "/student/interventions",
    grades: "/student/grades",
    todo: "/student/todo",
    notifications: "/student/notifications",
  },

  setupPassword: {
    path: "/setup-password",
    component: SetupPassword,
  },

} as const;
