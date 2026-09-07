export type ChannelId =
  | "manychat"
  | "telegram"
  | "twilio"
  | "messenger"
  | "instagram"
  | "whatsapp"
  | "zernio";

export interface IncomingMessage {
  channel: ChannelId;
  channelUserId: string;
  displayName?: string;
  text?: string;
  audioUrl?: string;
  imageUrl?: string;
  isOwnerMessage?: boolean;
  receivedAt: number;
  rawPayload: unknown;
}

export interface OutgoingReply {
  channel: ChannelId;
  channelUserId: string;
  chunks: string[];
  interChunkDelayMs?: number;
}

export interface ChannelAdapter {
  parseIncoming(request: Request, env: any): Promise<IncomingMessage>;
  sendReply(reply: OutgoingReply, env: any): Promise<void>;
  showTyping?(channelUserId: string, env: any): Promise<void>;
  /**
   * Envía una imagen (con caption opcional) por el canal. Opcional: si un
   * canal no lo implementa, sendPaymentQr cae al fallback de devolver la URL
   * como texto. Los canales que exigen URL pública (WhatsApp/Meta) requieren
   * que `url` sea alcanzable desde internet — el QR se sirve desde el Worker.
   */
  sendImage?(req: { channel: ChannelId; channelUserId: string; url: string; caption?: string }, env: any): Promise<void>;
}
