import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { Text } from "@/components/retroui/Text";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { Checkbox } from "@/components/retroui/Checkbox";

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
    <div className="flex flex-col items-center justify-center h-screen">
    <Card>
      <Card.Header className="flex flex-col justify-center bg-accent">
        <Card.Title>
          Sign In
        </Card.Title>
        <Card.Description className="text-black text-sm">
          Welcome back! Enter your details to access your account.
        </Card.Description>
      </Card.Header>

      <Card.Content>
        <div className="flex flex-col gap-5">
          <div className="grid w-full max-w-sm items-center gap-2">
            <Label htmlFor="email">Email Address</Label>
            <Input type="email" id="email" placeholder="Email" value={username}
              onChange={(e) => setUsername(e.target.value)}/>
          </div> 
          
          <div className="grid w-full max-w-sm items-center gap-2">
            <div className="flex flex-row justify-between items-center">
              <Label htmlFor="password">Password</Label>
              <Button variant="link" className="font-regular p-0 text-sm font-normal font-underline" 
                onClick={() => navigate("/forgot-password")}>
                Forget password?
              </Button>
            </div>
            <Input type="password" id="password" placeholder="Password" value={password}
              onChange={(e) => setPassword(e.target.value)}/>
            {error && <Text as="p" className="text-red-500 text-sm">{error}</Text>}
          </div>  
          
          <div className="flex gap-2 items-center">
            <Checkbox />
            <Text>Remember me</Text>
          </div>

    
          <Button variant="default" className="mt-4"
            onClick={handleLogin}
          >
            Sign In
          </Button>
          <div className="flex flex-row items-center gap-1">
            <Text as="p" className="text-center">Don't have an account?</Text>
            <Button variant="link" className="font-regular p-0" 
              onClick={() => navigate("/forgot-password")}>
              Sign In
            </Button>
          </div>
          
        </div>
      </Card.Content>
    </Card>
    </div>
  );
};

export default Login;
