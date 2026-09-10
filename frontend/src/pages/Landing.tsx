import { Link, Navigate } from "react-router-dom";
import { routes } from "@/../routes";
import { Button } from "@/components/retroui/Button";
import { useAuth } from "@/context/AuthContext";

const Landing = () => {
  const { role, isLoading } = useAuth();

  if (isLoading) return null;

  if (role) {
    if (role === "admin") return <Navigate to={routes.admin.dashboard} replace />;
    if (role === "teacher") return <Navigate to={routes.teacher.dashboard} replace />;
    if (role === "student") return <Navigate to={routes.student.board} replace />;
  }

  return (
    <div className="retro-squares-bg retro-squares-motion flex min-h-svh flex-col">
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <section className="w-full max-w-[560px] text-center" aria-labelledby="landing-title">
        <h1
          id="landing-title"
          className="mb-2.5 font-head text-[clamp(32px,7.5vw,58px)] leading-[1.15] tracking-[2px] text-primary-hover [-webkit-text-stroke:2px_#000] [paint-order:stroke_fill] [text-shadow:4px_5px_0_#000]"
        >
          ENTERVENE
        </h1>
        <p className="text-[clamp(16px,2.5vw,19px)] leading-[1.4] font-semibold">
          Medellin National Science and Technology School
        </p>
        <p className="mt-1.5 mb-7 text-[15px] leading-[1.25] text-muted-foreground">
          Ad Astra. Built for Medellin National Science and Technology School — where
          science and discovery reach for the stars.
        </p>
        <Button
          asChild
          autoIcon={false}
          className="mx-auto min-h-10 w-full max-w-[414px] text-lg focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-8 focus-visible:outline-foreground"
        >
          <Link to={routes.auth.login}>Get Started</Link>
        </Button>
      </section>
    </main>
    <footer className="status-footer">Medellin National Science and Technology School<span>Ad Astra.</span></footer>
    </div>
  );
};

export default Landing;
