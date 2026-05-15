import type { SkillExecutionContext, SkillHandler } from '../context.js';
import { resolveAgentOwner } from './userOwnedAgentOwner.js';

export const calendarHandlers: Record<string, SkillHandler> = {
  'calendar.list_events': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('../../calendar/calendarActionService.js');
    return calendarActionService.listEvents(
      input as import('../../../../shared/types/calendarAction.js').CalendarListEventsInput,
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'calendar.get_event': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('../../calendar/calendarActionService.js');
    return calendarActionService.getEvent(
      input as import('../../../../shared/types/calendarAction.js').CalendarGetEventInput,
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'calendar.find_free_slot': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('../../calendar/calendarActionService.js');
    return calendarActionService.findFreeSlot(
      input as import('../../../../shared/types/calendarAction.js').CalendarFindFreeSlotInput,
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'calendar.create_event': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('../../calendar/calendarActionService.js');
    const { eaDraftId, ...rest } = input;
    if (!eaDraftId) throw Object.assign(new Error('calendar.create_event requires eaDraftId'), { statusCode: 400, errorCode: 'MISSING_DRAFT_ID' });
    return calendarActionService.createEvent(
      { ...(rest as import('../../../../shared/types/calendarAction.js').CalendarCreateEventInput), eaDraftId: eaDraftId as string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'calendar.update_event': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('../../calendar/calendarActionService.js');
    const { eaDraftId, etag, ...rest } = input;
    if (!eaDraftId) throw Object.assign(new Error('calendar.update_event requires eaDraftId'), { statusCode: 400, errorCode: 'MISSING_DRAFT_ID' });
    return calendarActionService.updateEvent(
      { ...(rest as import('../../../../shared/types/calendarAction.js').CalendarUpdateEventInput), eaDraftId: eaDraftId as string, etag: etag as string | undefined },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },

  'calendar.respond_to_invite': async (input: Record<string, unknown>, context: SkillExecutionContext) => {
    const ownerUserId = await resolveAgentOwner(context);
    const { calendarActionService } = await import('../../calendar/calendarActionService.js');
    const { eaDraftId, ownerEmail, ...rest } = input;
    if (!eaDraftId) throw Object.assign(new Error('calendar.respond_to_invite requires eaDraftId'), { statusCode: 400, errorCode: 'MISSING_DRAFT_ID' });
    if (!ownerEmail) throw Object.assign(new Error('calendar.respond_to_invite requires ownerEmail'), { statusCode: 400, errorCode: 'MISSING_OWNER_EMAIL' });
    return calendarActionService.respondToInvite(
      { ...(rest as import('../../../../shared/types/calendarAction.js').CalendarRespondToInviteInput), eaDraftId: eaDraftId as string, ownerEmail: ownerEmail as string },
      { organisationId: context.organisationId, subaccountId: context.subaccountId ?? '', ownerUserId },
    );
  },
};
