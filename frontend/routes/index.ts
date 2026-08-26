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
    subjectLoadStudio: "/admin/subject-load-studio",
    studentView: "/admin/classes/:classId/students/:studentId",
    users: "/admin/users",
    userDetail: "/admin/users/:role/:userId",
    interventions: "/admin/interventions",
    notifications: "/admin/notifications",
    settings: "/admin/settings",
    academicPeriods: "/admin/academic-periods",
    predictions: "/admin/predictions",
    gradePredictions: "/admin/predictions/:grade",
    sectionPredictions: "/admin/predictions/:grade/:classId",
    profile: "/admin/profile",
  },

  teacher: {
    dashboard: "/teacher/dashboard",
    classes: "/teacher/classes",
    classSections: "/teacher/classes/sections",
    classDetail: "/teacher/classes/:classId",
    advisoryClassDetail: "/teacher/advisory-class/:classId",
    subjects: "/teacher/classes/subjects",
    classSubjects: "/teacher/classes/:classId/subjects",
    subjectDetail: "/teacher/classes/:classId/subjects/:subjectId",
    createLesson: "/teacher/lessons/create",
    classworks: "/teacher/classworks",
    lessons: "/teacher/lessons",
    interventions: "/teacher/interventions",
    grades: "/teacher/grades",
    gradeView: "/teacher/grades/:section/:subject",
    notifications: "/teacher/notifications",
    predictions: "/teacher/predictions",
    gradePredictions: "/teacher/predictions/:grade",
    sectionPredictions: "/teacher/predictions/:grade/:classId",
    profile: "/teacher/profile",
    attendance: "/teacher/attendance",
    lessonPlanner: "/teacher/lesson-planner",
    lessonPlannerCreate: "/teacher/lesson-planner/new",
    lessonPlannerEdit: "/teacher/lesson-planner/:planId",
    tos: "/teacher/tos",
  },

  student: {
    board: "/student/studyboard",
    profile: "/student/profile",
    subjects: "/student/subjects",
    subjectDetail: "/student/subjects/:classId/:subjectId",
    interventions: "/student/interventions",
    grades: "/student/grades",
    todo: "/student/todo",
    todoView: "/student/todo/:subject/:quizTitle",
    notifications: "/student/notifications",
    attendance: "/student/attendance",

    // Quiz attempt pages — assignmentId is classwork_assignment.assignment_id
    quizView: "/student/quiz/:assignmentId",
    quizTake: "/student/quiz/:assignmentId/take",
    quizResult: "/student/quiz/:assignmentId/result",
  },

  setupPassword: {
    path: "/setup-password",
    component: SetupPassword,
  },

} as const;
