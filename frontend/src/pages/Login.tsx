import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    const matchedRole = login(username, password);
    if (matchedRole) {
      if (matchedRole === "teacher") navigate("/teacher");
      else if (matchedRole === "admin") navigate("/admin");
      else navigate("/");
    } else {
      setError("Invalid username or password.");
    }
  };

  return (
    <div className="px-10 py-10 flex flex-col justify-center items-center min-h-screen gap-5">
      <div className="flex flex-col gap-3 border rounded p-8 w-120">
        <div className="flex flex-col justify-center items-center">
          <header>
            <h1 className="font-semibold text-2xl">Log in to your account</h1>
          </header>
          <p className="text-sm">
            Enter your email and password below to login
          </p>
        </div>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p>Email Address</p>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="email@example.com"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-row justify-between">
              <p>Password</p>
              <p className="font-semibold">Forget password?</p>
            </div>

            <input
              className="border rounded px-3 py-2 w-full"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <Button>Button</Button>
          <button
            className="bg-[#7ABA78] text-black rounded py-2"
            onClick={handleLogin}
          >
            Login
          </button>
          <p className="text-center">
            <span className="font-semibold">Don't have an account?</span> Sign
            up
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
