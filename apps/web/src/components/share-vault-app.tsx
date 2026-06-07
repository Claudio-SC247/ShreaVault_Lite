"use client";

import {
  Ban,
  Clock,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UploadCloud
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EXPIRATION_OPTIONS,
  ShareRecord,
  SharesResponse,
  buildApiUrl,
  formatBytes,
  getAdminAuthHeaders,
  normalizeApiBaseUrl,
  resolveStatus
} from "@/lib/share";

const statusStyles: Record<ShareRecord["status"], string> = {
  active: "border-pine/20 bg-pine/10 text-pine",
  expired: "border-amber/25 bg-amber/10 text-amber",
  revoked: "border-coral/25 bg-coral/10 text-coral"
};

const statusLabels: Record<ShareRecord["status"], string> = {
  active: "Activo",
  expired: "Expirado",
  revoked: "Revocado"
};

type UploadResponse = {
  share: ShareRecord;
};

export function ShareVaultApp() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiBase = useMemo(() => normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL), []);
  const adminHeaders = useMemo(() => getAdminAuthHeaders(), []);
  const [expirationHours, setExpirationHours] = useState("24");
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [lastShare, setLastShare] = useState<ShareRecord | null>(null);
  const [loadingShares, setLoadingShares] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadShares = useCallback(
    async (cursor?: number | null, append = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingShares(true);
      }
      setError(null);

      try {
        const path =
          cursor != null
            ? `/api/shares?limit=50&cursor=${encodeURIComponent(String(cursor))}`
            : "/api/shares?limit=50";
        const response = await fetch(buildApiUrl(apiBase, path), {
          cache: "no-store",
          headers: adminHeaders
        });

        if (!response.ok) {
          throw new Error("No se pudieron cargar los enlaces.");
        }

        const data = (await response.json()) as SharesResponse;
        const normalizedShares = data.shares.map((share) => ({ ...share, status: resolveStatus(share) }));

        setShares((current) => (append ? [...current, ...normalizedShares] : normalizedShares));
        setNextCursor(data.nextCursor);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Error inesperado.");
      } finally {
        setLoadingShares(false);
        setLoadingMore(false);
      }
    },
    [adminHeaders, apiBase]
  );

  useEffect(() => {
    void loadShares();
  }, [loadShares]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setUploading(true);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    form.set("expiresInHours", expirationHours);

    try {
      const response = await fetch(buildApiUrl(apiBase, "/api/files"), {
        method: "POST",
        headers: adminHeaders,
        body: form
      });

      const data = (await response.json()) as Partial<UploadResponse> & { error?: string };
      if (!response.ok || !data.share) {
        throw new Error(data.error ?? "No se pudo subir el archivo.");
      }

      setLastShare(data.share);
      formElement.reset();
      setExpirationHours("24");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await loadShares();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Error inesperado.");
    } finally {
      setUploading(false);
    }
  }

  async function revokeShare(id: string) {
    setRevokingId(id);
    setError(null);

    try {
      const response = await fetch(buildApiUrl(apiBase, `/api/shares/${id}/revoke`), {
        method: "POST",
        headers: adminHeaders
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo revocar el enlace.");
      }

      await loadShares();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Error inesperado.");
    } finally {
      setRevokingId(null);
    }
  }

  async function deleteShare(id: string, fileName: string) {
    if (!window.confirm(`Eliminar "${fileName}" y su archivo asociado?`)) {
      return;
    }

    setDeletingId(id);
    setError(null);

    try {
      const response = await fetch(buildApiUrl(apiBase, `/api/shares/${id}`), {
        method: "DELETE",
        headers: adminHeaders
      });

      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "No se pudo eliminar el enlace.");
      }

      if (lastShare?.id === id) {
        setLastShare(null);
      }

      await loadShares();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Error inesperado.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-3 text-sm font-semibold uppercase text-pine">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            ShareVault Lite
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Archivos compartidos</h1>
        </div>
      </header>

      {error ? (
        <div className="rounded-md border border-coral/25 bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </div>
      ) : null}

      <section className="grid gap-5 lg:grid-cols-[minmax(18rem,24rem)_1fr]">
        <form
          className="flex flex-col gap-5 rounded-md border border-slate-200 bg-white p-5 shadow-sm"
          onSubmit={handleUpload}
        >
          <div>
            <h2 className="text-lg font-semibold text-ink">Nuevo enlace</h2>
            <p className="mt-1 text-sm text-slate-600">PDF, imagenes, texto, ZIP y documentos hasta 25 MB.</p>
          </div>

          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
            Archivo
            <input
              ref={fileInputRef}
              className="block w-full rounded-md border border-slate-300 bg-white text-sm text-slate-700 file:mr-3 file:h-10 file:border-0 file:bg-ink file:px-4 file:text-sm file:font-semibold file:text-white"
              name="file"
              type="file"
              required
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
            Expiracion
            <select
              className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-ink outline-none transition focus:border-pine focus:ring-2 focus:ring-pine/20"
              value={expirationHours}
              onChange={(event) => setExpirationHours(event.target.value)}
            >
              {EXPIRATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-pine px-4 text-sm font-semibold text-white transition hover:bg-[#124d3f] disabled:bg-slate-300"
            type="submit"
            disabled={uploading}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-4 w-4" aria-hidden="true" />}
            Subir
          </button>

          {lastShare ? (
            <div className="rounded-md border border-pine/20 bg-pine/10 p-3 text-sm text-pine">
              <div className="flex items-center gap-2 font-semibold">
                <Link2 className="h-4 w-4" aria-hidden="true" />
                Enlace creado
              </div>
              <a className="mt-2 block break-all underline" href={lastShare.shareUrl} target="_blank" rel="noreferrer">
                {lastShare.shareUrl}
              </a>
            </div>
          ) : null}
        </form>

        <section className="rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">Enlaces</h2>
              <p className="mt-1 text-sm text-slate-600">{shares.length} registros</p>
            </div>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-ink transition hover:border-pine hover:text-pine disabled:text-slate-400"
              type="button"
              onClick={() => void loadShares()}
              disabled={loadingShares}
            >
              <RefreshCw className={`h-4 w-4 ${loadingShares ? "animate-spin" : ""}`} aria-hidden="true" />
              Actualizar
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-mist text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Archivo</th>
                  <th className="px-5 py-3 font-semibold">Tamano</th>
                  <th className="px-5 py-3 font-semibold">Expira</th>
                  <th className="px-5 py-3 font-semibold">Estado</th>
                  <th className="px-5 py-3 text-right font-semibold">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingShares ? (
                  <tr>
                    <td className="px-5 py-8 text-center text-slate-500" colSpan={5}>
                      Cargando...
                    </td>
                  </tr>
                ) : shares.length === 0 ? (
                  <tr>
                    <td className="px-5 py-8 text-center text-slate-500" colSpan={5}>
                      Sin enlaces
                    </td>
                  </tr>
                ) : (
                  shares.map((share) => {
                    const status = resolveStatus(share);
                    return (
                      <tr key={share.id} className="align-middle">
                        <td className="max-w-[20rem] px-5 py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                              <FileText className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-ink">{share.fileName}</div>
                              <div className="truncate text-xs text-slate-500">{share.mimeType || "application/octet-stream"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-slate-700">{formatBytes(share.size)}</td>
                        <td className="px-5 py-4 text-slate-700">
                          <span className="inline-flex items-center gap-2">
                            <Clock className="h-4 w-4 text-slate-400" aria-hidden="true" />
                            {new Date(share.expiresAt).toLocaleString("es-PE", {
                              dateStyle: "medium",
                              timeStyle: "short"
                            })}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-semibold ${statusStyles[status]}`}>
                            {statusLabels[status]}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-2">
                            <a
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:border-pine hover:text-pine"
                              href={share.shareUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="Abrir"
                            >
                              <ExternalLink className="h-4 w-4" aria-hidden="true" />
                              <span className="sr-only">Abrir</span>
                            </a>
                            <button
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:border-coral hover:text-coral disabled:border-slate-200 disabled:text-slate-300"
                              type="button"
                              onClick={() => void revokeShare(share.id)}
                              disabled={status !== "active" || revokingId === share.id}
                              title="Revocar"
                            >
                              {revokingId === share.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ban className="h-4 w-4" aria-hidden="true" />}
                              <span className="sr-only">Revocar</span>
                            </button>
                            <button
                              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 transition hover:border-coral hover:text-coral disabled:border-slate-200 disabled:text-slate-300"
                              type="button"
                              onClick={() => void deleteShare(share.id, share.fileName)}
                              disabled={deletingId === share.id}
                              title="Eliminar"
                            >
                              {deletingId === share.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                              <span className="sr-only">Eliminar</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {nextCursor ? (
            <div className="border-t border-slate-200 p-5">
              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 px-4 text-sm font-semibold text-ink transition hover:border-pine hover:text-pine disabled:text-slate-400"
                type="button"
                onClick={() => void loadShares(nextCursor, true)}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Cargar mas
              </button>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
