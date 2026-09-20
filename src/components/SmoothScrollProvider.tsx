"use client";

import React, { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import Lenis from 'lenis';

const SmoothScrollContext = createContext<Lenis | null>(null);

// --- LENIS CONFIGURATION ---
// Tweak these values to adjust the scroll feel
const lenisOptions = {
  // Lerp is generally preferred over duration/easing for a tighter, less "floaty" responsive feel.
  // Lower values = smoother/floatier, Higher values = snappier/more native. (0.05 to 0.15 is the sweet spot)
  lerp: 0.05,
  
  // Wheel settings
  smoothWheel: true,
  wheelMultiplier: 1,
  
  // Touch/Trackpad settings
  // syncTouch: true, // Uncomment if you want touch scrolling to be strictly synced
  touchMultiplier: 2,

  // Prevent Lenis from hijacking nested scroll containers (modals, dropdowns, tables, etc.)
  // Only target elements identified by ARIA roles and specific tags - NOT generic overflow classes,
  // because the main scroll wrapper itself uses overflow-y-auto.
  prevent: (node: Element) => {
    // Walk up from the event target. If we hit a known nested scrollable before
    // hitting the main Lenis wrapper, let native scroll handle it.
    let el: Element | null = node;
    while (el) {
      // If we reached the main wrapper, stop - this is Lenis territory.
      if (el.hasAttribute('data-lenis-wrapper')) return false;

      const role = el.getAttribute('role');
      const tag = el.tagName;

      if (
        role === 'dialog' ||
        role === 'menu' ||
        role === 'listbox' ||
        role === 'combobox' ||
        tag === 'TABLE' ||
        el.hasAttribute('data-radix-scroll-area-viewport') ||
        el.hasAttribute('data-lenis-prevent')
      ) {
        return true;
      }

      el = el.parentElement;
    }
    return false;
  }
};

/** See the note in the effect below before changing this list. */
const SKIP_SMOOTH_SCROLL = [
  '/',
  '/pricing',
  '/customer-relation',
  '/reports',
  '/settings',
  '/admin-control',
  '/wholesale-reports',
];

export function useSmoothScroll() {
  return useContext(SmoothScrollContext);
}

interface SmoothScrollProviderProps {
  children: ReactNode;
  scrollContainerRef?: React.RefObject<HTMLElement>;
  pathname?: string;
}

export default function SmoothScrollProvider({ children, scrollContainerRef, pathname }: SmoothScrollProviderProps) {
  const lenisRef = useRef<Lenis | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Routes that scroll the DOCUMENT rather than the wrapper div.
    //
    // Lenis is initialised with `wrapper: mainContentRef.current`, but that div
    // is not height-constrained - the flex layout lets it grow, so the page
    // itself is what scrolls. On those routes Lenis captures the wheel events
    // and drives an element with no overflow, and the page appears frozen.
    // Skipping it hands scrolling back to the browser.
    //
    // ADDING A NEW FULL-PAGE ROUTE? If it is a normal page that grows past the
    // viewport (tables, tabs, stat cards), add it here or it will not scroll.
    if (SKIP_SMOOTH_SCROLL.includes(pathname || '')) return;

    const options: any = { ...lenisOptions };

    if (scrollContainerRef && scrollContainerRef.current) {
      options.wrapper = scrollContainerRef.current;
      options.content = contentRef.current;
      options.eventsTarget = scrollContainerRef.current;
      scrollContainerRef.current.setAttribute('data-lenis-wrapper', 'true');
    }

    const lenis = new Lenis(options);
    lenisRef.current = lenis;

    let rafId: number;
    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [scrollContainerRef, pathname]);

  useEffect(() => {
    if (lenisRef.current) {
      lenisRef.current.scrollTo(0, { immediate: true });
    } else if (scrollContainerRef && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, scrollContainerRef]);

  return (
    <SmoothScrollContext.Provider value={lenisRef.current}>
      <div ref={contentRef} className="lenis-content-wrapper min-h-full">
        {children}
      </div>
    </SmoothScrollContext.Provider>
  );
}
