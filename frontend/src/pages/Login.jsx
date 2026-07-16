import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useSchool } from "../context/SchoolContext.jsx";

export default function Login() {
  const { login } = useAuth();
  const { schoolName } = useSchool();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@school.test");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-display font-semibold text-ink">{schoolName}</h1>
          <p className="text-slate/60 text-sm mt-1 font-mono uppercase tracking-wider">Powered by Daraja</p>
        </div>
        <form onSubmit={handleSubmit} className="card p-8 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-rust text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="text-xs text-slate/50 mt-4 text-center font-mono">
          Demo: admin@school.test · teacher1@school.test · parent1@school.test — password123
        </p>
      </div>
    </div>
  );
}
