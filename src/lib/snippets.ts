import type { Snippet } from './types';

const s = (id: string, category: string, title: string, lang: 'de' | 'en', body: string): Snippet => ({ id, category, title, lang, body });

/** Standard-Textbausteine für das FSM. Platzhalter: {{Name}} oder {{Name|Standard}} */
export const DEFAULT_SNIPPETS: Snippet[] = [
  s('std-arrival', 'Einsatz', 'Arrival / start of work', 'en',
    'Arrival on site at {{Uhrzeit}}. Safety briefing completed with {{Ansprechpartner}}. Machine {{Maschinennummer}} handed over for service in {{Zustand|stopped and locked out}} condition.'),
  s('std-maint', 'Wartung', 'Preventive maintenance carried out', 'en',
    'Preventive maintenance carried out on {{Maschine}} (machine no. {{Maschinennummer}}) according to the maintenance plan.\n- Visual inspection of all assemblies\n- Lubrication points serviced\n- Wear parts checked: {{Verschleissteile|no abnormalities}}\n- Safety devices tested: OK\n- Test run with product: OK'),
  s('std-repair', 'Reparatur', 'Fault found and repaired', 'en',
    'Fault: {{Fehlerbild}}\nCause: {{Ursache}}\nAction: {{Massnahme}}\nResult: Machine tested in production. Function OK.'),
  s('std-parts', 'Ersatzteile', 'Spare parts replaced', 'en',
    'Spare parts replaced:\n- {{Teil 1}} (part no. {{Teilenummer 1}}), qty {{Menge 1|1}}\nOld parts {{Altteile|disposed by customer}}.'),
  s('std-order', 'Ersatzteile', 'Spare parts to be ordered', 'en',
    'Spare parts required, not available on site:\n- {{Teil}} (part no. {{Teilenummer}}), qty {{Menge|1}}\nQuotation to be sent to customer. Follow-up visit required after delivery.'),
  s('std-followup', 'Abschluss', 'Follow-up visit required', 'en',
    'Work could not be completed during this visit. Reason: {{Grund}}.\nFollow-up visit required. Estimated time: {{Dauer}}. Customer informed.'),
  s('std-handover', 'Abschluss', 'Handover to customer', 'en',
    'Machine handed over to {{Ansprechpartner}} in operational condition at {{Uhrzeit}}. Work explained to the customer. Customer confirmed proper function.'),
  s('std-training', 'Schulung', 'Operator training', 'en',
    'Operator training carried out for {{Anzahl|2}} participants ({{Teilnehmer}}).\nTopics: {{Themen|operation, format change, cleaning, basic troubleshooting}}.\nDuration: {{Dauer}}.'),
  s('std-wait', 'Einsatz', 'Waiting time (customer side)', 'en',
    'Waiting time from {{Von}} to {{Bis}}. Reason: {{Grund|machine not available / in production}}. Waiting time is chargeable.'),
  s('std-remote', 'Remote', 'Remote support', 'en',
    'Remote support via {{Tool|VPN / Teleservice}} from {{Von}} to {{Bis}}.\nIssue: {{Fehlerbild}}\nAction: {{Massnahme}}\nResult: {{Ergebnis}}'),
  s('de-kurz', 'Einsatz', 'Kurzbericht (deutsch)', 'de',
    'Einsatz bei {{Kunde}}, {{Ort}} an Maschine {{Maschinennummer}}.\nFehlerbild: {{Fehlerbild}}\nUrsache: {{Ursache}}\nMaßnahme: {{Massnahme}}\nErgebnis: Maschine läuft, Funktion i.O.'),
];
