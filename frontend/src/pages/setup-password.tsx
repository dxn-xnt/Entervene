import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/context/AuthContext";
import { Eye, EyeOff, Check, X, ShieldCheck } from "lucide-react";
import { Input } from "@/components/retroui/Input";
import { Card } from "@/components/retroui/Card";

export default function SetupPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { acceptInvitation } = useAuth();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);
  const [isConfirmFocused, setIsConfirmFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0]">
        <Card className="block w-full max-w-sm border-black bg-white p-8 text-center transition-none">
          <p className="text-sm font-semibold text-red-600">
            Invalid or missing invitation link.
          </p>
        </Card>
      </div>
    );
  }

  // Dynamic strength criteria checks
  const criteria = [
    { label: "A minimum of 8 characters", met: password.length >= 8 },
    {
      label: "Lower and upper case letters",
      met: /[a-z]/.test(password) && /[A-Z]/.test(password),
    },
    { label: "At least 1 number", met: /\d/.test(password) },
    { label: "At least 1 symbol", met: /[^A-Za-z0-9]/.test(password) },
  ];

  const metCount = criteria.filter((c) => c.met).length;
  const isAllMet = metCount === criteria.length;
  const isPasswordActive = isPasswordFocused || password.length > 0;
  const isConfirmActive = isConfirmFocused || confirm.length > 0;
  const isMatched =
    isConfirmActive && confirm.length > 0 && confirm === password;

  const getStrengthLabel = () => {
    if (password.length === 0) return "Weak";
    if (metCount <= 1) return "Weak";
    if (metCount === 2) return "Fair";
    if (metCount === 3) return "Strong";
    return "Very Strong";
  };

  const getStrengthBarColor = () => {
    if (metCount === 0) return "bg-gray-200";
    if (metCount === 1) return "bg-red-500";
    if (metCount === 2) return "bg-amber-500";
    if (metCount === 3) return "bg-blue-500";
    return "bg-emerald-500";
  };

  const getStrengthTextColor = () => {
    if (metCount === 0) return "text-gray-400";
    if (metCount === 1) return "text-red-500";
    if (metCount === 2) return "text-amber-600";
    if (metCount === 3) return "text-blue-600";
    return "text-emerald-600";
  };

  const handleSubmit = async () => {
    setError(null);
    if (!isAllMet) {
      setError("Please meet all password requirements before proceeding.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const role = await acceptInvitation(token, password, confirm);
      const dashboard =
        role === "teacher"
          ? "/teacher/dashboard"
          : role === "admin"
            ? "/admin/dashboard"
            : "/student/subjects";
      navigate(dashboard, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0] p-4">
      <Card className="block w-full max-w-md border-black bg-white p-8 transition-none">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center border-2 border-black bg-primary text-black shadow-md">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              Set your password
            </h1>
            <p className="text-xs text-gray-500">
              You've been invited. Create a secure password to activate your
              account.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {/* New Password Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700">
              Enter Password
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setIsPasswordFocused(true)}
                onBlur={() => setIsPasswordFocused(false)}
                className="w-full rounded-none border-black !shadow-none h-10 pr-10 text-sm"
                placeholder="Enter new password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Dynamic Password Strength & Progress Line (smooth height & opacity expand/collapse) */}
          <div
            className={`grid transition-all duration-300 ease-in-out ${
              isPasswordActive
                ? "grid-rows-[1fr] opacity-100 pointer-events-auto"
                : "grid-rows-[0fr] opacity-0 pointer-events-none"
            }`}
          >
            <div className="overflow-hidden">
              <div className="border-2 border-black bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    Password strength
                  </span>
                  <span
                    className={`text-xs font-bold ${getStrengthTextColor()}`}
                  >
                    {getStrengthLabel()}
                  </span>
                </div>

                {/* Line Progress Bar */}
                <div className="mb-4 h-2 w-full overflow-hidden border-2 border-black bg-gray-100">
                  <div
                    className={`h-full transition-all duration-300 ease-out ${getStrengthBarColor()}`}
                    style={{ width: `${(metCount / criteria.length) * 100}%` }}
                  />
                </div>

                {/* Dynamic Rule Checkboxes */}
                <ul className="space-y-2 text-xs">
                  {criteria.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2.5">
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center border-2 border-black transition-colors duration-200 ${
                          item.met
                            ? "bg-emerald-500 text-white"
                            : "bg-gray-100 text-transparent"
                        }`}
                      >
                        <Check className="h-3 w-3 stroke-[3]" />
                      </span>
                      <span
                        className={`transition-colors duration-200 ${
                          item.met
                            ? "font-medium text-gray-800"
                            : "text-gray-500"
                        }`}
                      >
                        {item.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Confirm Password Input */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-gray-700">
              Confirm Password
            </label>
            <div className="relative">
              <Input
                type={showConfirm ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onFocus={() => setIsConfirmFocused(true)}
                onBlur={() => setIsConfirmFocused(false)}
                className="w-full rounded-none border-black !shadow-none h-10 pr-10 text-sm"
                placeholder="Re-enter password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition"
                aria-label={
                  showConfirm
                    ? "Hide confirm password"
                    : "Show confirm password"
                }
              >
                {showConfirm ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {/* Match / Unmatch status text dependent on active input with smooth transition */}
            <div
              className={`grid transition-all duration-300 ease-in-out ${
                isConfirmActive && confirm.length > 0
                  ? "grid-rows-[1fr] opacity-100"
                  : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="overflow-hidden">
                <p
                  className={`mt-1 flex items-center gap-1.5 text-xs font-semibold ${
                    isMatched ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  {isMatched ? (
                    <>
                      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                      Password matched
                    </>
                  ) : (
                    <>
                      <X className="h-3.5 w-3.5 stroke-[2.5]" />
                      Password unmatched
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="border-2 border-red-600 bg-red-50 p-3 text-xs text-red-600">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !isAllMet || !isMatched}
            className="mt-1 w-full rounded-none border-2 border-black bg-primary py-2.5 text-sm font-semibold shadow-md transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[3px_3px_0_#000]"
          >
            {loading ? "Activating..." : "Activate Account"}
          </button>
        </div>
      </Card>
    </div>
  );
}
