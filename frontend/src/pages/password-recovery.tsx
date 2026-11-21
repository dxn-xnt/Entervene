import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, Check, Eye, EyeOff, X } from "lucide-react";

import { routes } from "@/../routes";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { Text } from "@/components/retroui/Text";
import { EnterveneLogo } from "@/components/logo";
import { useToast } from "@/components/retroui/Toast";
import { apiFetch } from "@/lib/api";

type ResetLinkState = "idle" | "checking" | "valid" | "invalid";

export default function PasswordRecovery() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const resetting = pathname === routes.auth.resetPassword;
  const token = params.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetLinkState, setResetLinkState] = useState<ResetLinkState>(
    resetting ? "checking" : "idle",
  );

  const passwordCriteria = useMemo(
    () => [
      { label: "At least 8 characters", met: password.length >= 8 },
      {
        label: "Uppercase and lowercase letters",
        met: /[a-z]/.test(password) && /[A-Z]/.test(password),
      },
      { label: "At least one number", met: /\d/.test(password) },
      { label: "At least one symbol", met: /[^A-Za-z0-9]/.test(password) },
    ],
    [password],
  );
  const passwordIsValid = passwordCriteria.every((criterion) => criterion.met);
  const passwordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;

  useEffect(() => {
    if (!resetting) {
      setResetLinkState("idle");
      return;
    }
    if (!token) {
      setResetLinkState("invalid");
      return;
    }

    let cancelled = false;
    const validateToken = async () => {
      setResetLinkState("checking");
      try {
        const response = await apiFetch(
          "/api/v1/auth/reset-password/validate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          },
        );
        if (!cancelled) setResetLinkState(response.ok ? "valid" : "invalid");
      } catch {
        if (!cancelled) setResetLinkState("invalid");
      }
    };
    void validateToken();
    return () => {
      cancelled = true;
    };
  }, [resetting, token]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (resetting) {
      if (resetLinkState !== "valid") {
        setError("This reset link is invalid or has expired.");
        return;
      }
      if (!passwordIsValid) {
        setError("Please meet all password requirements.");
        return;
      }
      if (!passwordsMatch) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      const response = await apiFetch(
        resetting
          ? "/api/v1/auth/reset-password"
          : "/api/v1/auth/forgot-password",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            resetting
              ? { token, password, confirm_password: confirmPassword }
              : { email: email.trim() },
          ),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.detail === "string" ? data.detail : "Please try again.",
        );
      }

      if (resetting) {
        navigate(routes.auth.login, {
          replace: true,
          state: { passwordReset: true },
        });
        return;
      }
      toast.success({
        title: "Check your email",
        description:
          typeof data.message === "string"
            ? data.message
            : "If this email has an active account, a reset link has been sent.",
      });
      setEmail("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const description = resetting
    ? "Create a secure new password"
    : "Receive a password reset link by email";

  return (
    <main className="retro-squares-bg retro-squares-motion flex min-h-dvh w-full items-center justify-center px-4 py-6 sm:px-6">
      <Card className="block w-full max-w-md overflow-hidden p-0">
        <Card.Header className="mb-0 flex flex-col justify-center border-b-2 border-border bg-primary px-4 py-5 sm:px-8 sm:py-6">
          <div className="mb-1 flex items-center gap-4">
            <EnterveneLogo className="size-14" />
            <div className="min-w-0">
              <Card.Title className="pt-2 font-head text-4xl font-bold">
                Entervene
              </Card.Title>
              <Card.Description className="whitespace-nowrap pl-0.5 text-sm font-normal">
                {description}
              </Card.Description>
            </div>
          </div>
        </Card.Header>

        <Card.Content className="px-4 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6">
          <div className="mb-4">
            <h1 className="whitespace-nowrap text-2xl font-bold">
              {resetting ? "Reset password" : "Forgot password?"}
            </h1>
            <Text
              as="p"
              className="mt-1 whitespace-nowrap text-sm text-muted-foreground"
            >
              {resetting
                ? "Enter and confirm your new password."
                : "We’ll email instructions for active accounts."}
            </Text>
          </div>

          {resetting && resetLinkState === "checking" ? (
            <div className="py-8 text-center text-sm font-medium text-muted-foreground">
              Checking your reset link...
            </div>
          ) : resetting && resetLinkState === "invalid" ? (
            <div className="space-y-5">
              <Alert status="error" className="p-3">
                <Alert.Title className="text-sm font-bold">
                  Reset link unavailable
                </Alert.Title>
                <Alert.Description className="mt-1 text-sm text-red-800">
                  This link is invalid, expired, or has already been used.
                  Request a new password reset link.
                </Alert.Description>
              </Alert>
              <Button asChild autoIcon={false} className="w-full">
                <Link to={routes.auth.forgotPassword}>Request a new link</Link>
              </Button>
            </div>
          ) : (
            <form
              onSubmit={submit}
              className="flex flex-col gap-4"
              aria-busy={busy}
            >
              {resetting ? (
                <>
                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <div className="relative">
                      <Input
                        id="new-password"
                        className="h-10 w-full min-w-0 pr-10 text-base shadow-none"
                        type={showPassword ? "text" : "password"}
                        placeholder="Enter a new password"
                        maxLength={128}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-700"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {password.length > 0 && (
                    <div className="rounded border-2 border-black bg-background p-3">
                      <p className="mb-2 text-xs font-bold">
                        Password requirements
                      </p>
                      <ul className="grid gap-1.5 text-xs">
                        {passwordCriteria.map((criterion) => (
                          <li
                            key={criterion.label}
                            className="flex items-center gap-2"
                          >
                            {criterion.met ? (
                              <Check className="size-3.5 text-success" />
                            ) : (
                              <X className="size-3.5 text-muted-foreground" />
                            )}
                            <span
                              className={
                                criterion.met
                                  ? "font-medium"
                                  : "text-muted-foreground"
                              }
                            >
                              {criterion.label}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="grid min-w-0 gap-2">
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <div className="relative">
                      <Input
                        id="confirm-password"
                        className="h-10 w-full min-w-0 pr-10 text-base shadow-none"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="Confirm your new password"
                        maxLength={128}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                        required
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setShowConfirmPassword((current) => !current)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-gray-700"
                        aria-label={
                          showConfirmPassword
                            ? "Hide password confirmation"
                            : "Show password confirmation"
                        }
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    {confirmPassword.length > 0 && (
                      <p
                        className={`text-xs font-medium ${passwordsMatch ? "text-success" : "text-destructive"}`}
                      >
                        {passwordsMatch
                          ? "Passwords match."
                          : "Passwords do not match."}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="recovery-email">Email Address</Label>
                  <Input
                    id="recovery-email"
                    className="h-10 w-full min-w-0 text-base shadow-none"
                    type="email"
                    placeholder="Email"
                    inputMode="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
              )}

              {error && (
                <Alert status="error" className="p-3">
                  <Alert.Description className="text-sm text-red-800">
                    {error}
                  </Alert.Description>
                </Alert>
              )}
              <Button
                type="submit"
                autoIcon={false}
                className="mt-1 w-full"
                disabled={
                  busy || (resetting && (!passwordIsValid || !passwordsMatch))
                }
              >
                {busy
                  ? "Please wait..."
                  : resetting
                    ? "Reset Password"
                    : "Send Reset Link"}
              </Button>
            </form>
          )}

          <Button
            asChild
            variant="link"
            autoIcon={false}
            className="mx-auto mt-4 w-fit gap-2 p-0 text-sm text-foreground shadow-none"
          >
            <Link to={routes.auth.login}>
              <ArrowLeft className="size-4 shrink-0" />
              Back to sign in
            </Link>
          </Button>
        </Card.Content>
      </Card>
    </main>
  );
}
