using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.Extensions.Options;

namespace GameServer.Auth;

/// <summary>
/// VK ID differs from a plain OAuth 2.0 provider in two ways: the callback carries a <c>device_id</c>
/// that must be sent back with the code exchange, and the user profile is fetched with a POST.
/// </summary>
public class VkIdAuthenticationHandler : OAuthHandler<VkIdAuthenticationOptions>
{
    public VkIdAuthenticationHandler(
        IOptionsMonitor<VkIdAuthenticationOptions> options, ILoggerFactory logger, UrlEncoder encoder, ISystemClock clock)
        : base(options, logger, encoder, clock)
    {
    }

    protected override async Task<OAuthTokenResponse> ExchangeCodeAsync(OAuthCodeExchangeContext context)
    {
        var parameters = new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["client_id"] = Options.ClientId,
            ["code"] = context.Code,
            ["redirect_uri"] = context.RedirectUri,
            ["device_id"] = Request.Query["device_id"].ToString(),
            ["state"] = Request.Query["state"].ToString(),
        };
        if (context.Properties.Items.TryGetValue(OAuthConstants.CodeVerifierKey, out var codeVerifier) && codeVerifier is not null)
        {
            parameters[OAuthConstants.CodeVerifierKey] = codeVerifier;
            context.Properties.Items.Remove(OAuthConstants.CodeVerifierKey);
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, Options.TokenEndpoint)
        {
            Content = new FormUrlEncodedContent(parameters),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await Backchannel.SendAsync(request, Context.RequestAborted);
        var body = await response.Content.ReadAsStringAsync(Context.RequestAborted);
        if (!response.IsSuccessStatusCode)
        {
            return OAuthTokenResponse.Failed(new Exception($"VK ID token exchange failed ({(int)response.StatusCode}): {body}"));
        }

        var payload = JsonDocument.Parse(body);
        if (payload.RootElement.TryGetProperty("error", out var error))
        {
            payload.Dispose();
            return OAuthTokenResponse.Failed(new Exception($"VK ID token exchange failed: {error}"));
        }
        return OAuthTokenResponse.Success(payload);
    }

    protected override async Task<AuthenticationTicket> CreateTicketAsync(
        ClaimsIdentity identity, AuthenticationProperties properties, OAuthTokenResponse tokens)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, Options.UserInformationEndpoint)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = Options.ClientId,
                ["access_token"] = tokens.AccessToken!,
            }),
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await Backchannel.SendAsync(request, Context.RequestAborted);
        var body = await response.Content.ReadAsStringAsync(Context.RequestAborted);
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"VK ID user info request failed ({(int)response.StatusCode}): {body}");
        }

        using var payload = JsonDocument.Parse(body);
        if (!payload.RootElement.TryGetProperty("user", out var user))
        {
            throw new HttpRequestException($"VK ID user info response has no user: {body}");
        }

        var principal = new ClaimsPrincipal(identity);
        var context = new OAuthCreatingTicketContext(principal, properties, Context, Scheme, Options, Backchannel, tokens, user);
        context.RunClaimActions();
        await Events.CreatingTicket(context);
        return new AuthenticationTicket(context.Principal!, context.Properties, Scheme.Name);
    }
}
