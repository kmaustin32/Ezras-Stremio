#pragma once
#include <string>

// Only public, versioned community bootstrap scripts are eligible for the patch.
bool IsCommunityPlayerScript(const std::string& url);
struct PlayerPatchReport {
    bool autoplay = false;
    bool volume = false;
    bool episodeBlur = false;
    bool volumeFeedback = false;
    bool libraryDetails = false;
    std::string warning;
    bool AllApplied() const { return autoplay && volume && episodeBlur && volumeFeedback && libraryDetails; }
};
// Each feature commits only after its own validation. Unknown features retain
// upstream behavior; status metadata describes what was actually applied.
PlayerPatchReport PatchCommunityPlayer(std::string& script);
bool PatchEpisodeSpoilerBlur(std::string& script, std::string& error);
