import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const PROMO_WIDTH = 1920;
export const PROMO_HEIGHT = 1080;
export const PROMO_FPS = 60;
export const PROMO_DURATION_FRAMES = 1200; // 20.0 seconds @ 60fps

// Foliet Graphite Dark & Bookmark Terracotta Design Tokens
const TOKENS = {
  bgDeep: "#0f0f10",
  bgPage: "#141415",
  bgCard: "#19191b",
  bgRaised: "#232325",
  hairline: "rgba(237, 237, 237, 0.08)",
  hairlineStrong: "rgba(237, 237, 237, 0.16)",
  textPrimary: "#ededed",
  textSecondary: "#a1a1a6",
  textMuted: "#85858b",
  accent: "#df6a47",
  accentSoft: "rgba(223, 106, 71, 0.15)",
  accentBorder: "rgba(223, 106, 71, 0.42)",
  positive: "#4cc38a",
  positiveSoft: "rgba(76, 195, 138, 0.14)",
  paperBg: "#faf9f6",
  paperInk: "#171717",
  paperSecondary: "#3f3f46",
  paperMuted: "#71717a",
  fontSans:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontDisplay: 'Georgia, "Times New Roman", serif',
  fontMono:
    '"JetBrains Mono", "Cascadia Mono", "Consolas", ui-monospace, monospace',
} as const;

// ============================================================================
// Reusable Foliet Brand & UI Primitives (Deterministic Frame-Driven)
// ============================================================================

const FolioLogoMark: React.FC<{
  size: number;
  drawProgress?: number;
  rotateDeg?: number;
  color?: string;
}> = ({
  size,
  drawProgress = 1,
  rotateDeg = 0,
  color = TOKENS.textPrimary,
}) => {
  const angles = [0, 45, 90, 135];
  const dashLen = 48;
  const dashOffset = interpolate(drawProgress, [0, 1], [dashLen, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: `rotate(${rotateDeg}deg)` }}
    >
      {angles.map((deg) => (
        <ellipse
          key={deg}
          cx="12"
          cy="12"
          rx="4"
          ry="9.5"
          transform={deg ? `rotate(${deg} 12 12)` : undefined}
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray={dashLen}
          strokeDashoffset={dashOffset}
        />
      ))}
      <circle
        cx="12"
        cy="12"
        r="2"
        fill={TOKENS.bgPage}
        stroke={TOKENS.accent}
        strokeWidth="1.6"
        opacity={drawProgress}
      />
    </svg>
  );
};

const LioMascotSvg: React.FC<{
  size: number;
  pupilX?: number;
  pupilY?: number;
  sparkleScale?: number;
  tiltDeg?: number;
}> = ({
  size,
  pupilX = 0,
  pupilY = 0,
  sparkleScale = 0,
  tiltDeg = 0,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      style={{
        transform: `rotate(${tiltDeg}deg)`,
        transformOrigin: "24px 28px",
      }}
    >
      <ellipse
        cx="24"
        cy="44"
        rx="14"
        ry="2.5"
        fill="#ffffff"
        fillOpacity="0.1"
      />
      <path
        d="M 21 38 L 21 44 L 24 41.5 L 27 44 L 27 38 Z"
        fill={TOKENS.accent}
      />
      <path
        d="M 12 12 C 12 8.5, 14.5 6, 18 6 L 28 6 L 37 15 L 37 36 C 37 39.5, 34.5 42, 31 42 L 17 42 C 13.5 42, 12 39.5, 12 36 Z"
        fill={TOKENS.bgCard}
        stroke={TOKENS.hairlineStrong}
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M 28 6 L 28 15 L 37 15 Z"
        fill={TOKENS.bgRaised}
        stroke={TOKENS.hairlineStrong}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M 21.5 24 Q 24 23, 26.5 24"
        stroke={TOKENS.textPrimary}
        strokeOpacity="0.28"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      {sparkleScale > 0.01 && (
        <g
          transform={`translate(35, 7) scale(${sparkleScale}) translate(-35, -7)`}
        >
          <path
            d="M 35 2.5 L 36.4 5.8 L 39.5 7 L 36.4 8.2 L 35 11.5 L 33.6 8.2 L 30.5 7 L 33.6 5.8 Z"
            fill={TOKENS.accent}
          />
        </g>
      )}
      <g transform={`translate(${pupilX}, ${pupilY})`}>
        <circle cx="19" cy="24" r="2.4" fill={TOKENS.textPrimary} />
        <circle cx="18.2" cy="23.2" r="0.8" fill="#ffffff" />
        <circle cx="29" cy="24" r="2.4" fill={TOKENS.textPrimary} />
        <circle cx="28.2" cy="23.2" r="0.8" fill="#ffffff" />
      </g>
      <path
        d="M 22 29.5 Q 24 31.5, 26 29.5"
        stroke={TOKENS.textPrimary}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

const KeycapBadge: React.FC<{
  keys: string[];
  label: string;
  active?: boolean;
}> = ({ keys, label, active = false }) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        height: 44,
        padding: "0 16px",
        borderRadius: 10,
        backgroundColor: active ? TOKENS.bgCard : TOKENS.bgPage,
        border: `1px solid ${active ? TOKENS.accentBorder : TOKENS.hairlineStrong}`,
        boxShadow: "0 16px 36px rgba(0, 0, 0, 0.55)",
        transform: `scale(${active ? 0.97 : 1})`,
      }}
    >
      <div style={{ display: "inline-flex", gap: 6 }}>
        {keys.map((k) => (
          <span
            key={k}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 26,
              minWidth: 26,
              padding: "0 8px",
              borderRadius: 5,
              fontFamily: TOKENS.fontMono,
              fontSize: 13,
              fontWeight: 600,
              backgroundColor: active ? TOKENS.accent : TOKENS.bgRaised,
              color: active ? "#141415" : TOKENS.textPrimary,
              border: `1px solid ${active ? TOKENS.accent : TOKENS.hairlineStrong}`,
            }}
          >
            {k}
          </span>
        ))}
      </div>
      <span
        style={{
          fontFamily: TOKENS.fontSans,
          fontSize: 14,
          fontWeight: 500,
          color: TOKENS.textPrimary,
        }}
      >
        {label}
      </span>
    </div>
  );
};

// ============================================================================
// Main 20-Second (1200-Frame @ 60fps) Promotional Video Composition
// ============================================================================

export const FolietPromoVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // --------------------------------------------------------------------------
  // Act timings (1200 frames = 20.0s @ 60fps)
  // Act 1 (0..180):    Brand Ignition & 3D Desktop Window Launch
  // Act 2 (180..460):  Rust HTTP 206 Streaming + Live Annotation & lopdf Burn
  // Act 3 (460..730):  Lio AI Copilot + 4 Agentic Tools + [Page 2] Spotlight
  // Act 4 (730..1010): 3D Stacked Screens (Living Summary + ONNX RAG + Vault)
  // Act 5 (1010..1200): Finale Lockup & Multi-OS Download CTA
  // --------------------------------------------------------------------------

  // Act 1 animations
  const logoDraw = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 90, mass: 1 },
  });
  const logoSpin = interpolate(logoDraw, [0, 1], [-90, 0]);
  const introTitleSpring = spring({
    frame: frame - 18,
    fps,
    config: { damping: 15, stiffness: 140 },
  });
  const introSubSpring = spring({
    frame: frame - 34,
    fps,
    config: { damping: 16, stiffness: 130 },
  });

  // Transition from Intro Card to 3D App Window at frame 105..175
  const windowLaunch = spring({
    frame: frame - 105,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.95 },
  });
  const introFadeOut = interpolate(frame, [100, 138], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Camera Choreography across Acts 1 -> 2 -> 3 -> 4
  const act2Focus = spring({
    frame: frame - 185,
    fps,
    config: { damping: 18, stiffness: 95 },
  });
  const act3PanAi = spring({
    frame: frame - 460,
    fps,
    config: { damping: 17, stiffness: 100 },
  });
  const act4StackMode = spring({
    frame: frame - 730,
    fps,
    config: { damping: 16, stiffness: 95 },
  });
  const act5Finale = spring({
    frame: frame - 1010,
    fps,
    config: { damping: 15, stiffness: 110 },
  });

  // 3D transform of main window during Acts 1..3
  const winScaleBase = interpolate(windowLaunch, [0, 1], [0.78, 1]);
  const winScaleZoom =
    winScaleBase +
    act2Focus * 0.14 -
    act3PanAi * 0.04 -
    act4StackMode * 0.14;
  const winTranslateX =
    act2Focus * 45 - act3PanAi * 185 + act4StackMode * 140;
  const winTranslateY =
    interpolate(windowLaunch, [0, 1], [420, 26]) +
    act2Focus * 22 -
    act4StackMode * 22;
  const winRotateX =
    interpolate(windowLaunch, [0, 1], [24, 5]) -
    act2Focus * 3.5 +
    act4StackMode * 2.5;
  const winRotateY =
    interpolate(windowLaunch, [0, 1], [-12, -5]) +
    act2Focus * 4 -
    act3PanAi * 5 -
    act4StackMode * 6;

  // Act 2 Annotation Progressions
  const highlightSweep = interpolate(frame, [215, 265], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const underlineSweep = interpolate(frame, [285, 330], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const notePop = spring({
    frame: frame - 342,
    fps,
    config: { damping: 13, stiffness: 170 },
  });
  const noteText =
    "Compare 384-dim MedEmbed recall (0.853) vs 1024-dim Voyage 4 Lite.";
  const typedNoteChars = Math.floor(
    interpolate(frame, [354, 402], [0, noteText.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const isSavedBurned = frame >= 418;
  const burnFlash = spring({
    frame: frame - 418,
    fps,
    config: { damping: 12, stiffness: 180 },
  });

  // Act 3 Lio Copilot & Citation Spotlight
  const selectionBarPop = spring({
    frame: frame - 468,
    fps,
    config: { damping: 14, stiffness: 170 },
  });
  const userPromptPop = spring({
    frame: frame - 498,
    fps,
    config: { damping: 15, stiffness: 160 },
  });
  const tool1Pop = spring({
    frame: frame - 532,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  const tool2Pop = spring({
    frame: frame - 548,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  const tool3Pop = spring({
    frame: frame - 564,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  const tool4Pop = spring({
    frame: frame - 580,
    fps,
    config: { damping: 14, stiffness: 180 },
  });
  const aiReplyPop = spring({
    frame: frame - 596,
    fps,
    config: { damping: 15, stiffness: 150 },
  });
  const citationPulse = interpolate(
    frame,
    [640, 655, 705, 725],
    [0, 1, 1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  // Act 4 3D Multi-Screen Stack (Summary Split-View + ONNX RAG + Key Vault)
  const summarySlideIn = spring({
    frame: frame - 742,
    fps,
    config: { damping: 15, stiffness: 115 },
  });
  const ragCardSlideIn = spring({
    frame: frame - 775,
    fps,
    config: { damping: 15, stiffness: 120 },
  });
  const vaultCardSlideIn = spring({
    frame: frame - 810,
    fps,
    config: { damping: 15, stiffness: 120 },
  });
  const docxExportBadge = spring({
    frame: frame - 905,
    fps,
    config: { damping: 12, stiffness: 175 },
  });

  // Active HUD caption & keycap per phase
  const getActiveHud = (): {
    kicker: string;
    headline: string;
    keys: string[];
    keyLabel: string;
  } | null => {
    if (frame < 140 || frame >= 1015) return null;
    if (frame < 280) {
      return {
        kicker: "01 · Byte-Range Rust PDF Engine",
        headline: "foliet-pdf:// streams 500-page PDFs in 68 MB RAM",
        keys: ["H"],
        keyLabel: "Yellow Highlight",
      };
    }
    if (frame < 340) {
      return {
        kicker: "02 · Tactile Markup Suite",
        headline: "Solid, squiggle & dashed underlines + vector ink",
        keys: ["U"],
        keyLabel: "Green Dashed Underline",
      };
    }
    if (frame < 415) {
      return {
        kicker: "02 · Floating NoteEditorPortal",
        headline: "300ms debounced sticky notes & high-DPI figure crops",
        keys: ["N"],
        keyLabel: "Drop Sticky Note",
      };
    }
    if (frame < 460) {
      return {
        kicker: "02 · Native ISO 32000-1 PDF Burn",
        headline: "Rust lopdf writes standard Form XObject streams directly to disk",
        keys: ["Ctrl", "S"],
        keyLabel: "Burn & Save PDF",
      };
    }
    if (frame < 635) {
      return {
        kicker: "03 · Lio AI Research Companion",
        headline: "4 agentic PDF tools act directly on your active paper",
        keys: ["Ask Lio"],
        keyLabel: "Execute Copilot Tools",
      };
    }
    if (frame < 730) {
      return {
        kicker: "03 · Live Citation Spotlighting",
        headline: "Click [Page 2] to jump and spotlight the exact bounding box",
        keys: ["Page 2"],
        keyLabel: "Spotlight Cited Passage",
      };
    }
    if (frame < 875) {
      return {
        kicker: "04 · Offline Rust ONNX RAG & Living Summary",
        headline: "In-process 384-dim MedEmbed search (14 ms) + Tiptap split view",
        keys: ["ort", "SQLite"],
        keyLabel: "100% Offline Vector Index",
      };
    }
    return {
      kicker: "05 · Encrypted Key Vault & Portable Export",
      headline: "AES-256-GCM secrets.enc via OS Keyring + .md / .docx export",
      keys: ["AES-256"],
      keyLabel: "0 Bytes in localStorage",
    };
  };

  const hud = getActiveHud();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: TOKENS.bgDeep,
        color: TOKENS.textPrimary,
        fontFamily: TOKENS.fontSans,
        overflow: "hidden",
      }}
    >
      {/* Subtle 48px Architectural Grid Background */}
      <AbsoluteFill
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(237, 237, 237, 0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(237, 237, 237, 0.03) 1px, transparent 1px)
          `,
          backgroundSize: "48px 48px",
        }}
      />

      {/* ====================================================================
          ACT 1: Brand Ignition Intro (Frames 0..145)
          ==================================================================== */}
      {introFadeOut > 0.01 && (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            opacity: introFadeOut,
            transform: `scale(${interpolate(introFadeOut, [0, 1], [1.08, 1])})`,
          }}
        >
          {/* Terracotta Pulse Ring */}
          <div
            style={{
              position: "absolute",
              width: 340,
              height: 340,
              borderRadius: "50%",
              border: `1.5px solid ${TOKENS.accentBorder}`,
              transform: `scale(${interpolate(frame, [8, 95], [0.4, 2.2], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })})`,
              opacity: interpolate(frame, [8, 95], [0.85, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "16px 28px",
                borderRadius: 20,
                backgroundColor: TOKENS.bgCard,
                border: `1px solid ${TOKENS.hairlineStrong}`,
                boxShadow: "0 24px 60px rgba(0, 0, 0, 0.65)",
              }}
            >
              <FolioLogoMark
                size={68}
                drawProgress={logoDraw}
                rotateDeg={logoSpin}
              />
              <LioMascotSvg
                size={64}
                pupilX={Math.sin(frame / 12) * 1.8}
                pupilY={-0.6}
                sparkleScale={spring({
                  frame: frame - 28,
                  fps,
                  config: { damping: 10, stiffness: 160 },
                })}
                tiltDeg={4}
              />
            </div>

            <div
              style={{
                opacity: introTitleSpring,
                transform: `translateY(${interpolate(
                  introTitleSpring,
                  [0, 1],
                  [28, 0],
                )}px)`,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontFamily: TOKENS.fontMono,
                  fontSize: 15,
                  color: TOKENS.accent,
                  marginBottom: 12,
                  letterSpacing: "0.02em",
                }}
              >
                Tauri v2 · Rust · ISO 32000-1 PDF · Offline ONNX RAG
              </div>
              <h1
                style={{
                  margin: 0,
                  fontFamily: TOKENS.fontDisplay,
                  fontSize: 84,
                  fontWeight: 400,
                  letterSpacing: "-0.03em",
                  lineHeight: 1.04,
                  color: TOKENS.textPrimary,
                }}
              >
                Meet Foliet
              </h1>
            </div>

            <p
              style={{
                margin: 0,
                opacity: introSubSpring,
                transform: `translateY(${interpolate(
                  introSubSpring,
                  [0, 1],
                  [20, 0],
                )}px)`,
                fontSize: 26,
                color: TOKENS.textSecondary,
                maxWidth: 760,
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              A local-first scholarly PDF reader, native annotation studio, and
              offline Rust vector search workspace
            </p>
          </div>
        </AbsoluteFill>
      )}

      {/* ====================================================================
          ACTS 2, 3 & 4: 3D Perspective Stage with Real Foliet Desktop Screens
          ==================================================================== */}
      {frame >= 100 && frame < 1045 && (
        <AbsoluteFill
          style={{
            perspective: 2200,
            alignItems: "center",
            justifyContent: "center",
            opacity: interpolate(frame, [1005, 1040], [1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {/* Back Stacked Screen in Act 4: AES-256-GCM Vault & Library Catalog */}
          {frame >= 730 && (
            <div
              style={{
                position: "absolute",
                width: 1460,
                height: 820,
                borderRadius: 18,
                backgroundColor: TOKENS.bgPage,
                border: `1px solid ${TOKENS.hairlineStrong}`,
                boxShadow: "0 30px 70px rgba(0, 0, 0, 0.65)",
                opacity: vaultCardSlideIn * 0.52,
                transform: `
                  translate3d(${interpolate(vaultCardSlideIn, [0, 1], [260, 170])}px, -74px, -280px)
                  rotateY(-17deg)
                  rotateX(5deg)
                  scale(0.91)
                `,
                padding: 28,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: `1px solid ${TOKENS.hairline}`,
                  paddingBottom: 14,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 500 }}>
                  Foliet Research Library · 18 Monographs Indexed (42.6 MB)
                </span>
                <span
                  style={{
                    fontFamily: TOKENS.fontMono,
                    fontSize: 14,
                    color: TOKENS.positive,
                  }}
                >
                  secrets.enc · AES-256-GCM + OS Keyring
                </span>
              </div>
            </div>
          )}

          {/* Middle Stacked Screen in Act 4: Offline Rust ONNX RAG Engine */}
          {frame >= 730 && (
            <div
              style={{
                position: "absolute",
                width: 1460,
                height: 820,
                borderRadius: 18,
                backgroundColor: TOKENS.bgCard,
                border: `1px solid ${TOKENS.accentBorder}`,
                boxShadow: "0 32px 76px rgba(0, 0, 0, 0.72)",
                opacity: ragCardSlideIn * 0.86,
                transform: `
                  translate3d(${interpolate(ragCardSlideIn, [0, 1], [190, 88])}px, -38px, -140px)
                  rotateY(-15deg)
                  rotateX(4deg)
                  scale(0.955)
                `,
                padding: 28,
                display: "flex",
                flexDirection: "column",
                gap: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span
                  style={{
                    fontFamily: TOKENS.fontMono,
                    fontSize: 15,
                    color: TOKENS.accent,
                  }}
                >
                  In-Process Rust ONNX Runtime (ort + tokenizers + rusqlite)
                </span>
                <span
                  style={{
                    padding: "4px 12px",
                    borderRadius: 6,
                    backgroundColor: TOKENS.positiveSoft,
                    color: TOKENS.positive,
                    fontFamily: TOKENS.fontMono,
                    fontSize: 14,
                  }}
                >
                  RAG Match (94%) · 14 ms offline
                </span>
              </div>
            </div>
          )}

          {/* Primary Foliet Desktop Application Window */}
          <div
            style={{
              width: 1520,
              height: 848,
              borderRadius: 18,
              backgroundColor: TOKENS.bgPage,
              border: `1px solid ${TOKENS.hairlineStrong}`,
              boxShadow: "0 44px 100px rgba(0, 0, 0, 0.78)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              transform: `
                translate3d(${winTranslateX}px, ${winTranslateY}px, 0)
                scale(${winScaleZoom})
                rotateX(${winRotateX}deg)
                rotateY(${winRotateY}deg)
              `,
            }}
          >
            {/* 1. Real 36px Titlebar */}
            <div
              style={{
                height: 40,
                padding: "0 16px",
                borderBottom: `1px solid ${TOKENS.hairline}`,
                backgroundColor: TOKENS.bgPage,
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    color: TOKENS.textSecondary,
                    fontWeight: 500,
                  }}
                >
                  ‹ Library
                </span>
                <span
                  style={{
                    fontFamily: TOKENS.fontMono,
                    fontSize: 11.5,
                    padding: "2px 8px",
                    borderRadius: 4,
                    backgroundColor: TOKENS.bgRaised,
                    color: TOKENS.accent,
                    border: `1px solid ${TOKENS.accentBorder}`,
                  }}
                >
                  foliet-pdf:// HTTP 206 Range · 68 MB RAM
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontWeight: 500 }}>
                  Attention-Guided Retrieval in Technical Monographs.pdf
                </span>
                <span
                  style={{
                    width: 1,
                    height: 16,
                    backgroundColor: TOKENS.hairlineStrong,
                  }}
                />
                {isSavedBurned ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: TOKENS.fontMono,
                      fontSize: 12,
                      color: TOKENS.positive,
                      transform: `scale(${1 + burnFlash * 0.08})`,
                    }}
                  >
                    ✓ Saved · ISO 32000-1 Form XObject Burned
                  </span>
                ) : (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: TOKENS.fontMono,
                      fontSize: 12,
                      color: TOKENS.textPrimary,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        backgroundColor: TOKENS.accent,
                      }}
                    />
                    Unsaved · Ctrl+S
                  </span>
                )}
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 14,
                  color: TOKENS.textMuted,
                  fontFamily: TOKENS.fontMono,
                  fontSize: 12,
                }}
              >
                <span>Signed Auto-Updater · v0.1.1</span>
                <span>—</span>
                <span>□</span>
                <span>×</span>
              </div>
            </div>

            {/* 2. Main Application Body */}
            <div
              style={{
                flex: 1,
                display: "grid",
                gridTemplateColumns:
                  frame >= 735 ? "220px 1fr 560px" : "220px 1fr 400px",
                minHeight: 0,
              }}
            >
              {/* Left PdfSidebar (Outline | Bookmarks | Figures) */}
              <div
                style={{
                  borderRight: `1px solid ${TOKENS.hairline}`,
                  backgroundColor: TOKENS.bgCard,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    height: 48,
                    padding: "0 12px",
                    borderBottom: `1px solid ${TOKENS.hairline}`,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      display: "inline-flex",
                      gap: 4,
                      padding: 3,
                      borderRadius: 8,
                      backgroundColor: TOKENS.bgPage,
                      border: `1px solid ${TOKENS.hairline}`,
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        backgroundColor: TOKENS.bgCard,
                        color: TOKENS.textPrimary,
                        fontWeight: 500,
                      }}
                    >
                      Outline
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        color: TOKENS.textMuted,
                      }}
                    >
                      Bookmarks
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        color: TOKENS.textMuted,
                      }}
                    >
                      Figures 3
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: 12.5,
                  }}
                >
                  {[
                    { title: "1. Introduction", page: "1", active: false },
                    {
                      title: "2. Dense ONNX Retrieval",
                      page: "2",
                      active: true,
                    },
                    {
                      title: "  2.1 Line-Window Chunking",
                      page: "2",
                      active: false,
                    },
                    {
                      title: "  2.2 Bounding Rect Storage",
                      page: "4",
                      active: false,
                    },
                    {
                      title: "3. ISO 32000-1 XObjects",
                      page: "7",
                      active: false,
                    },
                    {
                      title: "4. Benchmark Evaluation",
                      page: "12",
                      active: false,
                    },
                  ].map((item) => (
                    <div
                      key={item.title}
                      style={{
                        height: 34,
                        padding: "0 10px",
                        borderRadius: 6,
                        backgroundColor: item.active
                          ? TOKENS.bgRaised
                          : "transparent",
                        borderLeft: item.active
                          ? `2.5px solid ${TOKENS.accent}`
                          : "2.5px solid transparent",
                        color: item.active
                          ? TOKENS.textPrimary
                          : TOKENS.textSecondary,
                        fontWeight: item.active ? 500 : 400,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ whiteSpace: "pre" }}>{item.title}</span>
                      <span
                        style={{
                          fontFamily: TOKENS.fontMono,
                          fontSize: 11.5,
                          color: TOKENS.textMuted,
                        }}
                      >
                        {item.page}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Security Vault Callout inside Left Sidebar */}
                <div
                  style={{
                    marginTop: "auto",
                    margin: 12,
                    padding: 12,
                    borderRadius: 10,
                    backgroundColor: TOKENS.bgPage,
                    border: `1px solid ${TOKENS.hairlineStrong}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      fontFamily: TOKENS.fontMono,
                      fontSize: 11,
                      color: TOKENS.positive,
                    }}
                  >
                    ● AES-256-GCM Vault Active
                  </div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: TOKENS.textSecondary,
                      lineHeight: 1.4,
                    }}
                  >
                    Master key in OS Keyring · 12-byte random nonce per write · 0
                    keys in localStorage
                  </div>
                </div>
              </div>

              {/* Center Column: ViewerHeader (48px) + PdfToolbar (48px) + PDF Canvas */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  backgroundColor: TOKENS.bgDeep,
                }}
              >
                {/* ViewerHeader (48px) */}
                <div
                  style={{
                    height: 48,
                    padding: "0 16px",
                    borderBottom: `1px solid ${TOKENS.hairline}`,
                    backgroundColor: TOKENS.bgPage,
                    display: "grid",
                    gridTemplateColumns: "1fr auto 1fr",
                    alignItems: "center",
                    fontSize: 12.5,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontFamily: TOKENS.fontMono,
                    }}
                  >
                    <span>−</span>
                    <span
                      style={{
                        padding: "3px 8px",
                        borderRadius: 6,
                        backgroundColor: TOKENS.bgRaised,
                      }}
                    >
                      125%
                    </span>
                    <span>+</span>
                    <span style={{ color: TOKENS.textMuted }}>Fit width</span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontFamily: TOKENS.fontMono,
                    }}
                  >
                    <span>‹</span>
                    <span
                      style={{
                        padding: "3px 10px",
                        borderRadius: 6,
                        backgroundColor: TOKENS.bgCard,
                        border: `1px solid ${TOKENS.hairlineStrong}`,
                      }}
                    >
                      2
                    </span>
                    <span style={{ color: TOKENS.textMuted }}>/ 24</span>
                    <span>›</span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      color: TOKENS.textSecondary,
                    }}
                  >
                    <span>Search Ctrl+F</span>
                    <span style={{ color: TOKENS.accent }}>★ Bookmarked</span>
                  </div>
                </div>

                {/* PdfToolbar (48px) */}
                <div
                  style={{
                    height: 48,
                    padding: "0 16px",
                    borderBottom: `1px solid ${TOKENS.hairline}`,
                    backgroundColor: TOKENS.bgCard,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairline}`,
                      }}
                    >
                      ↶ Undo
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        borderRadius: 6,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairline}`,
                      }}
                    >
                      ↷ Redo
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <span
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairline}`,
                      }}
                    >
                      Select V
                    </span>
                    <span
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        backgroundColor: TOKENS.bgPage,
                        border: `1.5px solid ${TOKENS.accent}`,
                        fontWeight: 500,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          backgroundColor: "#fde047",
                        }}
                      />
                      Yellow Highlight H ▾
                    </span>
                    <span
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairline}`,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: "50%",
                          backgroundColor: "#22c55e",
                        }}
                      />
                      Dashed U
                    </span>
                    <span
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairline}`,
                      }}
                    >
                      Note N
                    </span>
                    <span
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairline}`,
                      }}
                    >
                      Crop A
                    </span>
                  </div>

                  <span
                    style={{
                      padding: "5px 12px",
                      borderRadius: 8,
                      backgroundColor: TOKENS.accentSoft,
                      border: `1px solid ${TOKENS.accentBorder}`,
                      color: TOKENS.accent,
                      fontWeight: 500,
                    }}
                  >
                    AI Studio
                  </span>
                </div>

                {/* PDF Page Sheet */}
                <div
                  style={{
                    flex: 1,
                    padding: "22px 28px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 14,
                    position: "relative",
                  }}
                >
                  {/* RAG Match Banner when in Act 4 */}
                  {frame >= 740 && (
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 680,
                        padding: "8px 14px",
                        borderRadius: 8,
                        backgroundColor: TOKENS.accentSoft,
                        border: `1px solid ${TOKENS.accentBorder}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: 12.5,
                      }}
                    >
                      <span
                        style={{
                          fontFamily: TOKENS.fontMono,
                          color: TOKENS.accent,
                          fontWeight: 600,
                        }}
                      >
                        RAG Match (94%) · MedEmbed-small-v0.1 (384-dim · 14 ms)
                      </span>
                      <span style={{ color: TOKENS.textSecondary }}>
                        Page 2 · Cosine similarity
                      </span>
                    </div>
                  )}

                  <div
                    style={{
                      width: "100%",
                      maxWidth: 680,
                      backgroundColor: TOKENS.paperBg,
                      color: TOKENS.paperInk,
                      borderRadius: 10,
                      padding: "28px 34px",
                      boxShadow: "0 18px 44px rgba(0, 0, 0, 0.35)",
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontFamily: TOKENS.fontMono,
                        fontSize: 11,
                        color: TOKENS.paperMuted,
                        marginBottom: 10,
                      }}
                    >
                      <span>SECTION 2 · DENSE SEMANTIC RETRIEVAL</span>
                      <span>PAGE 2 OF 24</span>
                    </div>

                    <h2
                      style={{
                        margin: "0 0 6px",
                        fontFamily: TOKENS.fontDisplay,
                        fontSize: 25,
                        fontWeight: 400,
                        color: TOKENS.paperInk,
                      }}
                    >
                      Attention-Guided Retrieval in Technical Monographs
                    </h2>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: TOKENS.paperMuted,
                        marginBottom: 18,
                      }}
                    >
                      K. Al-Mansoor, E. Lindqvist, H. Takahashi · Systems &amp;
                      Retrieval Lab
                    </div>

                    {/* Floating NoteEditorPortal (pops at frame 342) */}
                    {notePop > 0.01 && (
                      <div
                        style={{
                          position: "absolute",
                          top: 72,
                          right: 18,
                          width: 230,
                          padding: "10px 12px",
                          borderRadius: 10,
                          backgroundColor: TOKENS.bgCard,
                          color: TOKENS.textPrimary,
                          border: `1.5px solid #0284c7`,
                          boxShadow: "0 16px 36px rgba(0, 0, 0, 0.45)",
                          transform: `scale(${notePop})`,
                          transformOrigin: "top right",
                          zIndex: 10,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontFamily: TOKENS.fontMono,
                            fontSize: 10.5,
                            color: "#38bdf8",
                            marginBottom: 4,
                          }}
                        >
                          <span>Sticky Note · Page 2</span>
                          <span>300ms auto-save</span>
                        </div>
                        <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                          {noteText.slice(0, typedNoteChars)}
                        </div>
                      </div>
                    )}

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 20,
                        fontSize: 13,
                        lineHeight: 1.62,
                        color: TOKENS.paperSecondary,
                      }}
                    >
                      <div>
                        <p style={{ margin: "0 0 12px" }}>
                          Local neural retrievers eliminate network latency and
                          keep unpublished manuscripts strictly offline.{" "}
                          <span
                            style={{
                              background: `linear-gradient(90deg, rgba(253, 224, 71, 0.72) ${
                                highlightSweep * 100
                              }%, transparent ${highlightSweep * 100}%)`,
                              borderRadius: 3,
                              padding: "1px 2px",
                              color: TOKENS.paperInk,
                              fontWeight: 500,
                            }}
                          >
                            33M-parameter quantized ONNX encoders retain 98.4% of
                            cloud retrieval recall
                          </span>{" "}
                          across multi-chapter PDFs while executing inside Rust.
                        </p>
                        <p style={{ margin: 0 }}>
                          <span
                            style={{
                              borderRadius: 4,
                              padding: "2px 4px",
                              backgroundColor: `rgba(223, 106, 71, ${
                                citationPulse * 0.34
                              })`,
                              boxShadow:
                                citationPulse > 0.05
                                  ? `0 0 0 4px rgba(223, 106, 71, ${
                                      citationPulse * 0.35
                                    })`
                                  : "none",
                            }}
                          >
                            Storing normalized line bounding rectangles alongside
                            32-line overlapping chunks enables instant page
                            spotlighting on the active canvas.
                          </span>
                        </p>
                      </div>

                      <div>
                        <p style={{ margin: "0 0 12px" }}>
                          Furthermore,{" "}
                          <span
                            style={{
                              borderBottom:
                                underlineSweep > 0.05
                                  ? "2.5px dashed #16a34a"
                                  : "none",
                              paddingBottom: 1,
                            }}
                          >
                            burning annotations as ISO 32000-1 Form XObjects
                            guarantees full compatibility
                          </span>{" "}
                          with macOS Preview, Acrobat, and Zotero.
                        </p>

                        {/* Figure Crop Box */}
                        <div
                          style={{
                            border: `2px dashed ${TOKENS.accent}`,
                            borderRadius: 8,
                            padding: "10px 12px",
                            backgroundColor: "rgba(180, 67, 39, 0.06)",
                            position: "relative",
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: -10,
                              right: 10,
                              padding: "1px 8px",
                              borderRadius: 4,
                              backgroundColor: TOKENS.accent,
                              color: "#ffffff",
                              fontFamily: TOKENS.fontMono,
                              fontSize: 10.5,
                              fontWeight: 600,
                            }}
                          >
                            Fig. 2 Crop · idb://crop-fig-2
                          </span>
                          <div
                            style={{
                              fontFamily: TOKENS.fontMono,
                              fontSize: 11,
                              color: TOKENS.paperInk,
                              marginBottom: 8,
                            }}
                          >
                            NDCG@10 Retrieval Benchmark
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 5,
                            }}
                          >
                            {[
                              {
                                name: "MedEmbed-small (384d)",
                                w: "94%",
                                color: TOKENS.accent,
                              },
                              {
                                name: "all-MiniLM-L12 (384d)",
                                w: "89%",
                                color: "#52525b",
                              },
                              {
                                name: "GIST-MiniLM-L6 (384d)",
                                w: "83%",
                                color: "#71717a",
                              },
                            ].map((bar) => (
                              <div
                                key={bar.name}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  fontFamily: TOKENS.fontMono,
                                  fontSize: 10,
                                }}
                              >
                                <span style={{ width: 135 }}>{bar.name}</span>
                                <div
                                  style={{
                                    flex: 1,
                                    height: 7,
                                    borderRadius: 4,
                                    backgroundColor: "#e4e4e7",
                                    overflow: "hidden",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: bar.w,
                                      height: "100%",
                                      backgroundColor: bar.color,
                                    }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Floating SelectionActionBar in Act 3 */}
                  {frame >= 460 && frame < 730 && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        height: 38,
                        padding: "0 8px",
                        borderRadius: 10,
                        backgroundColor: TOKENS.bgCard,
                        border: `1px solid ${TOKENS.hairlineStrong}`,
                        boxShadow: "0 16px 36px rgba(0, 0, 0, 0.55)",
                        transform: `scale(${selectionBarPop})`,
                        fontSize: 12.5,
                      }}
                    >
                      <span
                        style={{
                          padding: "4px 10px",
                          color: TOKENS.textSecondary,
                        }}
                      >
                        Search Web
                      </span>
                      <span
                        style={{
                          padding: "5px 12px",
                          borderRadius: 7,
                          backgroundColor: TOKENS.accent,
                          color: "#141415",
                          fontWeight: 600,
                        }}
                      >
                        Ask Lio · Page 2
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: AiStudioSidebar (Acts 1..3) OR Split-Screen Living Summary (Act 4) */}
              {frame < 735 ? (
                <div
                  style={{
                    borderLeft: `1px solid ${TOKENS.hairline}`,
                    backgroundColor: TOKENS.bgCard,
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      height: 48,
                      padding: "0 14px",
                      borderBottom: `1px solid ${TOKENS.hairline}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        display: "inline-flex",
                        gap: 4,
                        padding: 3,
                        borderRadius: 8,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairline}`,
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{
                          padding: "4px 12px",
                          borderRadius: 6,
                          backgroundColor: TOKENS.bgCard,
                          color: TOKENS.textPrimary,
                          fontWeight: 500,
                        }}
                      >
                        Chat
                      </span>
                      <span
                        style={{
                          padding: "4px 12px",
                          color: TOKENS.textMuted,
                        }}
                      >
                        RAG Search
                      </span>
                      <span
                        style={{
                          padding: "4px 12px",
                          color: TOKENS.textMuted,
                        }}
                      >
                        Summarize
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: TOKENS.fontMono,
                        fontSize: 11,
                        color: TOKENS.textMuted,
                      }}
                    >
                      Claude / Ollama
                    </span>
                  </div>

                  <div
                    style={{
                      padding: 16,
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                      flex: 1,
                    }}
                  >
                    {/* Lio Companion Header Card */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 10,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairline}`,
                      }}
                    >
                      <LioMascotSvg
                        size={44}
                        pupilX={Math.cos(frame / 15) * 1.9}
                        pupilY={Math.sin(frame / 18) * 1.2}
                        sparkleScale={
                          frame >= 495 && frame < 605 ? 1 : 0
                        }
                        tiltDeg={frame >= 495 ? 5 : 0}
                      />
                      <div>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                          Lio · Agentic PDF Copilot
                        </div>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: TOKENS.textMuted,
                          }}
                        >
                          4 live PDF tools · SQLite conversation history
                        </div>
                      </div>
                    </div>

                    {/* User Message */}
                    {userPromptPop > 0.01 && (
                      <div
                        style={{
                          alignSelf: "flex-end",
                          maxWidth: "90%",
                          padding: "10px 14px",
                          borderRadius: 10,
                          backgroundColor: TOKENS.bgRaised,
                          border: `1px solid ${TOKENS.hairlineStrong}`,
                          fontSize: 13,
                          lineHeight: 1.45,
                          transform: `scale(${userPromptPop})`,
                          transformOrigin: "bottom right",
                        }}
                      >
                        Highlight the 33M ONNX recall finding on Page 2 and insert
                        Fig. 2 into my Living Summary.
                      </div>
                    )}

                    {/* Executed Copilot Tools & Assistant Response */}
                    {tool1Pop > 0.01 && (
                      <div
                        style={{
                          padding: 14,
                          borderRadius: 12,
                          backgroundColor: TOKENS.bgPage,
                          border: `1px solid ${TOKENS.hairlineStrong}`,
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          {[
                            {
                              label: "✓ navigate_to(p.2)",
                              pop: tool1Pop,
                            },
                            {
                              label: "✓ highlight_passage",
                              pop: tool2Pop,
                            },
                            {
                              label: "✓ explain_figure(Fig.2)",
                              pop: tool3Pop,
                            },
                            {
                              label: "✓ add_figure_to_summary",
                              pop: tool4Pop,
                            },
                          ].map(
                            (t) =>
                              t.pop > 0.01 && (
                                <span
                                  key={t.label}
                                  style={{
                                    padding: "3px 8px",
                                    borderRadius: 5,
                                    backgroundColor: TOKENS.positiveSoft,
                                    color: TOKENS.positive,
                                    fontFamily: TOKENS.fontMono,
                                    fontSize: 11,
                                    transform: `scale(${t.pop})`,
                                  }}
                                >
                                  {t.label}
                                </span>
                              ),
                          )}
                        </div>

                        {aiReplyPop > 0.01 && (
                          <div
                            style={{
                              fontSize: 13,
                              lineHeight: 1.55,
                              color: TOKENS.textSecondary,
                              opacity: aiReplyPop,
                            }}
                          >
                            Highlighted the 98.4% recall finding and embedded{" "}
                            <strong style={{ color: TOKENS.textPrimary }}>
                              Fig. 2
                            </strong>{" "}
                            into Chapter 3 of your Living Summary.{" "}
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "2px 8px",
                                borderRadius: 5,
                                backgroundColor:
                                  citationPulse > 0.1
                                    ? TOKENS.accent
                                    : TOKENS.accentSoft,
                                color:
                                  citationPulse > 0.1
                                    ? "#141415"
                                    : TOKENS.accent,
                                border: `1px solid ${TOKENS.accentBorder}`,
                                fontFamily: TOKENS.fontMono,
                                fontSize: 11.5,
                                fontWeight: 600,
                              }}
                            >
                              [Page 2 · Spotlight]
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Act 4: Split-Screen Living Summary Workspace (Tiptap + .md/.docx) */
                <div
                  style={{
                    borderLeft: `1px solid ${TOKENS.hairline}`,
                    backgroundColor: TOKENS.bgCard,
                    display: "flex",
                    flexDirection: "column",
                    opacity: summarySlideIn,
                    transform: `translateX(${interpolate(
                      summarySlideIn,
                      [0, 1],
                      [60, 0],
                    )}px)`,
                  }}
                >
                  <div
                    style={{
                      height: 48,
                      padding: "0 16px",
                      borderBottom: `1px solid ${TOKENS.hairline}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      Living Summary Split-View · Chapter 3
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          backgroundColor: TOKENS.bgPage,
                          border: `1px solid ${TOKENS.hairlineStrong}`,
                          fontFamily: TOKENS.fontMono,
                          fontSize: 11.5,
                        }}
                      >
                        Export .md
                      </span>
                      <span
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          backgroundColor:
                            docxExportBadge > 0.1
                              ? TOKENS.accent
                              : TOKENS.accentSoft,
                          color:
                            docxExportBadge > 0.1 ? "#141415" : TOKENS.accent,
                          border: `1px solid ${TOKENS.accentBorder}`,
                          fontFamily: TOKENS.fontMono,
                          fontSize: 11.5,
                          fontWeight: 600,
                          transform: `scale(${1 + docxExportBadge * 0.06})`,
                        }}
                      >
                        ✓ Export .docx
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: 20,
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                      flex: 1,
                    }}
                  >
                    <div
                      style={{
                        padding: 18,
                        borderRadius: 12,
                        backgroundColor: TOKENS.bgPage,
                        border: `1px solid ${TOKENS.hairlineStrong}`,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        flex: 1,
                      }}
                    >
                      <div style={{ fontSize: 17, fontWeight: 600 }}>
                        Chapter 3 — Dense Retrieval &amp; Hybrid Indexing
                      </div>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 20,
                          fontSize: 13,
                          lineHeight: 1.6,
                          color: TOKENS.textSecondary,
                        }}
                      >
                        <li>
                          Local 384-dim ONNX models (MedEmbed-small-v0.1) achieve
                          0.853 NDCG@10 with zero external API latency.
                        </li>
                        <li>
                          32-line windows with 6-line overlap preserve equations
                          and normalized line bounding rects.
                        </li>
                      </ul>

                      {/* Embedded Figure Crop inside Tiptap Editor */}
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 8,
                          backgroundColor: TOKENS.bgCard,
                          border: `1px solid ${TOKENS.accentBorder}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                            Embedded Figure · Fig. 2 (idb://crop-fig-2)
                          </div>
                          <div
                            style={{
                              fontFamily: TOKENS.fontMono,
                              fontSize: 11,
                              color: TOKENS.textMuted,
                            }}
                          >
                            Auto-expanded from SQLite into standalone .md and
                            Word .docx
                          </div>
                        </div>
                        <span
                          style={{
                            fontFamily: TOKENS.fontMono,
                            fontSize: 11,
                            color: TOKENS.positive,
                          }}
                        >
                          200×120 PNG
                        </span>
                      </div>

                      <pre
                        style={{
                          margin: 0,
                          padding: 12,
                          borderRadius: 8,
                          backgroundColor: TOKENS.bgDeep,
                          border: `1px solid ${TOKENS.hairline}`,
                          fontFamily: TOKENS.fontMono,
                          fontSize: 11.5,
                          color: TOKENS.textSecondary,
                        }}
                      >
                        {`// src-tauri/src/secrets.rs (AES-256-GCM)\nlet nonce = Nonce::from_slice(&random_12_bytes);\nlet ct = cipher.encrypt(nonce, payload)?;`}
                      </pre>
                    </div>

                    {/* Focus mode pills */}
                    <div style={{ display: "flex", gap: 8 }}>
                      {["Study Notes", "Executive Brief", "Technical & Code"].map(
                        (mode, i) => (
                          <span
                            key={mode}
                            style={{
                              padding: "5px 12px",
                              borderRadius: 6,
                              fontSize: 12,
                              backgroundColor:
                                i === 0 ? TOKENS.accentSoft : TOKENS.bgPage,
                              border: `1px solid ${
                                i === 0 ? TOKENS.accentBorder : TOKENS.hairline
                              }`,
                              color:
                                i === 0 ? TOKENS.accent : TOKENS.textSecondary,
                              fontWeight: i === 0 ? 600 : 400,
                            }}
                          >
                            {mode}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* ====================================================================
          Floating Lower-Third HUD Callout + Active Keycap (Frames 140..1015)
          ==================================================================== */}
      {hud && (
        <div
          style={{
            position: "absolute",
            left: 64,
            bottom: 44,
            right: 64,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              padding: "14px 22px",
              borderRadius: 14,
              backgroundColor: "rgba(20, 20, 21, 0.92)",
              border: `1px solid ${TOKENS.hairlineStrong}`,
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.65)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span
              style={{
                fontFamily: TOKENS.fontMono,
                fontSize: 13,
                color: TOKENS.accent,
              }}
            >
              {hud.kicker}
            </span>
            <span
              style={{
                fontSize: 22,
                fontWeight: 500,
                color: TOKENS.textPrimary,
                letterSpacing: "-0.015em",
              }}
            >
              {hud.headline}
            </span>
          </div>

          <KeycapBadge keys={hud.keys} label={hud.keyLabel} active />
        </div>
      )}

      {/* ====================================================================
          ACT 5: High-Energy Finale & Call to Action (Frames 1010..1200)
          ==================================================================== */}
      {frame >= 1005 && (
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            opacity: act5Finale,
            transform: `scale(${interpolate(act5Finale, [0, 1], [0.92, 1])})`,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 26,
              maxWidth: 1180,
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "14px 26px",
                borderRadius: 18,
                backgroundColor: TOKENS.bgCard,
                border: `1px solid ${TOKENS.hairlineStrong}`,
              }}
            >
              <FolioLogoMark size={54} />
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                }}
              >
                Foliet
              </span>
              <span
                style={{
                  fontFamily: TOKENS.fontMono,
                  fontSize: 15,
                  padding: "4px 10px",
                  borderRadius: 6,
                  backgroundColor: TOKENS.accentSoft,
                  color: TOKENS.accent,
                  border: `1px solid ${TOKENS.accentBorder}`,
                }}
              >
                v0.1.1 · Open Source MIT
              </span>
              <LioMascotSvg
                size={50}
                pupilX={0}
                pupilY={-0.5}
                sparkleScale={1}
                tiltDeg={5}
              />
            </div>

            <h2
              style={{
                margin: 0,
                fontFamily: TOKENS.fontDisplay,
                fontSize: 78,
                fontWeight: 400,
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
              }}
            >
              Read deeply. Annotate natively.
              <br />
              Think locally.
            </h2>

            {/* 4 Key Architecture Pillars */}
            <div
              style={{
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              {[
                "HTTP 206 Byte-Range Streaming",
                "ISO 32000-1 lopdf Form XObjects",
                "Offline Rust ONNX RAG (0.853 NDCG)",
                "AES-256-GCM Encrypted Key Vault",
              ].map((pill, idx) => {
                const pillPop = spring({
                  frame: frame - (1030 + idx * 8),
                  fps,
                  config: { damping: 14, stiffness: 160 },
                });
                return (
                  <span
                    key={pill}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      backgroundColor: TOKENS.bgCard,
                      border: `1px solid ${TOKENS.hairlineStrong}`,
                      fontFamily: TOKENS.fontMono,
                      fontSize: 14.5,
                      color: TOKENS.textSecondary,
                      transform: `scale(${pillPop})`,
                    }}
                  >
                    {pill}
                  </span>
                );
              })}
            </div>

            {/* OS Download CTA Bar */}
            <div
              style={{
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <div
                style={{
                  padding: "16px 28px",
                  borderRadius: 12,
                  backgroundColor: TOKENS.textPrimary,
                  color: TOKENS.bgPage,
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                Download for Windows · macOS Apple Silicon · Linux
              </div>
              <div
                style={{
                  padding: "16px 24px",
                  borderRadius: 12,
                  backgroundColor: TOKENS.bgCard,
                  border: `1px solid ${TOKENS.accentBorder}`,
                  fontFamily: TOKENS.fontMono,
                  fontSize: 17,
                  color: TOKENS.accent,
                }}
              >
                github.com/MohammedKamalAlsyd/Foliet
              </div>
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
