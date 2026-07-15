import type { SchemaRepresentationIssue } from "../../SchemaRepresentation2.ts"

function formatPath(path: ReadonlyArray<string | number>): string {
  return path.length === 0 ? "<root>" : path.map((segment) =>
    typeof segment === "number"
      ? `[${segment}]`
      : `.${segment}`
  ).join("")
}

function formatSchemaRepresentationIssue(issue: SchemaRepresentationIssue): string {
  const path = formatPath(issue.path)
  switch (issue._tag) {
    case "InvalidDocument":
      return `Invalid schema representation document at ${path}`
    case "InvalidStructuralValue":
      return `Invalid structural value at ${path}`
    case "MissingRepresentation":
      return `Missing representation annotation at ${path}`
    case "InvalidRepresentationPayload":
      return `Invalid representation payload${issue.id === undefined ? "" : ` for ${issue.id}`} at ${path}`
    case "MissingReviver":
      return `Missing reviver for ${issue.id} at ${path}`
    case "DuplicateReviver":
      return `Duplicate reviver for ${issue.id} at ${path}`
    case "InvalidReviverArity":
      return `Invalid ${issue.field} for ${issue.id} at ${path}`
    case "InvalidSchemasArity":
      return `Invalid schemas arity for ${issue.id} at ${path}: expected ${issue.expected}, got ${issue.actual}`
    case "InvalidTypeParametersArity":
      return `Invalid type parameters arity for ${issue.id} at ${path}: expected ${issue.expected}, got ${issue.actual}`
    case "InvalidReviverKind":
      return `Invalid reviver kind for ${issue.id} at ${path}`
    case "InvalidReviverResult":
      return `Invalid reviver result for ${issue.id} at ${path}`
    case "InvalidJsonSchemaResult":
      return `Invalid JSON Schema callback result at ${path}`
    case "MissingJsonSchema":
      return `Missing JSON Schema callback at ${path}`
    case "MissingGeneration":
      return `Missing generation callback at ${path}`
    case "InvalidGenerationResult":
      return `Invalid generation callback result at ${path}`
    case "InvalidReference":
      return `Invalid reference ${issue.$ref} at ${path}`
  }
}

/**
 * Error thrown by high-level representation APIs.
 *
 * @category errors
 * @since 4.0.0
 */
export class SchemaRepresentationError extends globalThis.Error {
  readonly _tag = "SchemaRepresentationError"
  readonly issue: SchemaRepresentationIssue

  constructor(issue: SchemaRepresentationIssue) {
    super(formatSchemaRepresentationIssue(issue))
    this.issue = issue
  }
}
