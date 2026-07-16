import { useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../context/AuthContext.jsx";

export default function ChangePassword() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const forced = user?.mustChangePassword;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setLoading(true);
    try {
      await client.post("/auth/change-password", { currentPassword, newPassword });
      const updated = { ...user, mustChangePassword: false };
      localStorage.setItem("user", JSON.stringify(updated));
      setUser(updated);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Could not change password. Check your current password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display font-semibold text-ink">
            {forced ? "Set a new password" : "Change password"}
          </h1>
          {forced && (
            <p className="text-slate/60 text-sm mt-2">
              This account was created with a temporary password. Please set your own before continuing.
            </p>
          )}
        </div>
        <form onSubmit={handleSubmit} className="card p-8 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Current password</label>
            <input
              className="input"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">New password</label>
            <input
              className="input"
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Confirm new password</label>
            <input
              className="input"
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-rust text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Saving…" : "Save new password"}
          </button>
          {!forced && (
            <button type="button" onClick={() => navigate("/")} className="text-sm text-slate/60 underline underline-offset-2 w-full text-center">
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
