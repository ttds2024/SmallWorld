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
