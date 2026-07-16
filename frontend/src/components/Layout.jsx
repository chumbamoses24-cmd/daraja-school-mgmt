import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useSchool } from "../context/SchoolContext.jsx";

const NAV = {
  ADMIN: [
    { to: "/", label: "Dashboard", tab: "01" },
    { to: "/students", label: "Students", tab: "02" },
    { to: "/attendance", label: "Attendance", tab: "03" },
    { to: "/grades", label: "Grades", tab: "04" },
    { to: "/fees", label: "Fees", tab: "05" },
    { to: "/timetable", label: "Timetable", tab: "06" },
    { to: "/messages", label: "Messages", tab: "07" },
    { to: "/users", label: "Users", tab: "08" },
    { to: "/settings", label: "Settings", tab: "09" },
  ],
  TEACHER: [
    { to: "/", label: "Dashboard", tab: "01" },
    { to: "/students", label: "Students", tab: "02" },
    { to: "/attendance", label: "Attendance", tab: "03" },
    { to: "/grades", label: "Grades", tab: "04" },
    { to: "/timetable", label: "Timetable", tab: "06" },
    { to: "/messages", label: "Messages", tab: "07" },
  ],
  PARENT: [
    { to: "/", label: "Dashboard", tab: "01" },
    { to: "/students", label: "My Children", tab: "02" },
    { to: "/grades", label: "Report Cards", tab: "04" },
    { to: "/fees", label: "Fee Statement", tab: "05" },
    { to: "/messages", label: "Messages", tab: "07" },
  ],
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { schoolName } = useSchool();
  const navigate = useNavigate();
  const items = NAV[user?.role] || [];

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 bg-ink text-paper flex flex-col">
        <div className="px-6 py-6 border-b border-paper/15">
          <h1 className="text-2xl font-display font-semibold tracking-tight">{schoolName}</h1>
          <p className="text-xs text-paper/60 mt-0.5 font-mono uppercase tracking-wider">Powered by Daraja</p>
        </div>
        <nav className="flex-1 py-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 text-sm border-l-2 transition-colors ${
                  isActive
                    ? "border-amber bg-white/5 text-white"
                    : "border-transparent text-paper/70 hover:text-white hover:bg-white/5"
                }`
              }
            >
              <span className="font-mono text-xs text-paper/40">{item.tab}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-6 py-4 border-t border-paper/15 text-sm">
          <p className="font-medium">{user?.firstName} {user?.lastName}</p>
          <p className="text-paper/50 text-xs uppercase tracking-wider font-mono mb-3">{user?.role}</p>
          <div className="flex gap-3 flex-wrap">
            <NavLink to="/profile" className="text-paper/70 hover:text-white text-xs underline underline-offset-2">
              Edit profile
            </NavLink>
            <NavLink to="/change-password" className="text-paper/70 hover:text-white text-xs underline underline-offset-2">
              Change password
            </NavLink>
            <button
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="text-paper/70 hover:text-white text-xs underline underline-offset-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
