import axios from 'axios';
import { connectionTokenService } from '../services/connectionTokenService.js';
import type { IntegrationAdapter } from './integrationAdapter.js';
import type { IntegrationConnection } from '../db/schema/integrationConnections.js';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const TIMEOUT_MS = 12_000;

export const ghlAdapter: IntegrationAdapter = {
  supportedActions: ['create_contact', 'tag_contact', 'create_opportunity'],

  crm: {
    async createContact(connection: IntegrationConnection, fields: Record<string, unknown>) {
      try {
        if (!connection.accessToken) {
          return { contactId: '', success: false, error: 'Connection has no access token' };
        }

        const accessToken = connectionTokenService.decryptToken(connection.accessToken);
        const config = connection.configJson as Record<string, unknown> | null;
        const locationId = config?.locationId as string | undefined;

        if (!locationId) {
          return { contactId: '', success: false, error: 'No locationId in connection config' };
        }

        // Split name into firstName / lastName
        const name = fields.name as string | undefined;
        let firstName: string | undefined;
        let lastName: string | undefined;
        if (name) {
          const parts = name.trim().split(/\s+/);
          firstName = parts[0];
          lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
        }

        const body: Record<string, unknown> = {
          locationId,
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(fields.email && { email: fields.email }),
          ...(fields.phone && { phone: fields.phone }),
          ...(fields.tags && { tags: fields.tags }),
        };

        // Pipeline stage mapping
        if (fields.pipelineStage) {
          const stage = fields.pipelineStage as { pipelineId?: string; stageId?: string };
          if (stage.pipelineId && stage.stageId) {
            body.pipelineStage = stage;
          }
        }

        const response = await axios.post(`${GHL_API_BASE}/contacts/`, body, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
          },
          timeout: TIMEOUT_MS,
        });

        const contactId = (response.data as { contact?: { id?: string } })?.contact?.id ?? '';
        return { contactId, success: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { contactId: '', success: false, error: `GHL createContact failed: ${message}` };
      }
    },
  },
};
