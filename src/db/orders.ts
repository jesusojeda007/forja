import { Db } from "./client";

export type OrderStatus =
  | "pendiente"
  | "reservado"
  | "pagado"
  | "enviado"
  | "entregado"
  | "cancelado";

export type DeliveryZone = "incluido" | "cliente_paga" | "interior";

export interface OrderItem {
  name: string;
  sku?: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  code: string;
  conversation_id: string | null;
  lead_id: string | null;
  items_json: string;
  total: number;
  currency: string;
  customer_name: string | null;
  contact: string | null;
  city: string | null;
  address: string | null;
  delivery_zone: DeliveryZone | null;
  map_url: string | null;
  status: OrderStatus;
  reserved_until: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateOrderInput {
  conversationId: string | null;
  leadId?: string | null;
  items: OrderItem[];
  total: number;
  currency?: string;
  customerName?: string;
  contact?: string;
  city?: string;
  address?: string;
  deliveryZone?: DeliveryZone;
  mapUrl?: string;
  status?: OrderStatus;
  reservedUntil?: number | null;
  notes?: string;
}

export function orderItems(o: Pick<Order, "items_json">): OrderItem[] {
  try {
    const v = JSON.parse(o.items_json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Pedidos de la tienda. El bot los registra al cerrar la venta; nunca confirma
 * el pago (eso lo hace el dueño en el panel, o la conciliación por correo del
 * banco). El `code` es el número corto que el cliente puede citar después.
 */
export class OrdersRepo {
  constructor(private readonly db: Db) {}

  private async nextCode(): Promise<string> {
    const row = await this.db.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM orders",
    );
    return `TS-${String((row?.n ?? 0) + 1).padStart(4, "0")}`;
  }

  async create(input: CreateOrderInput): Promise<{ id: string; code: string }> {
    const id = crypto.randomUUID();
    const code = await this.nextCode();
    const now = Date.now();
    await this.db.run(
      `INSERT INTO orders
        (id, code, conversation_id, lead_id, items_json, total, currency,
         customer_name, contact, city, address, delivery_zone, map_url,
         status, reserved_until, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        code,
        input.conversationId,
        input.leadId ?? null,
        JSON.stringify(input.items ?? []),
        input.total,
        input.currency ?? "BOB",
        input.customerName ?? null,
        input.contact ?? null,
        input.city ?? null,
        input.address ?? null,
        input.deliveryZone ?? null,
        input.mapUrl ?? null,
        input.status ?? "pendiente",
        input.reservedUntil ?? null,
        input.notes ?? null,
        now,
        now,
      ],
    );
    return { id, code };
  }

  async list(limit = 100): Promise<Order[]> {
    return this.db.all<Order>(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT ?",
      [limit],
    );
  }

  async byStatus(status: OrderStatus, limit = 100): Promise<Order[]> {
    return this.db.all<Order>(
      "SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?",
      [status, limit],
    );
  }

  async byCode(code: string): Promise<Order | null> {
    return this.db.first<Order>(
      "SELECT * FROM orders WHERE code = ? COLLATE NOCASE",
      [code.trim()],
    );
  }

  async latestByConversation(conversationId: string): Promise<Order | null> {
    return this.db.first<Order>(
      "SELECT * FROM orders WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1",
      [conversationId],
    );
  }

  async latestByContact(contact: string): Promise<Order | null> {
    const c = contact.replace(/\D/g, "");
    if (c.length < 6) return null;
    return this.db.first<Order>(
      "SELECT * FROM orders WHERE REPLACE(REPLACE(REPLACE(contact,' ',''),'-',''),'+','') LIKE ? ORDER BY created_at DESC LIMIT 1",
      [`%${c}%`],
    );
  }

  async setStatus(id: string, status: OrderStatus): Promise<void> {
    await this.db.run(
      "UPDATE orders SET status = ?, updated_at = ? WHERE id = ?",
      [status, Date.now(), id],
    );
  }

  async count(): Promise<number> {
    const row = await this.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM orders");
    return row?.n ?? 0;
  }
}
