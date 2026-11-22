import { useState, useEffect } from "react";
import { Link, Navigate } from "react-router-dom";
import { routes } from "@/../routes";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { useAuth } from "@/context/AuthContext";
import EnterveneLogo from "@/components/logo";
import IconContainer from "@/components/icon-container";
import { Carousel, type CarouselApi } from "@/components/retroui/Carousel";
import {
  AlertTriangle,
  Lightbulb,
  BarChart3,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn, formatToTitleCase } from "@/lib/utils";

const mosaicTiles = [
  {
    title: "Medellin National Science and Technology School",
    image: "/34193101_1079245788881265_1406145758402445312_n.jpg",
    gridClass: "col-span-1 sm:col-span-2 md:col-span-3 md:row-span-2 min-h-[200px] md:min-h-[316px]",
  },
  {
    title: "Partner institution campus",
    image: "/502559653_3185505348255288_5547689931543849637_n.jpg",
    gridClass: "col-span-1 sm:col-span-1 md:col-span-3 min-h-[150px]",
  },
  {
    title: "Partner science laboratory",
    image: "/509356808_3211426742329815_7578138440447546932_n.jpg",
    gridClass: "col-span-1 sm:col-span-1 md:col-span-2 min-h-[150px]",
  },
  {
    title: "Library",
    image: "/904270628_3787558194716664_3463499783369779486_n.jpg",

    gridClass: "col-span-1 sm:col-span-1 md:col-span-1 min-h-[150px]",
  },
  {
    title: "Student showcase",
    image: "/71490301_1447634648709042_8430278266627031040_n.jpg",
    gridClass: "col-span-1 sm:col-span-1 md:col-span-2 min-h-[150px]",
  },
  {
    title: "Partner institution classroom",
    image: "/86836438_1587201884752317_1580559050238590976_n.jpg",
    gridClass: "col-span-1 sm:col-span-2 md:col-span-4 max-h-[300px]",
  },
];

const features = [
  {
    title: "Spot at-risk students early",
    description:
      "AI reviews performance data and flags students who may be heading toward academic failure, before grades drop too far.",
    icon: <AlertTriangle className="size-5" />,
    image: "/features/at-risk.png",
  },
  {
    title: "Get the right help for each student",
    description:
      "Entervene recommends interventions and learning materials that match what each student needs to catch up.",
    icon: <Lightbulb className="size-5" />,
    image: "/features/interventions.png",
  },
  {
    title: "Monitor performance and engagement",
    description:
      "See grades, submissions and participation for every student and section, with reports and alerts when something changes.",
    icon: <BarChart3 className="size-5" />,
    image: "/features/performance.png",
  },
  {
    title: "Create quizzes in minutes",
    description:
      "Teachers turn lesson content into ready-to-use quiz questions with the AI quiz generator, then edit and assign them.",
    icon: <Sparkles className="size-5" />,
    image: "/features/quizzes.png",
  },
];

const Landing = () => {
  const { role, isLoading } = useAuth();
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const [currentSlide, setCurrentSlide] = useState(0);

  useEffect(() => {
    if (!carouselApi) return;
    const onSelect = () => {
      setCurrentSlide(carouselApi.selectedScrollSnap());
    };
    carouselApi.on("select", onSelect);
    onSelect();
    return () => {
      carouselApi.off("select", onSelect);
    };
  }, [carouselApi]);

  useEffect(() => {
    if (!carouselApi) return;
    const interval = setInterval(() => {
      carouselApi.scrollNext();
    }, 5000);
    return () => clearInterval(interval);
  }, [carouselApi]);

  if (isLoading) return null;

  if (role) {
    if (role === "admin") return <Navigate to={routes.admin.dashboard} replace />;
    if (role === "teacher") return <Navigate to={routes.teacher.dashboard} replace />;
    if (role === "student") return <Navigate to={routes.student.board} replace />;
  }

  return (
    <div className="retro-squares-bg retro-squares-motion min-h-svh flex flex-col">
      {/* Top Navigation */}
      <div className="sticky top-0 z-50 flex w-full bg-background/95 backdrop-blur-sm border-b-2 border-border justify-center">
        <header className="flex items-center justify-between py-4 sm:py-5 max-w-6xl w-full px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-3 font-head font-bold text-xl sm:text-2xl text-foreground"
          >
            <EnterveneLogo className="size-9 drop-shadow-[0px_2px_0px_#000]" />
            <span>Entervene</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-6" aria-label="Main">
            <a
              href="#partners"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Our schools
            </a>
            <a
              href="#features"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Features
            </a>
            <Button asChild size="sm" autoIcon={false}>
              <Link to={routes.auth.login}>Get Started</Link>
            </Button>
          </nav>
          <div className="sm:hidden">
            <Button asChild size="sm" autoIcon={false}>
              <Link to={routes.auth.login}>Sign In</Link>
            </Button>
          </div>
        </header>
      </div>

      <main id="top" className="flex-1">
        {/* Hero Section with Showcase Carousel */}
        <section id="partners" className="py-10 sm:py-16 md:py-20 px-10 sm:px-16 md:px-20 relative overflow-hidden">
          <div className="w-full mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 gap-16 items-center">
              {/* Carousel Display on the Left */}
              <div className="lg:col-span-6 w-full order-2 lg:order-1">
                <Carousel
                  opts={{
                    loop: true,
                  }}
                  setApi={setCarouselApi}
                  className="w-full relative"
                >
                  <Carousel.Content>
                    {mosaicTiles.map((slide, index) => (
                      <Carousel.Item key={slide.title} className="pr-2 pb-2">
                        <div className="relative aspect-[4/3] sm:aspect-[16/10] w-full rounded-2xl border-2 border-border overflow-hidden bg-card shadow-md mr-2">
                          <img
                            src={slide.image}
                            alt={slide.title}
                            className="w-full h-full object-cover block select-none"
                            loading={index === 0 ? "eager" : "lazy"}
                          />
                        </div>
                      </Carousel.Item>
                    ))}
                  </Carousel.Content>

                  {/* Dots indicators & Navigation buttons */}
                  <div className="flex items-center justify-between mt-3 px-1">
                    <div className="flex items-center gap-1.5">
                      {mosaicTiles.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => carouselApi?.scrollTo(i)}
                          className={cn(
                            "h-2.5 rounded-full transition-all duration-200 cursor-pointer border-2 border-black",
                            currentSlide === i
                              ? "w-7 bg-primary"
                              : "w-2.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                          )}
                          aria-label={`Go to slide ${i + 1}`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8 rounded shadow-xs"
                        onClick={() => carouselApi?.scrollPrev()}
                        aria-label="Previous slide"
                      >
                        <ChevronLeft className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="size-8 rounded shadow-xs"
                        onClick={() => carouselApi?.scrollNext()}
                        aria-label="Next slide"
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    </div>
                  </div>
                </Carousel>
              </div>

              {/* Hero Content on the Right */}
              <div className="lg:col-span-6 flex flex-col items-center text-left order-1 lg:order-2">
                <div className="flex items-center gap-3 sm:gap-4 mb-3">
                  <EnterveneLogo className="size-12 sm:size-16 md:size-20 drop-shadow-[0px_4px_0px_#000]" />
                  <h1 className="text-4xl sm:text-5xl md:text-6xl font-head font-bold tracking-tight text-foreground">
                    Entervene
                  </h1>
                </div>
                <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-foreground mb-3">
                  Medellin National Science and Technology School
                </h2>
                <p className="text-sm sm:text-base text-muted-foreground mb-8 leading-relaxed">
                  Ad Astra. A learning management system built for Medellin National Science
                  and Technology School, where science and discovery reach for the stars.
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    asChild
                    autoIcon={false}
                    size="lg"
                    className="min-h-12 px-8 text-base font-bold shadow-md"
                  >
                    <Link to={routes.auth.login}>Get Started</Link>
                  </Button>
                  <Button
                    asChild
                    autoIcon={false}
                    variant="outline"
                    size="lg"
                    className="min-h-12 px-8 text-base font-bold shadow-md"
                  >
                    <a href="#features">See what’s inside</a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section id="features" className="py-12 sm:py-16">
          <div className="w-full mx-auto px-26">
            <h3 className="text-2xl sm:text-4xl font-head font-bold text-foreground mb-3 leading-tight">
              One platform for school management and early intervention
            </h3>
            <p className="text-sm sm:text-base text-muted-foreground mb-8 leading-relaxed">
              Entervene is an AI-enhanced, web-based LMS that streamlines academic management, monitors student performance and supports early intervention for students at risk of academic failure.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {features.map((feat) => (
                <Card
                  key={feat.title}
                  className="border-2 border-border p-6 sm:p-7 rounded-2xl shadow-md bg-card flex flex-col justify-between hover:-translate-y-1 transition-all"
                >
                  <div className="flex-1 flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                      <IconContainer variant="primary" shadow="default" size="xl" className="size-20 shadow-none">
                        {feat.icon}
                      </IconContainer>
                      <div className="flex flex-col gap-1">
                        <h4 className="text-xl font-head font-bold text-foreground">
                          {formatToTitleCase(feat.title)}
                        </h4>
                        <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed mb-2">
                          {feat.description}
                        </p>
                      </div>
                    </div>

                    <div className="mt-auto overflow-hidden rounded! border-2 border-border bg-card shadow-none">
                      <img
                        src={feat.image}
                        alt={feat.title}
                        className="w-full aspect-[4/1.5] object-cover object-top block select-none pointer-events-none"
                        loading="lazy"
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Call to Action Band */}
        <section id="start" className="py-12 sm:py-16">
          <div className="w-full max-w-6xl mx-auto px-4 sm:px-6">
            <div className=" p-8 sm:p-14 text-center ">
              <h3 className="text-2xl sm:text-4xl font-head font-bold mb-3">
                Ready to start learning?
              </h3>
              <p className="max-w-xl mx-auto mb-7 text-sm sm:text-base opacity-85 leading-relaxed">
                Sign in with your school account to open your classes.
              </p>
              <Button
                asChild
                autoIcon={false}
                size="lg"
              >
                <Link to={routes.auth.login}>Get Started</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 mt-auto">
        <footer className="flex flex-col sm:flex-row items-center justify-between gap-3 py-8 text-xs sm:text-sm text-muted-foreground">
          <span>Medellin National Science and Technology School</span>
          <span className="font-semibold">Ad Astra.</span>
        </footer>
      </div>
    </div>
  );
};

export default Landing;
