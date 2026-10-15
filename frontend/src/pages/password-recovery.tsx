import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { routes } from "@/../routes";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";

export default function PasswordRecovery() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const resetting = pathname === routes.auth.resetPassword;
  const token = params.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (resetting && (!token || password.length < 8 || password !== confirmPassword)) {
      setError(!token ? "Invalid reset link." : password.length < 8 ? "Use at least 8 characters." : "Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const response = await apiFetch(
        resetting ? "/api/v1/auth/reset-password" : "/api/v1/auth/forgot-password",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(resetting
            ? { token, password, confirm_password: confirmPassword }
            : { email: email.trim() }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Please try again.");
      setMessage(data.message);
      setPassword("");
      setConfirmPassword("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="retro-squares-bg flex min-h-dvh items-center justify-center px-4">
      <Card className="block w-full max-w-md p-8">
        <h1 className="mb-2 text-2xl font-bold">{resetting ? "Reset password" : "Forgot password?"}</h1>
        <p className="mb-6 text-sm">{resetting ? "Choose a new password for your account." : "Enter your email and we’ll send you a reset link."}</p>
        {resetting && !token ? <p role="alert" className="mb-4 text-red-600">This reset link is invalid.</p> : null}
        <form onSubmit={submit} className="flex flex-col gap-4">
          {resetting ? <>
            <div><Label htmlFor="new-password">New password</Label><Input id="new-password" type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
            <div><Label htmlFor="confirm-password">Confirm password</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
          </> : <div><Label htmlFor="recovery-email">Email</Label><Input id="recovery-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {message && <p role="status" className="text-sm text-green-700">{message}</p>}
          <Button type="submit" disabled={busy || (resetting && !token)}>{busy ? "Please wait…" : resetting ? "Save password" : "Send reset link"}</Button>
        </form>
        <Link className="mt-6 inline-block text-sm underline" to={routes.auth.login}>Back to sign in</Link>
      </Card>
    </main>
  );
}
