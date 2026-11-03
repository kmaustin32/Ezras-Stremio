#include "../src/utils/discord.h"
#include <discord_rpc.h>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

// Exercise the production formatter; copy values at the actual SDK boundary.
// No Discord connection is opened by this test.
bool g_isRpcOn = true;
void AppendToCrashLog(const std::string&) {}
namespace {
int updates = 0, clears = 0;
std::string state, title, detailsLink, watchLink, thumbnail;
int64_t started = 0, ends = 0;
void Require(bool condition, const char* message) { if (!condition) throw std::runtime_error(message); }
}
extern "C" void Discord_Initialize(const char*, DiscordEventHandlers*, int, const char*) {}
extern "C" void Discord_ClearPresence() { ++clears; }
extern "C" void Discord_UpdatePresence(const DiscordRichPresence* p)
{
    ++updates;
    state = p->state ? p->state : "";
    title = p->details ? p->details : "";
    detailsLink = p->button1Url ? p->button1Url : "";
    watchLink = p->button2Url ? p->button2Url : "";
    thumbnail = p->smallImageKey ? p->smallImageKey : "";
    started = p->startTimestamp; ends = p->endTimestamp;
}

int main()
{
    try {
        const std::vector<std::string> full = {"watching", "series", "Example show", "3", "7",
            std::string(100, 'E'), "https://example.invalid/episode", "https://example.invalid/show",
            "60", "120", "no", "https://example.invalid/details", "stremio:///detail/series/example"};
        for (size_t count = 0; count <= full.size(); ++count) {
            const int before = updates;
            SetDiscordPresenceFromArgs({full.begin(), full.begin() + count});
            Require(updates == before + (count >= 10 ? 1 : 0), "Required/optional activity argument handling changed");
            if (count < 10) continue;
            Require(title == "Example show", "Show title lost");
            Require(state == full[5] + " (S3-E7)", "Series state must remain alive through the SDK call");
            Require(ends - started == 120, "Valid playback timestamps lost");
            Require(thumbnail == full[6], "Episode thumbnail lost");
            Require(detailsLink == (count > 11 ? full[11] : ""), "Details link optional field read incorrectly");
            Require(watchLink == (count > 12 ? full[12] : ""), "Watch link optional field read incorrectly");
        }
        for (const std::string bad : {"", "null", "NaN", "-1", "60junk", "999999999999999999999999999999"}) {
            for (const int field : {8, 9}) {
                auto args = full; args[field] = bad;
                SetDiscordPresenceFromArgs(args);
                Require(started == 0 && ends == 0, "Invalid timing must not throw or create a misleading timer");
                Require(title == full[2] && state == full[5] + " (S3-E7)", "Invalid timing must retain activity text");
            }
        }
        auto args = full; args[8] = "130";
        SetDiscordPresenceFromArgs(args);
        Require(started == 0 && ends == 0, "Elapsed time past duration must not produce reversed timestamps");
        args = full; args[8] = "0"; args[9] = "9223372036854775807";
        SetDiscordPresenceFromArgs(args);
        Require(started == 0 && ends == 0, "Huge duration must not overflow epoch timestamps");
        args = full; args[10] = "yes";
        SetDiscordPresenceFromArgs(args);
        Require(state == "Paused" && started == 0 && ends == 0, "Paused presence changed");
        args = full; args[1] = "movie";
        SetDiscordPresenceFromArgs(args);
        Require(state == "Enjoying a Movie", "Movie presence changed");
        SetDiscordPresenceFromArgs({"meta-detail", "series", "Another show", "image"});
        Require(state == "Exploring a Series" && title == "Another show", "Details presence changed");
        SetDiscordPresenceFromArgs({"clear"}); Require(clears == 1, "Clear presence changed");
        const int before = updates; g_isRpcOn = false;
        SetDiscordPresenceFromArgs(full); SetDiscordPresenceFromArgs({"clear"});
        Require(updates == before && clears == 1, "Disabled Discord must stay disabled");
        std::cout << "PASS: production Discord argument bounds, owned series state, optional links, safe timing, paused/movie/details status and disabled RPC\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
