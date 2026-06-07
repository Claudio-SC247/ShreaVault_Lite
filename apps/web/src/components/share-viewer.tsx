"use client";

import { Download, FileWarning, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildApiUrl,
  extractFileName,
  normalizeApiBaseUrl,
  resolveSharePreviewMode
} from "@/lib/share";

type ShareViewerProps = {
  token: string;
};

type ViewerState =
  | { status: "loading" }
  | { status: "error"; message: string; httpStatus: number }
  | {
      status: "ready";
      blobUrl: string;
      downloadUrl: string;
      fileName: string;
      mimeType: string;
      previewMode: ReturnType<typeof resolveSharePreviewMode>;
      textContent?: string;
    };

export function ShareViewer({ token }: ShareViewerProps) {
  const apiBase = useMemo(() => normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL), []);
  const shareApiUrl = useMemo(() => buildApiUrl(apiBase, `/share/${token}`), [apiBase, token]);
  const [state, setState] = useState<ViewerState>({ status: "loading" });

  useEffect(() => {
    let blobUrl: string | null = null;
    let cancelled = false;

    async function loadShare() {
      setState({ status: "loading" });

      try {
        const response = await fetch(shareApiUrl, { cache: "no-store" });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          if (!cancelled) {
            setState({
              status: "error",
              message: data?.error ?? "No se pudo abrir el enlace.",
              httpStatus: response.status
            });
          }
          return;
        }

        const blob = await response.blob();
        blobUrl = URL.createObjectURL(blob);
        const mimeType = response.headers.get("content-type") ?? blob.type ?? "application/octet-stream";
        const fileName = extractFileName(response.headers.get("content-disposition"), "archivo-compartido");
        const previewMode = resolveSharePreviewMode(mimeType);
        let textContent: string | undefined;

        if (previewMode === "text") {
          textContent = await blob.text();
        }

        if (!cancelled) {
          setState({
            status: "ready",
            blobUrl,
            downloadUrl: shareApiUrl,
            fileName,
            mimeType,
            previewMode,
            textContent
          });
        }
      } catch {
        if (!cancelled) {
          setState({
            status: "error",
            message: "No se pudo conectar con la API.",
            httpStatus: 0
          });
        }
      }
    }

    void loadShare();

    return () => {
      cancelled = true;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [shareApiUrl]);

  if (state.status === "loading") {
    return (
      <div className="flex min-h-[16rem] items-center justify-center rounded-md border border-slate-200 bg-white p-8 text-slate-600">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        Cargando archivo...
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-md border border-coral/25 bg-coral/10 p-6 text-coral">
        <div className="flex items-center gap-2 font-semibold">
          <FileWarning className="h-5 w-5" aria-hidden="true" />
          {state.httpStatus === 410 ? "Enlace no disponible" : "No se pudo abrir el enlace"}
        </div>
        <p className="mt-2 text-sm">{state.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">{state.fileName}</h1>
          <p className="mt-1 text-sm text-slate-600">{state.mimeType}</p>
        </div>
        <a
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 text-sm font-semibold text-ink transition hover:border-pine hover:text-pine"
          href={state.downloadUrl}
          download={state.fileName}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Descargar
        </a>
      </div>

      {state.previewMode === "image" ? (
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={state.fileName} className="mx-auto max-h-[70vh] max-w-full object-contain" src={state.blobUrl} />
        </div>
      ) : null}

      {state.previewMode === "pdf" ? (
        <iframe className="h-[75vh] w-full rounded-md border border-slate-200 bg-white shadow-sm" src={state.blobUrl} title={state.fileName} />
      ) : null}

      {state.previewMode === "text" ? (
        <pre className="max-h-[70vh] overflow-auto rounded-md border border-slate-200 bg-white p-4 text-sm text-ink shadow-sm">{state.textContent}</pre>
      ) : null}

      {state.previewMode === "download" ? (
        <div className="rounded-md border border-slate-200 bg-mist p-6 text-sm text-slate-700">
          Vista previa no disponible para este tipo de archivo. Usa el boton de descarga.
        </div>
      ) : null}
    </div>
  );
}
