import { getApiUrl, readUserConfig, writeUserConfig, clearAuth } from "../config/userConfig.js";

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function apiRequest(method, route, body, { auth = true, timeoutMs = 90_000 } = {}) {
  const headers = { "Content-Type": "application/json" };

  if (auth) {
    const { token } = readUserConfig();

    if (!token) {
      throw new ApiError("You are not logged in. Run `devvault login` first.", 401);
    }

    headers.Authorization = `Bearer ${token}`;
  }

  const url = `${getApiUrl()}${route}`;
  let response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new ApiError(
      `Could not reach the DevVault server at ${getApiUrl()} (${error.cause?.code || error.message}). ` +
        "Local commands still work offline.",
      0
    );
  }

  // The server hands out a fresh token while you keep using DevVault, so you stay signed in on this device.
  const renewed = response.headers.get("x-devvault-token");
  if (auth && renewed) writeUserConfig({ ...readUserConfig(), token: renewed });

  let data = null;
  try {
    data = await response.json();
  } catch {
    // non-JSON body
  }

  if (auth && response.status === 401 && data?.code === "SESSION_INVALID") {
    clearAuth();
    throw new ApiError("Your session has expired or was ended from another device. Please sign in again: devvault login", 401, "SESSION_EXPIRED");
  }

  if (!response.ok) {
    throw new ApiError(data?.error || `Server returned HTTP ${response.status}.`, response.status, data?.code);
  }

  return data;
}
