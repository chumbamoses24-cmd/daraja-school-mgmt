import { Routes, Route } from "react-router-dom";
import Login from "./pages/Login.jsx";
import ChangePassword from "./pages/ChangePassword.jsx";
import Profile from "./pages/Profile.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Students from "./pages/Students.jsx";
import Attendance from "./pages/Attendance.jsx";
import Grades from "./pages/Grades.jsx";
import Fees from "./pages/Fees.jsx";
import Timetable from "./pages/Timetable.jsx";
import Messages from "./pages/Messages.jsx";
import Users from "./pages/Users.jsx";
import Settings from "./pages/Settings.jsx";
import Layout from "./components/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";

function Page({ children }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute>
            <ChangePassword />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Page><Dashboard /></Page>} />
      <Route path="/profile" element={<Page><Profile /></Page>} />
      <Route
        path="/users"
        element={
          <ProtectedRoute roles={["ADMIN"]}>
            <Layout><Users /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute roles={["ADMIN"]}>
            <Layout><Settings /></Layout>
          </ProtectedRoute>
        }
      />
      <Route path="/students" element={<Page><Students /></Page>} />
      <Route path="/attendance" element={<Page><Attendance /></Page>} />
      <Route path="/grades" element={<Page><Grades /></Page>} />
      <Route
        path="/fees"
        element={
          <ProtectedRoute roles={["ADMIN", "PARENT"]}>
            <Layout><Fees /></Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/timetable"
        element={
          <ProtectedRoute roles={["ADMIN", "TEACHER"]}>
            <Layout><Timetable /></Layout>
          </ProtectedRoute>
        }
      />
      <Route path="/messages" element={<Page><Messages /></Page>} />
    </Routes>
  );
}
