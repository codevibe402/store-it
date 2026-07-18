"use client";

import { motion } from "framer-motion";
import LogoutButton from "@/components/LogoutButton";
import { useArchive } from "./ArchiveContext";
import { formatBytes } from "./utils";
import shared from "./PageShared.module.css";
import styles from "./SettingsPage.module.css";

export default function SettingsPage() {
  const { totalBytesUsed } = useArchive();

  return (
    <div>
      <div className={shared.pageHead}>
        <div className={shared.eyebrow}>Ledger office</div>
        <h1 className={shared.pageTitle}>Settings</h1>
        <p className={shared.pageDesc}>Manage your account and how the archive behaves.</p>
      </div>

      <div className={styles.block}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Profile name</div>
            <div className={styles.rowDesc}>Shown on shared files and your avatar</div>
          </div>
          <motion.button type="button" className={styles.btn} whileTap={{ scale: 0.97 }}>
            Edit
          </motion.button>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Storage plan</div>
            <div className={styles.rowDesc}>{formatBytes(totalBytesUsed)} filed · no plan limit set</div>
          </div>
          <motion.button type="button" className={styles.btn} whileTap={{ scale: 0.97 }}>
            Upgrade
          </motion.button>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Auto-empty trash</div>
            <div className={styles.rowDesc}>Shred discarded files after 30 days</div>
          </div>
          <motion.button type="button" className={styles.btn} whileTap={{ scale: 0.97 }}>
            Change
          </motion.button>
        </div>
      </div>

      <div className={`${styles.block} ${styles.dangerZone}`}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <div className={styles.rowLabel}>Log out</div>
            <div className={styles.rowDesc}>End your session on this device</div>
          </div>
          <LogoutButton className={`${styles.btn} ${styles.btnDanger}`} />
        </div>
      </div>
    </div>
  );
}
