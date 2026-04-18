import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import StudentApp from "./pages/StudentInterfaces/StudentApp";
import TeacherApp from "./pages/TeacherInterfaces/TeacherApp";
import AdminApp from "./pages/AdminInterfaces/AdminApp";

const App = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute allowedRoles={["student"]} />}>
            <Route path="/" element={<StudentApp />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={["teacher"]} />}>
            <Route path="/teacher" element={<TeacherApp />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
            <Route path="/admin" element={<AdminApp />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
