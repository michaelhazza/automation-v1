import { randomUUID } from 'node:crypto';

export interface ICalEventInput {
  title: string;
  organiser: string;
  startsAt: Date;
  endsAt: Date;
  attendeeEmails: string[];
  uid?: string;
}

function fmtDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildICalEvent(input: ICalEventInput): string {
  const uid = input.uid ?? randomUUID();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Synthetos//AgentCalendar//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${fmtDate(input.startsAt)}`,
    `DTEND:${fmtDate(input.endsAt)}`,
    `SUMMARY:${input.title}`,
    `ORGANIZER:mailto:${input.organiser}`,
    ...input.attendeeEmails.map((e) => `ATTENDEE;RSVP=TRUE:mailto:${e}`),
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

export function buildICalReply(input: {
  uid: string;
  attendee: string;
  status: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE';
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Synthetos//AgentCalendar//EN',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `ATTENDEE;PARTSTAT=${input.status}:mailto:${input.attendee}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}
