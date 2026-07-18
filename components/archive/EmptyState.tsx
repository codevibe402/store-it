"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

type EmptyStateProps = {
  icon: ReactNode;
  title: string;
  description: string;
};

export default function EmptyState({ icon, title, description }: EmptyStateProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className={styles.emptyState}>
      <motion.div
        className={styles.icon}
        animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
        transition={reduceMotion ? undefined : { duration: 4, repeat: Infinity, ease: "easeInOut" }}
      >
        {icon}
      </motion.div>
      <div className={styles.title}>{title}</div>
      <div className={styles.desc}>{description}</div>
    </div>
  );
}
