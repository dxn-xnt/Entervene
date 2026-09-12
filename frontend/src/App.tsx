import { BrowserRouter, Routes, Route } from "react-router-dom";
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
import AdminDashboard from "./pages/admin/dashboard";
import AdminSubjects from "./pages/admin/subjects";
import AdminSubjectLevel from "./pages/admin/subject-level-view";
import AdminSubjectView from "./pages/admin/subject-view";
import AdminClasses from "./pages/admin/classes";
import AdminClassDetail from "./pages/admin/class-view";
import SubjectLoadStudio from "./pages/admin/subject-load-studio";
import AdminUsers from "./pages/admin/users";
import AdminUserDetail from "./pages/admin/user-detail";
import AdminInterventions from "./pages/admin/interventions";
import AdminNotifications from "./pages/admin/notifications";
import AdminSettings from "./pages/admin/system-settings";
import AcademicPeriods from "./pages/admin/academic-periods";
import AdminProfile from "./pages/admin/profile-view";
import AdminSubstitutions from "./pages/admin/substitutions";

// import AppLayout from "./layouts/app-layout";

// Teacher pages
import TeacherDashboard from "./pages/teacher/dashboard";
import TeacherProfile from "./pages/teacher/profile-view";
// import TeacherClasses from "./pages/teacher/Classworks";
import ClassesPage from "./pages/teacher/classes";
import TeacherClassDetail from "./pages/teacher/classes-view/class-view";
import SubjectDetails from "./pages/teacher/classes-view/subject-details";
import AdvisoryClassDetail from "./pages/teacher/classes-view/advisory-class-view";
import ClassSections from "./pages/teacher/classes-view/class-section";
import TeacherClassworks from "./pages/teacher/classworks";
// import TeacherLessons from "./pages/teacher/lessons";
// import TeacherInterventions from "./pages/teacher/interventions";
import CreateLesson from "./pages/teacher/create-lesson";
import TeacherGrades from "./pages/teacher/grades";
import TeacherGradeView from "./pages/teacher/grade-view";
import TeacherNotifications from "./pages/teacher/notifications";
import TeacherAttendance from "./pages/teacher/attendance";
import PredictionsDashboard from "./pages/teacher/predictions";
import GradesPredictions from "./pages/teacher/grade-predictions";
import SectionPredictions from "./pages/teacher/section-predictions";
import LessonPlannerPage from "./pages/teacher/lesson-planner/lesson-planner-page";
import LessonPlannerListPage from "./pages/teacher/lesson-planner/lesson-planner-list-page";
import TeacherTOSPage from "./pages/teacher/tos/teacher-tos-page";

// // Student pages
import StudentBoard from "./pages/student/storyboard";
import StudentProfile from "./pages/student/student-profile";
import StudentSubjects from "./pages/student/subjects";
import StudentSubjectDetail from "./pages/student/student-subject-detail";
import StudentInterventions from "./pages/student/student-interventions";
import StudentGrades from "./pages/student/grades/grades";
import StudentTodo from "./pages/student/todo";
import StudentTodoView from "./pages/student/todo-view";
import StudentNotifications from "./pages/student/notifications";
import AdminStudentView from "./pages/admin/student-view";

// Quiz pages
import StudentQuizTake from "./pages/quiz/quiz-interface";
import StudentQuizView from "./pages/quiz/quiz-view";
import StudentQuizResult from "./pages/quiz/quiz-result";
import ClassworkView from "./pages/teacher/classwork-view";


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
          </BrowserRouter>
        </AcademicPeriodProvider>
      </AuthProvider>
    </SettingsProvider>
  );
};

export default App;
