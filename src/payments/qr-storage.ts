import type { Env } from "../env";
import { Db } from "../db/client";
import { SettingsRepo, SETTING_KEYS } from "../db/settings";

// El QR de pago del negocio vive en el bucket R2 CATALOG (ya declarado en
// wrangler.toml) y se sirve PÚBLICO en GET /qr: WhatsApp/Meta exige poder
// hacer fetch de la URL para mostrar la imagen al cliente. La subida desde el
// panel deja la setting paymentQrUrl apuntando a /qr?v=<timestamp> — el ?v=
// revienta cualquier cache de Meta cuando el dueño cambia el QR.

const R2_KEY = "payment-qr";
const MAX_BYTES = 2 * 1024 * 1024; // 2MB: un QR sobra con 100KB

/** Firma por magic bytes: solo imágenes reales (anti HTML-subido-como-QR). */
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length > 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Guarda la imagen del QR en R2 y deja la setting paymentQrUrl lista.
 * Devuelve la URL pública. Lanza con mensaje en español si la imagen no es
 * válida — el route la convierte en feedback del panel.
 */
export async function savePaymentQr(env: Env, file: File): Promise<string> {
  if (!env.CATALOG) throw new Error("El bucket de archivos (CATALOG) no está disponible.");
  if (!file || file.size === 0) throw new Error("No recibí ningún archivo.");
  if (file.size > MAX_BYTES) throw new Error("La imagen pesa más de 2 MB — comprímela e intenta de nuevo.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(bytes);
  if (!contentType) throw new Error("Ese archivo no es una imagen PNG/JPG/WEBP válida.");

  await env.CATALOG.put(R2_KEY, bytes, {
    httpMetadata: { contentType },
  });
  const base = (env.DASHBOARD_BASE_URL ?? "").replace(/\/$/, "");
  const url = `${base}/qr?v=${Date.now()}`;
  await new SettingsRepo(new Db(env.DB)).set(SETTING_KEYS.paymentQrUrl, url);
  return url;
}

/** Sirve el QR (GET /qr, público — Meta lo fetcha). 404 si aún no hay QR. */
export async function servePaymentQr(env: Env): Promise<Response> {
  if (!env.CATALOG) return new Response("not found", { status: 404 });
  const obj = await env.CATALOG.get(R2_KEY);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers();
  // content-type desde httpMetadata (writeHttpMetadata no serializa bien en
  // tests con el bucket proxyado; lectura directa es equivalente).
  headers.set("content-type", obj.httpMetadata?.contentType ?? "image/png");
  headers.set("cache-control", "public, max-age=86400");
  headers.set("x-content-type-options", "nosniff");
  return new Response(obj.body, { headers });
}
