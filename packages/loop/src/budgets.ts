/** Validate built-in policy budgets before traversal or model work. */
export const validateBudgets = (maxSteps: number, maxClaims: number): void => {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) {
    throw new TypeError('maxSteps must be a nonnegative safe integer')
  }
  if (maxClaims !== Infinity && (!Number.isSafeInteger(maxClaims) || maxClaims < 0)) {
    throw new TypeError('maxClaims must be a nonnegative safe integer or Infinity')
  }
}
