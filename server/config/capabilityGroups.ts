export interface CapabilityGroup {
  id: 'email' | 'calendar' | 'files' | 'team_chat';
  title: string;
  description: string;
  capabilitySlugs: string[];
}

export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  {
    id: 'email',
    title: 'Email',
    description: "Send and read email on the owner's behalf.",
    capabilitySlugs: ['inbox_read', 'send_email'],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'Read availability and create or update calendar events with approval.',
    capabilitySlugs: [
      'calendar_read',
      'calendar_event_create',
      'calendar_event_update',
      'calendar_event_respond',
    ],
  },
  {
    id: 'files',
    title: 'Files',
    description: "Read files from the owner's document storage.",
    capabilitySlugs: ['drive_read'],
  },
  {
    id: 'team_chat',
    title: 'Team chat',
    description: 'Read and post Slack messages with approval.',
    capabilitySlugs: [
      'channel_messages_read',
      'channel_post_message',
      'channel_search_messages',
      'dm_send',
    ],
  },
];
