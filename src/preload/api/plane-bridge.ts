import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const planeApi = {
  connect: (args) => ipcRenderer.invoke('plane:connect', args),
  status: () => ipcRenderer.invoke('plane:status'),
  disconnect: () => ipcRenderer.invoke('plane:disconnect'),
  setProjectScope: (args) => ipcRenderer.invoke('plane:setProjectScope', args),
  listProjects: (args) => ipcRenderer.invoke('plane:listProjects', args),
  listWorkItems: (args) => ipcRenderer.invoke('plane:listWorkItems', args),
  getWorkItem: (args) => ipcRenderer.invoke('plane:getWorkItem', args),
  lookupWorkItem: (args) => ipcRenderer.invoke('plane:lookupWorkItem', args),
  listStates: (args) => ipcRenderer.invoke('plane:listStates', args),
  listMembers: (args) => ipcRenderer.invoke('plane:listMembers', args),
  listComments: (args) => ipcRenderer.invoke('plane:listComments', args),
  updateState: (args) => ipcRenderer.invoke('plane:updateState', args),
  addComment: (args) => ipcRenderer.invoke('plane:addComment', args)
} satisfies PreloadApi['plane']
