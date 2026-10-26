import {
  SERVER_URL,
  fetchPlayer,
  fetchProviders,
  loadSession,
  loginUrl,
  parseSignInFragment,
  saveSession,
  type Player,
  type ProviderId,
  type Session,
} from './auth';

const ERRORS: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  invalid_profile: 'The provider did not share your profile.',
};

/** The "Sign in" button in the top bar and the sign-in dialog with Yandex ID and VK ID. */
export class AccountView {
  private session: Session | null = loadSession();
  private player: Player | null = null;
  private readonly button: HTMLButtonElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly dialogs: { open(sel: string): void; close(): void },
  ) {
    this.button = this.$<HTMLButtonElement>('#account');
    if (!SERVER_URL) {
      this.button.hidden = true;
      return;
    }
    this.button.hidden = false;
    this.button.addEventListener('click', () => this.open());
    this.root.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((b) =>
      b.addEventListener('click', () => {
        // The server sends the player back here with the token in the URL fragment.
        const back = location.href.split('#')[0]!;
        location.assign(loginUrl(b.dataset.provider as ProviderId, back));
      }),
    );
    this.$('#sign-out').addEventListener('click', () => {
      this.signIn(null);
      this.dialogs.close();
    });

    const result = parseSignInFragment(location.hash);
    if (result) {
      history.replaceState(null, '', location.pathname + location.search);
      if ('session' in result) this.signIn(result.session);
      else this.open(ERRORS[result.error] ?? `Sign-in failed (${result.error}).`);
    }
    void this.refresh();
  }

  private signIn(session: Session | null): void {
    this.session = session;
    this.player = null;
    saveSession(session);
    this.render();
  }

  /** Loads the signed-in player's profile. */
  private async refresh(): Promise<void> {
    this.render();
    if (!this.session) return;
    try {
      this.player = await fetchPlayer(this.session);
      if (!this.player) this.signIn(null);
    } catch {
      // Server unreachable: keep the session and try again on the next visit.
    }
    this.render();
  }

  private open(message = ''): void {
    const signedIn = this.session !== null;
    this.$('#login-providers').hidden = signedIn;
    this.$('#login-account').hidden = !signedIn;
    this.$('#sign-out').hidden = !signedIn;
    this.$('#login-title').textContent = signedIn ? 'Your account' : 'Sign in';
    this.setMessage(message);
    this.dialogs.open('#login');
    if (!signedIn) void this.loadProviders(message);
  }

  /** Enables only the providers the server has configured. */
  private async loadProviders(message: string): Promise<void> {
    const buttons = this.root.querySelectorAll<HTMLButtonElement>('[data-provider]');
    buttons.forEach((b) => (b.disabled = true));
    try {
      const ids = new Set((await fetchProviders()).map((p) => p.id));
      buttons.forEach((b) => (b.disabled = !ids.has(b.dataset.provider as ProviderId)));
      if (ids.size === 0) this.setMessage('No sign-in providers are set up on the server.');
    } catch {
      this.setMessage(message || 'The game server is not reachable right now.');
    }
  }

  private setMessage(message: string): void {
    const el = this.$('#login-message');
    el.textContent = message;
    el.hidden = !message;
  }

  private render(): void {
    const p = this.player;
    const label = p?.name || (this.session ? 'Account' : 'Sign in');
    this.button.replaceChildren();
    if (p?.avatar) {
      const img = document.createElement('img');
      img.className = 'avatar';
      img.src = p.avatar;
      img.alt = '';
      this.button.append(img);
    }
    this.button.append(label);
    this.button.classList.toggle('signed-in', this.session !== null);

    this.$('#login-name').textContent = p?.name || 'Signed in';
    this.$('#login-via').textContent = p
      ? `via ${p.provider === 'VkId' ? 'VK ID' : 'Yandex ID'}${p.email ? ` · ${p.email}` : ''}`
      : '';
  }

  private $<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }
}
