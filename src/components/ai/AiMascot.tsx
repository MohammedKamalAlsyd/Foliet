/**
 * Foliet - Lio Mascot Component
 *
 * "Lio" is Foliet's scholarly companion inspired by a folded paper folio and bookmark.
 * Built as an interactive, fully responsive inline SVG with mouse-tracking pupils,
 * dynamic emotional expressions, natural blinking, and motion accessibility.
 */

import React, { memo, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type MascotState = "idle" | "curious" | "thinking" | "speaking" | "happy";
export type MascotSize = "sm" | "md" | "lg" | number;

export interface AiMascotProps extends React.SVGProps<SVGSVGElement> {
    state?: MascotState;
    size?: MascotSize;
    interactive?: boolean; // When true, tracks window mouse movements
    className?: string;
}

function resolveSize(size: MascotSize): number {
    if (typeof size === "number") return size;
    switch (size) {
        case "sm":
            return 20;
        case "md":
            return 36;
        case "lg":
            return 64;
        default:
            return 36;
    }
}

export const AiMascot = memo(function AiMascot({
    state = "idle",
    size = "md",
    interactive = true,
    className,
    ...rest
}: AiMascotProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [pupilOffset, setPupilOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
    const [headTilt, setHeadTilt] = useState<number>(0);
    const [isBlinking, setIsBlinking] = useState<boolean>(false);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);

    const dim = resolveSize(size);

    // Detect prefers-reduced-motion
    useEffect(() => {
        if (typeof window === "undefined") return;
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        setPrefersReducedMotion(media.matches);

        const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
    }, []);

    // Natural random eye blink interval
    useEffect(() => {
        if (prefersReducedMotion || state === "happy") return;

        let blinkTimeout: ReturnType<typeof setTimeout>;
        let isMounted = true;

        const scheduleBlink = () => {
            const nextDelay = 3000 + Math.random() * 3500;
            blinkTimeout = setTimeout(() => {
                if (!isMounted) return;
                setIsBlinking(true);
                setTimeout(() => {
                    if (isMounted) {
                        setIsBlinking(false);
                        scheduleBlink();
                    }
                }, 140);
            }, nextDelay);
        };

        scheduleBlink();
        return () => {
            isMounted = false;
            clearTimeout(blinkTimeout);
        };
    }, [prefersReducedMotion, state]);

    // Pointer tracking for pupils & head angle
    useEffect(() => {
        if (!interactive || prefersReducedMotion || typeof window === "undefined") return;

        const handlePointerMove = (e: PointerEvent) => {
            const el = svgRef.current;
            if (!el) return;

            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;

            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            const dx = e.clientX - centerX;
            const dy = e.clientY - centerY;
            const dist = Math.hypot(dx, dy);

            // Maximum pupil wander radius in SVG units
            const maxRadius = 2.2;
            const intensity = Math.min(dist / 220, 1);
            const angle = Math.atan2(dy, dx);

            const px = Math.cos(angle) * intensity * maxRadius;
            const py = Math.sin(angle) * intensity * maxRadius;

            // Clamped head tilt (-5deg to +5deg)
            const tilt = Math.max(-5, Math.min(5, (dx / (window.innerWidth || 1000)) * 10));

            setPupilOffset({ x: px, y: py });
            setHeadTilt(tilt);
        };

        window.addEventListener("pointermove", handlePointerMove, { passive: true });
        return () => window.removeEventListener("pointermove", handlePointerMove);
    }, [interactive, prefersReducedMotion]);

    // Base state modifiers
    let effectiveTilt = headTilt;
    let effectivePupilX = pupilOffset.x;
    let effectivePupilY = pupilOffset.y;

    if (state === "curious") {
        effectiveTilt += 5.5;
        effectivePupilY = Math.min(effectivePupilY, -0.6);
    } else if (state === "thinking") {
        effectiveTilt -= 3.5;
        effectivePupilX = 1.4;
        effectivePupilY = -1.8;
    }

    return (
        <svg
            ref={svgRef}
            width={dim}
            height={dim}
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label={`Lio AI Mascot (${state})`}
            className={cn(
                "inline-block select-none overflow-visible transition-transform duration-200 ease-out",
                !prefersReducedMotion && state === "idle" && "animate-[lio-breathe_3.8s_ease-in-out_infinite]",
                !prefersReducedMotion && state === "thinking" && "animate-[lio-think_1.8s_ease-in-out_infinite]",
                !prefersReducedMotion && state === "speaking" && "animate-[lio-speak_0.9s_ease-in-out_infinite]",
                className
            )}
            style={{
                transform: `rotate(${effectiveTilt}deg)`,
                transformOrigin: "24px 28px",
            }}
            {...rest}
        >
            <style>
                {`
                @keyframes lio-breathe {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-1.2px); }
                }
                @keyframes lio-think {
                    0%, 100% { transform: translateY(0) scale(1); }
                    50% { transform: translateY(-1.5px) scale(1.02); }
                }
                @keyframes lio-speak {
                    0%, 100% { transform: translateY(0) scaleY(1); }
                    35% { transform: translateY(-0.8px) scaleY(1.04); }
                    70% { transform: translateY(0.4px) scaleY(0.98); }
                }
                @keyframes lio-sparkle {
                    0%, 100% { opacity: 0.25; transform: scale(0.8) rotate(0deg); }
                    50% { opacity: 1; transform: scale(1.15) rotate(45deg); }
                }
                `}
            </style>

            {/* Subtle soft ground shadow */}
            <ellipse
                cx="24"
                cy="44"
                rx="14"
                ry="2.5"
                className="fill-black/10 dark:fill-white/10"
            />

            {/* Bookmark ribbon tail peeking from bottom */}
            <path
                d="M 21 38 L 21 44 L 24 41.5 L 27 44 L 27 38 Z"
                className="fill-[var(--accent-brand,#2563EB)]"
            />

            {/* Main Folded Folio Body */}
            {/* Outline path: rounded rectangle with clipped top-right dog-ear fold */}
            <path
                d="M 12 12
                   C 12 8.5, 14.5 6, 18 6
                   L 28 6
                   L 37 15
                   L 37 36
                   C 37 39.5, 34.5 42, 31 42
                   L 17 42
                   C 13.5 42, 12 39.5, 12 36
                   Z"
                className="fill-[var(--card,#FFFFFF)] stroke-[var(--border,#E4E4E7)]"
                strokeWidth="1.75"
                strokeLinejoin="round"
            />

            {/* Folded Dog-Ear Top-Right Corner */}
            <path
                d="M 28 6 L 28 15 L 37 15 Z"
                className="fill-[var(--muted,#F4F4F5)] stroke-[var(--border,#E4E4E7)]"
                strokeWidth="1.5"
                strokeLinejoin="round"
            />

            {/* Scholarly glasses bridge / folded folio crease (subtle) */}
            <path
                d="M 21.5 24 Q 24 23, 26.5 24"
                stroke="currentColor"
                strokeOpacity="0.25"
                strokeWidth="1.25"
                strokeLinecap="round"
            />

            {/* Thinking Sparkle / Particle indicator */}
            {state === "thinking" && !prefersReducedMotion && (
                <g className="animate-[lio-sparkle_1.4s_ease-in-out_infinite]" style={{ transformOrigin: "35px 7px" }}>
                    <path
                        d="M 35 3 L 36.2 6 L 39 7 L 36.2 8 L 35 11 L 33.8 8 L 31 7 L 33.8 6 Z"
                        className="fill-[var(--accent-brand,#2563EB)]"
                    />
                </g>
            )}

            {/* Curious Perked Highlight */}
            {state === "curious" && (
                <circle
                    cx="34"
                    cy="8"
                    r="1.5"
                    className="fill-[var(--accent-brand,#2563EB)]"
                />
            )}

            {/* EYES */}
            {state === "happy" ? (
                /* Happy Squint Crescents (^ ^) */
                <g className="stroke-[var(--foreground,#18181B)]" strokeWidth="2" strokeLinecap="round" fill="none">
                    <path d="M 16.5 25.5 Q 19 21.5, 21.5 25.5" />
                    <path d="M 26.5 25.5 Q 29 21.5, 31.5 25.5" />
                    {/* Tiny cheerful blush dots */}
                    <circle cx="15.5" cy="28.5" r="1.5" className="fill-[#F87171]/40 stroke-none" />
                    <circle cx="32.5" cy="28.5" r="1.5" className="fill-[#F87171]/40 stroke-none" />
                </g>
            ) : isBlinking ? (
                /* Blinking Flat Eyes (-) */
                <g className="stroke-[var(--foreground,#18181B)]" strokeWidth="1.8" strokeLinecap="round" fill="none">
                    <line x1="16" y1="24" x2="22" y2="24" />
                    <line x1="26" y1="24" x2="32" y2="24" />
                </g>
            ) : (
                /* Normal / Curious / Thinking / Speaking Eyes */
                <g>
                    {/* Left Eye Base & Pupil */}
                    <g transform={`translate(${effectivePupilX}, ${effectivePupilY})`}>
                        <circle
                            cx="19"
                            cy="24"
                            r={state === "curious" ? "2.6" : "2.3"}
                            className="fill-[var(--foreground,#18181B)]"
                        />
                        {/* Eye catchlight / living glint */}
                        <circle
                            cx="18.2"
                            cy="23.2"
                            r="0.75"
                            fill="white"
                        />
                    </g>

                    {/* Right Eye Base & Pupil */}
                    <g transform={`translate(${effectivePupilX}, ${effectivePupilY})`}>
                        <circle
                            cx="29"
                            cy="24"
                            r={state === "curious" ? "2.6" : "2.3"}
                            className="fill-[var(--foreground,#18181B)]"
                        />
                        {/* Eye catchlight / living glint */}
                        <circle
                            cx="28.2"
                            cy="23.2"
                            r="0.75"
                            fill="white"
                        />
                    </g>
                </g>
            )}

            {/* MOUTH / SPEAKING EXPRESSION */}
            {state === "speaking" ? (
                <path
                    d="M 22 29.5 Q 24 32, 26 29.5"
                    className="stroke-[var(--foreground,#18181B)]"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    fill="none"
                />
            ) : state === "happy" ? (
                <path
                    d="M 22 29 Q 24 31.5, 26 29"
                    className="stroke-[var(--foreground,#18181B)]"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    fill="none"
                />
            ) : state === "curious" ? (
                <circle
                    cx="24"
                    cy="29.5"
                    r="1"
                    className="fill-[var(--foreground,#18181B)]"
                />
            ) : (
                /* Calm subtle scholarly smile */
                <path
                    d="M 22.5 29 Q 24 30.5, 25.5 29"
                    stroke="currentColor"
                    strokeOpacity="0.45"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    fill="none"
                />
            )}
        </svg>
    );
});
