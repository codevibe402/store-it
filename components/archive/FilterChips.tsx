"use client";

import { motion } from "framer-motion";
import type { FileFilter } from "./types";
import styles from "./FilterChips.module.css";

type ChipDef = { id: FileFilter; label: string; count: number };

type FilterChipsProps = {
  chips: ChipDef[];
  active: FileFilter;
  onChange: (filter: FileFilter) => void;
};

export default function FilterChips({ chips, active, onChange }: FilterChipsProps) {
  return (
    <div className={styles.chips}>
      {chips.map((chip) => {
        const isActive = chip.id === active;
        return (
          <button
            key={chip.id}
            type="button"
            className={`${styles.chip} ${isActive ? styles.active : ""}`}
            onClick={() => onChange(chip.id)}
            aria-pressed={isActive}
          >
            {isActive && (
              <motion.span layoutId="filter-chip-active" className={styles.chipBg} transition={{ type: "spring", stiffness: 400, damping: 32 }} />
            )}
            <span className={styles.chipLabel}>
              {chip.label} · {chip.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
