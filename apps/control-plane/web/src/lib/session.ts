import type { UserView } from "../types";

const ACCESS_KEY = "cp.accessToken";
const REFRESH_KEY = "cp.refreshToken";
const USER_KEY = "cp.user";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: UserView;
}

export function loadSession(): StoredSession | null {
  const accessToken = localStorage.getItem(ACCESS_KEY);
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  const rawUser = localStorage.getItem(USER_KEY);
  if (!accessToken || !refreshToken || !rawUser) {
    return null;
  }
  try {
    return { accessToken, refreshToken, user: JSON.parse(rawUser) as UserView };
  } catch (error) {
    // A hand-edited or partially written entry must not block the console from
    // booting; drop it and fall back to the sign-in screen.
    console.error("stored admin session is unreadable", error);
    clearSession();
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(ACCESS_KEY, session.accessToken);
  localStorage.setItem(REFRESH_KEY, session.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

export function updateStoredUser(user: UserView): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
