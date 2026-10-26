using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.OAuth;

namespace GameServer.Auth;

/// <summary>
/// Options for VK ID (https://id.vk.com), the OAuth 2.1 sign-in that replaces the legacy oauth.vk.com.
/// </summary>
public class VkIdAuthenticationOptions : OAuthOptions
{
    public VkIdAuthenticationOptions()
    {
        CallbackPath = "/auth/callback/vkid";
        AuthorizationEndpoint = VkIdAuthenticationDefaults.AuthorizationEndpoint;
        TokenEndpoint = VkIdAuthenticationDefaults.TokenEndpoint;
        UserInformationEndpoint = VkIdAuthenticationDefaults.UserInformationEndpoint;

        // VK ID requires PKCE (S256) for the authorization code flow.
        UsePkce = true;

        Scope.Add("vkid.personal_info");
        Scope.Add("email");

        ClaimActions.MapJsonKey(ClaimTypes.NameIdentifier, "user_id");
        ClaimActions.MapJsonKey(ClaimTypes.GivenName, "first_name");
        ClaimActions.MapJsonKey(ClaimTypes.Surname, "last_name");
        ClaimActions.MapJsonKey(ClaimTypes.Email, "email");
        ClaimActions.MapJsonKey(AuthClaimTypes.Avatar, "avatar");
        ClaimActions.MapCustomJson(ClaimTypes.Name, user =>
            string.Join(' ', new[] { user.GetString("first_name"), user.GetString("last_name") }
                .Where(part => !string.IsNullOrWhiteSpace(part))));
    }

    public override void Validate()
    {
        // VK ID web apps are public PKCE clients: the token exchange does not use a client secret.
        if (string.IsNullOrEmpty(ClientSecret))
        {
            ClientSecret = "unused";
        }
        base.Validate();
    }
}

public static class VkIdAuthenticationDefaults
{
    public const string AuthenticationScheme = "VkId";
    public const string DisplayName = "VK ID";
    public const string AuthorizationEndpoint = "https://id.vk.com/authorize";
    public const string TokenEndpoint = "https://id.vk.com/oauth2/auth";
    public const string UserInformationEndpoint = "https://id.vk.com/oauth2/user_info";
}

public static class VkIdAuthenticationExtensions
{
    public static AuthenticationBuilder AddVkId(
        this AuthenticationBuilder builder, Action<VkIdAuthenticationOptions> configureOptions) =>
        builder.AddOAuth<VkIdAuthenticationOptions, VkIdAuthenticationHandler>(
            VkIdAuthenticationDefaults.AuthenticationScheme, VkIdAuthenticationDefaults.DisplayName, configureOptions);
}
