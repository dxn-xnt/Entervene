import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { Text } from "@/components/retroui/Text";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Eye, EyeOff } from "lucide-react";
import { routes } from "@/../routes";

const Login = () => {
  const { login, role, isLoading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(() => {
    return localStorage.getItem("saved_email") || "";
  });
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => {
    return localStorage.getItem("remember_me") === "true";
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isLoading && role) {
      if (role === "admin") navigate(routes.admin.dashboard, { replace: true });
      else if (role === "teacher") navigate(routes.teacher.dashboard, { replace: true });
      else if (role === "student") navigate(routes.student.board, { replace: true });
    }
  }, [isLoading, role, navigate]);

  const handleLogin = async () => {
    setError("");
    const email = username.trim();

    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }

    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      if (rememberMe) {
        localStorage.setItem("remember_me", "true");
        localStorage.setItem("saved_email", email);
      } else {
        localStorage.removeItem("remember_me");
        localStorage.removeItem("saved_email");
      }

      const matchedRole = await login(email, password);
      if (matchedRole === "admin") navigate(routes.admin.dashboard);
      else if (matchedRole === "teacher") navigate(routes.teacher.dashboard);
      else if (matchedRole === "student") navigate(routes.student.board);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="retro-squares-bg retro-squares-motion flex min-h-dvh w-full items-center justify-center px-4 py-6 sm:px-6">
      <Card className="block w-full max-w-md p-0">
        <Card.Header className="mb-6 flex flex-col justify-center border-b-2 border-border bg-primary px-4 pb-5 pt-6 sm:mb-8 sm:px-8 sm:pb-6 sm:pt-8">
          <Card.Title className="font-sans font-bold mb-1">
            Entervene
          </Card.Title>
          <Card.Description className="font-normal text-sm">
            Enter your details to access your account
          </Card.Description>
        </Card.Header>
        <Card.Content className="px-4 pb-6 sm:px-8 sm:pb-10">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleLogin();
            }}
            className="flex flex-col gap-2"
          >
            <div className="mb-2 grid w-full min-w-0 items-center gap-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                type="email"
                id="email"
                className="w-full min-w-0 text-base shadow-none"
                placeholder="Email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="email"
                inputMode="email"
              />
            </div>

            <div className="mb-2 grid w-full min-w-0 items-center gap-2">
              <div className="flex min-w-0 flex-row items-center justify-between gap-2">
                <Label htmlFor="password">Password</Label>
                <Button
                  type="button"
                  variant="link"
                  className="font-regular shrink-0 p-0 text-sm font-normal font-underline shadow-none"
                  onClick={() => navigate("/forgot-password")}
                >
                  Forget password?
                </Button>
              </div>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 w-full min-w-0 rounded-none border-black pr-10 text-base shadow-none"
                  autoComplete="current-password"
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
              {error && (
                <Text as="p" className="text-red-500 text-sm">
                  {error}
                </Text>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <Checkbox
                id="remember-me"
                checked={rememberMe}
                onCheckedChange={(checked) => setRememberMe(checked === true)}
              />
              <Label htmlFor="remember-me" className="cursor-pointer select-none">
                Remember me
              </Label>
            </div>

            <Button
              type="submit"
              variant="default"
              autoIcon={false}
              className="mt-4 shadow-md hover:shadow-none"
              disabled={loading}
            >
              Sign In
            </Button>
            {/* <div className="flex flex-row items-center gap-1 mt-1">
              <Text as="p" className="text-center">
                Don't have an account?
              </Text>
              <Button
                type="button"
                variant="link"
                className="font-regular p-0"
                onClick={() => navigate("/forgot-password")}
              >
                Sign Up
              </Button>
            </div> */}
          </form>
        </Card.Content>
      </Card>
    </main>
  );
};

export default Login;
