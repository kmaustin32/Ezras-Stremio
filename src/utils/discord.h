#ifndef STREMIO_DISCORD_H
#define STREMIO_DISCORD_H
#include <string>
#include <vector>

void InitializeDiscord();
void SetDiscordPresenceFromArgs(const std::vector<std::string>& args);

#endif
