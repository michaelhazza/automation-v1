export class HealthService {
  checkHealth() {
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }
}

export const healthService = new HealthService();
