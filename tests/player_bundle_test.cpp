#include "../src/webview/player_bundle_patch.h"
#include <iostream>
#include <stdexcept>

static void require(bool value, const char* message)
{
    if (!value) throw std::runtime_error(message);
}

int main()
{
    try {
        const std::string episodes =
            "Z=s.useMemo(function(){return function(e){var f=b.settings.hideSpoilers&&D&&l&&!d;"
            "return s.createElement(N,{className:A(p.thumbnail,E({},p.blurred,f)),src:primary,alt:\" \",renderFallback:function(){return s.createElement(N,{className:p.thumbnail,src:alternate,alt:\" \",renderFallback:icon})}})}},[]),ee=s.useMemo(function(){return function(){return null}},[]);"
            "s.createElement(N,{className:A(p[\"poster-image\"],E({},p.blurred,f)),src:next.thumbnail,alt:\" \",fallbackSrc:poster,renderFallback:function(){return s.createElement(N,{className:p[\"poster-image\"],src:alternate,alt:\" \",renderFallback:icon})}});";
        const std::string url = "https://stremio.zarg.me/6f6b0558dbb064bca18a8dcc22cb1f3f4c455b22/scripts/main.js";
        require(IsCommunityPlayerScript(url), "Accept community bootstrap");
        require(IsCommunityPlayerScript(url + "?__WB_REVISION__=abcd"), "Accept service-worker revision query");
        require(!IsCommunityPlayerScript("https://evil.example/" + url), "Reject external URLs");
        require(!IsCommunityPlayerScript(url + "/other.js"), "Reject non-bootstrap paths");
        require(!IsCommunityPlayerScript("https://stremio.zarg.me/../scripts/main.js"), "Reject unversioned paths");
        const std::string autoplay = "pt=l.useCallback(function(){te.nextVideo=Ot.current,Lt.current||(re(),null!==te.nextVideo?Qt():window.history.back())},[te.nextVideo,Qt]);"
            "l.useEffect(function(){Te.bingeWatching&&null!==te.nextVideo&&!ut.current&&(null!==Oe.state.time&&null!==Oe.state.duration&&Oe.state.time<Oe.state.duration&&Oe.state.duration-Oe.state.time<=Te.nextVideoNotificationDuration?it():ot())},[te.nextVideo,Oe.state.time,Oe.state.duration]);";
        const std::string volume = "bt=l.useCallback(function(e){Oe.setProp(\"volume\",Math.min(e,Number(le.maxVolume)))},[]);"
            "localStorage.setItem(\"localProfile\",JSON.stringify(i));"
            "l.useLayoutEffect(function(){return function(){window.removeEventListener(\"wheel\",onWheel)}},[Oe.state.volume]);";
        const std::string feedback = "null!==Oe.state.volume&&At?l.createElement(G,{muted:Oe.state.muted,volume:Oe.state.volume}):null";
        std::string script = autoplay + volume + episodes + feedback;
        std::string error;
        require(PatchCommunityPlayer(script).AllApplied(), "Apply all known fixes");
        require(script.find("re(),Te.bingeWatching&&null!==te.nextVideo?Qt():window.history.back()") != std::string::npos,
            "Keep completion and back navigation, gate autoplay");
        require(script.find("[te.nextVideo,Qt,Te.bingeWatching]") != std::string::npos,
            "Refresh callback when setting changes");
        require(script.find(":ot()},[te.nextVideo,Oe.state.time,Oe.state.duration,Te.bingeWatching,Te.nextVideoNotificationDuration]") != std::string::npos,
            "Close popup when autoplay is disabled, dismissed, or settings change");
        require(script.find("Number(le.maxVolume)))},[le.maxVolume])") != std::string::npos,
            "Refresh volume callback with live maximum");
        require(script.find("detail:Number(i.maxVolume)") != std::string::npos,
            "Send native limit updates from StorageProvider");
        require(script.find("[Oe.state.volume,bt]") != std::string::npos, "Refresh keyboard and wheel volume handlers");
        require(script.find("className:A(p.thumbnail,E({},p.blurred,f)),src:alternate") != std::string::npos,
            "Alternate episode thumbnails keep conditional blur");
        require(script.find("className:A(p[\"poster-image\"],E({},p.blurred,f)),src:alternate") != std::string::npos,
            "Next episode alternate thumbnails keep conditional blur");
        require(script.find("b.settings.hideSpoilers&&Number.isFinite(D)&&Number.isFinite(l)&&!d") != std::string::npos,
            "Special episodes with zero season or episode numbers are also protected");
        require(script.find("}},[b.settings.hideSpoilers,D]),ee=") != std::string::npos,
            "Changing setting or season refreshes the episode label");
        require(script.find("null!==Oe.state.volume?l.createElement(G,{muted:Oe.state.muted,volume:Oe.state.volume}):null") != std::string::npos,
            "Native indicator stays mounted independently of pause and hidden controls");
        const auto patched = script;
        require(PatchCommunityPlayer(script).AllApplied() && script == patched, "Patch is idempotent");
        std::string unknown = "new unknown upstream implementation";
        const auto unknownReport = PatchCommunityPlayer(unknown);
        require(!unknownReport.autoplay && !unknownReport.volume && !unknownReport.episodeBlur && !unknownReport.volumeFeedback &&
            unknown.starts_with("new unknown upstream implementation\n;"), "Unknown code stays intact with honest status metadata");
        std::string partial = "pt=l.useCallback(function(){te.nextVideo=Ot.current,Lt.current||(re(),null!==te.nextVideo?Qt():window.history.back())},[te.nextVideo,Qt]);"
            "l.useEffect(function(){Te.bingeWatching&&null!==te.nextVideo&&!ut.current&&(time?it():ot())},[te.nextVideo]);";
        const auto unchanged = partial;
        const auto partialReport = PatchCommunityPlayer(partial);
        require(partialReport.autoplay && !partialReport.volume && !partialReport.episodeBlur && partial != unchanged,
            "Autoplay works independently of missing volume and blur");
        for (unsigned mask = 0; mask < 16; ++mask) {
            std::string candidate = (mask & 1 ? autoplay : "/* unknown autoplay */") +
                (mask & 2 ? volume : "/* unknown volume */") +
                (mask & 4 ? episodes : "/* unknown episode images */") +
                (mask & 8 ? feedback : "/* unknown indicator mount */");
            const auto report = PatchCommunityPlayer(candidate);
            require(report.autoplay == bool(mask & 1) && report.volume == bool(mask & 2) &&
                report.episodeBlur == bool(mask & 4) && report.volumeFeedback == bool(mask & 8), "Every compatibility combination is independent");
            require(report.warning.empty() == (mask == 15), "Report unavailable fixes");
            const auto once = candidate;
            const auto again = PatchCommunityPlayer(candidate);
            require(candidate == once && again.autoplay == report.autoplay && again.volume == report.volume &&
                again.episodeBlur == report.episodeBlur && again.volumeFeedback == report.volumeFeedback, "Partial patches are idempotent too");
        }
        const auto footer = patched.rfind("\n;window.__stremioForkAutoplayPatched=");
        auto legacy = patched.substr(0, footer);
        const std::string newFeedback = "null!==Oe.state.volume?l.createElement(G,{muted:Oe.state.muted,volume:Oe.state.volume}):null";
        legacy.replace(legacy.find(newFeedback), newFeedback.size(), feedback);
        legacy += "\n;window.__stremioForkAutoplayPatched=true;window.__stremioForkVolumePatched=true;window.__stremioForkEpisodeBlurPatched=true;/* StremioForkPlayerCompatibilityV3 */";
        require(PatchCommunityPlayer(legacy).AllApplied() && legacy == patched,
            "Upgrade an existing V3 patched cache without duplicating successful edits");
        auto ambiguous = autoplay + volume + episodes + feedback + feedback;
        const auto ambiguousReport = PatchCommunityPlayer(ambiguous);
        require(ambiguousReport.autoplay && ambiguousReport.volume && ambiguousReport.episodeBlur && !ambiguousReport.volumeFeedback &&
            ambiguous.find(feedback + feedback) != std::string::npos, "Ambiguous popup markup fails independently and stays intact");
        // A failure after finding some edits must not commit a half-working feature.
        auto brokenVolume = volume;
        brokenVolume.replace(brokenVolume.find("localStorage.setItem"), 12, "otherStorage");
        auto brokenAutoplay = autoplay;
        brokenAutoplay.replace(brokenAutoplay.find(".useEffect"), 10, ".otherHook");
        auto isolated = brokenAutoplay + brokenVolume + episodes;
        const auto isolatedReport = PatchCommunityPlayer(isolated);
        require(!isolatedReport.autoplay && !isolatedReport.volume && isolatedReport.episodeBlur &&
            isolated.starts_with(brokenAutoplay + brokenVolume), "Failed feature edits are atomic");
        std::string missingFallback = episodes.substr(0, episodes.find("s.createElement(N,{className:A(p[\"poster-image\"]"));
        const auto before = missingFallback;
        require(!PatchEpisodeSpoilerBlur(missingFallback, error) && missingFallback == before,
            "Unknown image shapes leave all episode code intact");
        std::cout << "PASS: independent, atomic player fixes preserve upstream code and report compatibility\n";
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
}
