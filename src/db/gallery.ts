import { Db } from "./client";

// Índice de la Galería (superpoder). Los bytes viven en R2; esta tabla dice qué
// hay, de qué tipo, cómo se llama y CUÁNDO mandarlo.

export type GalleryKind = "image" | "video" | "audio";

export interface GalleryItemRow {
  id: string;
  kind: GalleryKind;
  label: string;
  trigger: string;
  r2_key: string;
  mime: string;
  size_bytes: number;
  source_url: string | null;
  created_at: number;
}

export interface CreateGalleryItemInput {
  /** id explícito (para que el r2_key <galeria/id> coincida). Autogenera si falta. */
  id?: string;
  kind: GalleryKind;
  label: string;
  trigger: string;
  r2Key: string;
  mime: string;
  sizeBytes: number;
  sourceUrl?: string;
}

const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "a", "al", "y", "o", "u",
  "que", "con", "por", "para", "en", "es", "son", "me", "te", "se", "lo", "le", "mi", "tu", "su",
  "como", "cómo", "cual", "cuál", "donde", "dónde", "cuanto", "cuánto", "hay", "tienen", "tienes",
  "quiero", "puedo", "puedes", "mandas", "manda", "ver", "foto", "fotos", "imagen", "video",
]);

function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-záéíóúñ0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export class GalleryRepo {
  constructor(private readonly db: Db) {}

  async create(input: CreateGalleryItemInput): Promise<string> {
    const id = input.id ?? crypto.randomUUID();
    await this.db.run(
      `INSERT INTO gallery_items (id, kind, label, trigger, r2_key, mime, size_bytes, source_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.kind,
        input.label,
        input.trigger ?? "",
        input.r2Key,
        input.mime,
        input.sizeBytes ?? 0,
        input.sourceUrl ?? null,
        Date.now(),
      ],
    );
    return id;
  }

  get(id: string): Promise<GalleryItemRow | null> {
    return this.db.first<GalleryItemRow>("SELECT * FROM gallery_items WHERE id = ?", [id]);
  }

  list(): Promise<GalleryItemRow[]> {
    return this.db.all<GalleryItemRow>("SELECT * FROM gallery_items ORDER BY created_at DESC");
  }

  async delete(id: string): Promise<boolean> {
    const r = await this.db.run("DELETE FROM gallery_items WHERE id = ?", [id]);
    return (r.meta.changes ?? 0) > 0;
  }

  /**
   * Mejor item para lo que pide el cliente: solape de palabras entre la query y
   * (label + trigger). null si ningún item comparte al menos una palabra.
   */
  async bestMatch(query: string): Promise<GalleryItemRow | null> {
    const q = new Set(tokens(query));
    if (q.size === 0) return null;
    let best: GalleryItemRow | null = null;
    let bestScore = 0;
    for (const item of await this.list()) {
      const hay = tokens(`${item.label} ${item.trigger}`);
      let score = 0;
      for (const w of hay) if (q.has(w)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return bestScore > 0 ? best : null;
  }
}
