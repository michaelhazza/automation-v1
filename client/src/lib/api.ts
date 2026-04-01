import axios from 'axios';

const api = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach JWT token and org context to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // For system_admin users, pass the selected active organisation so the backend
  // scopes data to that org rather than the system_admin's own (system) org.
  const userRole = localStorage.getItem('userRole');
  const activeOrgId = localStorage.getItem('activeOrgId');
  if (userRole === 'system_admin' && activeOrgId && !config.headers['X-Organisation-Id']) {
    config.headers['X-Organisation-Id'] = activeOrgId;
  }

  return config;
});

// Handle 401 responses globally
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('userRole');
      localStorage.removeItem('activeOrgId');
      localStorage.removeItem('activeOrgName');
      localStorage.removeItem('activeSubaccountId');
      localStorage.removeItem('activeSubaccountName');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
