/**
 * Resolves the canonical API base path.
 *
 * Requirements:
 * 1. Production builds (served by Express on Render or any production host) must always use
 *    same-origin relative '/api' paths to avoid Content Security Policy (connect-src 'self') blocks
 *    and cross-origin cookie restrictions. Never allow 'localhost' or '127.0.0.1' in production.
 * 2. In development (import.meta.env.DEV), use VITE_API_BASE_URL if explicitly provided,
 *    or fallback to relative '/api' (which Vite dev server proxies to http://localhost:5000).
 */
const resolveApiBase = () => {
  const envUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();

  // Production environment:
  if (import.meta.env.PROD) {
    // If VITE_API_BASE_URL was accidentally configured with localhost/127.0.0.1, ignore it.
    if (!envUrl || envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
      return '/api';
    }
    return envUrl.replace(/\/+$/, '');
  }

  // Development environment:
  // If explicitly configured with a custom URL, use it; otherwise use relative '/api'
  // which is proxied by Vite dev server to http://localhost:5000 seamlessly.
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }

  return '/api';
};

const API_BASE = resolveApiBase();

/**
 * Standard fetch wrapper sending credentials (HttpOnly cookies).
 */
export async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const defaultHeaders = {
    'Content-Type': 'application/json',
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
    credentials: 'include',
  };

  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export async function apiDownload(endpoint, fallbackFilename = 'download.xlsx') {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const error = new Error(errorData.message || `Export failed with status ${response.status}`);
    error.status = response.status;
    error.data = errorData;
    throw error;
  }

  // Extract filename from Content-Disposition header if present
  let filename = fallbackFilename;
  const disposition = response.headers.get('content-disposition');
  if (disposition && disposition.includes('filename=')) {
    const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(disposition);
    if (matches && matches[1]) {
      filename = matches[1].replace(/['"]/g, '').trim();
    }
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

export { API_BASE };
