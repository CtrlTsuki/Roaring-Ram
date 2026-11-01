# Windows 10/11 APIs for monitoring and managing RAM from a non-elevated (medium-integrity) desktop app

Scope: what an Electron + koffi app (kernel32/psapi/ntdll/user32) can do as a standard user, what needs elevation, and what is impossible. Every capability is tagged with one of four labels:
**[MONITOR]** monitoring only, **[SOFT]** soft request/hint the OS or the app may ignore, **[LIMIT]** OS-enforced limit, **[DISRUPTIVE]** action that can end or destabilize another app.
Source tags: **(DOC)** means Microsoft Learn or kernel.org reference documentation. **(COMMUNITY)** means reverse-engineering, blogs, forum posts, or code samples.

---

## 1. System-wide monitoring (GlobalMemoryStatusEx, GetPerformanceInfo, GetPhysicallyInstalledSystemMemory, and Task Manager semantics)

### Takeaway
All three system calls are documented, need no handle, and work from medium integrity **[MONITOR]**. "Available" is documented as standby + free + zero lists. That means cached file data counts as available. `MEMORYSTATUSEX.ullTotalPageFile` is the **commit limit**, not the page-file size, and it is clamped by any job limit on the *calling* process. Use `GetPerformanceInfo` for true system-wide commit. Adding up per-process numbers does not reproduce system usage. Shared pages, the system file cache, kernel pools and the compression store are not attributed to ordinary processes in a summable way.

### Cited Findings
**MEMORYSTATUSEX / GlobalMemoryStatusEx (DOC)**
- Layout: `DWORD dwLength; DWORD dwMemoryLoad; DWORDLONG ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual`. The caller must set `dwLength` before the call. — [MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)
- `dwMemoryLoad`: "A number between 0 and 100 that specifies the approximate percentage of physical memory that is in use". — [MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)
- `ullAvailPhys` is memory "that can be immediately reused without having to write its contents to disk first. It is the sum of the size of the standby, free, and zero lists." — [MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)
- `ullTotalPageFile` = "The current committed memory limit for the system **or the current process, whichever is smaller**". To get the system-wide value, call GetPerformanceInfo. — [MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)
- `ullAvailPageFile` = the maximum the *current process* can commit, which is ≤ system-wide available commit. System-wide available commit = `CommitLimit − CommitTotal` from GetPerformanceInfo. — [MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)
- `ullTotalVirtual`/`ullAvailVirtual` describe the *caller's* user-mode address space, not RAM. `ullAvailExtendedVirtual` is reserved and always 0. Physical sizes include all NUMA nodes. The page file can grow up to an admin-set maximum, so the values are point-in-time. — [MEMORYSTATUSEX](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/ns-sysinfoapi-memorystatusex)

**PERFORMANCE_INFORMATION / GetPerformanceInfo (DOC)**
- Layout: `DWORD cb; SIZE_T CommitTotal, CommitLimit, CommitPeak, PhysicalTotal, PhysicalAvailable, SystemCache, KernelTotal, KernelPaged, KernelNonpaged, PageSize; DWORD HandleCount, ProcessCount, ThreadCount`. — [PERFORMANCE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information)
- **All memory fields are in pages.** Multiply by `PageSize` (bytes). — [PERFORMANCE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information)
- `CommitTotal`: pages currently committed. A `VirtualAlloc(MEM_COMMIT)` changes it immediately, "however, the physical memory is not charged until the pages are accessed." — [PERFORMANCE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information)
- `CommitLimit`: the maximum that can be committed "without extending the paging file(s)… If the paging file can be extended, this is a soft limit." — [PERFORMANCE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information)
- `PhysicalAvailable` = standby + free + zero lists (same as `ullAvailPhys`). `SystemCache` = "the size of the standby list plus the system working set". `KernelTotal` = paged + nonpaged pool. — [PERFORMANCE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information)

**GetPhysicallyInstalledSystemMemory (DOC)**
- Returns installed RAM **in kilobytes**, read from SMBIOS firmware tables. It can exceed `ullTotalPhys` because the BIOS and drivers reserve memory for memory-mapped I/O. It fails with `ERROR_INVALID_DATA` if the SMBIOS data is malformed, including when it would be less than `ullTotalPhys`. Minimum: Vista SP1. — [GetPhysicallyInstalledSystemMemory](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-getphysicallyinstalledsystemmemory)

**Task Manager mapping (DOC for the Vista-era Task Manager, COMMUNITY for the Win10/11 labels)**
- Microsoft says Task Manager, Resource/Performance Monitor and Process Explorer "use performance counters to display memory information". It maps: Committed Bytes = `CommitTotal`; Commit Limit = `ullTotalPageFile`/`CommitLimit`; Available = `ullAvailPhys`/`PhysicalAvailable`; Kernel Paged/Nonpaged = `KernelPaged`/`KernelNonpaged`. — [Memory Performance Information](https://learn.microsoft.com/en-us/windows/win32/memory/memory-performance-information)
- The documented Task Manager "Physical Memory: Cached" (Vista/2008 table) = Cache Bytes + Modified Page List Bytes + Standby Cache Reserve Bytes + Standby Cache Normal Priority Bytes + Standby Cache Code Bytes. "Free" = the "Free & Zero Page List Bytes" counter. — [Memory Performance Information](https://learn.microsoft.com/en-us/windows/win32/memory/memory-performance-information)
- Per-process: Task Manager "Commit Size" = Private Bytes = `PROCESS_MEMORY_COUNTERS_EX.PrivateUsage`. "Working Set (Memory)" = `WorkingSetSize`. "Private Working Set" = the "Working Set - Private" counter, which has no PSAPI equivalent in that table. — [Memory Performance Information](https://learn.microsoft.com/en-us/windows/win32/memory/memory-performance-information)
- (COMMUNITY) In the Win10/11 Task Manager, "In use" is described as memory assigned to apps, Windows and drivers, **including compressed memory**, shown as "In use (Compressed)". "Cached" is described as the standby and modified lists (one source adds the system working set). "Committed" is shown as CommitTotal/CommitLimit (e.g. "6.8/37.7 GB"). — [HelpDeskGeek](https://helpdeskgeek.com/task-manager-ram-meaning-explained/), [How-To Geek](https://www.howtogeek.com/319933/what-is-memory-compression-in-windows-10/)

**Why summing per-process numbers misleads**
- Shared pages: "If several processes share a page, removing the page from the working set of one process does not affect other processes". A shared page sits in several working sets, so summing `WorkingSetSize` double-counts it. — [Working Set](https://learn.microsoft.com/en-us/windows/win32/memory/working-set)
- The file cache (`SystemCache` = standby + system working set) and the kernel pools (`KernelPaged`/`KernelNonpaged`) are system-level and not part of any ordinary process's private counters. — [PERFORMANCE_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-performance_information)
- The System process's "Page File Bytes is always 0" in the counter mapping. — [Memory Performance Information](https://learn.microsoft.com/en-us/windows/win32/memory/memory-performance-information)
- Compression (COMMUNITY, Microsoft Insider post from 2015 via a mirror): instead of writing modified pages to the pagefile, the memory manager compresses them into a "compression store" that lived in the **System process's working set**. System's working set therefore grows "exactly when memory is being made available for other processes." Compressed data was claimed to be about 40% of the original size. — [TweakHound mirror of the Windows Insider post](https://www.tweakhound.com/2015/08/20/windows-10-memory-compression/)
- (COMMUNITY) In later builds (Creators Update), the System process stays at about 0.1 MB despite heavy compression, and compressed data is reported under Performance > Memory "In use (Compressed)". Compressed data stays in RAM. — [How-To Geek](https://www.howtogeek.com/319933/what-is-memory-compression-in-windows-10/)

### Inferences
- UI guidance: show "In use" as `ullTotalPhys − ullAvailPhys`. That is everything not on the standby/free/zero lists, so it includes the modified list and the compression store. Show "Available" separately and explain that it includes reusable cache (standby). Show "Committed" as `CommitTotal × PageSize` / `CommitLimit × PageSize` from GetPerformanceInfo, **not** from `ullTotalPageFile`, which can be job-clamped for our own process. Microsoft does not publish the exact formula for the Win10/11 "In use" label, so mark it "approximately matches Task Manager".
- Real memory pressure is better judged by commit (`CommitTotal` near `CommitLimit`) and by a low `ullAvailPhys`. A high "In use" alone is not a problem, because Windows keeps freed memory as cache.
- koffi sizes, computed from the documented field lists with natural x64 alignment (verify with a `sizeof` test): MEMORYSTATUSEX = 64 bytes. PERFORMANCE_INFORMATION = 104 bytes on x64 (4-byte `cb` + 4 padding + 10×8 + 3×4 + 4 tail padding).

### Gaps
- No Microsoft Learn page found that defines the Win10/11 Task Manager labels "In use", "Cached", "Compressed" and "Committed" exactly. The Microsoft mapping table covers Vista/XP-era Task Manager only. Windows Internals 7th ed. was not accessible this session.
- No primary source fetched confirming the version that introduced the separate "Memory Compression" process, or that it is hidden from the Processes tab but visible in Details/Process Explorer. This is widely reported but unverified here.

---

## 2. Per-process monitoring (NtQuerySystemInformation vs. OpenProcess + GetProcessMemoryInfo)

### Takeaway
There are two routes. **(a)** `NtQuerySystemInformation(SystemProcessInformation)` is a single call, needs no process handles, and returns memory counters for every process, including ones a standard user cannot open. It is only *partially* documented: Microsoft warns it "may be altered or unavailable", and `WorkingSetPrivateSize` sits in a field Microsoft calls `Reserved1`. **(b)** The fully documented route is `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `GetProcessMemoryInfo` + `QueryFullProcessImageNameW`. It fails with access denied for processes whose DACL does not grant the caller access, typically SYSTEM/service and other-user processes. `PROCESS_MEMORY_COUNTERS_EX2` (`PrivateWorkingSetSize`, `SharedCommitUsage`) requires Windows 10 22H2 or Windows 11 22H2 with the **September 2023** cumulative update. All of this is **[MONITOR]**.

### Cited Findings
**NtQuerySystemInformation (DOC, partial)**
- Banner: "NtQuerySystemInformation may be altered or unavailable in future versions of Windows. Applications should use the alternate functions listed in this topic." The function "and the structures that it returns are internal to the operating system and subject to change". Microsoft advises run-time dynamic linking: "no associated import library… use LoadLibrary and GetProcAddress… Ntdll.dll". — [NtQuerySystemInformation](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation)
- Documented public layout: `ULONG NextEntryOffset; ULONG NumberOfThreads; BYTE Reserved1[48]; UNICODE_STRING ImageName; KPRIORITY BasePriority; HANDLE UniqueProcessId; HANDLE InheritedFromUniqueProcessId; ULONG HandleCount; ULONG SessionId; PVOID Reserved3; SIZE_T PeakVirtualSize; SIZE_T VirtualSize; ULONG Reserved4; SIZE_T PeakWorkingSetSize; SIZE_T WorkingSetSize; PVOID Reserved5; SIZE_T QuotaPagedPoolUsage; PVOID Reserved6; SIZE_T QuotaNonPagedPoolUsage; SIZE_T PagefileUsage; SIZE_T PeakPagefileUsage; SIZE_T PrivatePageCount; LARGE_INTEGER Reserved7[6];`.
  - Walk the list via `NextEntryOffset`; it is 0 for the last entry. Each entry is followed by `NumberOfThreads` SYSTEM_THREAD_INFORMATION records.
  - If the buffer is too small, the call returns an NTSTATUS error and the required size in `ReturnLength`. — [NtQuerySystemInformation](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation)
- New since **Windows 11 build 26100.4770**: `SystemBasicProcessInformation` returns `SYSTEM_BASICPROCESS_INFORMATION {NextEntryOffset, UniqueProcessId, InheritedFromUniqueProcessId, ULONG64 SequenceNumber, UNICODE_STRING ImageName}`. It is faster and needs no timing sync. `SequenceNumber` detects PID reuse. It has **no memory counters**. — [NtQuerySystemInformation](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation)
- Full x64 layout (COMMUNITY, Geoff Chappell; struct size 0x100). Offsets:
  - 0x00 NextEntryOffset, 0x04 NumberOfThreads, 0x14 NumberOfThreadsHighWatermark (6.1+)
  - 0x20 CreateTime, 0x28 UserTime, 0x30 KernelTime
  - 0x38 ImageName (UNICODE_STRING; full path only with SystemFullProcessInformation), 0x48 BasePriority
  - 0x50 UniqueProcessId, 0x58 InheritedFromUniqueProcessId, 0x60 HandleCount, 0x64 SessionId, 0x68 UniqueProcessKey
  - 0x70 PeakVirtualSize, 0x78 VirtualSize, 0x80 PageFaultCount
  - 0x88 PeakWorkingSetSize, 0x90 WorkingSetSize (bytes)
  - 0x98–0xB0 quota pool fields
  - 0xB8 PagefileUsage, 0xC0 PeakPagefileUsage
  - 0xC8 PrivatePageCount ("Bytes, despite the name")
  - 0xD0–0xF8 I/O counts
  - `WorkingSetPrivateSize` (6.0+, i.e. Vista+), `HardFaultCount` (6.1+) and `CycleTime` (6.1+) are listed at x86 offsets 0x08/0x10/0x18. The page gives no x64 offsets for them. — [Geoff Chappell: SYSTEM_PROCESS_INFORMATION](https://www.geoffchappell.com/studies/windows/km/ntoskrnl/api/ex/sysinfo/process.htm)
- **Documentation conflict:** Microsoft's page says `PeakWorkingSetSize` is "in kilobytes", but Geoff Chappell lists it as bytes. — [NtQuerySystemInformation](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation) vs [Geoff Chappell](https://www.geoffchappell.com/studies/windows/km/ntoskrnl/api/ex/sysinfo/process.htm)
- Non-elevated coverage (COMMUNITY): code samples enumerate processes with SystemProcessInformation "without opening handles". One gist notes the *Full* variant (SystemFullProcessInformation) works only as admin, while the base/extended class works for standard users. A psutil maintainer reported (2012) that the call succeeds for "basically ALL processes except for PID 0". — [TheWover gist](https://gist.github.com/TheWover/71079af504ba8e056c9ebbe017d288a0), [psutil issue #304](https://github.com/giampaolo/psutil/issues/304)
- 24H2 change (COMMUNITY, windows-internals.com): `NtQuerySystemInformation` and related APIs no longer leak **kernel addresses** unless the caller has SeDebugPrivilege enabled; they return 0 instead. This targets module/handle/pointer classes, not memory counters. — [windows-internals.com: KASLR Leaks Restriction](https://windows-internals.com/kaslr-leaks-restriction/)

**Documented route: GetProcessMemoryInfo & friends (DOC)**
- `GetProcessMemoryInfo(Process, ppsmemCounters, cb)`: the handle "must have the **PROCESS_QUERY_INFORMATION or PROCESS_QUERY_LIMITED_INFORMATION** access right". Only XP/2003 required `PROCESS_QUERY_INFORMATION | PROCESS_VM_READ`. It accepts PROCESS_MEMORY_COUNTERS, _EX or _EX2.
  - With PSAPI_VERSION ≥ 2 it is exported as `K32GetProcessMemoryInfo` from **kernel32.dll**; psapi.dll keeps a wrapper.
  - For koffi, bind `K32GetProcessMemoryInfo` from kernel32, or `GetProcessMemoryInfo` from psapi.dll. — [GetProcessMemoryInfo](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo)
- PROCESS_MEMORY_COUNTERS_EX2 fields: `cb, PageFaultCount, PeakWorkingSetSize, WorkingSetSize, QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage, QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage, PagefileUsage, PeakPagefileUsage, PrivateUsage, PrivateWorkingSetSize (SIZE_T), SharedCommitUsage (ULONG64)`.
  - `PagefileUsage` = `PrivateUsage` = "Commit Charge… total amount of private memory that the memory manager has committed".
  - **Minimum supported client: "Windows 10 22H2 with September 2023 cumulative update or Windows 11 22H2 with September 2023 cumulative update."** — [PROCESS_MEMORY_COUNTERS_EX2](https://learn.microsoft.com/en-us/windows/win32/api/psapi/ns-psapi-process_memory_counters_ex2)
- `QueryFullProcessImageNameW(hProcess, dwFlags, lpExeName, lpdwSize)`: the handle needs **PROCESS_QUERY_INFORMATION or PROCESS_QUERY_LIMITED_INFORMATION**. `dwFlags` 0 = Win32 path, `PROCESS_NAME_NATIVE` (1) = native path. `lpdwSize` is in characters, in/out. Vista+. — [QueryFullProcessImageNameW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-queryfullprocessimagenamew)
- Access-right semantics: `PROCESS_QUERY_LIMITED_INFORMATION` (0x1000) is needed for GetExitCodeProcess, GetPriorityClass, IsProcessInJob and QueryFullProcessImageName. A handle with PROCESS_QUERY_INFORMATION is automatically granted it. OpenProcess "checks the requested access rights against the DACL in the process's security descriptor". "To open a handle to another process and obtain full access rights, you must enable the SeDebugPrivilege privilege." — [Process Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)
- Protected processes (PPL/PP): **not allowed** from other processes: DELETE, READ_CONTROL, WRITE_DAC, WRITE_OWNER, PROCESS_ALL_ACCESS, PROCESS_CREATE_PROCESS, PROCESS_CREATE_THREAD, PROCESS_DUP_HANDLE, **PROCESS_QUERY_INFORMATION**, PROCESS_SET_INFORMATION, **PROCESS_SET_QUOTA**, PROCESS_VM_OPERATION/READ/WRITE. "The PROCESS_QUERY_LIMITED_INFORMATION right was introduced to provide access to a subset of the information available through PROCESS_QUERY_INFORMATION." — [Process Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)
- Integrity: process objects always carry mandatory labels, which "prevents processes for the same user at lower integrity levels from accessing these object types and modifying their content or behavior". `NO_READ_UP` "is used, for example, to restrict read access to the virtual memory address space of a process." — [Windows Integrity Mechanism Design](https://learn.microsoft.com/en-us/previous-versions/dotnet/articles/bb625963(v=msdn.10))

### Inferences
- Recommended design: use `NtQuerySystemInformation(SystemProcessInformation)` (class 5) as the primary enumerator, loaded dynamically. It gives one consistent snapshot of all PIDs, image names, `WorkingSetSize`, `PrivatePageCount`/`PagefileUsage` (private commit) and `WorkingSetPrivateSize`, without per-process handles. Fall back to or cross-check with `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` + `K32GetProcessMemoryInfo` for documented values. Label the NT route "undocumented fields, may change".
- x64 offsets for the fields Geoff Chappell only gives for x86: Microsoft's own layout puts `ImageName` at 8+48 = 0x38. Geoff puts `NumberOfThreadsHighWatermark` at x64 0x14 and `CreateTime` at 0x20. Both are consistent with **WorkingSetPrivateSize at x64 0x08 (8 bytes), HardFaultCount 0x10, NumberOfThreadsHighWatermark 0x14, CycleTime 0x18**, because these leading fields are fixed-width. Verify empirically against `GetProcessMemoryInfo(...EX2).PrivateWorkingSetSize` for our own PID.
- Expected outcomes for `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` from medium integrity:
  - Same-user, medium-integrity processes: succeeds (default DACL from the creator's token).
  - Same-user elevated (High-IL) processes: usually succeeds, because the right is a query right not blocked by the integrity label. This is community knowledge; Task Manager and Process Explorer show image paths of elevated processes when not elevated.
  - SYSTEM/LocalService/other-user processes: typically `ERROR_ACCESS_DENIED`, because their DACL grants nothing to a standard user. The SystemProcessInformation route still returns their counters.
  - PPL processes: QUERY_LIMITED is allowed by the documented PPL rules.
- Feature-detect EX2 by calling with `cb = sizeof(EX2)` and falling back to `_EX` (cb = 80) or the base struct (72) on failure. Computed x64 sizes: base 72, _EX 80, _EX2 96 bytes.
- Sum-safe metrics for a "top consumers" list: private commit (`PrivateUsage`/`PagefileUsage`) and private working set. Never sum `WorkingSetSize` across processes (see section 1).

### Gaps
- No Microsoft statement found on the exact access check (if any) for `SystemProcessInformation`. Coverage of all processes from a standard user rests on community observation, so verify on Windows 10 22H2 and Windows 11 24H2/25H2 builds.
- Behavior of `GetProcessMemoryInfo` when passed an EX2-sized `cb` on a pre-September-2023 build (which error code) was not found.
- `EnumProcesses` / `CreateToolhelp32Snapshot` reference pages were not fetched this session. Neither returns memory counters itself.
- The PPL documentation does not list PROCESS_TERMINATE as disallowed. Whether PPL processes can be terminated by a standard user depends on DACL and signer level, which is not covered by the fetched docs.

---

## 3. Per-app memory limits: job objects and hard working-set limits

### Takeaway
A non-elevated app can create a job, set a **commit** cap on it (`JOB_OBJECT_LIMIT_PROCESS_MEMORY` per process, or `JOB_OBJECT_LIMIT_JOB_MEMORY` for the whole job), and assign a target. The target must be openable with `PROCESS_SET_QUOTA | PROCESS_TERMINATE`, which in practice means only same-user, non-elevated, non-protected processes. This is a true **[LIMIT]**: new commits beyond the cap **fail**; the process is not trimmed or killed by the limit itself. Many apps crash or misbehave when allocations fail, so in practice it can also be **[DISRUPTIVE]**.
Key limitations:
- Assignment is **irreversible**: "the association cannot be broken". The job persists while any member process lives, even after our handle closes.
- Commit made before assignment is not examined.
- Children are added to the job by default.
- Notify-only limits (`JobObjectNotificationLimitInformation`, Windows 8+) let us **watch** a commit threshold without enforcing it **[MONITOR]**.
- A hard working-set max (`SetProcessWorkingSetSizeEx` + `QUOTA_LIMITS_HARDWS_MAX_ENABLE`, or `JOB_OBJECT_LIMIT_WORKINGSET`) caps physical residency, which causes paging, not allocation failure **[LIMIT]**.

### Cited Findings
**Creating and opening jobs; access rights (DOC)**
- Jobs are "namable, securable, sharable". Only named jobs can be opened with `OpenJobObject`. — [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- The handle from `CreateJobObject` has `JOB_OBJECT_ALL_ACCESS` (0x1F001F). The default security descriptor's ACLs come from the creator's token. `OpenJobObject` checks the requested rights against the descriptor. A caller with access to a job "implicitly has access to all of its child jobs". — [Job Object Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/procthread/job-object-security-and-access-rights)
- Job-specific rights: `JOB_OBJECT_ASSIGN_PROCESS` (0x1) for AssignProcessToJobObject, `JOB_OBJECT_SET_ATTRIBUTES` (0x2) for SetInformationJobObject, `JOB_OBJECT_QUERY` (0x4) for QueryInformationJobObject/IsProcessInJob, `JOB_OBJECT_TERMINATE` (0x8). `JOB_OBJECT_SET_SECURITY_ATTRIBUTES` is no longer supported (removed in Vista). — [Job Object Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/procthread/job-object-security-and-access-rights)
- `SetInformationJobObject(hJob, class, info, len)` needs `JOB_OBJECT_SET_ATTRIBUTES`.
  - Classes: JobObjectExtendedLimitInformation = **9**, JobObjectNotificationLimitInformation = **12** (Windows 8+), JobObjectNotificationLimitInformation2 = 33 (Windows 10+), JobObjectAssociateCompletionPortInformation = 7, JobObjectLimitViolationInformation2 = 34.
  - To change a subset of limits, query the current limits first, then modify and set. — [SetInformationJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-setinformationjobobject)

**AssignProcessToJobObject (DOC)**
- Required rights: hJob needs **JOB_OBJECT_ASSIGN_PROCESS**; hProcess needs **PROCESS_SET_QUOTA and PROCESS_TERMINATE**. — [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- Process already in a job (Windows 8+): the target job "must be empty or it must be in the hierarchy of nested jobs to which the process already belongs, and it cannot have UI limits set". On Windows 7 and earlier it fails with `ERROR_ACCESS_DENIED`. — [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- Nested effective limits: for "commit charge… and working set minimum and maximum, the process inherits an effective limit which is the most restrictive limit of all the jobs in its parent job chain". By default all child processes join the immediate job and every parent job. `CREATE_BREAKAWAY_FROM_JOB` breaks away only where breakaway is allowed. — [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- **Pre-existing usage:** "Memory operations performed by the process before it was associated with the job are not examined by AssignProcessToJobObject." — [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- Other failure modes:
  - Assignment fails if the job or a parent job is terminating.
  - Assignment fails on `JOB_OBJECT_SECURITY_NO_ADMIN` when the token contains Administrators.
  - Assignment fails, **and the process is terminated**, if an active-process limit or an exhausted user-time limit would be violated. A memory-only job does not set these. — [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)
- Terminal Services: "All processes within a job must run within the same session as the job." — [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)

**Lifetime / removal (DOC)**
- "After a process is associated with a job, **the association cannot be broken**." — [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- "The job is destroyed when its last handle has been closed **and** all associated processes have been terminated." With `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (0x2000), closing the last handle **terminates all associated processes**, including processes in nested child jobs. — [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [JOBOBJECT_BASIC_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- Child processes created with `CreateProcess` join the job by default (`Win32_Process.Create` children do not). `JOB_OBJECT_LIMIT_BREAKAWAY_OK` (0x800) and `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK` (0x1000) change this. — [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

**Memory limit semantics (DOC)**
- `JOB_OBJECT_LIMIT_PROCESS_MEMORY` (0x100): "limit their committed memory. When a process attempts to commit memory that would exceed the per-process limit, **it fails**." A `JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT` message goes to an associated completion port. In nested jobs the most restrictive limit applies. — [JOBOBJECT_BASIC_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- `JOB_OBJECT_LIMIT_JOB_MEMORY` (0x200): limits "the job-wide sum of their committed memory… it fails", and sends `JOB_OBJECT_MSG_JOB_MEMORY_LIMIT`. — [JOBOBJECT_BASIC_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- Both flags require JOBOBJECT_EXTENDED_LIMIT_INFORMATION:
  - Layout: `JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; IO_COUNTERS IoInfo (reserved); SIZE_T ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed`.
  - Limits are "virtual memory that can be committed". The two limits are independent, e.g. 100 MB per job with 10 MB per process. — [JOBOBJECT_EXTENDED_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)
- JOBOBJECT_BASIC_LIMIT_INFORMATION layout: `LARGE_INTEGER PerProcessUserTimeLimit, PerJobUserTimeLimit; DWORD LimitFlags; SIZE_T MinimumWorkingSetSize, MaximumWorkingSetSize; DWORD ActiveProcessLimit; ULONG_PTR Affinity; DWORD PriorityClass, SchedulingClass`. Privileges are documented only for PriorityClass and SchedulingClass > 5, both `SE_INC_BASE_PRIORITY_NAME`. — [JOBOBJECT_BASIC_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- Real-world consequence (Raymond Chen, Microsoft): a program's `VirtualAlloc(MEM_COMMIT)` calls failed because it ran inside a job with a **155 MB commit limit**, and the program reported a fatal error. Committing on demand saves only commit charge, not physical memory. — [The Old New Thing, 2017-04-19](https://devblogs.microsoft.com/oldnewthing/20170419-00/?p=95995)

**Working-set limits (DOC)**
- `JOB_OBJECT_LIMIT_WORKINGSET` (0x1) makes all job processes use the same Min/MaxWorkingSetSize. If one is nonzero, the other must be too. In nested jobs the smallest applies.
  - Processes can still empty their working sets with `SetProcessWorkingSetSize(-1,-1)`.
  - "you cannot use SetProcessWorkingSetSize [to] change the minimum or maximum working set size of a process in a job object." — [JOBOBJECT_BASIC_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_limit_information)
- When a job process tries to raise its working set or priority above the job limit, "the function calls succeed but are silently ignored." — [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- `SetProcessWorkingSetSizeEx(hProcess, min, max, Flags)`: the handle needs **PROCESS_SET_QUOTA**.
  - Defaults: min 50 pages (204,800 bytes), max 345 pages (1,413,120 bytes) at a 4K page size. Min is floored at 20 pages. Max must be ≥ 13 pages and less than (available pages − 512).
  - Flags: `QUOTA_LIMITS_HARDWS_MIN_ENABLE` 0x1 / `_MIN_DISABLE` 0x2, `QUOTA_LIMITS_HARDWS_MAX_ENABLE` 0x4 ("The working set will not exceed the maximum") / `_MAX_DISABLE` 0x8 ("may exceed the maximum… if there is abundant memory").
  - Without the hard flags, limits are advisory: the OS may trim below min or allow above max.
  - Raising either value above the current sizes requires **SE_INC_WORKING_SET_NAME**, which "All users generally have". On Server 2003 it required SE_INC_BASE_PRIORITY_NAME.
  - Microsoft warns that increasing working sets "tak[es] away physical memory from the rest of the system" and can cause failures. — [SetProcessWorkingSetSizeEx](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-setprocessworkingsetsizeex)
- `PROCESS_SET_QUOTA` (0x0100) is "Required to set memory limits using SetProcessWorkingSetSize". — [Process Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)

**Notify-only limits (DOC)**
- `JOBOBJECT_NOTIFICATION_LIMIT_INFORMATION` (Windows 8+) fields:
  - `DWORD64 IoReadBytesLimit, IoWriteBytesLimit`
  - `LARGE_INTEGER PerJobUserTimeLimit`
  - `DWORD64 JobMemoryLimit` (job-wide **commit**, in bytes, with `JOB_OBJECT_LIMIT_JOB_MEMORY` 0x200)
  - `RateControlTolerance`, `RateControlToleranceInterval`, `DWORD LimitFlags`
- When the limit is exceeded, `JOB_OBJECT_MSG_NOTIFICATION_LIMIT` is posted to the job's completion port, and "Processes in the job continue to run and can continue to allocate memory".
  - The monitor must call `QueryInformationJobObject(JobObjectLimitViolationInformation)` before another message will be sent.
  - These notifications "are guaranteed to arrive". Other job messages are not guaranteed. — [JOBOBJECT_NOTIFICATION_LIMIT_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_notification_limit_information), [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)

### Inferences
**Feasibility for a standard user (by target type)**
- Same-user, medium-IL processes: the default DACL normally grants `PROCESS_SET_QUOTA|PROCESS_TERMINATE`, so assignment is possible.
- Elevated processes: blocked, because mandatory integrity blocks modify-type access from medium IL.
- Other users' and SYSTEM processes: blocked by DACL.
- PPL processes: blocked, because `PROCESS_SET_QUOTA` is explicitly disallowed (section 2 citations).

**Recommended "honest limit" pattern**
- `CreateJobObjectW(NULL, L"Local\\<AppName>-Limit-<pid>")` with the default (creator-only) DACL. A named job lets the app re-open it after a restart to relax limits. Local\ is the per-session namespace; that is general Windows object-namespace knowledge, not re-verified here.
- **Do not** set KILL_ON_JOB_CLOSE. Without it, closing our handle or crashing does not kill the target, and limits stay in force while the target lives.
- Keep the handle open, or rely on the name, so the user can **raise or remove** the cap. To remove it: query, clear 0x100/0x200 in `LimitFlags`, and set again. There is no way to remove a process from the job.
- Surface clearly that the limit lasts until the target exits.

**Limit below current usage**
- Microsoft only says pre-assignment memory operations "are not examined". The likely behavior is that existing commit stays and only *new* commits fail. Expect immediate allocation failures and possible crashes in the target; label this **[LIMIT] + risk of [DISRUPTIVE]**.

**Child processes and our own process**
- Multi-process apps (browsers, Electron apps) spawn children that inherit the job and its limits unless breakaway is allowed. The per-process cap applies to each child; the job cap applies to the sum.
- Our own app may already be in a job, e.g. one created by a terminal, IDE or launcher. That can clamp our own `ullTotalPageFile`/`ullAvailPageFile` (section 1). It also means a target already in a job can only join *our* job if ours is empty or in its chain.

**Hard working-set max**
- It neither frees commit nor prevents allocation. It forces the target to page against itself: soft faults from standby, and hard faults if those pages are repurposed. It is a residency cap, not a memory "saving", and can badly slow the target.
- To reset to default behavior: `SetProcessWorkingSetSizeEx(h, 204800, 1413120, QUOTA_LIMITS_HARDWS_MIN_DISABLE | QUOTA_LIMITS_HARDWS_MAX_DISABLE)`, scaled to the actual page size. This is inferred from the documented defaults and flags.

**koffi sizes (computed, x64)**
- JOBOBJECT_BASIC_LIMIT_INFORMATION = 64 bytes; IO_COUNTERS = 48; JOBOBJECT_EXTENDED_LIMIT_INFORMATION = 144 bytes. Validate against `QueryInformationJobObject` return length.

### Gaps
- No documentation found on whether `JOB_OBJECT_LIMIT_WORKINGSET` on a job requires a privilege (e.g. SeIncreaseBasePriorityPrivilege or SeIncreaseQuotaPrivilege). The fetched pages only list privileges for priority/scheduling class. Test as a standard user.
- No documentation on whether a job working-set limit is "hard" (like `QUOTA_LIMITS_HARDWS_MAX_ENABLE`) or advisory.
- What happens to an existing process when a commit limit is set *below* its current commit was not documented; see the inference above.
- Whether sandboxed renderer processes of browsers/Electron (restricted tokens, custom DACLs, already in jobs with UI restrictions) can be assigned by a same-user medium-IL tool is not documented. Expect `ERROR_ACCESS_DENIED` in many cases.
- `CreateJobObjectW`/`OpenJobObjectW` reference pages and the "Nested Jobs" page were not fetched individually. The facts above come from the Job Objects overview and the AssignProcessToJobObject page.

---

## 4. Reclamation and "asking" apps to use less (EmptyWorkingSet, memory priority, standby purge, notifications, WM_CLOSE, protections)

### Takeaway
There is **no general API to make another app use less memory**.
- `EmptyWorkingSet` (needs QUERY(_LIMITED) + SET_QUOTA) only moves pages out of the working set. They stay cached in RAM as transition pages, commit is unchanged, and they soft-fault back in. Microsoft calls it "useful primarily for testing and tuning" **[SOFT, mostly cosmetic]**.
- Memory priority (`SetProcessInformation(ProcessMemoryPriority)`, needs PROCESS_SET_INFORMATION) is a trimming hint **[SOFT]**.
- Standby-list purge (`NtSetSystemInformation(SystemMemoryListInformation)`) is undocumented and needs SeProfileSingleProcessPrivilege, i.e. admin. It discards cache that already counts as "Available", so it does not lower "In use" **[requires elevation; not recommended]**.
- Apps may listen to `CreateMemoryResourceNotification` low-memory signals **[MONITOR for us, voluntary for them]**.
- The only cooperative "please free memory" lever that works for arbitrary GUI apps is asking a window to close (`WM_CLOSE`) **[DISRUPTIVE]**. UIPI silently drops it for elevated targets.

### Cited Findings
**EmptyWorkingSet / SetProcessWorkingSetSize(-1,-1) (DOC)**
- `EmptyWorkingSet(hProcess)`: the handle needs "**PROCESS_QUERY_INFORMATION or PROCESS_QUERY_LIMITED_INFORMATION** access right **and the PROCESS_SET_QUOTA** access right". It is equivalent to `SetProcessWorkingSetSize(Ex)` with both sizes `(SIZE_T)-1`. Exported as `K32EmptyWorkingSet` from kernel32 when PSAPI_VERSION ≥ 2. — [EmptyWorkingSet](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-emptyworkingset)
- Microsoft guidance: EmptyWorkingSet "removes as many pages as possible from the process working set. **This operation is useful primarily for testing and tuning.**" — [Working Set Information](https://learn.microsoft.com/en-us/windows/win32/psapi/working-set-information)
- Fate of trimmed pages: after a page leaves all working sets "the page becomes a *transition page*. Transition pages remain cached in RAM until the page is either referenced again… or repurposed". Dirty pages "must be written to its backing store before it can be repurposed". A soft fault resolves "without accessing the backing store" when the page is in transition. — [Working Set](https://learn.microsoft.com/en-us/windows/win32/memory/working-set)
- (COMMUNITY) On Windows 10+, modified pages are compressed into the compression store rather than written straight to the pagefile. — [TweakHound mirror of the Windows Insider post](https://www.tweakhound.com/2015/08/20/windows-10-memory-compression/)

**Memory priority (DOC)**
- `SetProcessInformation(hProcess, ProcessMemoryPriority, &MEMORY_PRIORITY_INFORMATION, sizeof)`: the handle needs **PROCESS_SET_INFORMATION**. Windows 8+. Microsoft recommends apps lower the priority for background work. Lower-priority pages are trimmed first. — [SetProcessInformation](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation)
- `MEMORY_PRIORITY_INFORMATION { ULONG MemoryPriority; }` values: VERY_LOW 1, LOW 2, MEDIUM 3, BELOW_NORMAL 4, NORMAL 5 (the default). It is "a hint to the memory manager when it trims pages from the working set". — [MEMORY_PRIORITY_INFORMATION](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-memory_priority_information)
- `PROCESS_SET_INFORMATION` (0x0200) is listed as **not allowed** to protected processes. — [Process Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)

**Standby list purge (COMMUNITY: undocumented)**
- The Learn page for `NtQuerySystemInformation` lists no SystemMemoryListInformation class. — [NtQuerySystemInformation](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation)
- Git's Windows test helper:
  - Enables `SeProfileSingleProcessPrivilege` via AdjustTokenPrivileges.
  - Calls `NtSetSystemInformation(SystemMemoryListInformation = 80, &command, sizeof(command))` with `command = MemoryPurgeStandbyList`.
  - Command enum: MemoryCaptureAccessedBits, MemoryCaptureAndResetAccessedBits, MemoryEmptyWorkingSets, MemoryFlushModifiedList, MemoryPurgeStandbyList, MemoryPurgeLowPriorityStandbyList, MemoryCommandMax. That makes PurgeStandbyList = 4.
  - On `STATUS_PRIVILEGE_NOT_HELD` (0xC0000061) it reports that admin access is required. — [git t/helper/test-drop-caches.c](https://code.googlesource.com/git/+/HEAD/t/helper/test-drop-caches.c), [bitshifter gist](https://gist.github.com/bitshifter/c87aa396446bbebeab29)

**Low-memory notifications (DOC)**
- `CreateMemoryResourceNotification(LowMemoryResourceNotification=0 | HighMemoryResourceNotification=1)` returns a waitable handle. "This is a system-wide event, so all applications receive notification". There is a middle band where neither is signaled. Microsoft suggests apps "reduce [their] working set" when it is low. Use with `QueryMemoryResourceNotification` or the wait functions. XP+. — [CreateMemoryResourceNotification](https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-creatememoryresourcenotification)

**Asking an app to close (DOC)**
- `WM_CLOSE` (0x0010) is "Sent as a signal that a window or an application should terminate." `DefWindowProc` calls `DestroyWindow` by default. An app "can prompt the user for confirmation… and calling DestroyWindow only if the user confirms". — [WM_CLOSE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-close)
- UIPI: a lower-integrity process cannot "Use SendMessage or PostMessage to application windows running with higher rights. These APIs **return success but silently drop the window message**." UIPI does not affect messaging at the same integrity level. — [Windows Integrity Mechanism Design](https://learn.microsoft.com/en-us/previous-versions/dotnet/articles/bb625963(v=msdn.10))
- `PROCESS_TERMINATE` (0x0001) is required for `TerminateProcess`. — [Process Security and Access Rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights)

### Inferences
**Why purging standby does not reduce "In use"**
- Standby is already counted in `ullAvailPhys`/`PhysicalAvailable` (section 1). Moving it to the free list leaves "Available" roughly unchanged and does not touch "In use". It only discards useful cache, causing later hard faults/disk reads.
- A non-elevated app gets `STATUS_PRIVILEGE_NOT_HELD`: the privilege is normally held only by admins and is not present in a filtered UAC token.
- Do **not** offer a "purge standby" button in a non-elevated app. If offered at all, label it "requires administrator; frees cache, not app memory".

**What EmptyWorkingSet really does**
- On a target the user owns, it raises the "Available" number only to the extent that trimmed pages are clean (go to standby). Dirty pages go to the modified list, which is not counted as Available, then to compression or the pagefile. The pages fault back when touched.
- Present it as **[SOFT] "trim working set (temporary, numbers may rebound)"**, never as "free RAM".
- It fails with access denied on elevated, other-user, SYSTEM and PPL targets (SET_QUOTA is not grantable).

**Memory priority**
- Lowering a background app's memory priority is the most honest "deprioritize" option. It only changes trimming order under pressure.
- It needs PROCESS_SET_INFORMATION (same-user, non-elevated targets only).
- Reset: set NORMAL (5).

**WM_CLOSE etiquette**
- Enumerate the target's top-level visible windows (EnumWindows + GetWindowThreadProcessId) and post `WM_CLOSE` only after explicit user confirmation.
- Label it **[DISRUPTIVE]**: the app may prompt, save, ignore it, or exit.
- For elevated targets the message is silently dropped. The UI must say "cannot close elevated apps from here" rather than report success.
- `TerminateProcess` should be avoided or gated behind a strong warning (data loss). It also requires PROCESS_TERMINATE, which DACL/IL deny for elevated, other-user and SYSTEM targets.

**Non-elevated app: allowed vs. denied (same-user, medium-IL targets → generally allowed)**

| Target | Query memory (QUERY_LIMITED) | Trim / WS limit / job (SET_QUOTA, +TERMINATE for job) | Memory priority (SET_INFORMATION) | WM_CLOSE |
|---|---|---|---|---|
| Same-user, medium IL | yes | yes | yes | delivered |
| Same-user, elevated (high IL) | usually yes (community) | **no** (integrity no-write-up) | **no** | silently dropped (UIPI) |
| SYSTEM / service / other user | typically **no** (DACL); use SystemProcessInformation | **no** | **no** | n/a or blocked |
| PPL / protected | yes (QUERY_LIMITED allowed) | **no** (SET_QUOTA disallowed) | **no** | n/a |

### Gaps
- Raymond Chen's specific posts on why "memory optimizers" and working-set trimming are counterproductive were not located by search this session. Only the 2017 commit-limit post was found.
- No Microsoft page fetched that lists the default holders of SeProfileSingleProcessPrivilege ("Profile single process" user right). The admin-only claim rests on the git helper's error text and general knowledge.
- `NtSetSystemInformation` itself is not documented on Learn. The class number (80) and enum ordering come from community code and could change.
- No source fetched on whether Windows 11 24H2/25H2 changed trimming/standby behavior relevant to these calls.

---

## 5. macOS and Linux comparison (brief)

### Takeaway
**Linux (cgroup v2)** has the closest analog to job objects, with richer semantics:
- `memory.max` is a hard cap that triggers the OOM killer when reclaim fails **[LIMIT/DISRUPTIVE]**.
- `memory.high` is a throttle with heavy reclaim that never OOM-kills **[LIMIT, softer]**.
- `memory.current`, `memory.events` and `memory.pressure` (PSI) are **[MONITOR]**.
- An unprivileged user can apply these only inside a cgroup subtree delegated to them. With systemd, that is typically `systemd-run --user --scope -p MemoryMax=… -p MemoryHigh=… <cmd>`, best suited to *launching* an app under a limit rather than capping an arbitrary running one.

**macOS**: no documented per-process hard memory limit for other apps was found. `purge` (file-cache flush) and `memory_pressure` need sudo per secondary sources.

### Cited Findings
- `memory.max`: "If a cgroup's memory usage reaches this limit and can't be reduced, the OOM killer is invoked in the cgroup." Usage may briefly exceed it. — [Linux kernel: Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- `memory.high`: exceeding it throttles and applies heavy reclaim pressure. "Going over the high limit never invokes the OOM killer and under extreme conditions the limit may be breached." It is intended for external monitors that relieve pressure. — [Linux kernel: Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- `memory.low` = best-effort protection. `memory.min` = hard protection. `memory.current` = usage of the cgroup and its descendants. `memory.events` counts events such as `max`. `memory.pressure` shows PSI. `memory.reclaim` (write-only) triggers proactive reclaim and returns -EAGAIN if it reclaims less than requested. — [Linux kernel: Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- Delegation:
  - Granting a less-privileged user write access to a cgroup directory and its `cgroup.procs`, `cgroup.threads` and `cgroup.subtree_control` delegates it. The delegatee "shouldn't be allowed to write to" the delegated root's own resource control files.
  - Moving a process requires write access to `cgroup.procs` of the common ancestor; otherwise the write fails with -EACCES. A user therefore cannot pull other users' or system processes into their subtree. — [Linux kernel: Control Group v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)
- (COMMUNITY) Under systemd on pure cgroup v2, users can set MemoryLow/MemoryHigh/MemoryMax/MemorySwapMax without extra delegation; CPU and I/O need delegation. — [Arch Wiki user draft (Igo95862/cgroups)](https://wiki.archlinux.org/title/User:Igo95862/cgroups)
- (COMMUNITY) Gotcha: `systemd-run --user --scope` with MemoryMax applied no limit until the memory controller was enabled in the parent's `cgroup.subtree_control`. — [NixOS Discourse](https://discourse.nixos.org/t/ram-limiting-firefox-for-pathological-tabbers/5117/2)
- (COMMUNITY) macOS `purge` is run as `sudo purge`. Per its man page (quoted secondhand), it approximates a cold disk-buffer-cache state for performance analysis and does not affect anonymous (malloc/vm_allocate) memory. — [Pplware](https://pplware.sapo.pt/?p=549640)
- (COMMUNITY) macOS `memory_pressure` can apply real or simulated (`-S`) pressure at levels `warn`/`critical` and typically needs sudo ("Operation not permitted" otherwise). — [Eternal Storms blog](https://blog.eternalstorms.at/?p=750)

### Inferences
- Cross-platform labeling for the app:
  - Windows job commit cap ≈ Linux `memory.max`, but semantics differ. Windows fails the allocation; Linux reclaims then OOM-kills in the cgroup.
  - Windows notify-only job limit ≈ Linux `memory.events`/PSI monitoring.
  - Windows hard working-set max ≈ Linux `memory.high`-style reclaim pressure. Both are residency/reclaim pressure, not allocation failure.
- On Linux the realistic non-root feature is "launch app X under a limit" via `systemd-run --user --scope`. Retrofitting a limit onto an already-running process is possible only if it is already inside the user's delegated subtree; moving it requires write access to `cgroup.procs` of a common ancestor.
- On macOS, label all per-app limiting as "not available". Offer monitoring only, plus "ask app to quit" via normal app-level mechanisms.

### Gaps
- No Apple developer documentation was fetched. The macOS claims (`purge`, `memory_pressure`, no per-process limit API for other apps) rest on secondary blogs and man-page quotes.
- The default systemd user-manager delegation of the memory controller (which systemd version, distro defaults) was not verified from systemd's own documentation.
