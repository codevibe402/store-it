"use client";

import { useEffect, useState } from "react";
import {
  generateDEKBytes,
  generateSalt,
  generateRecoveryCode,
  normalizeRecoveryCode,
  deriveWrappingKey,
  wrapDEKBytes,
  importDEK,
} from "@/client/lib/dek";
import { bufferToBase64, setSessionDEK } from "@/hooks/useFileEncryption";
import { storeDeviceDEK } from "@/client/lib/dekStore";

interface EncryptionSetupModalProps {
  userId: string;
  onComplete: () => void;
}

export default function EncryptionSetupModal({ userId, onComplete }: EncryptionSetupModalProps) {
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const dekBytes = generateDEKBytes();
        const code = generateRecoveryCode();
        const salt = generateSalt();
        const wrappingKey = await deriveWrappingKey(normalizeRecoveryCode(code), bufferToBase64(salt));
        const wrapped = await wrapDEKBytes(dekBytes, wrappingKey);

        const res = await fetch("/api/auth/encryption/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recoveryWrapped: wrapped.ciphertext,
            recoveryNonce: wrapped.nonce,
            recoverySalt: bufferToBase64(salt),
            recoveryCode: normalizeRecoveryCode(code),
          }),
        });
        if (!res.ok) throw new Error("Failed to set up encryption");

        await storeDeviceDEK(userId, bufferToBase64(dekBytes));
        setSessionDEK(await importDEK(dekBytes));

        if (!cancelled) {
          setRecoveryCode(code);
          setBusy(false);
        }
      } catch {
        if (!cancelled) {
          setError("Couldn't set up encryption. You can still upload and access files as normal; this will be retried next time you sign in.");
          setBusy(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  if (busy) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-[#111827] p-6">
        {error ? (
          <>
            <h3 className="text-lg font-semibold text-slate-100">Encryption setup skipped</h3>
            <p className="mt-2 text-sm text-slate-400">{error}</p>
            <button
              onClick={onComplete}
              className="mt-5 w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400"
            >
              Continue
            </button>
          </>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-slate-100">Save your recovery code</h3>
            <p className="mt-2 text-sm text-slate-400">
              Your files are encrypted so that even we can&apos;t read them. This code is the
              <span className="text-slate-200"> only way</span> to recover access to your files if
              you sign in on a new device or lose access to your password. Save it somewhere safe
              — it will not be shown again.
            </p>
            <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/70 p-3 text-center font-mono text-sm tracking-wider text-indigo-300 break-all">
              {recoveryCode}
            </div>
            <button
              type="button"
              onClick={() => recoveryCode && navigator.clipboard?.writeText(recoveryCode)}
              className="mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-slate-800"
            >
              Copy to clipboard
            </button>
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              I&apos;ve saved this recovery code somewhere safe
            </label>
            <button
              type="button"
              disabled={!confirmed}
              onClick={onComplete}
              className="mt-4 w-full rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
