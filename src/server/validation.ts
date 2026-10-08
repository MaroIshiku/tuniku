export class FieldValidationError extends Error {
  constructor(readonly path: string, message: string) { super(message); }
}
