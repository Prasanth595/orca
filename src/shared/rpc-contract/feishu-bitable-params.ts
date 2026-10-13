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
  urlField: OptionalPlainString
})

const OptionalFieldMapping = FieldMapping.optional()

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
