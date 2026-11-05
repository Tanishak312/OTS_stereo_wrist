"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

// Photo with a tinted placeholder underneath. The image is visible from the
// first paint (the placeholder shows through only while it's still arriving):
// the card's own entrance animation is the reveal, and fading the image in
// separately after hydration made every reload show an empty box first. With
// no src (asset not supplied yet) or a failed load, the placeholder stays.
export function Photo({
  src,
  alt,
  label,
  className = "",
  imgClassName = "",
  tone = "light",
  style,
}: {
  style?: CSSProperties;
  src?: string;
  alt: string;
  label?: string;
  className?: string;
  imgClassName?: string;
  tone?: "light" | "dark";
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // A 404 that lands before hydration never reaches onError, so check once after mount.
  useEffect(() => {
    const img = ref.current;
    setFailed(Boolean(img?.complete && img.naturalWidth === 0));
  }, [src]);

  const placeholder =
    tone === "dark" ? "bg-gradient-to-br from-[#1b2333] to-[#0b0f17] text-white/50" : "bg-gradient-to-br from-[#eef1f5] to-[#dfe4eb] text-muted";

  // The wrapper must be positioned for the absolutely placed <img>; keep the caller's position if it set one.
  const position = /(^|\s)(absolute|fixed|sticky)(\s|$)/.test(className) ? "" : "relative";

  return (
    <div role={src ? undefined : "img"} aria-label={src ? undefined : alt} className={`${position} overflow-hidden ${placeholder} ${className}`} style={style}>
      {(!src || failed) && label && <span className="eyebrow absolute bottom-3 left-3">{label}</span>}
      {src && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={ref}
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-[transform,translate,scale] duration-700 ease-[var(--ease-out-expo)] ${imgClassName}`}
        />
      )}
    </div>
  );
}
