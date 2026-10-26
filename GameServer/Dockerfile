FROM mcr.microsoft.com/dotnet/sdk:7.0 AS build
WORKDIR /src
COPY GameServer/GameServer.csproj GameServer/
RUN dotnet restore GameServer/GameServer.csproj
COPY GameServer/ GameServer/
RUN dotnet publish GameServer/GameServer.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:7.0
LABEL org.opencontainers.image.source=https://github.com/ttds2024/SmallWorld
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080 \
    DataProtection__KeysPath=/keys
EXPOSE 8080
RUN useradd --system --uid 1654 app && mkdir /keys && chown app /keys
USER app
ENTRYPOINT ["dotnet", "GameServer.dll"]
