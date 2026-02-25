export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
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

// Active subaccount context — used by org users / system_admin to scope view to a subaccount
export function getActiveSubaccountId(): string | null {
  return localStorage.getItem('activeSubaccountId');
}

export function getActiveSubaccountName(): string | null {
  return localStorage.getItem('activeSubaccountName');
}

export function setActiveSubaccount(id: string, name: string): void {
  localStorage.setItem('activeSubaccountId', id);
  localStorage.setItem('activeSubaccountName', name);
}

export function removeActiveSubaccount(): void {
  localStorage.removeItem('activeSubaccountId');
  localStorage.removeItem('activeSubaccountName');
}
