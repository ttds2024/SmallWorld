using AspNet.Security.OAuth.Yandex;

namespace GameServer.Auth;

public static class AuthProviders
{
    public const string Yandex = YandexAuthenticationDefaults.AuthenticationScheme;
    public const string VkId = VkIdAuthenticationDefaults.AuthenticationScheme;
}
