import { usePlaneHostScope } from './plane-host-scope'

/** Name of the host that holds the Plane token and makes every Plane request. */
export function usePlaneHostLabel(): string {
  return usePlaneHostScope().label
}
