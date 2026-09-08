import type { Env } from "../env";
import { Db } from "../db/client";
import { GalleryRepo, type GalleryKind } from "../db/gallery";

// Almacén de la Galería: los bytes en R2 (bucket CATALOG, key "galeria/<id>"),
// el índice en D1. La carga es por URL — el Worker hace fetch y guarda, así el
// agente que administra la galería (skill/galeria.md) no maneja archivos.

// Cap por archivo: video pesa; el Worker aguanta pero seamos razonables.
const MAX_BYTES: Record<GalleryKind, number> = {
  image: 5 * 1024 * 1024,
  audio: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
};

interface SniffResult {
  kind: GalleryKind;
  mime: string;
}

/** Detecta tipo por magic bytes. Sólo media real (anti HTML/otro). */
export function sniffMediaType(b: Uint8Array): SniffResult | null {
  const has = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  const at = (off: number, ...sig: number[]) => sig.every((v, i) => b[off + i] === v);

  // --- imagen ---
  if (has(0x89, 0x50, 0x4e, 0x47)) return { kind: "image", mime: "image/png" };
  if (has(0xff, 0xd8, 0xff)) return { kind: "image", mime: "image/jpeg" };
  if (has(0x47, 0x49, 0x46, 0x38)) return { kind: "image", mime: "image/gif" };
  if (has(0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { kind: "image", mime: "image/webp" };

  // --- audio ---
  if (has(0x49, 0x44, 0x33)) return { kind: "audio", mime: "audio/mpeg" }; // ID3 (mp3)
  if (has(0xff, 0xfb) || has(0xff, 0xf3) || has(0xff, 0xf2)) return { kind: "audio", mime: "audio/mpeg" };
  if (has(0x4f, 0x67, 0x67, 0x53)) return { kind: "audio", mime: "audio/ogg" }; // OggS
  if (has(0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x41, 0x56, 0x45)) return { kind: "audio", mime: "audio/wav" };

  // --- video ---
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return { kind: "video", mime: "video/mp4" }; // ....ftyp (mp4/mov)
  if (has(0x1a, 0x45, 0xdf, 0xa3)) return { kind: "video", mime: "video/webm" }; // EBML (webm/mkv)

  return null;
}

export interface IngestInput {
  url: string;
  label: string;
  trigger: string;
}

/** Descarga la URL, valida el tipo, guarda en R2 y crea la fila. */
export async function ingestFromUrl(env: Env, input: IngestInput): Promise<{ id: string; kind: GalleryKind }> {
  if (!env.CATALOG) throw new Error("El bucket de archivos (CATALOG) no está disponible.");
  if (!input.label?.trim()) throw new Error("Cada item necesita un 'label' (nombre corto).");

  let res: Response;
  try {
    res = await fetch(input.url, { headers: { "user-agent": "ForjaBot-Galeria/1" } });
  } catch (e) {
    throw new Error(`No pude descargar ${input.url}: ${(e as Error)?.message ?? e}`);
  }
  if (!res.ok) throw new Error(`No pude descargar ${input.url}: HTTP ${res.status}`);

  const bytes = new Uint8Array(await res.arrayBuffer());
  const sniff = sniffMediaType(bytes);
  if (!sniff) throw new Error(`El contenido de ${input.url} no es una imagen, video ni audio reconocible.`);

  if (bytes.byteLength > MAX_BYTES[sniff.kind]) {
    throw new Error(
      `El archivo (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB) supera el límite para ${sniff.kind} (${MAX_BYTES[sniff.kind] / 1024 / 1024} MB).`,
    );
  }

  const repo = new GalleryRepo(new Db(env.DB));
  const id = crypto.randomUUID();
  const r2Key = `galeria/${id}`;
  await env.CATALOG.put(r2Key, bytes, { httpMetadata: { contentType: sniff.mime } });
  await repo.create({
    id,
    kind: sniff.kind,
    label: input.label.trim(),
    trigger: (input.trigger ?? "").trim(),
    r2Key,
    mime: sniff.mime,
    sizeBytes: bytes.byteLength,
    sourceUrl: input.url,
  });
  return { id, kind: sniff.kind };
}

/** GET /galeria/:id — sirve la media pública (adaptadores + WhatsApp/Meta la fetchean). */
export async function serveGalleryItem(env: Env, id: string): Promise<Response> {
  if (!env.CATALOG) return new Response("not found", { status: 404 });
  const item = await new GalleryRepo(new Db(env.DB)).get(id);
  if (!item) return new Response("not found", { status: 404 });
  const obj = await env.CATALOG.get(item.r2_key);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": item.mime || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

/** URL pública de un item (la que el adaptador manda al canal). */
export function galleryItemUrl(env: Env, id: string): string {
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}/galeria/${id}`;
}
