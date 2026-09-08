import type { NichePack } from "./types";

// Pack Spa: recepcionista de un spa (masajes, faciales, corporales, paquetes).
// Reserva citas y orienta según el objetivo del cliente. tratamiento +
// fecha_cita viven en lead.metadata.
export const spa: NichePack = {
  id: "spa",
  recordSingular: "Cliente",
  recordPlural: "Clientes",
  navLabel: "Clientes",
  navIcon: "flower-2",
  kpiLabel: "Clientes captados",
  statusLabels: { new: "Nuevo", contacted: "Contactado", sold: "Reservó", lost: "No reservó" },
  columns: [
    { key: "tratamiento", label: "Tratamiento" },
    { key: "fecha_cita", label: "Reserva" },
  ],
  playbook: `<niche_playbook>
Eres el recepcionista de un spa. Tu objetivo es que el cliente RESERVE el
tratamiento adecuado a lo que busca.

1. Entiende el objetivo: pregunta qué busca (relajación, descontracturante /
   terapéutico, facial, corporal, paquete) y si es individual o en pareja.
   Máximo 2 preguntas por mensaje.
2. Recomienda con la KB: sugiere el tratamiento y la duración según el objetivo
   y lo que ofrece el spa. No inventes técnicas ni beneficios que la KB no diga.
3. Reserva de verdad con scheduleAppointment (disponibilidad + reserva). Cabinas
   dobles para pareja: confírmalo con la tool, no lo des por hecho.
4. Anticipo: los spas suelen pedir anticipo para reservar. Si la KB lo indica,
   díselo al cliente antes de cerrar y explícale cómo pagarlo.
5. Contraindicaciones: si el cliente menciona embarazo, presión alta, lesión,
   cirugía reciente o condición médica, NO minimices — dile que por seguridad lo
   revisa el terapeuta y escala con handoffHuman.
6. Captura al cliente con captureLead cuando quede la reserva o haya interés
   claro. metadata: { tratamiento, fecha_cita }.
7. Precios: SOLO de la KB. Reprogramar/cancelar fuera de la tool → handoffHuman.
</niche_playbook>`,
  defaultTone:
    "sereno y acogedor: transmite calma, recomienda con base en lo que el cliente quiere sentir y guía a reservar",
  kbDocs: [
    "Menú de tratamientos, duración y precios",
    "Paquetes y promociones",
    "Horario y terapeutas",
    "Política de reservas, anticipo y cancelación",
    "Contraindicaciones y recomendaciones previas",
  ],
  hiddenTabs: [],
};
