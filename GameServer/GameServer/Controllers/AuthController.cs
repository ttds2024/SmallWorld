using System.IdentityModel.Tokens.Jwt;
using GameServer.Auth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace GameServer.Controllers;

/// <summary>
/// Sign-in with Yandex ID or VK ID. The game client opens <c>/auth/login/{provider}?returnUrl=...</c>;
/// after the provider's consent screen the server redirects back to <c>returnUrl#access_token=...</c>
/// (or <c>returnUrl#error=...</c>), and the client sends the token as <c>Authorization: Bearer</c>.
/// </summary>
[ApiController]
[Route("auth")]
public class AuthController : ControllerBase
{
    public const string ExternalScheme = "External";
    public const string ReturnUrlKey = "returnUrl";
    public const string ProviderKey = "provider";

    private readonly IAuthenticationSchemeProvider _schemes;
    private readonly TokenService _tokens;
    private readonly AuthRedirectOptions _redirects;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        IAuthenticationSchemeProvider schemes,
        TokenService tokens,
        IOptions<AuthRedirectOptions> redirects,
        ILogger<AuthController> logger)
    {
        _schemes = schemes;
        _tokens = tokens;
        _redirects = redirects.Value;
        _logger = logger;
    }

    /// <summary>The sign-in providers configured on this server.</summary>
    [HttpGet("providers")]
    public async Task<IEnumerable<AuthProvider>> GetProviders() =>
        (await _schemes.GetAllSchemesAsync())
            .Where(scheme => scheme.Name is AuthProviders.Yandex or AuthProviders.VkId)
            .Select(scheme => new AuthProvider(scheme.Name, scheme.DisplayName ?? scheme.Name));

    /// <summary>Redirects the player to the provider's sign-in page.</summary>
    [HttpGet("login/{provider}")]
    public async Task<IActionResult> Login(string provider, [FromQuery] string returnUrl)
    {
        var scheme = (await GetProviders()).FirstOrDefault(p => string.Equals(p.Id, provider, StringComparison.OrdinalIgnoreCase));
        if (scheme is null)
        {
            return NotFound($"Unknown sign-in provider '{provider}'.");
        }
        if (!_redirects.IsAllowedReturnUrl(returnUrl))
        {
            return BadRequest("returnUrl is not an allowed game client origin.");
        }

        var properties = new AuthenticationProperties
        {
            RedirectUri = Url.Action(nameof(Complete)),
            Items = { [ReturnUrlKey] = returnUrl, [ProviderKey] = scheme.Id },
        };
        return Challenge(properties, scheme.Id);
    }

    /// <summary>
    /// Reached after the provider callback: turns the temporary external sign-in into a game token
    /// and sends the player back to the game client.
    /// </summary>
    [HttpGet("complete")]
    [ApiExplorerSettings(IgnoreApi = true)]
    public async Task<IActionResult> Complete()
    {
        var result = await HttpContext.AuthenticateAsync(ExternalScheme);
        await HttpContext.SignOutAsync(ExternalScheme);

        string? returnUrl = null, provider = null;
        result.Properties?.Items.TryGetValue(ReturnUrlKey, out returnUrl);
        result.Properties?.Items.TryGetValue(ProviderKey, out provider);
        if (!result.Succeeded || result.Principal is null || provider is null || !_redirects.IsAllowedReturnUrl(returnUrl))
        {
            return Unauthorized();
        }

        try
        {
            var (token, expiresAt) = _tokens.CreateToken(provider, result.Principal);
            var expiresIn = (int)(expiresAt - DateTime.UtcNow).TotalSeconds;
            return Redirect(WithFragment(returnUrl!, $"access_token={Uri.EscapeDataString(token)}&token_type=Bearer&expires_in={expiresIn}"));
        }
        catch (InvalidOperationException e)
        {
            _logger.LogWarning(e, "Could not issue a token after {Provider} sign-in", provider);
            return Redirect(WithFragment(returnUrl!, "error=invalid_profile"));
        }
    }

    /// <summary>The signed-in player.</summary>
    [HttpGet("me")]
    [Authorize]
    public CurrentUser Me() => new(
        User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value ?? "",
        User.FindFirst(AuthClaimTypes.Provider)?.Value ?? "",
        User.FindFirst(JwtRegisteredClaimNames.Name)?.Value,
        User.FindFirst(JwtRegisteredClaimNames.Email)?.Value,
        User.FindFirst(AuthClaimTypes.Avatar)?.Value);

    public static string WithFragment(string url, string fragment)
    {
        var hash = url.IndexOf('#');
        return (hash < 0 ? url : url[..hash]) + "#" + fragment;
    }
}

public record AuthProvider(string Id, string DisplayName);

public record CurrentUser(string Id, string Provider, string? Name, string? Email, string? Avatar);
