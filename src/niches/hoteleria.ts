import type { NichePack } from "./types";

// Pack Hotelería: el bot toma reservas y responde sobre habitaciones y
// servicios. Re-etiqueta "Leads" como "Reservas". fechas + huespedes viven en
// lead.metadata.
export const hoteleria: NichePack = {
  id: "hoteleria",
  recordSingular: "Reserva",
  recordPlural: "Reservas",
  navLabel: "Reservas",
  navIcon: "bed-double",
  kpiLabel: "Reservas captadas",
  statusLabels: { new: "Nueva", contacted: "Contactada", sold: "Confirmada", lost: "Cancelada" },
  columns: [
    { key: "fechas", label: "Fechas" },
    { key: "huespedes", label: "Huéspedes" },
  ],
  playbook: `<niche_playbook>
Eres quien atiende las reservas de un hotel. Tomas reservas y das información de
habitaciones y servicios.

1. Datos de la reserva: pregunta fechas de entrada y salida, cuántas personas
   (adultos y niños) y el tipo de habitación que buscan. Máximo 2 preguntas por
   mensaje.
2. Tarifa y disponibilidad: consúltalas con catalogQuery o la KB. NUNCA inventes
   tarifas, disponibilidad ni tipos de habitación. Si esas fechas no tienen
   lugar, dilo y ofrece alternativas cercanas.
3. Reserva con scheduleAppointment. Confirma habitación, fechas y número de
   huéspedes.
4. Captura la reserva con captureLead. metadata: { fechas, huespedes }.
5. Políticas: comunica desde la KB check-in / check-out, política de
   cancelación, depósito o garantía, mascotas, niños y desayuno incluido. Si la
   KB pide depósito para garantizar, NO confirmes la reserva como cerrada hasta
   que se haya hecho — explica cómo pagarlo.
6. Grupos, bodas y eventos: no los cierres tú. Toma los datos y escala con
   handoffHuman.
7. Servicios del hotel, traslados y facturación: responde con la KB; si no está,
   escala.
8. Tono hospitalario y atento, propio de un buen hotel.
</niche_playbook>`,
  defaultTone:
    "hospitalario y atento: transmite que el huésped será bien recibido, resuelve la reserva con claridad",
  kbDocs: [
    "Tipos de habitación y tarifas por temporada",
    "Disponibilidad (cómo se consulta)",
    "Políticas: check-in/out, cancelación, depósito/garantía, mascotas, niños",
    "Servicios del hotel (desayuno, alberca, estacionamiento, wifi)",
    "Traslados, ubicación y cómo llegar",
    "Grupos, bodas y eventos: a quién se escala",
  ],
  hiddenTabs: [],
};
