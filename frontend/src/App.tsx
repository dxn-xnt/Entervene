import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import StatusPage from "./pages/status-page";
import { AuthProvider } from "./context/AuthContext";
import { SettingsProvider } from "./context/SettingsContext";
import { AcademicPeriodProvider } from "./context/AcademicPeriodContext";
import ProtectedRoute from "./components/protected-route";
import Login from "./pages/login";
import Landing from "./pages/landing";
import { routes } from "@/../routes";
import SetupPassword from "./pages/setup-password";
import { NavigationProgress } from "./components/navigation-progress";
import { Toaster } from "./components/retroui/Sonner";

// import StudentApp from "./pages/StudentInterfaces/StudentApp";
// import TeacherApp from "./pages/teacher/TeacherApp";

// Admin pages
const AdminDashboard = lazy(() => import("./pages/admin/dashboard"));
const AdminSubjects = lazy(() => import("./pages/admin/subjects"));
const AdminSubjectLevel = lazy(() => import("./pages/admin/subject-level-view"));
const AdminSubjectView = lazy(() => import("./pages/admin/subject-view"));
const AdminClasses = lazy(() => import("./pages/admin/classes"));
const AdminClassDetail = lazy(() => import("./pages/admin/class-view"));
const SubjectLoadStudio = lazy(() => import("./pages/admin/subject-load-studio"));
const AdminUsers = lazy(() => import("./pages/admin/users"));
const AdminUserDetail = lazy(() => import("./pages/admin/user-detail"));
const AdminInterventions = lazy(() => import("./pages/admin/interventions"));
const AdminNotifications = lazy(() => import("./pages/admin/notifications"));
const AdminSettings = lazy(() => import("./pages/admin/system-settings"));
const AcademicPeriods = lazy(() => import("./pages/admin/academic-periods"));
const AdminProfile = lazy(() => import("./pages/admin/profile-view"));
const AdminSubstitutions = lazy(() => import("./pages/admin/substitutions"));

// import AppLayout from "./layouts/app-layout";

// Teacher pages
const TeacherDashboard = lazy(() => import("./pages/teacher/dashboard"));
const TeacherProfile = lazy(() => import("./pages/teacher/profile-view"));
// import TeacherClasses from "./pages/teacher/Classworks";
const ClassesPage = lazy(() => import("./pages/teacher/classes"));
const TeacherClassDetail = lazy(() => import("./pages/teacher/classes-view/class-view"));
const SubjectDetails = lazy(() => import("./pages/teacher/classes-view/subject-details"));
const AdvisoryClassDetail = lazy(() => import("./pages/teacher/classes-view/advisory-class-view"));
const ClassSections = lazy(() => import("./pages/teacher/classes-view/class-section"));
const TeacherClassworks = lazy(() => import("./pages/teacher/classworks"));
// import TeacherLessons from "./pages/teacher/lessons";
// import TeacherInterventions from "./pages/teacher/interventions";
const CreateLesson = lazy(() => import("./pages/teacher/create-lesson"));
const TeacherGrades = lazy(() => import("./pages/teacher/grades"));
const TeacherGradeView = lazy(() => import("./pages/teacher/grade-view"));
const TeacherNotifications = lazy(() => import("./pages/teacher/notifications"));
const TeacherAttendance = lazy(() => import("./pages/teacher/attendance"));
const PredictionsDashboard = lazy(() => import("./pages/teacher/predictions"));
const GradesPredictions = lazy(() => import("./pages/teacher/grade-predictions"));
const SectionPredictions = lazy(() => import("./pages/teacher/section-predictions"));
const LessonPlannerPage = lazy(() => import("./pages/teacher/lesson-planner/lesson-planner-page"));
const LessonPlannerListPage = lazy(() => import("./pages/teacher/lesson-planner/lesson-planner-list-page"));
const TeacherTOSPage = lazy(() => import("./pages/teacher/tos/teacher-tos-page"));

// // Student pages
const StudentBoard = lazy(() => import("./pages/student/storyboard"));
const StudentProfile = lazy(() => import("./pages/student/student-profile"));
const StudentSubjects = lazy(() => import("./pages/student/subjects"));
const StudentSubjectDetail = lazy(() => import("./pages/student/student-subject-detail"));
const StudentInterventions = lazy(() => import("./pages/student/student-interventions"));
const StudentGrades = lazy(() => import("./pages/student/grades/grades"));
const StudentTodo = lazy(() => import("./pages/student/todo"));
const StudentTodoView = lazy(() => import("./pages/student/todo-view"));
const StudentNotifications = lazy(() => import("./pages/student/notifications"));
const AdminStudentView = lazy(() => import("./pages/admin/student-view"));

// Quiz pages
const StudentQuizTake = lazy(() => import("./pages/quiz/quiz-interface"));
const StudentQuizView = lazy(() => import("./pages/quiz/quiz-view"));
const StudentQuizResult = lazy(() => import("./pages/quiz/quiz-result"));
const ClassworkView = lazy(() => import("./pages/teacher/classwork-view"));


// // Layouts
// import TeacherLayout from "./pages/teacher/TeacherLayout";
// import StudentLayout from "./pages/student/StudentLayout";

const App = () => {
  return (
    <SettingsProvider>
      <AuthProvider>
        <AcademicPeriodProvider>
          <BrowserRouter>
            <NavigationProgress />
            <Toaster />
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/maintenance" element={<StatusPage variant="maintenance" />} />
                <Route path="/unavailable" element={<StatusPage variant="unavailable" />} />
                <Route path="/error" element={<StatusPage />} />
                <Route path={routes.auth.login} element={<Login />} />
                <Route path="/setup-password" element={<SetupPassword />} />

                {/* Admin */}
                <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
                  <Route path={routes.admin.dashboard} element={<AdminDashboard />} />
                  <Route path={routes.admin.subjects} element={<AdminSubjects />} />
                  <Route path={routes.admin.subjectLevel} element={<AdminSubjectLevel />} />
                  <Route path={routes.admin.subjectView} element={<AdminSubjectView />} />
                  <Route path={routes.admin.classes} element={<AdminClasses />} />
                  <Route path={routes.admin.classDetail} element={<AdminClassDetail />} />
                  <Route path={routes.admin.subjectLoadStudio} element={<SubjectLoadStudio />} />
                  <Route path={routes.admin.users} element={<AdminUsers />} />
                  <Route path={routes.admin.userDetail} element={<AdminUserDetail />} />
                  <Route path={routes.admin.interventions} element={<AdminInterventions />} />
                  <Route path={routes.admin.studentView} element={<AdminStudentView />} />
                  <Route path={routes.admin.notifications} element={<AdminNotifications />} />
                  <Route path={routes.admin.settings} element={<AdminSettings />} />
                  <Route path={routes.admin.academicPeriods} element={<AcademicPeriods />} />
                  <Route path={routes.admin.profile} element={<AdminProfile />} />
                  <Route path={routes.admin.predictions} element={<PredictionsDashboard />} />
                  <Route path={routes.admin.gradePredictions} element={<GradesPredictions />} />
                  <Route path={routes.admin.sectionPredictions} element={<SectionPredictions />} />
                  <Route path={routes.admin.substitutions} element={<AdminSubstitutions />} />
                </Route>

                {/* Teacher */}
                <Route element={<ProtectedRoute allowedRoles={["teacher"]} />}>
                  <Route path={routes.teacher.dashboard} element={<TeacherDashboard />} />
                  <Route path={routes.teacher.classes} element={<ClassesPage />} />
                  <Route path={routes.teacher.classSections} element={<ClassSections />} />
                  <Route path={routes.teacher.classDetail} element={<TeacherClassDetail />} />
                  <Route path={routes.teacher.advisoryClassDetail} element={<AdvisoryClassDetail />} />
                  <Route path={routes.teacher.subjectDetail} element={<SubjectDetails />} />
                  <Route path={routes.teacher.classworks} element={<TeacherClassworks />} />
                  <Route path={routes.teacher.classworkDetail} element={<ClassworkView />} />
                  <Route path={routes.teacher.createLesson} element={<CreateLesson />} />
                  {/* <Route path={routes.teacher.lessons} element={<TeacherLessons />} /> */}
                  <Route path={routes.teacher.profile} element={<TeacherProfile />} />
                  <Route path={routes.teacher.interventions} element={<AdminInterventions />} />
                  <Route path={routes.teacher.grades} element={<TeacherGrades />} />
                  <Route path={routes.teacher.gradeView} element={<TeacherGradeView />} />
                  <Route path={routes.teacher.notifications} element={<TeacherNotifications />} />
                  <Route path={routes.teacher.attendance} element={<TeacherAttendance />} />
                  <Route path={routes.teacher.predictions} element={<PredictionsDashboard />} />
                  <Route path={routes.teacher.gradePredictions} element={<GradesPredictions />} />
                  <Route path={routes.teacher.sectionPredictions} element={<SectionPredictions />} />
                  <Route path={routes.teacher.lessonPlanner} element={<LessonPlannerListPage />} />
                  <Route path={routes.teacher.lessonPlannerCreate} element={<LessonPlannerPage />} />
                  <Route path={routes.teacher.lessonPlannerEdit} element={<LessonPlannerPage />} />
                  <Route path="/teacher/lesson-planner" element={<Navigate to={routes.teacher.classes} replace />} />
                  <Route path={routes.teacher.tos} element={<TeacherTOSPage />} />
                </Route>

                {/* Student */}
                <Route element={<ProtectedRoute allowedRoles={["student"]} />}>
                  <Route path={routes.student.board} element={<StudentBoard />} />
                  <Route path={routes.student.profile} element={<StudentProfile />} />
                  <Route path={routes.student.subjects} element={<StudentSubjects />} />
                  <Route path={routes.student.subjectDetail} element={<StudentSubjectDetail />} />
                  <Route path={routes.student.interventions} element={<StudentInterventions />} />
                  <Route path={routes.student.grades} element={<StudentGrades />} />
                  <Route path={routes.student.todo} element={<StudentTodo />} />
                  <Route path={routes.student.todoView} element={<StudentTodoView />} />
                  <Route path={routes.student.notifications} element={<StudentNotifications />} />
                </Route>

                {/* Quiz pages (outside student layout — fullscreen) */}
                <Route path={routes.student.quizView} element={<StudentQuizView />} />
                <Route path={routes.student.quizTake} element={<StudentQuizTake />} />
                <Route path={routes.student.quizResult} element={<StudentQuizResult />} />

                <Route
                  path="*"
                  element={<StatusPage variant="not-found" />}
                />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AcademicPeriodProvider>
      </AuthProvider>
    </SettingsProvider>
  );
};

export default App;
