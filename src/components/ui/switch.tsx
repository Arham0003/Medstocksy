import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

/**
 * App-wide toggle: green pill with a white knob when on, grey when off.
 * Kept deliberately in one place so every switch in the app looks the same
 * (Settings, Admin panel, coupons). The GST card in Settings draws the same
 * pill by hand because it sits inside a larger clickable card, so if these
 * colours or sizes change, change that one to match.
 */
const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // `min-h-0 p-0` are load-bearing: index.css gives every <button> a
      // 48px min-height and py-3 px-4 for touch targets, and the Radix Switch
      // root IS a button. Without these the track renders as a tall circle
      // with a squashed knob. Utilities outrank that base-layer rule.
      "peer inline-flex h-7 w-12 min-h-0 p-0 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
      "data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-600",
      "data-[state=unchecked]:bg-slate-300 data-[state=unchecked]:border-slate-400",
      "hover:data-[state=unchecked]:bg-slate-400",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition-transform",
        "data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
