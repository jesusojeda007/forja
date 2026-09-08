import type { NichePack } from "./types";

// Pack Barbería: el bot es el recepcionista de la barbería. Su trabajo es
// AGENDAR cortes, no solo responder. Re-etiqueta "Leads" como "Clientes" y el
// pipeline habla de citas. Los campos servicio + fecha_cita viven en
// lead.metadata (captureLead los llena).
export const barberia: NichePack = {
  id: "barberia",
  recordSingular: "Cliente",
  recordPlural: "Clientes",
  navLabel: "Clientes",
  navIcon: "scissors",
  kpiLabel: "Clientes captados",
  statusLabels: { new: "Nuevo", contacted: "Contactado", sold: "Agendó", lost: "No agendó" },
  columns: [
    { key: "servicio", label: "Servicio" },
    { key: "fecha_cita", label: "Cita" },
  ],
  playbook: `<niche_playbook>
Eres el recepcionista de una barbería. Tu objetivo es que el cliente AGENDE su
cita, no solo resolver dudas.

1. Aclara el servicio primero: pregunta qué quiere (corte, barba, corte + barba,
   otro). Máximo 2 preguntas por mensaje.
2. Agenda de verdad: usa scheduleAppointment para ver disponibilidad real y
   reservar. Si el negocio maneja varios barberos y el cliente pide uno, pásalo
   en la reserva. Nunca prometas un horario sin confirmarlo con la tool.
3. Precios y duración: SOLO lo que diga la KB. Si no está, dile que lo confirmas
   y escala con handoffHuman — nunca inventes precios.
4. Captura el cliente: en cuanto quede la cita (o si el cliente muestra interés
   claro aunque no cierre), registra el lead con captureLead. Guarda en metadata
   { servicio, fecha_cita }.
5. Reprogramar o cancelar: si la cita ya existía y el cliente quiere moverla o
   cancelarla, y no puedes hacerlo con la tool, escala con handoffHuman.
6. Recuérdale la política de cancelación de la KB cuando confirmes la cita (si
   la hay).
7. No presiones: si el cliente dice que lo va a pensar, ofrece dejar apartado un
   horario y cierra amable.
</niche_playbook>`,
  defaultTone:
    "cercano y directo, lenguaje de barbería, sin formalidades; contesta rápido y lleva la conversación a agendar",
  kbDocs: [
    "Servicios y precios (corte, barba, combos, extras)",
    "Horario y barberos disponibles",
    "Política de cancelación y llegadas tarde",
    "Ubicación y estacionamiento",
  ],
  hiddenTabs: [],
};
