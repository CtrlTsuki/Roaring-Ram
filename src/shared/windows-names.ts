// Processes R.R. treats as part of Windows. It never trims, limits or asks these to close, even
// when Windows would grant access (for example when R.R. runs as administrator).
export const CRITICAL = new Set([
  'idle',
  'system',
  'secure system',
  'registry',
  'memory compression',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'lsaiso.exe',
  'svchost.exe',
  'fontdrvhost.exe',
  'dwm.exe',
  'sihost.exe',
  'taskhostw.exe',
  'ctfmon.exe',
  'audiodg.exe',
  'spoolsv.exe',
  'msmpeng.exe',
  'nissrv.exe',
  'securityhealthservice.exe',
  'wudfhost.exe',
  'dllhost.exe',
  'conhost.exe',
  'runtimebroker.exe',
  'searchindexer.exe',
  'wmiprvse.exe'
])

// The desktop shell. Trimming it is harmless, but asking it to close would take the taskbar with it.
export const SHELL = new Set([
  'explorer.exe',
  'shellexperiencehost.exe',
  'startmenuexperiencehost.exe',
  'searchhost.exe',
  'textinputhost.exe',
  'lockapp.exe',
  // Hosts the windows of Store apps (Settings, Calculator, Photos); closing it closes them all.
  'applicationframehost.exe'
])
