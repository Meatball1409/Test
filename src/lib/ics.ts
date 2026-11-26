import { addDays } from './dates';
import type { CalendarEvent } from './types';
import { EVENT_TYPES } from './types';

const escapeIcs = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const unescapeIcs = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
const d = (iso: string) => iso.replace(/-/g, '');
const dt = (iso: string, t: string) => `${d(iso)}T${t.replace(':', '')}00`;

/** RFC 5545 Export – importierbar in Outlook, Google Kalender, Apple Kalender */
export function toIcs(events: CalendarEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TechDesk//DE', 'CALSCALE:GREGORIAN'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@techdesk`, `DTSTAMP:${stamp}`);
    if (e.startTime && e.endTime) {
      lines.push(`DTSTART:${dt(e.startDate, e.startTime)}`, `DTEND:${dt(e.endDate, e.endTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d(e.startDate)}`, `DTEND;VALUE=DATE:${d(addDays(e.endDate, 1))}`);
    }
    lines.push(`SUMMARY:${escapeIcs(e.title)}`, `CATEGORIES:${escapeIcs(EVENT_TYPES[e.type].label)}`);
    const desc = [e.customer && `Kunde: ${e.customer}`, e.machine && `Maschine: ${e.machine}`, e.notes].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${escapeIcs(desc)}`);
    if (e.location) lines.push(`LOCATION:${escapeIcs(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n');
}

function fold(line: string): string {
  if (line.length <= 74) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 73) parts.push((i ? ' ' : '') + line.slice(i, i + 73));
  return parts.join('\r\n');
}

/** Einfacher Import von VEVENTs (z. B. Export aus Outlook/FSM) */
export function fromIcs(text: string, newId: () => string): CalendarEvent[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const out: CalendarEvent[] = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const get = (k: string) => block.match(new RegExp(`^${k}(;[^:\\n]*)?:(.*)$`, 'm'));
    const s = get('DTSTART'), e = get('DTEND');
    if (!s) continue;
    const parse = (raw: string) => {
      const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
      if (!m) return null;
      return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : undefined };
    };
    const start = parse(s[2]);
    if (!start) continue;
    let end = e ? parse(e[2]) : start;
    if (!end) end = start;
    let endDate = end.date;
    if (!start.time && endDate > start.date) endDate = addDays(endDate, -1);
    out.push({
      id: newId(), type: 'einsatz', title: unescapeIcs(get('SUMMARY')?.[2]?.trim() ?? 'Termin'),
      startDate: start.date, endDate, startTime: start.time, endTime: end.time,
      location: get('LOCATION') ? unescapeIcs(get('LOCATION')![2].trim()) : undefined,
      notes: get('DESCRIPTION') ? unescapeIcs(get('DESCRIPTION')![2].trim()) : undefined,
    });
  }
  return out;
}
