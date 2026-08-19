"use client";

import { useEffect } from "react";

/**
 * Condenses the header into a floating island once the page scrolls.
 *
 * A one-pixel sentinel at the top of the document is observed rather than listening to scroll. It
 * fires twice in the life of a scroll gesture instead of on every frame, and it never runs layout
 * work inside a scroll handler — which is what makes a condensing header cheap enough to leave on
 * a mid-range phone.
 *
 * The header ships expanded in the HTML, so with JavaScript off it stays in its opening shape and
 * remains usable. Only width, padding, background and elevation change; the links never move
 * relative to each other, so nothing a reader is aiming at jumps out from under the cursor.
 */
export function HeaderIsland({ headerId }: { headerId: string }): null {
  useEffect(() => {
    const header = document.getElementById(headerId);
    if (!header) return;

    const sentinel = document.createElement("div");
    sentinel.setAttribute("aria-hidden", "true");
    // The height is the scroll threshold. It has to be intersecting at scroll zero, which a
    // negative rootMargin would prevent, so the margin stays at zero and the height does the work.
    sentinel.style.cssText = "position:absolute;top:0;left:0;height:32px;width:1px;pointer-events:none;";
    document.body.prepend(sentinel);

    const observer = new IntersectionObserver(
      ([entry]) => {
        header.dataset.condensed = String(!entry?.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, [headerId]);

  return null;
}
