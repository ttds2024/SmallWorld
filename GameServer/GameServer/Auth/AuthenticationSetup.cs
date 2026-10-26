using System.Security.Claims;
using System.Text.Json;
using AspNet.Security.OAuth.Yandex;
using GameServer.Controllers;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace GameServer.Auth;

public static class AuthenticationSetup
{
    /// <summary>
    /// API calls authenticate with the game's JWT. Yandex ID and VK ID sign in through a short-lived
    /// "External" cookie that only lives between the provider callback and <c>/auth/complete</c>.
    /// A provider is registered only when its ClientId is configured.
    /// </summary>
    public static IServiceCollection AddGameAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var jwt = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();
        if (jwt.SigningKey.Length < 32)
        {
            throw new InvalidOperationException("Jwt:SigningKey must be set to at least 32 characters.");
        }
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));
        services.Configure<AuthRedirectOptions>(configuration.GetSection(AuthRedirectOptions.SectionName));
        services.AddSingleton<TokenService>();

        var auth = services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = jwt.Issuer,
                    ValidAudience = jwt.Audience,
                    IssuerSigningKey = TokenService.CreateSigningKey(jwt),
                    NameClaimType = "name",
                };
            })
            .AddCookie(AuthController.ExternalScheme, options =>
            {
                options.Cookie.Name = "smallworld.external";
                options.ExpireTimeSpan = TimeSpan.FromMinutes(5);
            });

        var yandex = configuration.GetSection("Authentication:Yandex");
        if (!string.IsNullOrEmpty(yandex["ClientId"]))
        {
            auth.AddYandex(options =>
            {
                ConfigureProvider(options, yandex);
                options.CallbackPath = "/auth/callback/yandex";
                options.ClaimActions.MapCustomJson(AuthClaimTypes.Avatar, user =>
                    user.TryGetProperty("is_avatar_empty", out var empty) && empty.ValueKind == JsonValueKind.True
                        ? null
                        : user.GetString("default_avatar_id") is { Length: > 0 } avatarId
                            ? $"https://avatars.yandex.net/get-yapic/{avatarId}/islands-200"
                            : null);
                options.ClaimActions.Remove(ClaimTypes.Name);
                options.ClaimActions.MapCustomJson(ClaimTypes.Name, user =>
                    user.GetString("display_name") ?? user.GetString("real_name") ?? user.GetString("login"));
            });
        }

        var vkId = configuration.GetSection("Authentication:VkId");
        if (!string.IsNullOrEmpty(vkId["ClientId"]))
        {
            auth.AddVkId(options => ConfigureProvider(options, vkId));
        }

        return services;
    }

    private static void ConfigureProvider(OAuthOptions options, IConfigurationSection section)
    {
        options.ClientId = section["ClientId"]!;
        options.ClientSecret = section["ClientSecret"] ?? "";
        options.SignInScheme = AuthController.ExternalScheme;
        options.Events.OnRemoteFailure = context =>
        {
            // The player cancelled or the provider failed: send them back to the game with an error.
            var redirects = context.HttpContext.RequestServices
                .GetRequiredService<IOptions<AuthRedirectOptions>>().Value;
            string? returnUrl = null;
            context.Properties?.Items.TryGetValue(AuthController.ReturnUrlKey, out returnUrl);
            if (redirects.IsAllowedReturnUrl(returnUrl))
            {
                var error = context.HttpContext.Request.Query["error"].ToString();
                context.Response.Redirect(AuthController.WithFragment(
                    returnUrl!, "error=" + Uri.EscapeDataString(string.IsNullOrEmpty(error) ? "auth_failed" : error)));
            }
            else
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
            }
            context.HandleResponse();
            return Task.CompletedTask;
        };
    }
}
