const TOKEN_KEY = "devvault.token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiError extends Error {
  constructor(message, status, code, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Cannot reach the DevVault server.", 0);
  }

  const renewed = response.headers.get("x-devvault-token");
  if (renewed && token) setToken(renewed);

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && token && data.code === "SESSION_INVALID") {
      clearToken();
      window.dispatchEvent(new Event("devvault:logout"));
    }
    throw new ApiError(data.error || `Request failed (${response.status})`, response.status, data.code, data);
  }

  return data;
}
