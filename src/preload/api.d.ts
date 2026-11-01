import type {
  ActionReply,
  AppDetail,
  Capabilities,
  RoaringPreview,
  RoaringRequest,
  SealInput,
  Snapshot
} from '../shared/ipc'

export interface RRApi {
  capabilities(): Promise<Capabilities>
  snapshot(): Promise<Snapshot>
  onSnapshot(fn: (s: Snapshot) => void): () => void
  appDetail(key: string): Promise<AppDetail>
  previewRoaring(): Promise<RoaringPreview>
  runRoaring(req: RoaringRequest): Promise<ActionReply>
  runTitan(key: string): Promise<ActionReply>
  askToClose(key: string): Promise<ActionReply>
  saveSeal(input: SealInput): Promise<ActionReply>
  removeSeal(key: string): Promise<ActionReply>
  setSealEnabled(key: string, enabled: boolean): Promise<ActionReply>
  setWaterline(bytes: number | null): Promise<ActionReply>
  clearEchoes(): Promise<void>
  appIcon(key: string): Promise<string | null>
}

declare global {
  interface Window {
    rr: RRApi
  }
}
