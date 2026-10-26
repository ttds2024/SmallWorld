using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace GameServer.Auth;

/// <summary>Issues the game's own JWT for a player who signed in with Yandex ID or VK ID.</summary>
public class TokenService
{
    private readonly JwtOptions _options;

    public TokenService(IOptions<JwtOptions> options)
    {
        _options = options.Value;
    }

    public static SymmetricSecurityKey CreateSigningKey(JwtOptions options) =>
        new(Encoding.UTF8.GetBytes(options.SigningKey));

    public (string Token, DateTime ExpiresAt) CreateToken(string provider, ClaimsPrincipal external)
    {
        var providerUserId = external.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? throw new InvalidOperationException($"{provider} did not return a user id.");

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, $"{provider.ToLowerInvariant()}:{providerUserId}"),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new(AuthClaimTypes.Provider, provider),
        };
        AddIfPresent(claims, JwtRegisteredClaimNames.Name, external.FindFirstValue(ClaimTypes.Name));
        AddIfPresent(claims, JwtRegisteredClaimNames.Email, external.FindFirstValue(ClaimTypes.Email));
        AddIfPresent(claims, AuthClaimTypes.Avatar, external.FindFirstValue(AuthClaimTypes.Avatar));

        var expiresAt = DateTime.UtcNow.AddMinutes(_options.LifetimeMinutes);
        var token = new JwtSecurityToken(
            issuer: _options.Issuer,
            audience: _options.Audience,
            claims: claims,
            expires: expiresAt,
            signingCredentials: new SigningCredentials(CreateSigningKey(_options), SecurityAlgorithms.HmacSha256));
        return (new JwtSecurityTokenHandler().WriteToken(token), expiresAt);
    }

    private static void AddIfPresent(List<Claim> claims, string type, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            claims.Add(new Claim(type, value));
        }
    }
}
