import type { Env } from "../env";
import { Db } from "../db/client";
import { loadCatalog } from "../catalog/source";
import { fold } from "../tools/catalogQuery";

interface WaitRow {
  id: string;
  sku: string | null;
  product_name: string;
}

/**
 * Cron nocturno: cruza la lista de espera (stock_waitlist) contra el catálogo.
 * Para cada producto agotado que YA tiene stock, avisa al dueño cuántos
 * clientes lo estaban esperando y marca esas filas como avisadas.
 *
 * Solo avisa al dueño (no al cliente): un mensaje saliente automático al
 * cliente es una decisión que el dueño toma aparte.
 */
export async function checkStockWaitlist(env: Env): Promise<void> {
  const db = new Db(env.DB);
  let pending: WaitRow[];
  try {
    pending = await db.all<WaitRow>(
      "SELECT id, sku, product_name FROM stock_waitlist WHERE notified_at IS NULL",
    );
  } catch {
    return; // tabla nueva aún no migrada — no romper el cron
  }
  if (pending.length === 0) return;

  const catalog = await loadCatalog(env);
  const inStock = new Map<string, number>(); // nombre folded → stock
  const inStockSku = new Map<string, number>();
  for (const p of catalog) {
    if ((p.stock ?? 0) > 0) {
      inStock.set(fold(p.name), p.stock ?? 0);
      if (p.sku) inStockSku.set(p.sku.toLowerCase(), p.stock ?? 0);
    }
  }

  // Agrupa por producto los que ya tienen stock.
  const back = new Map<string, string[]>(); // product_name → [rowId]
  for (const row of pending) {
    const hit =
      (row.sku && inStockSku.has(row.sku.toLowerCase())) ||
      inStock.has(fold(row.product_name));
    if (hit) {
      const list = back.get(row.product_name) ?? [];
      list.push(row.id);
      back.set(row.product_name, list);
    }
  }
  if (back.size === 0) return;

  const now = Date.now();
  const ids = [...back.values()].flat();
  // Marca avisadas SOLO si hay canal para avisar al dueño; si no, se dejan para
  // la próxima corrida (cuando el dueño configure su Telegram).
  const chatId = env.OWNER_TELEGRAM_CHAT_ID;
  const token = env.TELEGRAM_BOT_TOKEN;

  if (chatId && token) {
    const lines = [...back.entries()].map(
      ([name, rows]) => `• ${name} — ${rows.length} cliente(s) esperando`,
    );
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `📦 Volvió stock de productos con lista de espera:\n\n${lines.join(
            "\n",
          )}\n\nEscribiles vos o desde el panel.`,
        }),
      });
    } catch (e) {
      console.error("[stockWaitlist] no pude avisar al dueño:", e);
      return; // no marcar: reintenta mañana
    }
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      await db.run(
        `UPDATE stock_waitlist SET notified_at = ? WHERE id IN (${batch.map(() => "?").join(",")})`,
        [now, ...batch],
      );
    }
  } else {
    console.warn(
      `[stockWaitlist] ${back.size} producto(s) volvieron con clientes esperando, pero no hay OWNER_TELEGRAM_CHAT_ID para avisar`,
    );
  }
}
