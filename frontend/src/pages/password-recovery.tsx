import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { routes } from "@/../routes";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { Text } from "@/components/retroui/Text";
import { ArrowLeft } from "lucide-react";

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
    <main className="retro-squares-bg flex min-h-dvh w-full items-center justify-center px-4 py-6 sm:px-6">
      <Card className="block w-full max-w-md overflow-hidden p-0">
        <Card.Header className="mb-0 gap-2 border-b-2 border-border bg-primary p-4 sm:p-5">
          <Text as="h1" className="text-2xl font-bold lg:text-2xl text-primary-foreground">
            {resetting ? "Reset password" : "Forgot password?"}
          </Text>
          <Text as="p" className="text-sm text-primary-foreground">
            {resetting ? "Choose a new password for your account." : "Enter your email and we’ll send you a reset link."}
          </Text>
        </Card.Header>
        <Card.Content className="p-4 sm:p-5">
          <form onSubmit={submit} className="flex flex-col gap-5" aria-busy={busy}>
            {resetting && !token ? <Text as="p" role="alert" className="text-sm text-destructive">This reset link is invalid.</Text> : null}
            {resetting ? <>
              <div className="grid min-w-0 gap-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" className="w-full min-w-0 shadow-none" type="password" placeholder="Enter a new password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
              </div>
              <div className="grid min-w-0 gap-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input id="confirm-password" className="w-full min-w-0 shadow-none" type="password" placeholder="Confirm your password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
              </div>
            </> : <div className="grid min-w-0 gap-2">
              <Label htmlFor="recovery-email">Email Address</Label>
              <Input id="recovery-email" className="w-full min-w-0 shadow-none" type="email" placeholder="Enter your email address" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>}
            {error && <Text as="p" role="alert" aria-live="assertive" className="text-sm text-destructive">{error}</Text>}
            {message && <Text as="p" role="status" className="text-sm text-foreground">{message}</Text>}
            <Button type="submit" autoIcon={false} className="w-full" disabled={busy || (resetting && !token)}>
              {busy ? "Please wait…" : resetting ? "Save password" : "Send reset link"}
            </Button>
          </form>
          <Button asChild variant="link" className="mx-auto mt-6 w-fit gap-2 p-0 text-sm text-foreground">
            <Link to={routes.auth.login}><ArrowLeft className="size-4 shrink-0" />Back to sign in</Link>
          </Button>
        </Card.Content>
      </Card>
    </main>
  );
}