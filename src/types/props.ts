export const LOGO_SIZES = {
    sm: 28,
    md: 44,
    lg: 68,
    xl: 96,
} as const;

export type LogoPresetSize = keyof typeof LOGO_SIZES;
export type LogoSize = LogoPresetSize | number;

export interface LogoProps {
    size?: LogoSize;
    showText?: boolean;
    subtitle?: string;
    className?: string;
    textClassName?: string;
    onClick?: () => void;
}

export interface TitlebarProps {
    onRequestClose?: () => void;
    onNavigateHome?: () => void;
}