import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FOLIO_ANGLES = [0, 45, 90, 135] as const;
const LOGO_SIZES = {
  sm: 28,
  md: 44,
  lg: 68,
  xl: 96,
} as const;

type LogoPresetSize = keyof typeof LOGO_SIZES;
type LogoSize = LogoPresetSize | number;

interface LogoProps {
  size?: LogoSize;
  showText?: boolean;
  subtitle?: string;
  className?: string;
  textClassName?: string;
  onClick?: () => void;
}

const resolveLogoSize = (size: LogoSize = "md") =>
  typeof size === "number" ? size : (LOGO_SIZES[size] ?? LOGO_SIZES.md);

export const LogoIcon = ({
  size = "md",
  className,
}: {
  size?: LogoSize;
  className?: string;
}) => {
  const px = resolveLogoSize(size);

  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 select-none text-foreground", className)}
      aria-hidden="true"
    >
      {FOLIO_ANGLES.map((deg) => (
        <ellipse
          key={deg}
          cx="12"
          cy="12"
          rx="4"
          ry="9.5"
          transform={deg ? `rotate(${deg} 12 12)` : undefined}
          stroke="currentColor"
          strokeWidth="1.5"
        />
      ))}
      <circle
        cx="12"
        cy="12"
        r="2"
        className="fill-background"
        stroke="currentColor"
        strokeWidth="1.5"
      />
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
  const content = (
    <>
      <LogoIcon size={resolveLogoSize(size)} />
      {showText && (
        <span
          className={cn("flex flex-col text-left leading-none", textClassName)}
        >
          <span className="font-sans text-base font-medium tracking-tight text-foreground">
            Foliet
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
      <Button
        type="button"
        variant="ghost"
        onClick={onClick}
        className={cn(
          "h-auto justify-start gap-3 px-2 py-1 select-none",
          className,
        )}
      >
        {content}
      </Button>
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
