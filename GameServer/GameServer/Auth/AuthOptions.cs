namespace GameServer.Auth;

/// <summary>Settings for the game's own access tokens, bound from the "Jwt" section.</summary>
public class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Issuer { get; set; } = "SmallWorld.GameServer";
    public string Audience { get; set; } = "SmallWorld";

    /// <summary>HMAC-SHA256 key, at least 32 characters. Keep it out of source control.</summary>
    public string SigningKey { get; set; } = "";

    public int LifetimeMinutes { get; set; } = 7 * 24 * 60;
}

/// <summary>Where the server may send players back after sign-in, bound from the "Auth" section.</summary>
public class AuthRedirectOptions
{
    public const string SectionName = "Auth";

    /// <summary>Origins of the game client (e.g. https://ttds2024.github.io); also used for CORS.</summary>
    public string[] AllowedOrigins { get; set; } = Array.Empty<string>();

    public bool IsAllowedReturnUrl(string? returnUrl) =>
        Uri.TryCreate(returnUrl, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
        && AllowedOrigins.Any(origin =>
            Uri.TryCreate(origin, UriKind.Absolute, out var allowed)
            && Uri.Compare(uri, allowed, UriComponents.SchemeAndServer, UriFormat.Unescaped, StringComparison.OrdinalIgnoreCase) == 0);
}
