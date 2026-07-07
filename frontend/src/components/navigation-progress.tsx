import { useNavigationProgress } from "@/hooks/use-navigation-progress";

/**
 * Global top-bar loading indicator — sits fixed at the very top of the
 * viewport with z-[9999] to overlay everything (including modals / sheets).
 *
 * Renders a thin animated bar that:
 *  - Slides in from left on navigation or API activity
 *  - Pulses with a shimmer highlight for visual polish
 *  - Fades out smoothly on completion
 */
export function NavigationProgress() {
  const { progress, isActive } = useNavigationProgress();

  // Don't render anything when idle (avoids stacking-context cost)
  if (!isActive && progress === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[9999] h-[5px]"
      style={{ opacity: isActive ? 1 : 0, transition: "opacity 300ms ease" }}
    >
      {/* Track background (subtle) */}
      <div className="absolute inset-0 bg-primary/10" />

      {/* Filled bar */}
      <div
        className="absolute inset-y-0 left-0 bg-primary"
        style={{
          width: `${progress}%`,
          transition:
            progress === 100
              ? "width 200ms ease-out"
              : "width 400ms cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        {/* Shimmer highlight on the leading edge */}
        <div
          className="absolute right-0 top-0 h-full w-24 bg-gradient-to-r from-transparent via-white/40 to-transparent"
          style={{
            animation: isActive ? "shimmer 1.5s ease-in-out infinite" : "none",
          }}
        />
      </div>

      {/* Glow dot at the tip */}
      {isActive && (
        <div
          className="absolute top-0 h-[5px] w-[5px] rounded-full bg-primary shadow-[0_0_10px_2px] shadow-primary/60"
          style={{
            left: `${progress}%`,
            transition:
              progress === 100
                ? "left 200ms ease-out"
                : "left 400ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      )}

      {/* Inline keyframes for the shimmer effect */}
      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 0.3; transform: translateX(-100%); }
          50% { opacity: 1; transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
