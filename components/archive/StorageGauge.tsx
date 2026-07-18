"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import styles from "./StorageGauge.module.css";

const ARC_LENGTH = 157;
// The dial's fill is cosmetic — there is no real storage quota backing it, so
// unlike the numeric readout below it, the needle doesn't represent a real
// fraction of anything. It just settles, like a real postal meter would.
const COSMETIC_FILL_OFFSET = 58;

type StorageGaugeProps = {
  totalBytes: number;
  compact?: boolean;
};

export default function StorageGauge({ totalBytes, compact }: StorageGaugeProps) {
  const reduceMotion = useReducedMotion();
  const targetGb = totalBytes / (1024 * 1024 * 1024);
  const [displayGb, setDisplayGb] = useState(reduceMotion ? targetGb : 0);

  useEffect(() => {
    if (reduceMotion) {
      setDisplayGb(targetGb);
      return;
    }
    let raf: number;
    const duration = 1200;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplayGb(targetGb * ease(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetGb, reduceMotion]);

  return (
    <div className={styles.wrap}>
      <svg
        className={styles.dial}
        width={compact ? 44 : 120}
        height={compact ? 26 : 70}
        viewBox="0 0 120 70"
        aria-hidden="true"
      >
        <path d="M10,65 A50,50 0 0,1 110,65" fill="none" stroke="var(--line-strong)" strokeWidth="8" strokeLinecap="round" />
        <motion.path
          d="M10,65 A50,50 0 0,1 110,65"
          fill="none"
          stroke="var(--brass)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          initial={{ strokeDashoffset: ARC_LENGTH }}
          animate={{ strokeDashoffset: reduceMotion ? COSMETIC_FILL_OFFSET : COSMETIC_FILL_OFFSET }}
          transition={reduceMotion ? { duration: 0 } : { duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
        {!compact && (
          <g stroke="var(--sage)" strokeWidth="1">
            <line x1="10" y1="65" x2="14" y2="58" />
            <line x1="26" y1="33" x2="30" y2="38" />
            <line x1="60" y1="15" x2="60" y2="21" />
            <line x1="94" y1="33" x2="90" y2="38" />
            <line x1="110" y1="65" x2="106" y2="58" />
          </g>
        )}
      </svg>
      {!compact && (
        <>
          <div className={styles.value}>
            {displayGb.toFixed(1)} <span className={styles.valueUnit}>GB filed</span>
          </div>
          <div className={styles.label}>Storage Used</div>
        </>
      )}
    </div>
  );
}
