/**
 * @file The password schemas of the authentication pages, shared with the React settings page's
 * password change.
 */
import { PASSWORD_REGEX } from '$/cloud/validation'
import type { GetText } from '$/providers/text'
import { z } from 'zod'

/** Cognito's bounds on a password's length. */
const MIN_PASSWORD_LENGTH = 6
const MAX_PASSWORD_LENGTH = 256

/** A schema for validating passwords. */
export function passwordSchema(getText: GetText) {
  return z
    .string()
    .trim()
    .min(MIN_PASSWORD_LENGTH, { message: getText('passwordLengthError') })
    .max(MAX_PASSWORD_LENGTH, { message: getText('passwordLengthError') })
}

/** A schema for validating passwords that match the required pattern. */
export function passwordWithPatternSchema(getText: GetText) {
  return passwordSchema(getText).refine(
    (password) => PASSWORD_REGEX.test(password),
    getText('passwordValidationError'),
  )
}
