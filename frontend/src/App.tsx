import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import { routes } from "@/../routes";

import StudentApp from "./pages/StudentInterfaces/StudentApp";
import TeacherApp from "./pages/TeacherInterfaces/TeacherApp";

// Admin pages
import AdminDashboard from "./pages/admin/dashboard";
import AdminSubjects from "./pages/admin/subjects";
import AdminClasses from "./pages/admin/classes";
import AdminUsers from "./pages/admin/users";
import AdminInterventions from "./pages/admin/interventions";
import AdminNotifications from "./pages/admin/notifications";
import AdminSettings from "./pages/admin/system-settings";
import AppLayout from "./layouts/app-layout";

// Teacher pages
// import TeacherDashboard from "./pages/teacher/TeacherDashboard";
// import TeacherClasses from "./pages/teacher/TeacherClasses";
// import TeacherClassworks from "./pages/teacher/TeacherClassworks";
// import TeacherInterventions from "./pages/teacher/TeacherInterventions";
// import TeacherGrades from "./pages/teacher/TeacherGrades";
// import TeacherNotifications from "./pages/teacher/TeacherNotifications";

// // Student pages
// import StudentBoard from "./pages/student/StudentBoard";
// import StudentSubjects from "./pages/student/StudentSubjects";
// import StudentInterventions from "./pages/student/StudentInterventions";
// import StudentGrades from "./pages/student/StudentGrades";
// import StudentTodo from "./pages/student/StudentTodo";
// import StudentNotifications from "./pages/student/StudentNotifications";

// // Layouts
// import TeacherLayout from "./pages/teacher/TeacherLayout";
// import StudentLayout from "./pages/student/StudentLayout";

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path={routes.auth.login} element={<Login />} />

          {/* Admin */}
          <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
            <Route index element={<Navigate to={routes.admin.dashboard} replace />} />
            <Route path={routes.admin.dashboard}     element={<AdminDashboard />}     />
            <Route path={routes.admin.subjects}      element={<AdminSubjects />}      />
            <Route path={routes.admin.classes}       element={<AdminClasses />}       />
            <Route path={routes.admin.users}         element={<AdminUsers />}         />
            <Route path={routes.admin.interventions} element={<AdminInterventions />} />
            <Route path={routes.admin.notifications} element={<AdminNotifications />} />
            <Route path={routes.admin.settings}      element={<AdminSettings />}      />
          </Route>

          {/* Teacher */}
          <Route element={<ProtectedRoute allowedRoles={["teacher"]} />}>
            <Route path="/teacher" element={<TeacherApp />} />
            {/* <Route element={<TeacherLayout />}>
              <Route path={routes.teacher.dashboard}     element={<TeacherDashboard />}     />
              <Route path={routes.teacher.classes}       element={<TeacherClasses />}       />
              <Route path={routes.teacher.classworks}    element={<TeacherClassworks />}    />
              <Route path={routes.teacher.interventions} element={<TeacherInterventions />} />
              <Route path={routes.teacher.grades}        element={<TeacherGrades />}        />
              <Route path={routes.teacher.notifications} element={<TeacherNotifications />} />
            </Route> */}
          </Route>

          {/* Student */}
          <Route element={<ProtectedRoute allowedRoles={["student"]} />}>
            <Route path="/" element={<StudentApp />} />
            {/* <Route element={<StudentLayout />}>
              <Route path={routes.student.board}          element={<StudentBoard />}          />
              <Route path={routes.student.subjects}       element={<StudentSubjects />}       />
              <Route path={routes.student.interventions}  element={<StudentInterventions />}  />
              <Route path={routes.student.grades}         element={<StudentGrades />}         />
              <Route path={routes.student.todo}           element={<StudentTodo />}           />
              <Route path={routes.student.notifications}  element={<StudentNotifications />}  />
            </Route> */}
          </Route>

          <Route path="*" element={<Navigate to={routes.auth.login} replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;