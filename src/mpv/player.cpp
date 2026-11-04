#include "player.h"
#include "ambient.h"
#include "display_mode.h"
#include "playback_defaults.h"
#include <iostream>
#include <algorithm>
#include <cctype>
#include <cmath>
#include "../core/globals.h"
#include "../utils/crashlog.h"
#include "../utils/helpers.h"
#include "../ui/mainwindow.h"

// Helper for mpv node => JSON
static nlohmann::json mpvNodeToJson(const mpv_node* node);

static nlohmann::json mpvNodeArrayToJson(const mpv_node_list* list)
{
    using json = nlohmann::json;
    json j = json::array();
    if(!list) return j;
    for(int i=0; i<list->num; i++){
        j.push_back(mpvNodeToJson(&list->values[i]));
    }
    return j;
}

static nlohmann::json mpvNodeMapToJson(const mpv_node_list* list)
{
    using json = nlohmann::json;
    json j = json::object();
    if(!list) return j;
    for(int i=0; i<list->num; i++){
        const char* key = (list->keys && list->keys[i]) ? list->keys[i] : "";
        mpv_node &val   = list->values[i];
        j[key] = mpvNodeToJson(&val);
    }
    return j;
}

static nlohmann::json mpvNodeToJson(const mpv_node* node)
{
    using json = nlohmann::json;
    if(!node) return nullptr;

    switch(node->format)
    {
    case MPV_FORMAT_STRING:
        return node->u.string ? node->u.string : "";
    case MPV_FORMAT_INT64:
        return (long long)node->u.int64;
    case MPV_FORMAT_DOUBLE:
        return node->u.double_;
    case MPV_FORMAT_FLAG:
        return (bool)node->u.flag;
    case MPV_FORMAT_NODE_ARRAY:
        return mpvNodeArrayToJson(node->u.list);
    case MPV_FORMAT_NODE_MAP:
        return mpvNodeMapToJson(node->u.list);
    default:
        return "<unhandled mpv_node format>";
    }
}

// File lifecycle and skip requests are both handled on the window thread.
static unsigned long long skipMediaSerial = 0;
static bool skipMediaLoaded = false;

void NotifySkipMedia()
{
    if (!g_webview) return;
    nlohmann::json media = {{"serial", std::to_string(skipMediaSerial)}, {"seekable", false}};
    int seekable = 0;
    if (g_mpv && skipMediaLoaded && mpv_get_property(g_mpv, "seekable", MPV_FORMAT_FLAG, &seekable) >= 0 && seekable) {
        media["seekable"] = true;
        for (const char* property : {"duration", "time-pos"}) {
            double value = 0;
            if (mpv_get_property(g_mpv, property, MPV_FORMAT_DOUBLE, &value) >= 0)
                media[property] = value;
        }
        mpv_node chapters{};
        if (mpv_get_property(g_mpv, "chapter-list", MPV_FORMAT_NODE, &chapters) >= 0) {
            media["chapters"] = mpvNodeToJson(&chapters);
            mpv_free_node_contents(&chapters);
        }
    }
    SendToJS("skip-media-changed", media);
}

void SeekSkipSegment(const std::vector<std::string>& args)
{
    if (!g_mpv || !skipMediaLoaded || args.size() != 3 || args[0] != std::to_string(skipMediaSerial)) return;
    try {
        size_t startLength = 0, endLength = 0;
        const double start = std::stod(args[1], &startLength);
        const double end = std::stod(args[2], &endLength);
        if (startLength != args[1].size() || endLength != args[2].size() ||
            !std::isfinite(start) || !std::isfinite(end) || start < 0 || end <= start) return;
        int seekable = 0;
        double position = 0, duration = 0;
        if (mpv_get_property(g_mpv, "seekable", MPV_FORMAT_FLAG, &seekable) < 0 || !seekable ||
            mpv_get_property(g_mpv, "time-pos", MPV_FORMAT_DOUBLE, &position) < 0 ||
            mpv_get_property(g_mpv, "duration", MPV_FORMAT_DOUBLE, &duration) < 0 ||
            position < start || position >= end || end > duration) return;
        // An exact seek to the end follows the same EOF path as natural playback.
        const char* command[] = {"seek", args[2].c_str(), "absolute+exact", nullptr};
        if (mpv_command_async(g_mpv, 0, command) >= 0 && end == duration) {
            // Paused mpv stays on the last frame after a seek until playback resumes.
            int playing = 0;
            mpv_set_property_async(g_mpv, 0, "pause", MPV_FORMAT_FLAG, &playing);
        }
    } catch (const std::exception&) { /* Ignore malformed skip requests. */ }
}

// Helper to properly capitalize mpv error
static std::string capitalizeFirstLetter(const std::string& input) {
    if (input.empty()) return input;
    std::string result = input;
    result[0] = std::toupper(result[0]);
    return result;
}

// Forward
static void MpvWakeup(void* ctx)
{
    PostMessage((HWND)ctx, WM_MPV_WAKEUP, 0, 0);
}

void HandleMpvEvents()
{
    if(!g_mpv) return;
    while(true){
        mpv_event* ev = mpv_wait_event(g_mpv, 0);
        if(!ev || ev->event_id==MPV_EVENT_NONE) break;

        if(ev->error<0) {
            std::cerr<<"mpv event error="<<mpv_error_string(ev->error)<<"\n";
        }

        switch(ev->event_id)
        {
        case MPV_EVENT_START_FILE:
            ++skipMediaSerial;
            skipMediaLoaded = false;
            NotifySkipMedia();
            break;
        case MPV_EVENT_FILE_LOADED:
            // Each video starts at normal full volume, independently of the last video.
            g_currentVolume = (std::min)(100.0, MaximumPlayerVolume());
            if (!ApplyVideoStartDefaults(g_mpv))
                AppendToCrashLog("[MPV]: Could not reset video to 100% volume and Fit");
            skipMediaLoaded = true;
            NotifySkipMedia();
            [[fallthrough]];
        case MPV_EVENT_VIDEO_RECONFIG:
        {
            int64_t width = 0;
            const bool active = mpv_get_property(g_mpv, "video-params/w", MPV_FORMAT_INT64, &width) >= 0 && width > 0;
            NotifyDisplayModeState(active);
            break;
        }
        case MPV_EVENT_PROPERTY_CHANGE:
        {
            mpv_event_property* prop=(mpv_event_property*)ev->data;
            if(!prop||!prop->name)break;

            json j;
            j["type"] ="mpv-prop-change";
            j["id"]   =(int64_t)ev->reply_userdata;
            j["name"] = prop->name;
            if(ev->error<0)
                j["error"]=mpv_error_string(ev->error);

            switch(prop->format)
            {
                case MPV_FORMAT_INT64:
                    if(prop->data)
                        j["data"]=(long long)(*(int64_t*)prop->data);
                    else
                        j["data"]=nullptr;
                break;
                case MPV_FORMAT_DOUBLE:
                    if(prop->data)
                        j["data"]=*(double*)prop->data;
                    else
                        j["data"]=nullptr;
                break;
                case MPV_FORMAT_FLAG:
                    if(prop->data)
                        j["data"]=(*(int*)prop->data!=0);
                    else
                        j["data"]=false;
                break;
                case MPV_FORMAT_STRING:
                    if(prop->data){
                        const char*s=*(char**)prop->data;
                        j["data"]=(s? s:"");
                    } else {
                        j["data"]="";
                    }
                break;
                case MPV_FORMAT_NODE:
                    j["data"]=mpvNodeToJson((mpv_node*)prop->data);
                break;
                default:
                    j["data"]=nullptr;
                break;
            }
            if (j["name"] == "volume" && j["data"].is_number() && j["data"].get<double>() > MaximumPlayerVolume()) {
                // Enforce caps below 100 even for mpv's own keyboard bindings.
                ApplyPlayerVolume(g_mpv, j["data"].get<double>());
                j["data"] = MaximumPlayerVolume();
            }
            if (j["name"] == "volume" && g_initialSet && j["data"].is_number()) {
                g_currentVolume = j["data"];
            }
            SendToJS("mpv-prop-change", j);
            break;
        }
        case MPV_EVENT_END_FILE:
        {
            skipMediaLoaded = false;
            NotifySkipMedia();
            NotifyDisplayModeState(false);
            mpv_event_end_file* ef=(mpv_event_end_file*)ev->data;
            nlohmann::json j;
            j["type"]="mpv-event-ended";
            switch(ef->reason){
                case MPV_END_FILE_REASON_EOF:
                    j["reason"]="quit";
                SendToJS("mpv-event-ended", j);
                break;
                case MPV_END_FILE_REASON_ERROR: {
                    std::string errorString = mpv_error_string(ef->error);
                    std::string capitalizedErrorString = capitalizeFirstLetter(errorString);
                    j["reason"]="error";
                    if(ef->error<0)
                        j["error"]= capitalizedErrorString;
                    SendToJS("mpv-event-ended", j);
                    AppendToCrashLog("[MPV]: " + capitalizedErrorString);
                    break;
                }
                default:
                    j["reason"]="other";
                break;
            }
            break;
        }
        case MPV_EVENT_SHUTDOWN:
        {
            std::cout<<"mpv EVENT_SHUTDOWN => terminate\n";
            mpv_terminate_destroy(g_mpv);
            g_mpv=nullptr;
            break;
        }
        default:
            // ignore
            break;
        }
    }
}

void HandleMpvCommand(const std::vector<std::string>& args)
{
    std::thread([args](){
        if(!g_mpv || args.empty()) return;
        std::vector<const char*> cargs;
        for(auto &s: args) {
            cargs.push_back(s.c_str());
        }
        cargs.push_back(nullptr);
        mpv_command(g_mpv, cargs.data());
    }).detach();
}

void HandleMpvSetProp(const std::vector<std::string>& args)
{
    if (args.size() >= 2 && args[0] == "volume") {
        try {
            size_t consumed = 0;
            const double volume = std::stod(args[1], &consumed);
            if (consumed == args[1].size()) ApplyPlayerVolume(g_mpv, volume);
        } catch (const std::exception&) { /* Ignore invalid volume requests. */ }
        return;
    }
    std::thread([args](){
        if(!g_mpv || args.size()<2) return;
        std::string val=args[1];
        if(val=="true")  val="yes";
        if(val=="false") val="no";
        mpv_set_property_string(g_mpv, args[0].c_str(), val.c_str());
    }).detach();
}

void HandleMpvObserveProp(const std::vector<std::string>& args)
{
    std::thread([args](){
        if(!g_mpv || args.empty()) return;
        std::string pname=args[0];
        g_observedProps.insert(pname);
        mpv_observe_property(g_mpv,0,pname.c_str(),MPV_FORMAT_NODE);
        std::cout<<"Observing prop="<<pname<<"\n";
    }).detach();
}

void pauseMPV(bool allowed)
{
    if(!allowed) return;
    std::vector<std::string> pauseArgs = { "pause", "true" };
    HandleMpvSetProp(pauseArgs);
}

bool InitMPV(HWND hwnd)
{
    g_mpv = mpv_create();
    if(!g_mpv){
        std::cerr<<"mpv_create failed\n";
        AppendToCrashLog("[MPV]: Create failed");
        return false;
    }

    // portable_config
    std::wstring exeDir = GetExeDirectory();
    std::wstring cfg    = exeDir + L"\\portable_config";
    CreateDirectoryW(cfg.c_str(), nullptr);

    // Convert config path to UTF-8
    int needed = WideCharToMultiByte(CP_UTF8, 0, cfg.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string utf8(needed, 0);
    WideCharToMultiByte(CP_UTF8, 0, cfg.c_str(), -1, &utf8[0], needed, nullptr, nullptr);

    mpv_set_option_string(g_mpv, "config-dir", utf8.c_str());
    mpv_set_option_string(g_mpv, "load-scripts","yes");
    mpv_set_option_string(g_mpv, "config","yes");
    mpv_set_option_string(g_mpv, "terminal","yes");
    mpv_set_option_string(g_mpv, "msg-level","all=v");

    int64_t wid=(int64_t)hwnd;
    mpv_set_option(g_mpv,"wid", MPV_FORMAT_INT64, &wid);
    mpv_set_wakeup_callback(g_mpv, MpvWakeup, hwnd);

    if(mpv_initialize(g_mpv)<0){
        std::cerr<<"mpv_initialize failed\n";
        AppendToCrashLog("[MPV]: Initialize failed");
        return false;
    }

    if (!ApplyBorderBlurPreference(g_mpv, ReadBorderBlurPreference(
            cfg + L"\\stremio-settings.ini"))) {
        AppendToCrashLog("[MPV]: Could not apply ambient border blur preference");
    }

    // demux/caching
    mpv_set_property_string(g_mpv,"demuxer-lavf-probesize",     "524288");
    mpv_set_property_string(g_mpv,"demuxer-lavf-analyzeduration","0.5");
    mpv_set_property_string(g_mpv,"demuxer-max-bytes","300000000");
    mpv_set_property_string(g_mpv,"demuxer-max-packets","150000000");
    mpv_set_property_string(g_mpv,"cache","yes");
    mpv_set_property_string(g_mpv,"cache-pause","no");
    mpv_set_property_string(g_mpv,"cache-secs","60");
    mpv_set_property_string(g_mpv,"vd-lavc-threads","0");
    mpv_set_property_string(g_mpv,"ad-lavc-threads","0");
    mpv_set_property_string(g_mpv,"audio-fallback-to-null","yes");
    mpv_set_property_string(g_mpv,"audio-client-name",APP_NAME);
    mpv_set_property_string(g_mpv,"title",APP_NAME);

    return true;
}

void CleanupMPV()
{
    if(g_mpv){
        mpv_terminate_destroy(g_mpv);
        g_mpv=nullptr;
    }
}
