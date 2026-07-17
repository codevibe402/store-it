"use client";

import { useState } from "react";
import { normalizeRecoveryCode, deriveWrappingKey, unwrapDEKBytes, importDEK } from "@/client/lib/dek";
import { bufferToBase64, setSessionDEK } from "@/hooks/useFileEncryption";
import { storeDeviceDEK } from "@/client/lib/dekStore";

interface EncryptionRecoveryModalProps {
  userId: string;
  onComplete: () => void;
  onSkip: () => void;
}

export default function EncryptionRecoveryModal({ userId, onComplete, onSkip }: EncryptionRecoveryModalProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    const normalized = normalizeRecoveryCode(code);
    if (!normalized) {
      setError("Enter your recovery code");
      return;
    }
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/encryption/recovery-wrap");
      if (!res.ok) throw new Error("no-wrap");
      const { recoveryWrapped, recoveryNonce, recoverySalt } = await res.json();

      const wrappingKey = await deriveWrappingKey(normalized, recoverySalt);
      const dekBytes = await unwrapDEKBytes(recoveryWrapped, recoveryNonce, wrappingKey);

      await storeDeviceDEK(userId, bufferToBase64(dekBytes));
      setSessionDEK(await importDEK(dekBytes));
      onComplete();
    } catch {
      setError("That recovery code doesn't match this account. Double-check it and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#111827] p-6">
        <h3 className="text-lg font-semibold text-slate-100">Unlock your encrypted files</h3>
        <p className="mt-2 text-sm text-slate-400">
          This is a new device (or your local data was cleared). Enter the recovery code you saved
          when encryption was first set up to unlock your files here.
        </p>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-400"
          onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
        />
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={handleSubmit}
          className="mt-4 w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Verifying..." : "Unlock"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-slate-800"
        >
          Skip for now — encrypted files won&apos;t open until I do this
        </button>
      </div>
    </div>
  );
}
