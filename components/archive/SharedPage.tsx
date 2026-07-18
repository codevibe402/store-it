"use client";

import { Mail } from "lucide-react";
import EmptyState from "./EmptyState";
import shared from "./PageShared.module.css";

export default function SharedPage() {
  return (
    <div>
      <div className={shared.pageHead}>
        <div className={shared.eyebrow}>Correspondence</div>
        <h1 className={shared.pageTitle}>Shared with you</h1>
        <p className={shared.pageDesc}>Files other people have sent to your archive.</p>
      </div>
      <EmptyState
        icon={<Mail strokeWidth={1.3} />}
        title="Nothing's arrived yet"
        description="When someone shares a file with you, it'll be stamped and filed here."
      />
    </div>
  );
}
