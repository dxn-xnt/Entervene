import React from "react";
import { cn } from "@/lib/utils";

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number | string;
}

/**
 * Entervene Mechanical Keycap Logo (from /logo2.svg)
 */
export const EnterveneLogo: React.FC<LogoProps> = ({
  className,
  size,
  ...props
}) => {
  return (
    <svg
      viewBox="24 25 225 198"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={size ? { width: size, height: size } : undefined}
      className={cn(
        "inline-block shrink-0 drop-shadow-[0px_4px_0px_#000] transition-all duration-150 ease-out select-none cursor-pointer",
        "active:translate-y-1 active:drop-shadow-none",
        className
      )}
      {...props}
    >
      {/* Outer base & lower skirt */}
      <path
        d="M44.0045 95.5L34.2085 186.716C33.8604 190.418 34.6677 194.132 36.5419 197.454L38.7859 201.431C42.6566 208.292 50.5688 212.625 59.2239 212.625H213.785C222.44 212.625 230.353 208.292 234.224 201.431L236.467 197.454C238.341 194.132 239.149 190.418 238.801 186.716L228.505 92C227.791 84.4116 218.005 74.5 212.505 67.5L193.38 41C193.38 41 159.255 44.3372 136.505 44.3372C113.755 44.3372 79.3772 41 79.3772 41L55.6295 75C48.1423 80.9481 44.7181 87.9116 44.0045 95.5Z"
        fill="var(--primary, #FFD200)"
        stroke="black"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Right side facet shading */}
      <path
        d="M201.5 122L192 44L226 76.5L236.5 196.5L230.5 204L201.5 122Z"
        fill="var(--primary-hover, #D8B202)"
      />

      {/* Left side facet shading */}
      <path
        d="M46 75L76 44.5L66.5 124.5L36.5 202L31 192.5L46 75Z"
        fill="var(--primary-hover, #D8B202)"
      />

      {/* Side facet stroke dividers */}
      <path
        d="M201.5 122L192 44L226 76.5L236.5 196.5L230.5 204L201.5 122Z"
        stroke="black"
      />
      <path
        d="M46 75L76 44.5L66.5 124.5L36.5 202L31 192.5L46 75Z"
        stroke="black"
      />

      {/* Outer border contour */}
      <path
        d="M44.005 90.0754L34.204 188.227C33.8559 191.712 34.6632 195.21 36.5374 198.338L38.7814 202.083C42.6521 208.544 50.5643 212.625 59.2194 212.625H213.781C222.436 212.625 230.348 208.544 234.219 202.083L236.462 198.338C238.337 195.21 239.145 191.712 238.796 188.227L228.995 90.0754C228.281 82.9294 223.655 78.7367 218.5 73L193.375 41C193.375 41 159.25 45.7674 136.5 45.7674C113.75 45.7674 79.3727 41 79.3727 41L54.5 72C49.3444 77.7367 44.7185 82.9294 44.005 90.0754Z"
        stroke="black"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Top dish face */}
      <path
        d="M78.9375 41C78.9375 41 113.75 45.5932 136.5 45.5932C159.25 45.5932 193.312 41 193.312 41L211.5 145C211.5 145 170.438 155 136.125 155C101.812 155 62 145 62 145L78.9375 41Z"
        fill="var(--primary-hover, #FFDB33)"
        stroke="black"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bottom corner rib lines */}
      <path
        d="M62 146L40 202M211.5 146L233 202"
        stroke="black"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Letter 'E' */}
      <path
        d="M111.62 126.109L115.719 61.708C115.719 61.708 128.77 62.313 137.14 62.3043C145.21 62.296 157.792 61.708 157.792 61.708V71.4824C157.792 71.4824 145.21 71.8454 137.14 71.8454C133.692 71.8454 128.864 71.8454 128.864 71.8454L128.266 84.7429C128.266 84.7429 133.674 84.9224 137.14 84.9643C143.859 85.0454 154.344 84.7429 154.344 84.7429V96.6124C154.344 96.6124 143.863 96.8906 137.14 96.8906C133.692 96.8906 128.174 96.8906 128.174 96.8906L127.543 110.921C127.543 110.921 133.002 111.202 137.14 111.202C146.556 111.202 161.241 110.606 161.241 110.606L162.62 125.917C162.62 125.917 147.097 127.17 137.14 127.208C127.171 127.246 111.62 126.109 111.62 126.109Z"
        fill="black"
      />
    </svg>
  );
};

export default EnterveneLogo;
