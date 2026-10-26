import { describe, expect, it } from 'vitest';
import { loginUrl, parseSignInFragment, SERVER_URL } from './auth';

describe('parseSignInFragment', () => {
  it('reads the token the server sends back', () => {
    expect(
      parseSignInFragment('#access_token=abc.def&token_type=Bearer&expires_in=60', 1000),
    ).toEqual({ session: { token: 'abc.def', expiresAt: 61000 } });
  });

  it('reads a sign-in error', () => {
    expect(parseSignInFragment('#error=access_denied')).toEqual({ error: 'access_denied' });
  });

  it('ignores unrelated fragments', () => {
    expect(parseSignInFragment('')).toBeNull();
    expect(parseSignInFragment('#rules')).toBeNull();
  });
});

describe('loginUrl', () => {
  it('points at the provider and escapes the return URL', () => {
    expect(loginUrl('VkId', 'http://localhost:5173/?a=1')).toBe(
      `${SERVER_URL}/auth/login/VkId?returnUrl=http%3A%2F%2Flocalhost%3A5173%2F%3Fa%3D1`,
    );
  });
});
