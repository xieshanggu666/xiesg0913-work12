import { contextBridge, ipcRenderer } from 'electron'
import type {
  ExperimentRecord,
  ForgeBridge,
  SnapshotRecord,
  StoryboardPresetRecord
} from '../shared/types'

const bridge: ForgeBridge = {
  listSnapshots: () => ipcRenderer.invoke('pn:snapshots:list'),
  saveSnapshot: (record: Omit<SnapshotRecord, 'id' | 'created_at'>) =>
    ipcRenderer.invoke('pn:snapshots:save', record),
  deleteSnapshot: (id: number) => ipcRenderer.invoke('pn:snapshots:delete', id),
  listPresets: () => ipcRenderer.invoke('pn:presets:list'),
  savePreset: (record: Omit<StoryboardPresetRecord, 'id' | 'created_at'>) =>
    ipcRenderer.invoke('pn:presets:save', record),
  deletePreset: (id: number) => ipcRenderer.invoke('pn:presets:delete', id),
  listExperiments: () => ipcRenderer.invoke('pn:experiments:list'),
  saveExperiment: (record: Omit<ExperimentRecord, 'id' | 'created_at'>) =>
    ipcRenderer.invoke('pn:experiments:save', record),
  updateExperimentConclusion: (id: number, conclusion: string) =>
    ipcRenderer.invoke('pn:experiments:conclusion', id, conclusion),
  deleteExperiment: (id: number) => ipcRenderer.invoke('pn:experiments:delete', id),
  exportStoryboard: (dataUrl: string, defaultName: string) =>
    ipcRenderer.invoke('pn:storyboard:export', dataUrl, defaultName),
  exportTrajectory: (json: string, defaultName: string) =>
    ipcRenderer.invoke('pn:trajectory:export', json, defaultName),
  importTrajectory: () => ipcRenderer.invoke('pn:trajectory:import'),
  exportAnnotations: (json: string, defaultName: string) =>
    ipcRenderer.invoke('pn:annotations:export', json, defaultName),
  importAnnotations: () => ipcRenderer.invoke('pn:annotations:import')
}

contextBridge.exposeInMainWorld('forge', bridge)
