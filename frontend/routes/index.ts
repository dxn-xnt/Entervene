import SetupPassword from "../src/pages/SetupPassword";

export const routes = {
  auth: {
    login: "/login",
    register: "/register",
  },

  admin: {
    dashboard: "/admin/dashboard",
    subjects: "/admin/subjects",
    classes: "/admin/classes",
    users: "/admin/users",
    interventions: "/admin/interventions",
    notifications: "/admin/notifications",
    settings: "/admin/settings",
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
    classDetail: "/teacher/classes/:classId",
    classSubjects: "/teacher/classes/:classId/subjects",
    classworks: "/teacher/classworks",
    interventions: "/teacher/interventions",
    grades: "/teacher/grades",
    notifications: "/teacher/notifications",
  },

  student: {
    board: "/student/studyboard",
    subjects: "/student/subjects",
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
