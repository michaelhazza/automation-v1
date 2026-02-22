export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'system_admin' | 'org_admin' | 'manager' | 'user' | 'client_user';
  organisationId: string;
}

export function getToken(): string | null {
  return localStorage.getItem('token');
}

export function setToken(token: string): void {
  localStorage.setItem('token', token);
}

export function removeToken(): void {
  localStorage.removeItem('token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

// Store the user's role so the API interceptor can read it without importing React state
export function setUserRole(role: string): void {
  localStorage.setItem('userRole', role);
}

export function getUserRole(): string | null {
  return localStorage.getItem('userRole');
}

export function removeUserRole(): void {
  localStorage.removeItem('userRole');
}

// Active organisation context — used by system_admin to operate within a specific org
export function getActiveOrgId(): string | null {
  return localStorage.getItem('activeOrgId');
}

export function getActiveOrgName(): string | null {
  return localStorage.getItem('activeOrgName');
}

export function setActiveOrg(id: string, name: string): void {
  localStorage.setItem('activeOrgId', id);
  localStorage.setItem('activeOrgName', name);
}

export function removeActiveOrg(): void {
  localStorage.removeItem('activeOrgId');
  localStorage.removeItem('activeOrgName');
}
