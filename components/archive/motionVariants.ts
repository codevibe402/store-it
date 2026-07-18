import type { Variants } from "framer-motion";

export function staggerContainer(staggerChildren: number, reduceMotion: boolean | null): Variants {
  if (reduceMotion) {
    return { hidden: { opacity: 1 }, show: { opacity: 1 } };
  }
  return {
    hidden: {},
    show: { transition: { staggerChildren, delayChildren: 0.02 } },
  };
}

export function riseItem(reduceMotion: boolean | null): Variants {
  if (reduceMotion) {
    return { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.15 } } };
  }
  return {
    hidden: { opacity: 0, y: 8 },
    show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  };
}

export function pageTransition(reduceMotion: boolean | null) {
  if (reduceMotion) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.12 },
    };
  }
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  };
}
