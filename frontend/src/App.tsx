import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import { routes } from "@/../routes";
import SetupPassword from "./pages/SetupPassword";

// import StudentApp from "./pages/StudentInterfaces/StudentApp";
// import TeacherApp from "./pages/TeacherInterfaces/TeacherApp";

// Admin pages
import AdminDashboard from "./pages/admin/dashboard";
import AdminSubjects from "./pages/admin/subjects";
import AdminClasses from "./pages/admin/classes";
import AdminUsers from "./pages/admin/users";
import AdminInterventions from "./pages/admin/interventions";
import AdminNotifications from "./pages/admin/notifications";
import AdminSettings from "./pages/admin/system-settings";
// import AppLayout from "./layouts/app-layout";

// Teacher pages
import TeacherDashboard from "./pages/TeacherInterfaces/Dashboard";
// import TeacherClasses from "./pages/TeacherInterfaces/Classworks";
import ClassesPage from "./pages/TeacherInterfaces/Classes/ClassesPage";
import ClassSections from "./pages/TeacherInterfaces/Classes/ClassSections";
import SubjectDetails from "./pages/TeacherInterfaces/Classes/SubjectDetails";
import Subjects from "./pages/TeacherInterfaces/Classes/Subjects";
import TeacherClassworks from "./pages/TeacherInterfaces/Classworks";
import TeacherInterventions from "./pages/TeacherInterfaces/Lessons";
import CreateLesson from "./pages/teacher/CreateLesson";
import TeacherGrades from "./pages/TeacherInterfaces/grades";
import TeacherNotifications from "./pages/TeacherInterfaces/Notifications";

// // Student pages
import StudentBoard from "./pages/student/storyboard";
import StudentSubjects from "./pages/student/Subjects/subject";
// import StudentInterventions from "./pages/student/StudentInterventions";
import StudentGrades from "./pages/student/Grades/grades";
import StudentTodo from "./pages/student/todo";
import StudentNotifications from "./pages/student/notification";

// // Layouts
// import TeacherLayout from "./pages/teacher/TeacherLayout";
// import StudentLayout from "./pages/student/StudentLayout";

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path={routes.auth.login} element={<Login />} />
          <Route path="/setup-password" element={<SetupPassword />} />

          {/* Admin */}
          <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
            <Route
              index
              element={<Navigate to={routes.admin.dashboard} replace />}
            />
            <Route path={routes.admin.dashboard} element={<AdminDashboard />} />
            <Route path={routes.admin.subjects} element={<AdminSubjects />} />
            <Route path={routes.admin.classes} element={<AdminClasses />} />
            <Route path={routes.admin.users} element={<AdminUsers />} />
            <Route
              path={routes.admin.interventions}
              element={<AdminInterventions />}
            />
            <Route
              path={routes.admin.notifications}
              element={<AdminNotifications />}
            />
            <Route path={routes.admin.settings} element={<AdminSettings />} />
          </Route>

          {/* Teacher */}
          <Route element={<ProtectedRoute allowedRoles={["teacher"]} />}>
            <Route index element={<Navigate to={routes.teacher.dashboard} replace />}/>
            <Route path={routes.teacher.dashboard} element={<TeacherDashboard />}/>
            {/* <Route path={routes.teacher.classes} element={<TeacherClasses />} /> */}
            <Route path={routes.teacher.classes} element={<ClassesPage />} />
            <Route path={routes.teacher.classSections} element={<ClassSections />} />
            <Route path={routes.teacher.subjects} element={<Subjects />} />
            <Route path={routes.teacher.classDetail} element={<Subjects />} />
            <Route path={routes.teacher.classSubjects} element={<Subjects />} />
            <Route path={routes.teacher.subjectDetail} element={<SubjectDetails />} />
            <Route path={routes.teacher.classworks} element={<TeacherClassworks />} />
            <Route path={routes.teacher.createLesson} element={<CreateLesson />} />
            <Route path={routes.teacher.interventions} element={<TeacherInterventions />} />
            <Route path={routes.teacher.grades} element={<TeacherGrades />} />
            <Route path={routes.teacher.notifications} element={<TeacherNotifications />}/>
          </Route>

          {/* Student */}
          <Route element={<ProtectedRoute allowedRoles={["student"]} />}>
            <Route
              index
              element={<Navigate to={routes.student.board} replace />}
            />
            <Route path={routes.student.board} element={<StudentBoard />} />
            <Route
              path={routes.student.subjects}
              element={<StudentSubjects />}
            />
            <Route
              path={routes.student.interventions}
              element={
                <div className="p-5">
                  <h1 className="text-3xl font-semibold">Interventions</h1>
                </div>
              }
            />
            <Route path={routes.student.grades} element={<StudentGrades />} />
            <Route path={routes.student.todo} element={<StudentTodo />} />
            <Route
              path={routes.student.notifications}
              element={<StudentNotifications />}
            />
          </Route>

          <Route
            path="*"
            element={<Navigate to={routes.auth.login} replace />}
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
