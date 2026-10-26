# GameServer

ASP.NET Core (.NET 7) API for Small Realm.

```sh
dotnet run --project GameServer --launch-profile https
```

## Sign-in with Yandex ID and VK ID

Players sign in with **Yandex ID** or **VK ID**; the server then issues its own JWT, which the game
client sends to the API as `Authorization: Bearer <token>`.

| Endpoint | |
| --- | --- |
| `GET /auth/providers` | the configured providers (`Yandex`, `VkId`) |
| `GET /auth/login/{provider}?returnUrl=<game url>` | open in the browser to start sign-in |
| `GET /auth/me` | the signed-in player (requires the bearer token) |

Flow: the client navigates to `/auth/login/VkId?returnUrl=https://ttds2024.github.io/SmallWorld/`, the
player confirms on the provider's page, and the server redirects back to
`returnUrl#access_token=...&token_type=Bearer&expires_in=...` (or `returnUrl#error=...` if the player
cancelled). The client reads the token from `location.hash` and clears it. `returnUrl` must be on
one of `Auth:AllowedOrigins`, which are also the CORS origins.

The player id (`sub`) is `yandex:<id>` or `vkid:<id>`. Profiles are not stored yet.

### Configuration

Keep secrets out of `appsettings.json`: use user secrets locally and environment variables
(`Jwt__SigningKey`, `Authentication__VkId__ClientId`, ...) in production.

```sh
cd GameServer
dotnet user-secrets set "Jwt:SigningKey" "<random string, 32+ characters>"
dotnet user-secrets set "Authentication:Yandex:ClientId" "<ClientID>"
dotnet user-secrets set "Authentication:Yandex:ClientSecret" "<Client secret>"
dotnet user-secrets set "Authentication:VkId:ClientId" "<app ID>"
```

A provider is enabled only when its `ClientId` is set. In Development a throwaway signing key is
provided by `appsettings.Development.json`.

- **Yandex ID**: create an app at <https://oauth.yandex.ru/client/new> (platform "Web services") with
  the Redirect URI `https://<server>/auth/callback/yandex` and access to the login, e-mail and avatar.
- **VK ID**: create a web app at <https://id.vk.com/about/business/go>, add the server's domain and
  the redirect URL `https://<server>/auth/callback/vkid`. VK ID is a public PKCE client, so only the
  app ID is needed (`ClientSecret` is optional and not sent).

Run over HTTPS (the `https` launch profile): the OAuth correlation cookies are `Secure`.

### Trying it with the game

Run the server with `--launch-profile https` (trust the dev certificate once with
`dotnet dev-certs https --trust`), then `npm run dev` in the repository root. The game's
**Sign in** button in the top bar opens the Yandex ID / VK ID dialog.

## Deploying

The **Deploy GameServer** workflow runs on every push to `main` that touches `GameServer/` (or by
hand from the Actions tab). It builds the Docker image (`GameServer/Dockerfile`) and publishes it as
`ghcr.io/ttds2024/smallworld-gameserver`. When a server is configured, it then starts it there with
[`deploy/docker-compose.yml`](deploy/docker-compose.yml): the GameServer behind
[Caddy](https://caddyserver.com), which gets the HTTPS certificate automatically.

### One-time setup

1. **A server**: any Linux VPS with Docker and the compose plugin
   (`curl -fsSL https://get.docker.com | sh`), ports 80 and 443 open, and an SSH user that can run
   `docker`.
2. **A domain**: point a DNS A record (e.g. `api.example.com`) at the server.
3. **Repository settings → Secrets and variables → Actions**:

   | Name | Kind | Value |
   | --- | --- | --- |
   | `GAME_SERVER_DOMAIN` | variable | `api.example.com` |
   | `DEPLOY_HOST` | secret | the server's address |
   | `DEPLOY_USER` | secret | the SSH user |
   | `DEPLOY_SSH_KEY` | secret | a private key whose public half is in that user's `~/.ssh/authorized_keys` |
   | `JWT_SIGNING_KEY` | secret | a random string, 32+ characters (`openssl rand -base64 48`) |
   | `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` | secrets | from the Yandex OAuth app |
   | `VKID_CLIENT_ID` | secret | the VK ID app ID |

4. Register `https://<domain>/auth/callback/yandex` and `https://<domain>/auth/callback/vkid` in the
   Yandex and VK ID apps, with `https://ttds2024.github.io` as the site.
5. Run **Deploy GameServer**, then **Deploy to GitHub Pages**: with `GAME_SERVER_DOMAIN` set, the
   game is built against `https://<domain>` and shows the **Sign in** button.

Without `DEPLOY_HOST` the workflow only publishes the image. To run it by hand, copy
`deploy/docker-compose.yml` to the server next to a `.env` file with `GAME_SERVER_DOMAIN`,
`Jwt__SigningKey`, `Authentication__Yandex__ClientId`, `Authentication__Yandex__ClientSecret` and
`Authentication__VkId__ClientId`, then `docker compose up -d`.
