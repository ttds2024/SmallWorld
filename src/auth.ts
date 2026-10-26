// Sign-in with Yandex ID or VK ID through the GameServer (see GameServer/README.md).

const SESSION_KEY = 'smallrealm.session';

/** GameServer base URL, from VITE_GAME_SERVER_URL; empty when sign-in is not available. */
export const SERVER_URL: string = (
  import.meta.env.VITE_GAME_SERVER_URL ?? (import.meta.env.DEV ? 'https://localhost:7002' : '')
).replace(/\/+$/, '');

export type ProviderId = 'Yandex' | 'VkId';

export interface Provider {
  id: ProviderId;
  displayName: string;
}

export interface Player {
  id: string;
  provider: string;
  name: string | null;
  email: string | null;
  avatar: string | null;
}

export interface Session {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** What the server put in the URL fragment after sign-in, if anything. */
export type SignInResult = { session: Session } | { error: string } | null;

export function parseSignInFragment(hash: string, now = Date.now()): SignInResult {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const error = params.get('error');
  if (error) return { error };
  const token = params.get('access_token');
  if (!token) return null;
  const expiresIn = Number(params.get('expires_in'));
  return {
    session: {
      token,
      expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 0),
    },
  };
}

export function loginUrl(provider: ProviderId, returnUrl: string): string {
  return `${SERVER_URL}/auth/login/${provider}?returnUrl=${encodeURIComponent(returnUrl)}`;
}

export function loadSession(now = Date.now()): Session | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
    return session && typeof session.token === 'string' && session.expiresAt > now ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage unavailable (private mode): the session lasts until the page closes.
  }
}

export async function fetchProviders(): Promise<Provider[]> {
  const response = await fetch(`${SERVER_URL}/auth/providers`);
  if (!response.ok) throw new Error(`GameServer answered ${response.status}`);
  return (await response.json()) as Provider[];
}

/** The signed-in player, or null when the token is no longer accepted. */
export async function fetchPlayer(session: Session): Promise<Player | null> {
  const response = await fetch(`${SERVER_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`GameServer answered ${response.status}`);
  return (await response.json()) as Player;
}
