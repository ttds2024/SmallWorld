interface ImportMetaEnv {
  /** GameServer base URL for Yandex ID / VK ID sign-in, e.g. https://api.example.com */
  readonly VITE_GAME_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
