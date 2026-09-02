// Extractor de texto plano de un email crudo (RFC 822), sin dependencias.
// Cloudflare Email Workers entrega message.raw como stream MIME; las
// notificaciones bancarias que nos importan traen un cuerpo text/plain (a
// veces quoted-printable o base64, a veces dentro de un multipart). Esto
// cubre esos casos comunes; si el correo es raro, devolvemos el texto que se
// pueda y el parser bancario decide si alcanza.

interface Part {
  headers: Record<string, string>; // nombres en minúscula
  body: string;
}

/** Decodifica quoted-printable: =XX y los soft breaks "=\\r\\n". */
function decodeQuotedPrintable(input: string): string {
  const bytes: number[] = [];
  const normalized = input.replace(/=\r?\n/g, "");
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(normalized.slice(i + 1, i + 3))) {
      bytes.push(parseInt(normalized.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
  }
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(new Uint8Array(bytes));
}

function decodeBase64(b64: string): string {
  try {
    const clean = b64.replace(/\s+/g, "");
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
  } catch {
    return "";
  }
}

function decodeBody(body: string, cte: string | undefined): string {
  const enc = (cte ?? "").trim().toLowerCase();
  if (enc === "quoted-printable") return decodeQuotedPrintable(body);
  if (enc === "base64") return decodeBase64(body);
  return body;
}

/** Separa "Header: value\r\n..." del cuerpo en el primer línea vacía. */
function splitHeaders(block: string): { headers: Record<string, string>; body: string } {
  const sep = block.match(/\r?\n\r?\n/);
  if (!sep || sep.index === undefined) return { headers: {}, body: block };
  const headerBlock = block.slice(0, sep.index);
  const body = block.slice(sep.index + sep[0].length);
  const headers: Record<string, string> = {};
  // Los headers pueden doblarse (continuación con espacio/tab).
  for (const line of headerBlock.split(/\r?\n(?![ \t])/)) {
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/s);
    if (m) headers[m[1].toLowerCase()] = m[2].replace(/\r?\n[ \t]/g, " ").trim();
  }
  return { headers, body };
}

function boundaryOf(contentType: string | undefined): string | null {
  const m = contentType?.match(/boundary="?([^";]+)"?/i);
  return m ? m[1] : null;
}

function pickPart(raw: string): string {
  const { headers, body } = splitHeaders(raw);
  const cte = headers["content-transfer-encoding"];
  const contentType = headers["content-type"];

  const boundary = boundaryOf(contentType);
  if (boundary) {
    // Recorre los hijos del multipart; primero text/plain, si no text/html.
    const parts = body.split(`--${boundary}`);
    const candidates: Part[] = [];
    for (const p of parts) {
      if (!p || p.trim() === "--") continue;
      candidates.push(splitHeaders(p));
    }
    const plain = candidates.find((c) => (c.headers["content-type"] ?? "").includes("text/plain"));
    if (plain) return decodeBody(plain.body, plain.headers["content-transfer-encoding"]);
    const html = candidates.find((c) => (c.headers["content-type"] ?? "").includes("text/html"));
    if (html) return htmlToText(decodeBody(html.body, html.headers["content-transfer-encoding"]));
    // multipart anidado u otra cosa: reintenta por dentro.
    for (const c of candidates) {
      const nested = pickPart(`${Object.entries(c.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n${c.body}`);
      if (nested.trim()) return nested;
    }
    return "";
  }

  const decoded = decodeBody(body, cte);
  if ((contentType ?? "").includes("text/html")) return htmlToText(decoded);
  return decoded;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&(aacute|eacute|iacute|oacute|uacute|ntilde);/g, (_m, c) => {
      const map: Record<string, string> = { aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ" };
      return map[c] ?? c;
    })
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Decodifica words MIME del subject: =?UTF-8?B?...?= / =?UTF-8?Q?...?= */
export function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_all, _cs, enc, data) => {
    if (enc.toLowerCase() === "b") return decodeBase64(data);
    return decodeQuotedPrintable(String(data).replace(/_/g, " "));
  });
}

/** Texto plano "útil" desde el email crudo completo (headers + cuerpo). */
export function extractEmailText(raw: string): string {
  return pickPart(raw);
}
