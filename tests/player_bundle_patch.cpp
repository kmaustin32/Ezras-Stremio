#include "../src/webview/player_bundle_patch.h"
#include <fstream>
#include <iostream>
#include <iterator>

int main(int count, char** args)
{
    if (count != 3 && count != 4) return 2;
    const bool allowPartial = count == 4 && std::string(args[3]) == "--allow-partial";
    if (count == 4 && !allowPartial) return 2;
    std::ifstream input(args[1], std::ios::binary);
    if (!input) return 2;
    std::string script(std::istreambuf_iterator<char>(input), {}), error;
    const auto report = PatchCommunityPlayer(script);
    if (!report.AllApplied() && !allowPartial) { std::cerr << report.warning << '\n'; return 1; }
    std::ofstream output(args[2], std::ios::binary);
    output << script;
    return output ? 0 : 2;
}
