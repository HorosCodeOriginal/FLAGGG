// language: C++, file: trainer.cpp, target: Windows 11, MSVC
// External game trainer — RPM pointer chain, HP read, god-mode / ammo write
// offsets pinned per game build; re-derive after patches
// link: psapi.lib
#include <windows.h>
#include <psapi.h>
#include <cstdio>
#include <string>

#pragma comment(lib, "psapi.lib")

// ---- config: per-game (example: fps shooter) ----
static const wchar_t* GAME_MODULE = L"game.dll";
static DWORD_PTR g_offsets[] = {
    0x0F2C10,  // localPlayer ptr
    0x0A4,     // health
    0x0A8      // armor
};
static const int g_offsets_count = 3;

static DWORD FindPid(const wchar_t* name) {
    DWORD pids[4096], needed = 0;
    if (!EnumProcesses(pids, sizeof(pids), &needed)) return 0;
    for (DWORD i = 0; i < needed / sizeof(DWORD); i++) {
        HANDLE h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pids[i]);
        if (h) {
            wchar_t exe[MAX_PATH];
            if (GetProcessImageFileNameW(h, exe, MAX_PATH) &&
                wcsstr(exe, name)) { CloseHandle(h); return pids[i]; }
            CloseHandle(h);
        }
    }
    return 0;
}

static DWORD_PTR ModuleBase(DWORD pid, const wchar_t* mod) {
    HANDLE proc = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!proc) return 0;
    HMODULE mods[1024]; DWORD needed;
    DWORD_PTR result = 0;
    if (EnumProcessModules(proc, mods, sizeof(mods), &needed)) {
        for (DWORD i = 0; i < needed / sizeof(HMODULE); i++) {
            wchar_t name[MAX_PATH];
            if (GetModuleBaseNameW(proc, mods[i], name, MAX_PATH) && !_wcsicmp(name, mod)) {
                result = (DWORD_PTR)mods[i];
                break;
            }
        }
    }
    CloseHandle(proc);
    return result;
}

static bool ReadPtrChain(HANDLE proc, DWORD_PTR base, DWORD_PTR& out) {
    DWORD_PTR addr = base;
    for (int i = 0; i < g_offsets_count - 1; i++) {
        if (!ReadProcessMemory(proc, (LPCVOID)addr, &addr, sizeof(addr), nullptr)) return false;
        addr += g_offsets[i];
    }
    out = addr + g_offsets[g_offsets_count - 1];
    return true;
}

int main() {
    DWORD pid = FindPid(L"game.exe");
    if (!pid) { printf("game.exe nicht gefunden\n"); return 1; }
    DWORD_PTR base = ModuleBase(pid, GAME_MODULE);
    if (!base) { printf("modul nicht gefunden\n"); return 2; }
    HANDLE proc = OpenProcess(PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION, FALSE, pid);
    if (!proc) { printf("openprocess fehlgeschlagen\n"); return 3; }

    printf("[+] pid=%lu base=0x%llX\n", pid, base);
    printf("hotkeys: F1 god-mode | F2 refill ammo | F3 read HP | ESC exit\n");

    for (;;) {
        if (GetAsyncKeyState(VK_ESCAPE) & 1) break;

        if (GetAsyncKeyState(VK_F3) & 1) {
            DWORD_PTR hp = 0;
            if (ReadPtrChain(proc, base, hp) && ReadProcessMemory(proc, (LPCVOID)hp, &hp, sizeof(hp), nullptr))
                printf("HP = %llu\n", hp);
        }
        if (GetAsyncKeyState(VK_F1) & 1) {
            DWORD_PTR hp = 0;
            if (ReadPtrChain(proc, base, hp)) {
                float god = 9999.0f;
                WriteProcessMemory(proc, (LPVOID)hp, &god, sizeof(god), nullptr);
                printf("god-mode: HP=9999\n");
            }
        }
        if (GetAsyncKeyState(VK_F2) & 1) {
            // ammo offset lands right after health in this chain
            DWORD_PTR hp = 0;
            if (ReadPtrChain(proc, base, hp)) {
                int ammo = 999;
                WriteProcessMemory(proc, (LPVOID)(hp + 0x10), &ammo, sizeof(ammo), nullptr);
                printf("ammo refill: 999\n");
            }
        }
        Sleep(30);
    }
    CloseHandle(proc);
    return 0;
}
