import { z } from 'zod'
import {
  OptionalFiniteNumber,
  OptionalPlainString,
  OptionalString,
  requiredString
} from './rpc-param-primitives'

export const FieldMapping = z.object({
  titleField: OptionalPlainString,
  descriptionField: OptionalPlainString,
  acceptanceCriteriaField: OptionalPlainString,
  urlField: OptionalPlainString,
  statusField: OptionalPlainString,
  completedValue: OptionalPlainString
})

const OptionalFieldMapping = FieldMapping.optional()

export const DiscoverTables = z.object({
  appId: requiredString('App ID is required'),
  appSecret: requiredString('App secret is required'),
  appToken: requiredString('Bitable link or app token is required')
})

export const Connect = z.object({
  label: OptionalPlainString,
  appId: requiredString('App ID is required'),
  appSecret: requiredString('App secret is required'),
  appToken: requiredString('Bitable app token is required'),
  tableId: requiredString('Table ID is required'),
  viewId: OptionalString,
  fieldMapping: OptionalFieldMapping
})

export const ConnectionSelection = z
  .object({
    connectionId: OptionalString
  })
  .optional()

export const SelectConnection = z.object({
  connectionId: z.union([OptionalString, z.null()])
})

export const ListRecords = z
  .object({
    connectionId: OptionalString,
    pageToken: OptionalString,
    pageSize: OptionalFiniteNumber
  })
  .optional()

export const GetRecord = z.object({
  connectionId: OptionalString,
  recordId: requiredString('Record ID is required')
})

export const ListFields = z
  .object({
    connectionId: OptionalString
  })
  .optional()

export const UpdateFieldMapping = z.object({
  connectionId: requiredString('Connection ID is required'),
  fieldMapping: FieldMapping
})

export const CompleteRecord = z.object({
  record: z.object({
    connectionId: requiredString('Connection ID is required'),
    appToken: requiredString('Bitable app token is required'),
    tableId: requiredString('Table ID is required'),
    recordId: requiredString('Record ID is required')
  })
})
