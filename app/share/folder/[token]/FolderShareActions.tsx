"use client";

import { ChangeEvent, FormEvent, useState } from "react";

type Props = {
  token: string;
  canAdd: boolean;
  folderId?: string;
};

export default function FolderShareActions({ token, canAdd, folderId }: Props) {
  const [folderName, setFolderName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const qs = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";

  if (!canAdd) return null;

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setMessage("");
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`/api/shared/${token}/upload${qs}`, {
      method: "POST",
      body: formData,
    });

    setBusy(false);
    event.target.value = "";

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? "Upload failed");
      return;
    }

    setMessage("File added. Refreshing...");
    window.location.reload();
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;

    setBusy(true);
    setMessage("");

    const res = await fetch(`/api/shared/${token}/folders${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    setBusy(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data.error ?? "Could not create folder");
      return;
    }

    setFolderName("");
    setMessage("Folder added. Refreshing...");
    window.location.reload();
  }

  return (
    <div className="share-add-panel">
      <div>
        <div className="share-add-title">Add access enabled</div>
        <div className="share-add-sub">People with this link can upload files and create folders here.</div>
      </div>
      <div className="share-add-actions">
        <label className="share-add-btn">
          Upload file
          <input type="file" hidden onChange={uploadFile} disabled={busy} />
        </label>
        <form className="share-folder-form" onSubmit={createFolder}>
          <input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="New folder name"
            disabled={busy}
          />
          <button type="submit" disabled={busy}>Create</button>
        </form>
      </div>
      {message && <div className="share-add-message">{message}</div>}
    </div>
  );
}
