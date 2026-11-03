import { cn } from "@/lib/utils";
import johnnyLogo from "@/assets/johnny-logo.png";
import johnnyMark from "@/assets/johnny-mark.png";
import johnnyMarkIcon from "@/assets/johnny-mark-icon.png";

/**
 * JohnnyStudio artwork (cut from src-tauri/icons/Johnny_of_JohnnyStudio.png,
 * white on transparent). Used as a CSS mask, so it's painted in the current
 * text color and fits every theme, light or dark.
 */
function Masked({ src, label, className }: { src: string; label: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{ mask: `url(${src}) center / contain no-repeat`, WebkitMask: `url(${src}) center / contain no-repeat` }}
    />
  );
}

/**
 * Johnny, the robot head mark (aspect ~3:2). `icon`: strokes thickened so that
 * at activity-bar size (28px wide) they come out ~1.5px, like the lucide icons
 * next to it (strokeWidth 1.5); the plain artwork would be ~1px there.
 */
export function JohnnyMark({ className, icon }: { className?: string; icon?: boolean }) {
  return (
    <Masked src={icon ? johnnyMarkIcon : johnnyMark} label="Johnny (JohnnyStudio)" className={cn("h-3.5 w-5", className)} />
  );
}

/** Stacked "JOHNNY STUDIO" logo. Square. */
export function JohnnyLogo({ className }: { className?: string }) {
  return <Masked src={johnnyLogo} label="JohnnyStudio" className={cn("size-20", className)} />;
}
