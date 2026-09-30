/** @file AJV instance configured for datalinks. */
import type * as ajv from 'ajv/dist/2020'
import Ajv from 'ajv/dist/2020'

import SCHEMA from '$/utils/datalinkSchema.json' with { type: 'json' }

import * as error from 'enso-common/src/utilities/errors'

export const AJV = new Ajv({
  formats: {
    'enso-secret': (value) => typeof value === 'string' && value !== '',
    'enso-file': true,
  },
})
AJV.addSchema(SCHEMA)

export const validateDatalink = error.assert<ajv.ValidateFunction>(() =>
  AJV.getSchema('#/$defs/DataLink'),
)
