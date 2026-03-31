import { getWebSocketStats } from '../websocket/emitters.js';

export class HealthService {
  checkHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      websocket: getWebSocketStats(),
    };
  }
}

export const healthService = new HealthService();
