// Thin, honest bindings to the Win32 memory APIs R.R. uses. Every function here either reads
// state or performs one documented, permission-checked action. Nothing elevates, injects,
// terminates, or works around an access check: when Windows says no, we report "no".
//
// References (Microsoft Learn): GlobalMemoryStatusEx, GetPerformanceInfo, NtQuerySystemInformation
// (SystemProcessInformation), OpenProcess, EmptyWorkingSet, SetProcessWorkingSetSizeEx,
// CreateJobObjectW, SetInformationJobObject, AssignProcessToJobObject, EnumWindows, PostMessageW.
import koffi from 'koffi'
import type { SystemMemory } from '../shared/types'

const kernel32 = koffi.load('kernel32.dll')
const ntdll = koffi.load('ntdll.dll')
const user32 = koffi.load('user32.dll')
const dwmapi = koffi.load('dwmapi.dll')
const version = koffi.load('version.dll')

const HANDLE = koffi.pointer('HANDLE', koffi.opaque())
// Registered by name for the prototypes below.
koffi.alias('HWND', HANDLE)

const MEMORYSTATUSEX = koffi.struct('MEMORYSTATUSEX', {
  dwLength: 'uint32',
  dwMemoryLoad: 'uint32',
  ullTotalPhys: 'uint64',
  ullAvailPhys: 'uint64',
  ullTotalPageFile: 'uint64',
  ullAvailPageFile: 'uint64',
  ullTotalVirtual: 'uint64',
  ullAvailVirtual: 'uint64',
  ullAvailExtendedVirtual: 'uint64'
})

const PERFORMANCE_INFORMATION = koffi.struct('PERFORMANCE_INFORMATION', {
  cb: 'uint32',
  CommitTotal: 'size_t',
  CommitLimit: 'size_t',
  CommitPeak: 'size_t',
  PhysicalTotal: 'size_t',
  PhysicalAvailable: 'size_t',
  SystemCache: 'size_t',
  KernelTotal: 'size_t',
  KernelPaged: 'size_t',
  KernelNonpaged: 'size_t',
  PageSize: 'size_t',
  HandleCount: 'uint32',
  ProcessCount: 'uint32',
  ThreadCount: 'uint32'
})

const JOBOBJECT_BASIC_LIMIT_INFORMATION = koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
  PerProcessUserTimeLimit: 'int64',
  PerJobUserTimeLimit: 'int64',
  LimitFlags: 'uint32',
  MinimumWorkingSetSize: 'size_t',
  MaximumWorkingSetSize: 'size_t',
  ActiveProcessLimit: 'uint32',
  Affinity: 'uintptr_t',
  PriorityClass: 'uint32',
  SchedulingClass: 'uint32'
})

// Registered by name; two DWORDs keep the full 64-bit value exact.
koffi.struct('FILETIME', { low: 'uint32', high: 'uint32' })

const IO_COUNTERS = koffi.struct('IO_COUNTERS', {
  ReadOperationCount: 'uint64',
  WriteOperationCount: 'uint64',
  OtherOperationCount: 'uint64',
  ReadTransferCount: 'uint64',
  WriteTransferCount: 'uint64',
  OtherTransferCount: 'uint64'
})

const JOBOBJECT_EXTENDED_LIMIT_INFORMATION = koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
  BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION,
  IoInfo: IO_COUNTERS,
  ProcessMemoryLimit: 'size_t',
  JobMemoryLimit: 'size_t',
  PeakProcessMemoryUsed: 'size_t',
  PeakJobMemoryUsed: 'size_t'
})

koffi.proto('bool __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)')

const GlobalMemoryStatusEx = kernel32.func('bool __stdcall GlobalMemoryStatusEx(_Inout_ MEMORYSTATUSEX *buf)')
const K32GetPerformanceInfo = kernel32.func(
  'bool __stdcall K32GetPerformanceInfo(_Out_ PERFORMANCE_INFORMATION *info, uint32 cb)'
)
const GetPhysicallyInstalledSystemMemory = kernel32.func(
  'bool __stdcall GetPhysicallyInstalledSystemMemory(_Out_ uint64 *kb)'
)
const GetLastError = kernel32.func('uint32 __stdcall GetLastError()')
const RtlMoveMemory = kernel32.func('void __stdcall RtlMoveMemory(void *dst, void *src, size_t len)')
const GetCurrentProcessId = kernel32.func('uint32 __stdcall GetCurrentProcessId()')
const OpenProcess = kernel32.func('HANDLE __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)')
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(HANDLE h)')
const GetProcessTimes = kernel32.func(
  'bool __stdcall GetProcessTimes(HANDLE h, _Out_ FILETIME *created, _Out_ FILETIME *exited, _Out_ FILETIME *kernel, _Out_ FILETIME *user)'
)
const K32EmptyWorkingSet = kernel32.func('bool __stdcall K32EmptyWorkingSet(HANDLE h)')
const QueryFullProcessImageNameW = kernel32.func(
  'bool __stdcall QueryFullProcessImageNameW(HANDLE h, uint32 flags, _Out_ char16_t *name, _Inout_ uint32 *size)'
)
const SetProcessWorkingSetSizeEx = kernel32.func(
  'bool __stdcall SetProcessWorkingSetSizeEx(HANDLE h, size_t min, size_t max, uint32 flags)'
)
const GetProcessWorkingSetSizeEx = kernel32.func(
  'bool __stdcall GetProcessWorkingSetSizeEx(HANDLE h, _Out_ size_t *min, _Out_ size_t *max, _Out_ uint32 *flags)'
)
const CreateJobObjectW = kernel32.func('HANDLE __stdcall CreateJobObjectW(void *attrs, const char16_t *name)')
const SetInformationJobObject = kernel32.func(
  'bool __stdcall SetInformationJobObject(HANDLE job, int cls, JOBOBJECT_EXTENDED_LIMIT_INFORMATION *info, uint32 len)'
)
const QueryInformationJobObject = kernel32.func(
  'bool __stdcall QueryInformationJobObject(HANDLE job, int cls, _Out_ JOBOBJECT_EXTENDED_LIMIT_INFORMATION *info, uint32 len, _Out_ uint32 *ret)'
)
const QueryJobProcessIds = kernel32.func(
  'bool __stdcall QueryInformationJobObject(HANDLE job, int cls, _Out_ uint8_t *info, uint32 len, _Out_ uint32 *ret)'
)
const AssignProcessToJobObject = kernel32.func('bool __stdcall AssignProcessToJobObject(HANDLE job, HANDLE proc)')
const IsProcessInJob = kernel32.func('bool __stdcall IsProcessInJob(HANDLE proc, HANDLE job, _Out_ bool *result)')
const NtQuerySystemInformation = ntdll.func(
  'int32 __stdcall NtQuerySystemInformation(int cls, void *buf, uint32 len, _Out_ uint32 *retLen)'
)
const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)')
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(HWND hwnd, _Out_ uint32 *pid)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(HWND hwnd)')
const GetWindow = user32.func('HWND __stdcall GetWindow(HWND hwnd, uint32 cmd)')
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(HWND hwnd)')
const PostMessageW = user32.func('bool __stdcall PostMessageW(HWND hwnd, uint32 msg, uintptr_t w, intptr_t l)')
const DwmGetWindowAttribute = dwmapi.func(
  'int32 __stdcall DwmGetWindowAttribute(HWND hwnd, uint32 attr, _Out_ uint32 *value, uint32 size)'
)
const GetFileVersionInfoSizeW = version.func('uint32 __stdcall GetFileVersionInfoSizeW(const char16_t *path, void *zero)')
const GetFileVersionInfoW = version.func(
  'bool __stdcall GetFileVersionInfoW(const char16_t *path, uint32 zero, uint32 len, _Out_ uint8_t *data)'
)
const VerQueryValueW = version.func(
  'bool __stdcall VerQueryValueW(const uint8_t *block, const char16_t *sub, _Out_ void **buf, _Out_ uint32 *len)'
)

// Access rights (winnt.h)
const PROCESS_TERMINATE = 0x0001
const PROCESS_SET_QUOTA = 0x0100
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
// Working-set quota flags
const QUOTA_LIMITS_HARDWS_MIN_DISABLE = 0x2
const QUOTA_LIMITS_HARDWS_MAX_ENABLE = 0x4
const QUOTA_LIMITS_HARDWS_MAX_DISABLE = 0x8
// Job objects
const JobObjectExtendedLimitInformation = 9
const JobObjectBasicProcessIdList = 3
const JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200
const JOB_OBJECT_LIMIT_BREAKAWAY_OK = 0x800
const JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK = 0x1000
// Windows
const GW_OWNER = 4
const WM_CLOSE = 0x0010
const DWMWA_CLOAKED = 14
// Status / errors
const STATUS_INFO_LENGTH_MISMATCH = 0xc0000004 | 0
const ERROR_ACCESS_DENIED = 5
const ERROR_INVALID_PARAMETER = 87
const SystemProcessInformation = 5

const PAGE_DEFAULT_MIN_WS = 50 * 4096
const PAGE_DEFAULT_MAX_WS = 345 * 4096

export type ActionResult = { ok: true } | { ok: false; denied: boolean; code: number; message: string }

function fail(code = GetLastError()): ActionResult {
  return { ok: false, denied: code === ERROR_ACCESS_DENIED, code, message: describeError(code) }
}

export function describeError(code: number): string {
  switch (code) {
    case ERROR_ACCESS_DENIED:
      return 'Windows denied access.'
    case ERROR_INVALID_PARAMETER:
      return 'The process has exited.'
    default:
      return `Windows error ${code}.`
  }
}

export function selfPid(): number {
  return GetCurrentProcessId()
}

export function systemMemory(): SystemMemory {
  const ms: Record<string, number> = { dwLength: koffi.sizeof(MEMORYSTATUSEX) }
  if (!GlobalMemoryStatusEx(ms)) throw new Error(`GlobalMemoryStatusEx failed: ${describeError(GetLastError())}`)

  const pi: Record<string, number> = {}
  if (!K32GetPerformanceInfo(pi, koffi.sizeof(PERFORMANCE_INFORMATION))) {
    throw new Error(`GetPerformanceInfo failed: ${describeError(GetLastError())}`)
  }
  const page = pi.PageSize

  const kb = [0]
  const installed = GetPhysicallyInstalledSystemMemory(kb) ? kb[0] * 1024 : null

  return {
    totalPhys: ms.ullTotalPhys,
    installed,
    availPhys: ms.ullAvailPhys,
    used: ms.ullTotalPhys - ms.ullAvailPhys,
    commitTotal: pi.CommitTotal * page,
    commitLimit: pi.CommitLimit * page,
    cache: pi.SystemCache * page,
    kernelPaged: pi.KernelPaged * page,
    kernelNonpaged: pi.KernelNonpaged * page
  }
}

export interface RawProc {
  pid: number
  parentPid: number
  name: string
  privateWs: number
  workingSet: number
  commit: number
  createTime: bigint
}

// One reusable buffer for the process snapshot; grown when Windows asks for more.
let snapSize = 2 * 1024 * 1024
let snapPtr: unknown = koffi.alloc('uint8_t', snapSize)
let snapCopy = Buffer.alloc(snapSize)
const utf16 = new TextDecoder('utf-16le')

/**
 * Snapshot of every process with its memory counters, in one call and without opening any
 * process (SystemProcessInformation). Microsoft documents this call as subject to change;
 * the x64 SYSTEM_PROCESS_INFORMATION offsets below match winternl.h and are verified in tests
 * against GetProcessMemoryInfo for R.R.'s own process.
 */
export function processes(): RawProc[] {
  const ret = [0]
  for (let attempt = 0; ; attempt++) {
    const status = NtQuerySystemInformation(SystemProcessInformation, snapPtr, snapSize, ret)
    if (status === 0) break
    if (status === STATUS_INFO_LENGTH_MISMATCH && attempt < 4) {
      koffi.free(snapPtr)
      snapSize = Math.max(snapSize * 2, ret[0] + 256 * 1024)
      snapPtr = koffi.alloc('uint8_t', snapSize)
      continue
    }
    throw new Error(`NtQuerySystemInformation failed with status 0x${(status >>> 0).toString(16)}`)
  }

  // Copy out of native memory rather than viewing it in place: Electron's V8 memory cage forbids
  // ArrayBuffers that point outside it. The names inside the snapshot are absolute pointers into
  // the native block, so offsets are computed against its address.
  const used = Math.min(ret[0] || snapSize, snapSize)
  if (snapCopy.length < used) snapCopy = Buffer.alloc(snapSize)
  RtlMoveMemory(snapCopy, snapPtr, used)
  const base = BigInt(koffi.address(snapPtr))
  const ab = snapCopy.buffer as ArrayBuffer
  const dv = new DataView(ab, snapCopy.byteOffset, used)
  const out: RawProc[] = []
  let off = 0
  for (;;) {
    const next = dv.getUint32(off, true)
    const nameLen = dv.getUint16(off + 56, true)
    const namePtr = dv.getBigUint64(off + 64, true)
    const pid = Number(dv.getBigUint64(off + 80, true))
    let name: string
    if (pid === 0) name = 'Idle'
    else if (namePtr === 0n || nameLen === 0) name = 'System'
    else {
      const rel = Number(namePtr - base)
      name = rel >= 0 && rel + nameLen <= used ? utf16.decode(new Uint8Array(ab, snapCopy.byteOffset + rel, nameLen)) : `pid ${pid}`
    }
    out.push({
      pid,
      parentPid: Number(dv.getBigUint64(off + 88, true)),
      name,
      privateWs: Number(dv.getBigInt64(off + 8, true)),
      workingSet: Number(dv.getBigUint64(off + 144, true)),
      commit: Number(dv.getBigUint64(off + 200, true)),
      createTime: dv.getBigInt64(off + 32, true)
    })
    if (next === 0) break
    off += next
  }
  return out
}

/**
 * Opens a process with exactly the rights an action needs. When `created` is given, the action
 * runs only if the process's creation time still matches: a PID Windows has reused for a new
 * process since the snapshot is treated as gone, so a seal never lands on the wrong app.
 */
function withProcess<T>(pid: number, access: number, fn: (h: unknown) => T, onDenied: (code: number) => T, created?: bigint): T {
  const h = OpenProcess(access | (created != null ? PROCESS_QUERY_LIMITED_INFORMATION : 0), false, pid)
  if (!h) return onDenied(GetLastError())
  try {
    if (created != null) {
      const c: Record<string, number> = {}
      if (!GetProcessTimes(h, c, {}, {}, {}) || ((BigInt(c.high) << 32n) | BigInt(c.low)) !== created) {
        return onDenied(ERROR_INVALID_PARAMETER)
      }
    }
    return fn(h)
  } finally {
    CloseHandle(h)
  }
}

/** Can R.R. trim this process? Opens and closes a handle with only the rights trimming needs. */
export function canTrim(pid: number): boolean {
  return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, () => true, () => false)
}

export function imagePath(pid: number): string | null {
  return withProcess(
    pid,
    PROCESS_QUERY_LIMITED_INFORMATION,
    (h) => {
      const buf = Buffer.alloc(2 * 1024)
      const size = [1024]
      if (!QueryFullProcessImageNameW(h, 0, buf, size)) return null
      return buf.toString('utf16le', 0, size[0] * 2)
    },
    () => null
  )
}

const descriptionCache = new Map<string, string | null>()

/** The FileDescription from an executable's version resource, e.g. "Google Chrome". */
export function fileDescription(path: string): string | null {
  if (descriptionCache.has(path)) return descriptionCache.get(path)!
  let result: string | null = null
  try {
    const size = GetFileVersionInfoSizeW(path, null)
    if (size > 0) {
      const data = Buffer.alloc(size)
      if (GetFileVersionInfoW(path, 0, size, data)) {
        const ptr = [null]
        const len = [0]
        const langs: string[] = []
        if (VerQueryValueW(data, '\\VarFileInfo\\Translation', ptr, len) && len[0] >= 4) {
          const pairs = koffi.decode(ptr[0], 'uint16', len[0] / 2) as number[]
          for (let i = 0; i + 1 < pairs.length; i += 2) {
            langs.push(pairs[i].toString(16).padStart(4, '0') + pairs[i + 1].toString(16).padStart(4, '0'))
          }
        }
        langs.push('040904b0', '040904e4')
        for (const lang of langs) {
          if (VerQueryValueW(data, `\\StringFileInfo\\${lang}\\FileDescription`, ptr, len) && len[0] > 1) {
            const text = (koffi.decode(ptr[0], 'char16_t', len[0]) as string).replace(/\0+$/, '').trim()
            if (text) {
              result = text
              break
            }
          }
        }
      }
    }
  } catch {
    result = null
  }
  descriptionCache.set(path, result)
  return result
}

/** Moves a process's pages out of its working set. They stay cached and fault back in on use. */
export function trim(pid: number, created?: bigint): ActionResult {
  return withProcess(
    pid,
    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA,
    (h) => (K32EmptyWorkingSet(h) ? ({ ok: true } as const) : fail()),
    (code) => fail(code),
    created
  )
}

/**
 * Sets (bytes) or clears (null) a hard maximum on a process's working set. Windows then keeps
 * the process's resident memory at or below the value by paging the rest out.
 */
export function setCeiling(pid: number, bytes: number | null, created?: bigint): ActionResult {
  return withProcess(
    pid,
    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA,
    (h) => {
      let ok: boolean
      if (bytes == null) {
        ok = SetProcessWorkingSetSizeEx(
          h,
          PAGE_DEFAULT_MIN_WS,
          PAGE_DEFAULT_MAX_WS,
          QUOTA_LIMITS_HARDWS_MIN_DISABLE | QUOTA_LIMITS_HARDWS_MAX_DISABLE
        )
      } else {
        const min = [0]
        const max = [0]
        const flags = [0]
        GetProcessWorkingSetSizeEx(h, min, max, flags)
        const floor = Math.min(min[0] || PAGE_DEFAULT_MIN_WS, Math.floor(bytes / 2))
        ok = SetProcessWorkingSetSizeEx(
          h,
          floor,
          bytes,
          QUOTA_LIMITS_HARDWS_MIN_DISABLE | QUOTA_LIMITS_HARDWS_MAX_ENABLE
        )
      }
      return ok ? ({ ok: true } as const) : fail()
    },
    (code) => fail(code),
    created
  )
}

/** Reads the current hard working-set maximum, or null when none is set. */
export function readCeiling(pid: number): number | null {
  return withProcess(
    pid,
    PROCESS_QUERY_LIMITED_INFORMATION,
    (h) => {
      const min = [0]
      const max = [0]
      const flags = [0]
      if (!GetProcessWorkingSetSizeEx(h, min, max, flags)) return null
      return flags[0] & QUOTA_LIMITS_HARDWS_MAX_ENABLE ? max[0] : null
    },
    () => null
  )
}

// ---- Job objects (caps) ----

export type JobHandle = unknown

/**
 * Creates a new, unnamed job for an app's cap. Unnamed on purpose: Windows drops a job's name when
 * its last handle closes, so a name would never let R.R. find the job again after a restart, and
 * it would let another program pre-create a job under that name for R.R. to join.
 */
export function openJob(key: string): JobHandle {
  const h = CreateJobObjectW(null, null)
  if (!h) throw new Error(`CreateJobObject failed for ${key}: ${describeError(GetLastError())}`)
  // Breakaway is set before any process joins, so no child is ever captured by accident.
  const r = setJobCap(h, null)
  if (!r.ok) {
    CloseHandle(h)
    throw new Error(`Could not prepare the job for ${key}: ${r.message}`)
  }
  return h
}

export function closeJob(job: JobHandle): void {
  CloseHandle(job)
}

function emptyLimits(): Record<string, unknown> {
  return {
    BasicLimitInformation: {
      PerProcessUserTimeLimit: 0,
      PerJobUserTimeLimit: 0,
      LimitFlags: 0,
      MinimumWorkingSetSize: 0,
      MaximumWorkingSetSize: 0,
      ActiveProcessLimit: 0,
      Affinity: 0,
      PriorityClass: 0,
      SchedulingClass: 0
    },
    IoInfo: {
      ReadOperationCount: 0,
      WriteOperationCount: 0,
      OtherOperationCount: 0,
      ReadTransferCount: 0,
      WriteTransferCount: 0,
      OtherTransferCount: 0
    },
    ProcessMemoryLimit: 0,
    JobMemoryLimit: 0,
    PeakProcessMemoryUsed: 0,
    PeakJobMemoryUsed: 0
  }
}

/** Sets (bytes) or removes (null) the job-wide commit cap. Never sets kill-on-close. */
export function setJobCap(job: JobHandle, bytes: number | null): ActionResult {
  const info = emptyLimits()
  // Programs the capped app launches leave the job at once, so a cap on a launcher never spreads
  // to the apps it starts. R.R. adds the app's own processes by name instead.
  let flags = JOB_OBJECT_LIMIT_BREAKAWAY_OK | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK
  if (bytes != null) {
    flags |= JOB_OBJECT_LIMIT_JOB_MEMORY
    info.JobMemoryLimit = bytes
  }
  ;(info.BasicLimitInformation as Record<string, number>).LimitFlags = flags
  const ok = SetInformationJobObject(
    job,
    JobObjectExtendedLimitInformation,
    info,
    koffi.sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)
  )
  return ok ? { ok: true } : fail()
}

export function readJobCap(job: JobHandle): { cap: number | null; peak: number; flags: number } {
  const info: Record<string, any> = {}
  const ret = [0]
  if (!QueryInformationJobObject(job, JobObjectExtendedLimitInformation, info, koffi.sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION), ret)) {
    return { cap: null, peak: 0, flags: 0 }
  }
  const flags = info.BasicLimitInformation.LimitFlags as number
  return { cap: flags & JOB_OBJECT_LIMIT_JOB_MEMORY ? info.JobMemoryLimit : null, peak: info.PeakJobMemoryUsed, flags }
}

/** Puts a process in the job. Needs PROCESS_SET_QUOTA and PROCESS_TERMINATE on it (Windows' rule
 *  for job assignment); R.R. never terminates anything. A process cannot leave a job afterwards. */
export function assignToJob(job: JobHandle, pid: number, created?: bigint): ActionResult {
  return withProcess(
    pid,
    PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA | PROCESS_TERMINATE,
    (h) => {
      const inJob = [false]
      if (IsProcessInJob(h, job, inJob) && inJob[0]) return { ok: true } as const
      return AssignProcessToJobObject(job, h) ? ({ ok: true } as const) : fail()
    },
    (code) => fail(code),
    created
  )
}

/** Every process inside the job, including any the app itself placed in a job of its own there. */
export function jobProcessIds(job: JobHandle): number[] {
  // JOBOBJECT_BASIC_PROCESS_ID_LIST: two DWORDs, then ULONG_PTR ids (8-byte aligned on x64).
  for (let slots = 256; slots <= 16384; slots *= 4) {
    const buf = Buffer.alloc(8 + slots * 8)
    const ret = [0]
    if (QueryJobProcessIds(job, JobObjectBasicProcessIdList, buf, buf.length, ret)) {
      const count = buf.readUInt32LE(4)
      const ids: number[] = []
      for (let i = 0; i < count; i++) ids.push(Number(buf.readBigUInt64LE(8 + i * 8)))
      return ids
    }
    if (GetLastError() !== 234 /* ERROR_MORE_DATA */) return []
  }
  return []
}

export function isInJob(job: JobHandle, pid: number): boolean {
  return withProcess(
    pid,
    PROCESS_QUERY_LIMITED_INFORMATION,
    (h) => {
      const r = [false]
      return IsProcessInJob(h, job, r) ? r[0] : false
    },
    () => false
  )
}

// ---- Windows (for polite close requests) ----

/** PIDs that own a visible, titled, unowned, uncloaked top-level window, with those windows. */
export function windowOwners(): Map<number, unknown[]> {
  const owners = new Map<number, unknown[]>()
  const pidOut = [0]
  const cloaked = [0]
  EnumWindows((hwnd: unknown) => {
    if (!IsWindowVisible(hwnd)) return true
    if (GetWindow(hwnd, GW_OWNER)) return true
    if (GetWindowTextLengthW(hwnd) === 0) return true
    if (DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) return true
    GetWindowThreadProcessId(hwnd, pidOut)
    const list = owners.get(pidOut[0]) ?? []
    list.push(hwnd)
    owners.set(pidOut[0], list)
    return true
  }, 0)
  return owners
}

/** Asks windows to close, exactly like clicking their close button. Apps may ask to save, refuse,
 *  or minimise to the tray instead; that is their choice. */
export function requestClose(windows: unknown[]): number {
  let posted = 0
  for (const hwnd of windows) if (PostMessageW(hwnd, WM_CLOSE, 0, 0)) posted++
  return posted
}
