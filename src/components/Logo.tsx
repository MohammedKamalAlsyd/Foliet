import { useId } from "react";

interface FolietLogoProps {
  size?: number;
  showText?: boolean;
  className?: string;
}

export function FolietMark({ size = 24 }: { size?: number }) {
  const id = useId();
  const gradId = `foliet-grad-${id}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0 select-none"
      aria-label="Foliet Logo"
    >
      <defs>
        <linearGradient
          id={gradId}
          x1="4"
          y1="4"
          x2="28"
          y2="28"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#14B8A6" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      {/* Back sheet */}
      <rect
        x="7"
        y="4"
        width="17"
        height="22"
        rx="3.5"
        stroke={`url(#${gradId})`}
        strokeWidth="1.8"
        opacity="0.45"
      />
      {/* Front folded folio */}
      <path
        d="M11 8H22.5L26 11.5V24.5C26 26.1569 24.6569 27.5 23 27.5H11C9.34315 27.5 8 26.1569 8 24.5V11C8 9.34315 9.34315 8 11 8Z"
        fill="var(--surface-panel)"
        stroke={`url(#${gradId})`}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Fold corner + bookmark line */}
      <path
        d="M22 8V12H26"
        stroke={`url(#${gradId})`}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 16H20.5M12.5 20.5H17.5"
        stroke={`url(#${gradId})`}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function FolietLogo({
  size = 24,
  showText = true,
  className = "",
}: FolietLogoProps) {
  return (
    <div
      className={`inline-flex items-center gap-2.5 select-none ${className}`}
    >
      <FolietMark size={size} />
      {showText && (
        <span className="font-sans font-bold tracking-tight text-sm text-[var(--text-primary)]">
          Foliet
        </span>
      )}
    </div>
  );
}
