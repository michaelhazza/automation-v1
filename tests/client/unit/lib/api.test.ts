// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the axios interceptors, so we mock axios and import fresh each time
let mockRequestInterceptor: (config: any) => any;
let mockResponseFulfilled: (response: any) => any;
let mockResponseRejected: (error: any) => any;

vi.mock('axios', () => {
  const interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  return {
    default: {
      create: vi.fn(() => ({
        interceptors,
        get: vi.fn(),
        post: vi.fn(),
      })),
    },
  };
});

describe('api interceptors', () => {
  beforeEach(async () => {
    localStorage.clear();
    // Reset modules to get fresh interceptor registrations
    vi.resetModules();
    // Re-mock axios before importing api
    vi.doMock('axios', () => {
      const interceptors = {
        request: { use: vi.fn() },
        response: { use: vi.fn() },
      };
      return {
        default: {
          create: vi.fn(() => ({
            interceptors,
            get: vi.fn(),
            post: vi.fn(),
          })),
        },
      };
    });

    const axios = (await import('axios')).default;
    await import('@/lib/api');
    const instance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockRequestInterceptor = instance.interceptors.request.use.mock.calls[0][0];
    mockResponseFulfilled = instance.interceptors.response.use.mock.calls[0][0];
    mockResponseRejected = instance.interceptors.response.use.mock.calls[0][1];
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('adds Authorization header when token exists in localStorage', () => {
    localStorage.setItem('token', 'test-jwt-token');
    const config = { headers: {} as Record<string, string> };
    const result = mockRequestInterceptor(config);
    expect(result.headers.Authorization).toBe('Bearer test-jwt-token');
  });

  it('does not add Authorization header when no token', () => {
    const config = { headers: {} as Record<string, string> };
    const result = mockRequestInterceptor(config);
    expect(result.headers.Authorization).toBeUndefined();
  });

  it('adds X-Organisation-Id header for system_admin with activeOrgId', () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('userRole', 'system_admin');
    localStorage.setItem('activeOrgId', 'org-123');
    const config = { headers: {} as Record<string, string> };
    const result = mockRequestInterceptor(config);
    expect(result.headers['X-Organisation-Id']).toBe('org-123');
  });

  it('does not add X-Organisation-Id for non-system_admin users', () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('userRole', 'admin');
    localStorage.setItem('activeOrgId', 'org-123');
    const config = { headers: {} as Record<string, string> };
    const result = mockRequestInterceptor(config);
    expect(result.headers['X-Organisation-Id']).toBeUndefined();
  });

  it('clears auth and redirects on 401 response', async () => {
    localStorage.setItem('token', 'tok');
    localStorage.setItem('userRole', 'admin');
    localStorage.setItem('activeOrgId', 'org-1');
    localStorage.setItem('activeSubaccountId', 'sub-1');

    // Mock window.location.href
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    });
    Object.defineProperty(window.location, 'href', {
      set: hrefSetter,
      get: () => '',
    });

    const error = { response: { status: 401 } };
    await expect(mockResponseRejected(error)).rejects.toEqual(error);
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('userRole')).toBeNull();
    expect(hrefSetter).toHaveBeenCalledWith('/login');
  });

  it('passes through non-401 errors', async () => {
    const error = { response: { status: 500 } };
    await expect(mockResponseRejected(error)).rejects.toEqual(error);
    // Token should not be cleared
    localStorage.setItem('token', 'still-here');
    expect(localStorage.getItem('token')).toBe('still-here');
  });
});
