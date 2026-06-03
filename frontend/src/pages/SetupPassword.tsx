import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/context/AuthContext";

export default function SetupPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { acceptInvitation } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-red-600">Invalid or missing invitation link.</p>
      </div>
    );
  }

  const handleSubmit = async () => {
    setError(null);
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters."); return; }

    setLoading(true);
    try {
      const role = await acceptInvitation(token, password, confirm);
      const dashboard = role === "teacher" ? "/teacher/dashboard"
                      : role === "admin"   ? "/admin/dashboard"
                      : "/student/subjects";
      navigate(dashboard, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0]">
      <div
        className="w-full max-w-sm rounded-xl p-8 shadow-[4px_5px_0_#000]"
        style={{ background: "#faf9f6", border: "2px solid #e5e3de" }}
      >
        <h1 className="mb-1 text-xl font-bold">Set your password</h1>
        <p className="mb-6 text-sm text-gray-500">
          You've been invited. Create a password to activate your account.
        </p>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            New Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "#ccc" }}
              placeholder="Min. 8 characters"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            Confirm Password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="rounded border px-3 py-2 text-sm"
              style={{ borderColor: "#ccc" }}
            />
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg border-2 border-black bg-[#79bd80] py-2 text-sm font-semibold shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000] disabled:opacity-50"
          >
            {loading ? "Activating..." : "Activate Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
