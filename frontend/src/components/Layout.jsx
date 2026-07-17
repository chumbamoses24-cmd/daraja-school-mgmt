import { useState } from "react";
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
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen md:flex">
      {/* Mobile top bar */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-ink text-paper sticky top-0 z-30">
        <button onClick={() => setNavOpen(true)} aria-label="Open menu" className="p-2 -ml-2 rounded hover:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="font-display font-semibold text-lg truncate px-2">{schoolName}</span>
        <div className="w-8" />
      </div>

      {/* Backdrop for mobile drawer */}
      {navOpen && <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={() => setNavOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 bg-ink text-paper flex flex-col transform transition-transform duration-200 md:static md:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-6 py-6 border-b border-paper/15 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-display font-semibold tracking-tight">{schoolName}</h1>
            <p className="text-xs text-paper/60 mt-0.5 font-mono uppercase tracking-wider">Powered by Daraja</p>
          </div>
          <button onClick={() => setNavOpen(false)} className="md:hidden p-1 text-paper/60 hover:text-white" aria-label="Close menu">
            ✕
          </button>
        </div>
        <nav className="flex-1 py-4 overflow-y-auto">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 text-sm border-l-2 transition-colors ${
                  isActive ? "border-amber bg-white/5 text-white" : "border-transparent text-paper/70 hover:text-white hover:bg-white/5"
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
            <NavLink to="/profile" onClick={() => setNavOpen(false)} className="text-paper/70 hover:text-white text-xs underline underline-offset-2">
              Edit profile
            </NavLink>
            <NavLink to="/change-password" onClick={() => setNavOpen(false)} className="text-paper/70 hover:text-white text-xs underline underline-offset-2">
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
      <main className="flex-1 overflow-y-auto min-w-0">
        <div className="max-w-6xl mx-auto px-4 py-5 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
