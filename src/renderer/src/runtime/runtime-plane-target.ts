import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { rowLessSourceTarget, type RowLessSource } from '@/lib/default-creation-host'

export type RuntimePlaneSettings = RowLessSource

export function getPlaneRuntimeTarget(source: RuntimePlaneSettings): RuntimeClientTarget {
  return rowLessSourceTarget(source)
}
