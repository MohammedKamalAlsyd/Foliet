import { cn } from "@/lib/utils";
import { type LogoProps, type LogoSize, LOGO_SIZES } from "@/types/props";

export const LogoIcon = ({
  size = "md",
  className,
}: {
  size?: LogoSize;
  className?: string;
}) => {
  const pixelSize =
    typeof size === "number" ? size : (LOGO_SIZES[size] ?? LOGO_SIZES.md);

  return (
    <svg
      width={pixelSize}
      height={pixelSize}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 select-none text-foreground", className)}
      aria-hidden="true"
    >
      {/* Simplified flat rosette: 4 intersecting folios around an open center */}
      <ellipse
        cx="12"
        cy="12"
        rx="4"
        ry="9.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="4"
        ry="9.5"
        transform="rotate(45 12 12)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="4"
        ry="9.5"
        transform="rotate(90 12 12)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <ellipse
        cx="12"
        cy="12"
        rx="4"
        ry="9.5"
        transform="rotate(135 12 12)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="2" className="fill-background" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
};

export const FullLogo = ({
  size = "md",
  showText = true,
  subtitle,
  className,
  textClassName,
  onClick,
}: LogoProps) => {
  const pixelSize =
    typeof size === "number" ? size : (LOGO_SIZES[size] ?? LOGO_SIZES.md);

  const content = (
    <>
      <LogoIcon size={pixelSize} />
      {showText && (
        <span
          className={cn(
            "flex flex-col justify-center text-left leading-none",
            textClassName,
          )}
        >
          <span className="font-sans text-base font-semibold tracking-tight text-foreground">
            foliet
          </span>
          {subtitle && (
            <span className="mt-1 font-sans text-xs font-normal text-muted-foreground">
              {subtitle}
            </span>
          )}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-3 rounded-md select-none cursor-pointer transition-opacity duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn("inline-flex items-center gap-3 select-none", className)}
    >
      {content}
    </div>
  );
};

export default FullLogo;
