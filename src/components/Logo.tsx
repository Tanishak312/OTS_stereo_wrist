// Brand logo from the design team (public/images/awign-logo.png, 228×80 @2x).
export function Logo({ inverted = false, className = "h-9 lg:h-[42px]" }: { inverted?: boolean; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/images/awign-logo.png"
      alt="awign, a Mynavi company"
      width={114}
      height={40}
      className={`w-auto ${inverted ? "brightness-0 invert" : ""} ${className}`}
    />
  );
}
