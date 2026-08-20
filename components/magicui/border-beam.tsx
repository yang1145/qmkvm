import { cn } from "@/lib/utils";

interface BorderBeamProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  duration?: number;
  anchor?: number;
  borderWidth?: number;
  colorFrom?: string;
  colorTo?: string;
  delay?: number;
}

/** Magic UI BorderBeam：沿边框循环扫描的光束动效 */
export function BorderBeam({
  className,
  size = 180,
  duration = 12,
  anchor = 90,
  borderWidth = 1.5,
  colorFrom = "var(--color-primary)",
  colorTo = "#93C5FD",
  delay = 0,
}: BorderBeamProps) {
  return (
    <div
      style={
        {
          "--size": size,
          "--duration": `${duration}s`,
          "--anchor": anchor,
          "--border-width": borderWidth,
          "--color-from": colorFrom,
          "--color-to": colorTo,
          "--delay": `-${delay}s`,
        } as React.CSSProperties
      }
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] [border:calc(var(--border-width)*1px)_solid_transparent]",
        "[mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]",
        className
      )}
    >
      <div
        style={{
          width: "var(--size)",
          height: "var(--size)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%) rotate(calc(var(--anchor)*1deg))",
        }}
        className={cn(
          "absolute animate-border-beam",
          "[background:conic-gradient(from_calc(var(--anchor)*-1deg),transparent_0deg,var(--color-from)_calc(var(--anchor)*0.5),var(--color-to)_calc(var(--anchor)*1),transparent_calc(var(--anchor)*1.5))]",
          "[mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)]",
          "[mask-composite:exclude]"
        )}
      />
    </div>
  );
}
