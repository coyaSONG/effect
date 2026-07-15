import * as Arr from "../../Array.ts"
import * as Equal from "../../Equal.ts"
import { escapeToken, unescapeToken } from "../../JsonPointer.ts"
import type * as JsonSchema from "../../JsonSchema.ts"
import * as Predicate from "../../Predicate.ts"
import * as RegEx from "../../RegExp.ts"
import * as Result from "../../Result.ts"
import type * as Schema from "../../Schema.ts"
import * as SchemaAST from "../../SchemaAST.ts"
import type * as SchemaRepresentation from "../../SchemaRepresentation2.ts"
import * as InternalAnnotations from "./annotations.ts"
import * as InternalSchema from "./schema.ts"

/** @internal */
export type ProjectionResult<A> =
  | { readonly _tag: "Success"; readonly value: A }
  | { readonly _tag: "Failure"; readonly issue: SchemaRepresentation.SchemaRepresentationIssue }

export type StrictJsonResult =
  | { readonly _tag: "Success"; readonly value: Schema.Json }
  | { readonly _tag: "Failure"; readonly path: SchemaRepresentation.Path; readonly actual: unknown }

type ArrayDataResult =
  | { readonly _tag: "Success"; readonly values: ReadonlyArray<unknown> }
  | { readonly _tag: "Failure" }

type RepresentationPolicy = "forbidden" | "optional" | "required"

export const hasOwn = Object.prototype.hasOwnProperty

export function success<A>(value: A): ProjectionResult<A> {
  return { _tag: "Success", value }
}

export function failure<A>(issue: SchemaRepresentation.SchemaRepresentationIssue): ProjectionResult<A> {
  return { _tag: "Failure", issue }
}

function invalidStructuralValue<A>(
  path: SchemaRepresentation.Path,
  actual: unknown
): ProjectionResult<A> {
  return failure({ _tag: "InvalidStructuralValue", path, actual })
}

function isDataDescriptor(descriptor: PropertyDescriptor | undefined): descriptor is PropertyDescriptor & {
  readonly value: unknown
} {
  return descriptor !== undefined && hasOwn.call(descriptor, "value")
}

function readArrayData(input: unknown): ArrayDataResult {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
    return { _tag: "Failure" }
  }

  const descriptors = Object.getOwnPropertyDescriptors(input)
  const length = Object.getOwnPropertyDescriptor(input, "length")
  if (
    !isDataDescriptor(length) ||
    typeof length.value !== "number" ||
    !Number.isSafeInteger(length.value) ||
    length.value < 0 ||
    length.enumerable !== false ||
    length.configurable !== false ||
    length.writable !== true ||
    Reflect.ownKeys(descriptors).length !== length.value + 1
  ) {
    return { _tag: "Failure" }
  }

  const values = new Array<unknown>(length.value)
  for (let index = 0; index < length.value; index++) {
    const descriptor = descriptors[index]
    if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true) {
      return { _tag: "Failure" }
    }
    values[index] = descriptor.value
  }
  return { _tag: "Success", values }
}

function strictJsonFailure(path: SchemaRepresentation.Path, actual: unknown): StrictJsonResult {
  return { _tag: "Failure", path, actual }
}

export function copyStrictJson(
  input: unknown,
  ancestors: ReadonlySet<object> = new Set(),
  path: SchemaRepresentation.Path = []
): StrictJsonResult {
  if (input === null || typeof input === "string" || typeof input === "boolean") {
    return { _tag: "Success", value: input }
  }
  if (typeof input === "number") {
    return Number.isFinite(input) && !Object.is(input, -0)
      ? { _tag: "Success", value: input }
      : strictJsonFailure(path, input)
  }
  if (typeof input !== "object" || ancestors.has(input)) {
    return strictJsonFailure(path, input)
  }

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(input)

  if (Array.isArray(input)) {
    const data = readArrayData(input)
    if (data._tag === "Failure") {
      return strictJsonFailure(path, input)
    }
    const out = new Array<Schema.Json>(data.values.length)
    for (let index = 0; index < data.values.length; index++) {
      const value = copyStrictJson(data.values[index], nextAncestors, [...path, index])
      if (value._tag === "Failure") {
        return value
      }
      out[index] = value.value
    }
    return { _tag: "Success", value: out }
  }

  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) {
    return strictJsonFailure(path, input)
  }

  const descriptors = Object.getOwnPropertyDescriptors(input)
  const out: Record<string, Schema.Json> = Object.create(prototype)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      return strictJsonFailure(path, input)
    }
    const descriptor = descriptors[key]
    if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true) {
      return strictJsonFailure([...path, key], input)
    }
    const value = copyStrictJson(descriptor.value, nextAncestors, [...path, key])
    if (value._tag === "Failure") {
      return value
    }
    Object.defineProperty(out, key, {
      value: value.value,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  return { _tag: "Success", value: out }
}

function projectArray<A, B>(
  input: ReadonlyArray<A>,
  path: SchemaRepresentation.Path,
  f: (value: A, path: SchemaRepresentation.Path) => ProjectionResult<B>
): ProjectionResult<ReadonlyArray<B>> {
  const data = readArrayData(input)
  if (data._tag === "Failure") {
    return invalidStructuralValue(path, input)
  }
  const out = new Array<B>(data.values.length)
  for (let index = 0; index < data.values.length; index++) {
    const value = f(data.values[index] as A, [...path, index])
    if (value._tag === "Failure") {
      return value
    }
    out[index] = value.value
  }
  return success(out)
}

function annotationsField<A>(annotations: A | undefined): { readonly annotations?: A | undefined } {
  return annotations === undefined ? {} : { annotations }
}

function defineAnnotation(
  out: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  Object.defineProperty(out, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true
  })
}

function projectRepresentationAnnotation(
  input: unknown,
  path: SchemaRepresentation.Path,
  ancestors: ReadonlySet<object>
): ProjectionResult<SchemaRepresentation.RepresentationAnnotation<SchemaRepresentation.PersistedRepresentation>> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    return invalidStructuralValue(path, input)
  }

  const descriptors = Object.getOwnPropertyDescriptors(input)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || (key !== "id" && key !== "payload" && key !== "schemas")) {
      return invalidStructuralValue(typeof key === "string" ? [...path, key] : path, input)
    }
    const descriptor = descriptors[key]
    if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true) {
      if (key === "payload") {
        return failure({ _tag: "InvalidRepresentationPayload", path: [...path, "payload"] })
      }
      return invalidStructuralValue([...path, key], input)
    }
  }

  const idDescriptor = descriptors.id
  if (
    !isDataDescriptor(idDescriptor) ||
    idDescriptor.enumerable !== true ||
    typeof idDescriptor.value !== "string" ||
    idDescriptor.value.length === 0
  ) {
    return invalidStructuralValue([...path, "id"], isDataDescriptor(idDescriptor) ? idDescriptor.value : undefined)
  }
  const id = idDescriptor.value

  const payloadDescriptor = descriptors.payload
  if (!isDataDescriptor(payloadDescriptor) || payloadDescriptor.enumerable !== true) {
    return failure({ _tag: "InvalidRepresentationPayload", path: [...path, "payload"], id })
  }
  const payload = copyStrictJson(payloadDescriptor.value)
  if (payload._tag === "Failure") {
    return failure({ _tag: "InvalidRepresentationPayload", path: [...path, "payload"], id })
  }

  const schemasDescriptor = descriptors.schemas
  if (
    schemasDescriptor === undefined || (isDataDescriptor(schemasDescriptor) && schemasDescriptor.value === undefined)
  ) {
    return success({ id, payload: payload.value })
  }
  if (!isDataDescriptor(schemasDescriptor) || schemasDescriptor.enumerable !== true) {
    return invalidStructuralValue([...path, "schemas"], input)
  }
  const schemas = projectArray(
    schemasDescriptor.value as ReadonlyArray<SchemaRepresentation.LiveRepresentation>,
    [...path, "schemas"],
    (representation, representationPath) => projectRepresentation(representation, representationPath, ancestors)
  )
  if (schemas._tag === "Failure") {
    return schemas
  }
  return success({ id, payload: payload.value, schemas: schemas.value })
}

function projectAnnotationBag(
  input: unknown,
  path: SchemaRepresentation.Path,
  representationPolicy: RepresentationPolicy,
  ancestors: ReadonlySet<object>,
  excludedKeys: ReadonlySet<string> = new Set()
): ProjectionResult<
  SchemaRepresentation.PersistedOpaqueAnnotations<SchemaRepresentation.PersistedRepresentation> | undefined
> {
  const representationPath = [...path, "representation"]
  if (input === undefined) {
    return representationPolicy === "required"
      ? failure({ _tag: "MissingRepresentation", path: representationPath })
      : success(undefined)
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return invalidStructuralValue(path, input)
  }

  const descriptors = Object.getOwnPropertyDescriptors(input)
  const hasRepresentation = hasOwn.call(descriptors, "representation")
  if (representationPolicy === "forbidden" && hasRepresentation) {
    const descriptor = descriptors.representation
    return invalidStructuralValue(representationPath, isDataDescriptor(descriptor) ? descriptor.value : input)
  }

  const out: Record<string, unknown> = {}
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key === "representation" || excludedKeys.has(key)) {
      continue
    }
    const descriptor = descriptors[key]
    if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true || descriptor.value === undefined) {
      continue
    }
    const value = copyStrictJson(descriptor.value)
    if (value._tag === "Success") {
      defineAnnotation(out, key, value.value)
    }
  }

  if (hasRepresentation) {
    const descriptor = descriptors.representation
    if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true) {
      return invalidStructuralValue(representationPath, input)
    }
    if (descriptor.value === undefined) {
      if (representationPolicy === "required") {
        return failure({ _tag: "MissingRepresentation", path: representationPath })
      }
    } else {
      const representation = projectRepresentationAnnotation(descriptor.value, representationPath, ancestors)
      if (representation._tag === "Failure") {
        return representation
      }
      defineAnnotation(out, "representation", representation.value)
    }
  } else if (representationPolicy === "required") {
    return failure({ _tag: "MissingRepresentation", path: representationPath })
  }

  return success(
    Reflect.ownKeys(out).length === 0
      ? undefined
      : out as SchemaRepresentation.PersistedOpaqueAnnotations<SchemaRepresentation.PersistedRepresentation>
  )
}

function projectNodeAnnotations(
  input: unknown,
  path: SchemaRepresentation.Path,
  representationPolicy: RepresentationPolicy,
  ancestors: ReadonlySet<object>,
  excludedKeys?: ReadonlySet<string>
): ProjectionResult<SchemaRepresentation.PersistedAnnotations["node"] | undefined> {
  return projectAnnotationBag(input, path, representationPolicy, ancestors, excludedKeys)
}

function projectFilterAnnotations(
  input: unknown,
  path: SchemaRepresentation.Path,
  representationPolicy: RepresentationPolicy,
  ancestors: ReadonlySet<object>
): ProjectionResult<SchemaRepresentation.PersistedAnnotations["filter"] | undefined> {
  return projectAnnotationBag(input, path, representationPolicy, ancestors)
}

function projectKeyAnnotations(
  input: unknown,
  path: SchemaRepresentation.Path,
  ancestors: ReadonlySet<object>
): ProjectionResult<SchemaRepresentation.PersistedAnnotations["key"] | undefined> {
  const annotations = projectAnnotationBag(input, path, "forbidden", ancestors)
  return annotations._tag === "Failure"
    ? annotations
    : success(annotations.value as SchemaRepresentation.PersistedAnnotations["key"] | undefined)
}

function projectChecks(
  checks: ReadonlyArray<SchemaRepresentation.Check<SchemaRepresentation.LiveAnnotations>>,
  path: SchemaRepresentation.Path,
  ancestors: ReadonlySet<object>
): ProjectionResult<ReadonlyArray<SchemaRepresentation.Check<SchemaRepresentation.PersistedAnnotations>>> {
  return projectArray(checks, path, (check, checkPath) => projectCheck(check, checkPath, ancestors))
}

function projectCheck(
  check: SchemaRepresentation.Check<SchemaRepresentation.LiveAnnotations>,
  path: SchemaRepresentation.Path,
  ancestors: ReadonlySet<object>
): ProjectionResult<SchemaRepresentation.Check<SchemaRepresentation.PersistedAnnotations>> {
  if (typeof check !== "object" || check === null || ancestors.has(check)) {
    return invalidStructuralValue(path, check)
  }
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(check)

  switch (check._tag) {
    case "Filter": {
      const annotations = projectFilterAnnotations(
        check.annotations,
        [...path, "annotations"],
        "required",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      if (typeof check.aborted !== "boolean") {
        return invalidStructuralValue([...path, "aborted"], check.aborted)
      }
      return success({
        _tag: "Filter",
        aborted: check.aborted,
        ...annotationsField(annotations.value)
      })
    }
    case "FilterGroup": {
      const annotations = projectFilterAnnotations(
        check.annotations,
        [...path, "annotations"],
        "optional",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(check.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      if (checks.value.length === 0) {
        return invalidStructuralValue([...path, "checks"], check.checks)
      }
      return success({
        _tag: "FilterGroup",
        checks: checks.value as readonly [
          SchemaRepresentation.Check<SchemaRepresentation.PersistedAnnotations>,
          ...Array<SchemaRepresentation.Check<SchemaRepresentation.PersistedAnnotations>>
        ],
        ...annotationsField(annotations.value)
      })
    }
  }
}

function projectRepresentation(
  representation: SchemaRepresentation.LiveRepresentation,
  path: SchemaRepresentation.Path,
  ancestors: ReadonlySet<object> = new Set()
): ProjectionResult<SchemaRepresentation.PersistedRepresentation> {
  if (typeof representation !== "object" || representation === null || ancestors.has(representation)) {
    return invalidStructuralValue(path, representation)
  }
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(representation)

  switch (representation._tag) {
    case "Reference":
      return typeof representation.$ref === "string" && representation.$ref.length > 0
        ? success({ _tag: "Reference", $ref: representation.$ref })
        : invalidStructuralValue([...path, "$ref"], representation.$ref)
    case "Declaration": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "required",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const typeParameters = projectArray(
        representation.typeParameters,
        [...path, "typeParameters"],
        (typeParameter, typeParameterPath) => projectRepresentation(typeParameter, typeParameterPath, nextAncestors)
      )
      if (typeParameters._tag === "Failure") {
        return typeParameters
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      return success({
        _tag: "Declaration",
        typeParameters: typeParameters.value,
        checks: checks.value,
        ...annotationsField(annotations.value)
      })
    }
    case "Suspend": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      if (checks.value.length !== 0) {
        return invalidStructuralValue([...path, "checks"], representation.checks)
      }
      const thunk = projectRepresentation(representation.thunk, [...path, "thunk"], nextAncestors)
      if (thunk._tag === "Failure") {
        return thunk
      }
      return success({
        _tag: "Suspend",
        checks: [],
        thunk: thunk.value,
        ...annotationsField(annotations.value)
      })
    }
    case "Null":
    case "Undefined":
    case "Void":
    case "Never":
    case "Unknown":
    case "Any":
    case "Number":
    case "Boolean":
    case "BigInt":
    case "Symbol":
    case "ObjectKeyword": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      return success({
        _tag: representation._tag,
        checks: checks.value,
        ...annotationsField(annotations.value)
      } as SchemaRepresentation.PersistedRepresentation)
    }
    case "String": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors,
        new Set(["contentMediaType", "contentSchema"])
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      if (representation.contentMediaType !== undefined && typeof representation.contentMediaType !== "string") {
        return invalidStructuralValue([...path, "contentMediaType"], representation.contentMediaType)
      }
      const contentSchema = representation.contentSchema === undefined
        ? success<SchemaRepresentation.PersistedRepresentation | undefined>(undefined)
        : projectRepresentation(representation.contentSchema, [...path, "contentSchema"], nextAncestors)
      if (contentSchema._tag === "Failure") {
        return contentSchema
      }
      return success({
        _tag: "String",
        checks: checks.value,
        ...annotationsField(annotations.value),
        ...(representation.contentMediaType === undefined
          ? undefined
          : { contentMediaType: representation.contentMediaType }),
        ...(contentSchema.value === undefined ? undefined : { contentSchema: contentSchema.value })
      })
    }
    case "Literal": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      if (
        typeof representation.literal !== "string" &&
        typeof representation.literal !== "number" &&
        typeof representation.literal !== "boolean" &&
        typeof representation.literal !== "bigint"
      ) {
        return invalidStructuralValue([...path, "literal"], representation.literal)
      }
      return success({
        _tag: "Literal",
        literal: representation.literal,
        checks: checks.value,
        ...annotationsField(annotations.value)
      })
    }
    case "UniqueSymbol": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      if (typeof representation.symbol !== "symbol" || globalThis.Symbol.keyFor(representation.symbol) === undefined) {
        return invalidStructuralValue([...path, "symbol"], representation.symbol)
      }
      return success({
        _tag: "UniqueSymbol",
        symbol: representation.symbol,
        checks: checks.value,
        ...annotationsField(annotations.value)
      })
    }
    case "Enum": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      const enums = projectArray<
        readonly [string, string | number],
        readonly [string, string | number]
      >(representation.enums, [...path, "enums"], (entry, entryPath) => {
        const data = readArrayData(entry)
        if (data._tag === "Failure" || data.values.length !== 2) {
          return invalidStructuralValue(entryPath, entry)
        }
        const name = data.values[0]
        const value = data.values[1]
        return typeof name === "string" && (typeof value === "string" || typeof value === "number")
          ? success([name, value] as const)
          : invalidStructuralValue(entryPath, entry)
      })
      if (enums._tag === "Failure") {
        return enums
      }
      return success({
        _tag: "Enum",
        enums: enums.value,
        checks: checks.value,
        ...annotationsField(annotations.value)
      })
    }
    case "TemplateLiteral": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      const parts = projectArray(
        representation.parts,
        [...path, "parts"],
        (part, partPath) => projectRepresentation(part, partPath, nextAncestors)
      )
      if (parts._tag === "Failure") {
        return parts
      }
      return success({
        _tag: "TemplateLiteral",
        parts: parts.value,
        checks: checks.value,
        ...annotationsField(annotations.value)
      })
    }
    case "Arrays": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      const elements = projectArray<
        SchemaRepresentation.Element<SchemaRepresentation.LiveAnnotations>,
        SchemaRepresentation.Element<SchemaRepresentation.PersistedAnnotations>
      >(representation.elements, [...path, "elements"], (element, elementPath) => {
        if (typeof element !== "object" || element === null) {
          return invalidStructuralValue(elementPath, element)
        }
        if (typeof element.isOptional !== "boolean") {
          return invalidStructuralValue([...elementPath, "isOptional"], element.isOptional)
        }
        const type = projectRepresentation(element.type, [...elementPath, "type"], nextAncestors)
        if (type._tag === "Failure") {
          return type
        }
        const elementAnnotations = projectKeyAnnotations(
          element.annotations,
          [...elementPath, "annotations"],
          nextAncestors
        )
        if (elementAnnotations._tag === "Failure") {
          return elementAnnotations
        }
        return success({
          isOptional: element.isOptional,
          type: type.value,
          ...annotationsField(elementAnnotations.value)
        })
      })
      if (elements._tag === "Failure") {
        return elements
      }
      const rest = projectArray(
        representation.rest,
        [...path, "rest"],
        (rest, restPath) => projectRepresentation(rest, restPath, nextAncestors)
      )
      if (rest._tag === "Failure") {
        return rest
      }
      return success({
        _tag: "Arrays",
        elements: elements.value,
        rest: rest.value,
        checks: checks.value,
        ...annotationsField(annotations.value)
      })
    }
    case "Objects": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      const propertySignatures = projectArray<
        SchemaRepresentation.PropertySignature<SchemaRepresentation.LiveAnnotations>,
        SchemaRepresentation.PropertySignature<SchemaRepresentation.PersistedAnnotations>
      >(
        representation.propertySignatures,
        [...path, "propertySignatures"],
        (property, propertyPath) => {
          if (typeof property !== "object" || property === null) {
            return invalidStructuralValue(propertyPath, property)
          }
          if (
            typeof property.name !== "string" &&
            typeof property.name !== "number" &&
            (typeof property.name !== "symbol" || globalThis.Symbol.keyFor(property.name) === undefined)
          ) {
            return invalidStructuralValue([...propertyPath, "name"], property.name)
          }
          if (typeof property.isOptional !== "boolean") {
            return invalidStructuralValue([...propertyPath, "isOptional"], property.isOptional)
          }
          if (typeof property.isMutable !== "boolean") {
            return invalidStructuralValue([...propertyPath, "isMutable"], property.isMutable)
          }
          const type = projectRepresentation(property.type, [...propertyPath, "type"], nextAncestors)
          if (type._tag === "Failure") {
            return type
          }
          const propertyAnnotations = projectKeyAnnotations(
            property.annotations,
            [...propertyPath, "annotations"],
            nextAncestors
          )
          if (propertyAnnotations._tag === "Failure") {
            return propertyAnnotations
          }
          return success({
            name: property.name,
            type: type.value,
            isOptional: property.isOptional,
            isMutable: property.isMutable,
            ...annotationsField(propertyAnnotations.value)
          })
        }
      )
      if (propertySignatures._tag === "Failure") {
        return propertySignatures
      }
      const indexSignatures = projectArray<
        SchemaRepresentation.IndexSignature<SchemaRepresentation.LiveAnnotations>,
        SchemaRepresentation.IndexSignature<SchemaRepresentation.PersistedAnnotations>
      >(
        representation.indexSignatures,
        [...path, "indexSignatures"],
        (index, indexPath) => {
          if (typeof index !== "object" || index === null) {
            return invalidStructuralValue(indexPath, index)
          }
          const parameter = projectRepresentation(index.parameter, [...indexPath, "parameter"], nextAncestors)
          if (parameter._tag === "Failure") {
            return parameter
          }
          const type = projectRepresentation(index.type, [...indexPath, "type"], nextAncestors)
          if (type._tag === "Failure") {
            return type
          }
          return success({ parameter: parameter.value, type: type.value })
        }
      )
      if (indexSignatures._tag === "Failure") {
        return indexSignatures
      }
      return success({
        _tag: "Objects",
        propertySignatures: propertySignatures.value,
        indexSignatures: indexSignatures.value,
        checks: checks.value,
        ...annotationsField(annotations.value)
      })
    }
    case "Union": {
      const annotations = projectNodeAnnotations(
        representation.annotations,
        [...path, "annotations"],
        "forbidden",
        nextAncestors
      )
      if (annotations._tag === "Failure") {
        return annotations
      }
      const checks = projectChecks(representation.checks, [...path, "checks"], nextAncestors)
      if (checks._tag === "Failure") {
        return checks
      }
      const types = projectArray(
        representation.types,
        [...path, "types"],
        (type, typePath) => projectRepresentation(type, typePath, nextAncestors)
      )
      if (types._tag === "Failure") {
        return types
      }
      if (representation.mode !== "anyOf" && representation.mode !== "oneOf") {
        return invalidStructuralValue([...path, "mode"], representation.mode)
      }
      return success({
        _tag: "Union",
        types: types.value,
        mode: representation.mode,
        checks: checks.value,
        ...annotationsField(annotations.value)
      })
    }
    default:
      return invalidStructuralValue([...path, "_tag"], (representation as { readonly _tag?: unknown })._tag)
  }
}

function projectReferences(
  references: SchemaRepresentation.References<SchemaRepresentation.LiveAnnotations>,
  path: SchemaRepresentation.Path
): ProjectionResult<SchemaRepresentation.References<SchemaRepresentation.PersistedAnnotations>> {
  if (
    typeof references !== "object" ||
    references === null ||
    Array.isArray(references) ||
    (Object.getPrototypeOf(references) !== Object.prototype && Object.getPrototypeOf(references) !== null)
  ) {
    return invalidStructuralValue(path, references)
  }
  const descriptors = Object.getOwnPropertyDescriptors(references)
  const out: Record<string, SchemaRepresentation.PersistedRepresentation> = {}
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      return invalidStructuralValue(path, references)
    }
    const descriptor = descriptors[key]
    if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true) {
      return invalidStructuralValue([...path, key], references)
    }
    const representation = projectRepresentation(
      descriptor.value as SchemaRepresentation.LiveRepresentation,
      [...path, key]
    )
    if (representation._tag === "Failure") {
      return representation
    }
    Object.defineProperty(out, key, {
      value: representation.value,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  return success(out)
}

/** @internal */
export function projectDocument(
  document: SchemaRepresentation.Document<SchemaRepresentation.LiveAnnotations>
): ProjectionResult<SchemaRepresentation.Document<SchemaRepresentation.PersistedAnnotations>> {
  const representation = projectRepresentation(document.representation, ["representation"])
  if (representation._tag === "Failure") {
    return representation
  }
  const references = projectReferences(document.references, ["references"])
  if (references._tag === "Failure") {
    return references
  }
  return success({ representation: representation.value, references: references.value })
}

/** @internal */
export function projectMultiDocument(
  document: SchemaRepresentation.MultiDocument<SchemaRepresentation.LiveAnnotations>
): ProjectionResult<SchemaRepresentation.MultiDocument<SchemaRepresentation.PersistedAnnotations>> {
  const representations = projectArray(
    document.representations,
    ["representations"],
    (representation, path) => projectRepresentation(representation, path)
  )
  if (representations._tag === "Failure") {
    return representations
  }
  if (representations.value.length === 0) {
    return invalidStructuralValue(["representations"], document.representations)
  }
  const references = projectReferences(document.references, ["references"])
  if (references._tag === "Failure") {
    return references
  }
  return success({
    representations: representations.value as readonly [
      SchemaRepresentation.PersistedRepresentation,
      ...Array<SchemaRepresentation.PersistedRepresentation>
    ],
    references: references.value
  })
}

export type PersistedRepresentation = SchemaRepresentation.PersistedRepresentation
export type PersistedCheck = SchemaRepresentation.Check<SchemaRepresentation.PersistedAnnotations>
export type PersistedDocument = SchemaRepresentation.Document<SchemaRepresentation.PersistedAnnotations>
export type PersistedMultiDocument = SchemaRepresentation.MultiDocument<SchemaRepresentation.PersistedAnnotations>

class RevivalFailure {
  readonly issue: SchemaRepresentation.SchemaRepresentationIssue

  constructor(issue: SchemaRepresentation.SchemaRepresentationIssue) {
    this.issue = issue
  }
}

export function failRevival(issue: SchemaRepresentation.SchemaRepresentationIssue): never {
  throw new RevivalFailure(issue)
}

export function protectRevival<A>(path: SchemaRepresentation.Path, evaluate: () => A): A {
  const result = Result.try(evaluate)
  if (Result.isSuccess(result)) {
    return result.success
  }
  if (result.failure instanceof RevivalFailure) {
    throw result.failure
  }
  return failRevival({ _tag: "InvalidDocument", path, cause: result.failure })
}

export function captureRevival<A>(evaluate: () => A): ProjectionResult<A> {
  const result = Result.try(evaluate)
  if (Result.isSuccess(result)) {
    return success(result.success)
  }
  return result.failure instanceof RevivalFailure
    ? failure(result.failure.issue)
    : failure({ _tag: "InvalidDocument", path: [], cause: result.failure })
}

const jsonSchemaTypes: ReadonlySet<string> = new Set([
  "null",
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array"
])

const jsonSchemaStringKeys = ["minLength", "maxLength", "pattern", "format", "contentMediaType", "contentSchema"]
const jsonSchemaNumberKeys = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"]
const jsonSchemaObjectKeys = [
  "properties",
  "required",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "minProperties",
  "maxProperties"
]
const jsonSchemaArrayKeys = ["items", "prefixItems", "additionalItems", "minItems", "maxItems", "uniqueItems"]

function isImportedJsonSchemaType(input: unknown): input is JsonSchema.Type {
  return typeof input === "string" && jsonSchemaTypes.has(input)
}

function inferJsonSchemaType(schema: JsonSchema.JsonSchema): JsonSchema.Type | undefined {
  if (jsonSchemaStringKeys.some((key) => schema[key] !== undefined)) {
    return "string"
  }
  if (jsonSchemaNumberKeys.some((key) => schema[key] !== undefined)) {
    return "number"
  }
  if (jsonSchemaObjectKeys.some((key) => schema[key] !== undefined)) {
    return "object"
  }
  if (jsonSchemaArrayKeys.some((key) => schema[key] !== undefined)) {
    return "array"
  }
}

function jsonSchemaReferenceKey($ref: string): string | undefined {
  const token = $ref.split("/").at(-1)
  return token === undefined || token.length === 0 ? undefined : unescapeToken(token)
}

function jsonSchemaFilter(
  id: string,
  payload: Schema.Json,
  schemas?: ReadonlyArray<PersistedRepresentation>
): PersistedCheck {
  return {
    _tag: "Filter",
    aborted: false,
    annotations: {
      representation: {
        id,
        payload,
        ...(schemas === undefined ? undefined : { schemas })
      }
    }
  }
}

function jsonSchemaAnnotations(
  schema: JsonSchema.JsonSchema
): SchemaRepresentation.PersistedAnnotations["node"] | undefined {
  const annotations: Record<string, Schema.Json> = {}
  if (typeof schema.title === "string") annotations.title = schema.title
  if (typeof schema.description === "string") annotations.description = schema.description
  if (hasOwn.call(schema, "default")) annotations.default = schema.default as Schema.Json
  if (Array.isArray(schema.examples)) annotations.examples = schema.examples as ReadonlyArray<Schema.Json>
  if (typeof schema.readOnly === "boolean") annotations.readOnly = schema.readOnly
  if (typeof schema.writeOnly === "boolean") annotations.writeOnly = schema.writeOnly
  if (typeof schema.format === "string") annotations.format = schema.format
  if (typeof schema.contentEncoding === "string") annotations.contentEncoding = schema.contentEncoding
  return Object.keys(annotations).length === 0 ? undefined : annotations
}

function annotateJsonSchemaRepresentation(
  representation: PersistedRepresentation,
  annotations: SchemaRepresentation.PersistedAnnotations["node"] | undefined
): PersistedRepresentation {
  if (annotations === undefined) {
    return representation
  }
  if (representation._tag === "Reference") {
    return {
      _tag: "Suspend",
      annotations,
      checks: [],
      thunk: representation
    }
  }
  return {
    ...representation,
    annotations: {
      ...representation.annotations,
      ...annotations
    }
  }
}

function jsonDeclaration(
  annotations: SchemaRepresentation.PersistedAnnotations["node"] | undefined
): PersistedRepresentation {
  return {
    _tag: "Declaration",
    annotations: {
      ...annotations,
      expected: "JSON value",
      representation: {
        id: "effect/schema/Json",
        payload: null
      }
    },
    checks: [],
    typeParameters: []
  }
}

function unknownJsonSchemas(representation: PersistedRepresentation): PersistedRepresentation {
  switch (representation._tag) {
    case "Unknown":
      return jsonDeclaration(representation.annotations)
    case "Suspend":
      return { ...representation, thunk: unknownJsonSchemas(representation.thunk) }
    case "String":
      return representation.contentSchema === undefined
        ? representation
        : { ...representation, contentSchema: unknownJsonSchemas(representation.contentSchema) }
    case "Arrays":
      return {
        ...representation,
        elements: representation.elements.map((element) => ({
          ...element,
          type: unknownJsonSchemas(element.type)
        })),
        rest: representation.rest.map(unknownJsonSchemas)
      }
    case "Objects":
      return {
        ...representation,
        propertySignatures: representation.propertySignatures.map((property) => ({
          ...property,
          type: unknownJsonSchemas(property.type)
        })),
        indexSignatures: representation.indexSignatures.map((indexSignature) => ({
          parameter: unknownJsonSchemas(indexSignature.parameter),
          type: unknownJsonSchemas(indexSignature.type)
        })),
        checks: representation.checks.map(unknownJsonSchemaCheck)
      }
    case "Union":
      return { ...representation, types: representation.types.map(unknownJsonSchemas) }
    default:
      return representation
  }
}

function unknownJsonSchemaCheck(check: PersistedCheck): PersistedCheck {
  const annotations = check.annotations
  const representation = annotations?.representation
  const schemas = representation?.schemas
  if (representation === undefined || schemas === undefined) {
    return check
  }
  return {
    ...check,
    annotations: {
      ...annotations,
      representation: {
        ...representation,
        schemas: schemas.map(unknownJsonSchemas)
      }
    }
  }
}

function translateJsonSchemaMultiDocument(
  document: JsonSchema.MultiDocument<"draft-2020-12">,
  options?: SchemaRepresentation.FromJsonSchemaOptions,
  singleRoot = false
): PersistedMultiDocument {
  const definitionCache = new Map<string, PersistedRepresentation>()
  const definitionsInProgress = new Set<string>()

  function translateDefinition(key: string, path: SchemaRepresentation.Path): PersistedRepresentation {
    const cached = definitionCache.get(key)
    if (cached !== undefined) {
      return cached
    }
    if (!hasOwn.call(document.definitions, key) || definitionsInProgress.has(key)) {
      return failRevival({ _tag: "InvalidReference", path: [...path, "$ref"], $ref: key })
    }
    definitionsInProgress.add(key)
    const representation = recur(document.definitions[key], ["definitions", key])
    definitionsInProgress.delete(key)
    definitionCache.set(key, representation)
    return representation
  }

  function resolveReference(
    reference: SchemaRepresentation.Reference,
    path: SchemaRepresentation.Path,
    seen: ReadonlySet<string> = new Set()
  ): PersistedRepresentation {
    if (seen.has(reference.$ref)) {
      return failRevival({ _tag: "InvalidReference", path: [...path, "$ref"], $ref: reference.$ref })
    }
    const nextSeen = new Set(seen)
    nextSeen.add(reference.$ref)
    const representation = translateDefinition(reference.$ref, path)
    if (representation._tag === "Reference") {
      return resolveReference(representation, path, nextSeen)
    }
    if (representation._tag === "Suspend" && representation.thunk._tag === "Reference") {
      return annotateJsonSchemaRepresentation(
        resolveReference(representation.thunk, path, nextSeen),
        representation.annotations
      )
    }
    return representation
  }

  function annotationsOf(
    representation: PersistedRepresentation
  ): SchemaRepresentation.PersistedAnnotations["node"] | undefined {
    return representation._tag === "Reference" ? undefined : representation.annotations
  }

  function mergeAnnotations(
    left: SchemaRepresentation.PersistedAnnotations["node"] | undefined,
    right: SchemaRepresentation.PersistedAnnotations["node"] | undefined
  ): SchemaRepresentation.PersistedAnnotations["node"] | undefined {
    if (left === undefined) return right
    if (right === undefined) return left
    return { ...left, ...right }
  }

  function combinedAnnotations(
    representation: PersistedRepresentation,
    left: PersistedRepresentation,
    right: PersistedRepresentation
  ): PersistedRepresentation {
    return annotateJsonSchemaRepresentation(
      representation,
      mergeAnnotations(annotationsOf(left), annotationsOf(right))
    )
  }

  function combineChecks(
    left: ReadonlyArray<PersistedCheck>,
    right: ReadonlyArray<PersistedCheck>
  ): ReadonlyArray<PersistedCheck> {
    return left.length === 0 ? right : right.length === 0 ? left : [...left, ...right]
  }

  function combineArrays(
    left: SchemaRepresentation.Arrays<SchemaRepresentation.PersistedAnnotations>,
    right: SchemaRepresentation.Arrays<SchemaRepresentation.PersistedAnnotations>,
    path: SchemaRepresentation.Path
  ): Pick<SchemaRepresentation.Arrays<SchemaRepresentation.PersistedAnnotations>, "elements" | "rest"> | undefined {
    const elements: Array<SchemaRepresentation.Element<SchemaRepresentation.PersistedAnnotations>> = []
    const length = Math.max(left.elements.length, right.elements.length)
    for (let index = 0; index < length; index++) {
      const leftElement = left.elements[index]
      const rightElement = right.elements[index]
      const isOptional = leftElement?.isOptional !== false && rightElement?.isOptional !== false
      const leftType = leftElement?.type ?? left.rest[0]
      const rightType = rightElement?.type ?? right.rest[0]
      if (leftType === undefined || rightType === undefined) {
        return isOptional ? { elements, rest: [] } : undefined
      }
      const type = combine(leftType, rightType, [...path, "elements", index, "type"])
      if (type._tag === "Never") {
        return isOptional ? { elements, rest: [] } : undefined
      }
      elements.push({
        isOptional,
        type,
        ...(leftElement?.annotations === undefined && rightElement?.annotations === undefined
          ? undefined
          : { annotations: { ...leftElement?.annotations, ...rightElement?.annotations } })
      })
    }

    const leftRest = left.rest[0]
    const rightRest = right.rest[0]
    if (leftRest === undefined || rightRest === undefined) {
      return { elements, rest: [] }
    }
    const rest = combine(leftRest, rightRest, [...path, "rest", 0])
    return { elements, rest: rest._tag === "Never" ? [] : [rest] }
  }

  function combineProperties(
    left: ReadonlyArray<SchemaRepresentation.PropertySignature<SchemaRepresentation.PersistedAnnotations>>,
    right: ReadonlyArray<SchemaRepresentation.PropertySignature<SchemaRepresentation.PersistedAnnotations>>,
    path: SchemaRepresentation.Path
  ): Array<SchemaRepresentation.PropertySignature<SchemaRepresentation.PersistedAnnotations>> {
    const rightByName = new Map(right.map((property) => [property.name, property]))
    const names = new Set<PropertyKey | number>()
    const properties = left.map((property) => {
      names.add(property.name)
      const other = rightByName.get(property.name)
      if (other === undefined) return property
      return {
        name: property.name,
        type: combine(property.type, other.type, [
          ...path,
          "properties",
          typeof property.name === "symbol" ? globalThis.String(property.name) : property.name
        ]),
        isOptional: property.isOptional && other.isOptional,
        isMutable: property.isMutable || other.isMutable,
        ...(property.annotations === undefined && other.annotations === undefined
          ? undefined
          : { annotations: { ...property.annotations, ...other.annotations } })
      }
    })
    for (const property of right) {
      if (!names.has(property.name)) properties.push(property)
    }
    return properties
  }

  function isUnconstrainedString(representation: PersistedRepresentation): boolean {
    return representation._tag === "String" && representation.checks.length === 0 &&
      representation.annotations === undefined && representation.contentMediaType === undefined &&
      representation.contentSchema === undefined
  }

  function combineIndexSignatures(
    left: ReadonlyArray<SchemaRepresentation.IndexSignature<SchemaRepresentation.PersistedAnnotations>>,
    right: ReadonlyArray<SchemaRepresentation.IndexSignature<SchemaRepresentation.PersistedAnnotations>>,
    path: SchemaRepresentation.Path
  ): Array<SchemaRepresentation.IndexSignature<SchemaRepresentation.PersistedAnnotations>> {
    if (left.length === 0 || right.length === 0) return []
    const signatures = [...left]
    for (const signature of right) {
      if (isUnconstrainedString(signature.parameter)) {
        const index = signatures.findIndex((candidate) => isUnconstrainedString(candidate.parameter))
        if (index !== -1) {
          signatures[index] = {
            parameter: signatures[index].parameter,
            type: combine(signatures[index].type, signature.type, [...path, "indexSignatures", index, "type"])
          }
        } else {
          signatures.push(signature)
        }
      } else {
        signatures.push(signature)
      }
    }
    return signatures
  }

  function combine(
    left: PersistedRepresentation,
    right: PersistedRepresentation,
    path: SchemaRepresentation.Path
  ): PersistedRepresentation {
    if (left._tag === "Never") return left
    if (right._tag === "Never") return right
    if (left._tag === "Unknown") return annotateJsonSchemaRepresentation(right, left.annotations)
    if (right._tag === "Unknown") return annotateJsonSchemaRepresentation(left, right.annotations)
    if (left._tag === "Reference") return combine(resolveReference(left, path), right, path)
    if (right._tag === "Reference") return combine(left, resolveReference(right, path), path)
    if (left._tag === "Suspend") {
      return annotateJsonSchemaRepresentation(combine(left.thunk, right, path), left.annotations)
    }
    if (right._tag === "Suspend") {
      return annotateJsonSchemaRepresentation(combine(left, right.thunk, path), right.annotations)
    }
    if (left._tag === "Union") {
      const types = left.types
        .map((type, index) => combine(type, right, [...path, "types", index]))
        .filter((type) => type._tag !== "Never")
      if (types.length === 0) return { _tag: "Never", checks: [] }
      return combinedAnnotations(
        {
          _tag: "Union",
          types,
          mode: left.mode,
          checks: left.checks
        },
        left,
        right
      )
    }
    if (right._tag === "Union") return combine(right, left, path)

    switch (left._tag) {
      case "Null":
        return right._tag === "Null"
          ? combinedAnnotations({ _tag: "Null", checks: combineChecks(left.checks, right.checks) }, left, right)
          : { _tag: "Never", checks: [] }
      case "String":
        if (right._tag === "Literal") {
          return typeof right.literal === "string"
            ? combinedAnnotations(
              {
                _tag: "Literal",
                literal: right.literal,
                checks: combineChecks(left.checks, right.checks)
              },
              left,
              right
            )
            : { _tag: "Never", checks: [] }
        }
        if (right._tag !== "String") return { _tag: "Never", checks: [] }
        return combinedAnnotations(
          {
            _tag: "String",
            checks: combineChecks(left.checks, right.checks),
            ...(right.contentMediaType ?? left.contentMediaType) === undefined
              ? undefined
              : { contentMediaType: right.contentMediaType ?? left.contentMediaType },
            ...(right.contentSchema ?? left.contentSchema) === undefined
              ? undefined
              : { contentSchema: right.contentSchema ?? left.contentSchema }
          },
          left,
          right
        )
      case "Number":
        if (right._tag === "Literal") {
          return typeof right.literal === "number"
            ? combinedAnnotations(
              {
                _tag: "Literal",
                literal: right.literal,
                checks: combineChecks(left.checks, right.checks)
              },
              left,
              right
            )
            : { _tag: "Never", checks: [] }
        }
        return right._tag === "Number"
          ? combinedAnnotations(
            {
              _tag: "Number",
              checks: combineChecks(left.checks, right.checks)
            },
            left,
            right
          )
          : { _tag: "Never", checks: [] }
      case "Boolean":
        if (right._tag === "Literal") {
          return typeof right.literal === "boolean"
            ? combinedAnnotations(
              {
                _tag: "Literal",
                literal: right.literal,
                checks: combineChecks(left.checks, right.checks)
              },
              left,
              right
            )
            : { _tag: "Never", checks: [] }
        }
        return right._tag === "Boolean"
          ? combinedAnnotations(
            {
              _tag: "Boolean",
              checks: combineChecks(left.checks, right.checks)
            },
            left,
            right
          )
          : { _tag: "Never", checks: [] }
      case "Literal":
        if (right._tag === "Literal") {
          return left.literal === right.literal
            ? combinedAnnotations(
              {
                _tag: "Literal",
                literal: left.literal,
                checks: combineChecks(left.checks, right.checks)
              },
              left,
              right
            )
            : { _tag: "Never", checks: [] }
        }
        if (
          (right._tag === "String" && typeof left.literal === "string") ||
          (right._tag === "Number" && typeof left.literal === "number") ||
          (right._tag === "Boolean" && typeof left.literal === "boolean")
        ) {
          return combinedAnnotations(
            {
              _tag: "Literal",
              literal: left.literal,
              checks: combineChecks(left.checks, right.checks)
            },
            left,
            right
          )
        }
        return { _tag: "Never", checks: [] }
      case "Arrays": {
        if (right._tag !== "Arrays") return { _tag: "Never", checks: [] }
        const arrays = combineArrays(left, right, path)
        if (arrays === undefined) return { _tag: "Never", checks: [] }
        return combinedAnnotations(
          {
            _tag: "Arrays",
            elements: arrays.elements,
            rest: arrays.rest,
            checks: combineChecks(left.checks, right.checks)
          },
          left,
          right
        )
      }
      case "Objects":
        return right._tag === "Objects"
          ? combinedAnnotations(
            {
              _tag: "Objects",
              propertySignatures: combineProperties(left.propertySignatures, right.propertySignatures, path),
              indexSignatures: combineIndexSignatures(left.indexSignatures, right.indexSignatures, path),
              checks: combineChecks(left.checks, right.checks)
            },
            left,
            right
          )
          : { _tag: "Never", checks: [] }
      default:
        return { _tag: "Never", checks: [] }
    }
  }

  function enter(input: unknown, path: SchemaRepresentation.Path): JsonSchema.JsonSchema | undefined {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return undefined
    }
    const copied = copyStrictJson(input)
    if (
      copied._tag === "Failure" || typeof copied.value !== "object" || copied.value === null ||
      Array.isArray(copied.value)
    ) {
      return failRevival({
        _tag: "InvalidDocument",
        path: copied._tag === "Failure" ? [...path, ...copied.path] : path,
        cause: copied._tag === "Failure" ? copied.actual : input
      })
    }
    if (options?.onEnter === undefined) {
      return copied.value as JsonSchema.JsonSchema
    }
    const entered = Result.try(() => options.onEnter!(copied.value as JsonSchema.JsonSchema))
    if (Result.isFailure(entered)) {
      return failRevival({ _tag: "InvalidDocument", path, cause: entered.failure })
    }
    const output = copyStrictJson(entered.success)
    if (
      output._tag === "Failure" || typeof output.value !== "object" || output.value === null ||
      Array.isArray(output.value)
    ) {
      return failRevival({
        _tag: "InvalidDocument",
        path: output._tag === "Failure" ? [...path, ...output.path] : path,
        cause: output._tag === "Failure" ? output.actual : entered.success
      })
    }
    return output.value as JsonSchema.JsonSchema
  }

  function recur(input: unknown, path: SchemaRepresentation.Path): PersistedRepresentation {
    if (input === false) {
      return { _tag: "Never", checks: [] }
    }
    const schema = enter(input, path)
    if (schema === undefined) {
      return { _tag: "Unknown", checks: [] }
    }

    let representation = on(schema, path)

    if (Array.isArray(schema.allOf)) {
      for (let index = 0; index < schema.allOf.length; index++) {
        representation = combine(
          representation,
          recur(schema.allOf[index], [...path, "allOf", index]),
          [...path, "allOf", index]
        )
      }
    }

    if (Array.isArray(schema.anyOf)) {
      const union: PersistedRepresentation = {
        _tag: "Union",
        types: schema.anyOf.map((member, index) => recur(member, [...path, "anyOf", index])),
        mode: "anyOf",
        checks: []
      }
      representation = combine(union, representation, [...path, "anyOf"])
    }
    if (Array.isArray(schema.oneOf)) {
      const union: PersistedRepresentation = {
        _tag: "Union",
        types: schema.oneOf.map((member, index) => recur(member, [...path, "oneOf", index])),
        mode: "oneOf",
        checks: []
      }
      representation = combine(union, representation, [...path, "oneOf"])
    }
    return annotateJsonSchemaRepresentation(representation, jsonSchemaAnnotations(schema))
  }

  function on(schema: JsonSchema.JsonSchema, path: SchemaRepresentation.Path): PersistedRepresentation {
    if (typeof schema.$ref === "string") {
      const $ref = jsonSchemaReferenceKey(schema.$ref)
      if ($ref !== undefined) {
        return { _tag: "Reference", $ref }
      }
    }
    if (hasOwn.call(schema, "const")) {
      if (schema.const === null) {
        return { _tag: "Null", checks: [] }
      }
      if (typeof schema.const === "string" || typeof schema.const === "number" || typeof schema.const === "boolean") {
        return { _tag: "Literal", literal: schema.const, checks: [] }
      }
    }
    if (Array.isArray(schema.enum)) {
      const types: Array<PersistedRepresentation> = []
      for (let index = 0; index < schema.enum.length; index++) {
        const value = schema.enum[index]
        if (value === null) {
          types.push({ _tag: "Null", checks: [] })
        } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          types.push({ _tag: "Literal", literal: value, checks: [] })
        } else {
          types.push(recur(value, [...path, "enum", index]))
        }
      }
      if (types.length === 1) {
        return types[0]
      }
      return { _tag: "Union", types, mode: "anyOf", checks: [] }
    }

    if (Array.isArray(schema.type) && schema.type.every(isImportedJsonSchemaType)) {
      return {
        _tag: "Union",
        types: schema.type.map((type) => on({ ...schema, type }, path)),
        mode: "anyOf",
        checks: []
      }
    }

    const type = isImportedJsonSchemaType(schema.type) ? schema.type : inferJsonSchemaType(schema)
    switch (type) {
      case "null":
        return { _tag: "Null", checks: [] }
      case "string":
        return {
          _tag: "String",
          checks: collectStringChecks(schema),
          ...(typeof schema.contentMediaType === "string" ? { contentMediaType: schema.contentMediaType } : undefined),
          ...(schema.contentSchema === undefined
            ? undefined
            : { contentSchema: recur(schema.contentSchema, [...path, "contentSchema"]) })
        }
      case "number":
        return {
          _tag: "Number",
          checks: [jsonSchemaFilter("effect/schema/isFinite", null), ...collectNumberChecks(schema)]
        }
      case "integer":
        return {
          _tag: "Number",
          checks: [jsonSchemaFilter("effect/schema/isInt", null), ...collectNumberChecks(schema)]
        }
      case "boolean":
        return { _tag: "Boolean", checks: [] }
      case "array": {
        const minItems = typeof schema.minItems === "number" ? schema.minItems : 0
        const elements = Array.isArray(schema.prefixItems)
          ? schema.prefixItems.map((element, index) => ({
            isOptional: index + 1 > minItems,
            type: recur(element, [...path, "prefixItems", index])
          }))
          : []
        const rest = schema.items !== undefined
          ? [recur(schema.items, [...path, "items"])]
          : schema.prefixItems !== undefined && typeof schema.maxItems === "number"
          ? []
          : [{ _tag: "Unknown", checks: [] } as PersistedRepresentation]
        return {
          _tag: "Arrays",
          elements,
          rest,
          checks: collectArrayChecks(schema)
        }
      }
      case "object":
        return {
          _tag: "Objects",
          propertySignatures: collectProperties(schema, path),
          indexSignatures: collectIndexSignatures(schema, path),
          checks: collectObjectChecks(schema, path)
        }
      default:
        return { _tag: "Unknown", checks: [] }
    }
  }

  function collectStringChecks(schema: JsonSchema.JsonSchema): Array<PersistedCheck> {
    const checks: Array<PersistedCheck> = []
    if (typeof schema.minLength === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isMinLength", { minLength: schema.minLength }))
    }
    if (typeof schema.maxLength === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isMaxLength", { maxLength: schema.maxLength }))
    }
    if (typeof schema.pattern === "string") {
      checks.push(jsonSchemaFilter("effect/schema/isPattern", { source: schema.pattern, flags: "" }))
    }
    return checks
  }

  function collectNumberChecks(schema: JsonSchema.JsonSchema): Array<PersistedCheck> {
    const checks: Array<PersistedCheck> = []
    if (typeof schema.minimum === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isGreaterThanOrEqualTo", { minimum: schema.minimum }))
    }
    if (typeof schema.maximum === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isLessThanOrEqualTo", { maximum: schema.maximum }))
    }
    if (typeof schema.exclusiveMinimum === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isGreaterThan", { exclusiveMinimum: schema.exclusiveMinimum }))
    }
    if (typeof schema.exclusiveMaximum === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isLessThan", { exclusiveMaximum: schema.exclusiveMaximum }))
    }
    if (typeof schema.multipleOf === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isMultipleOf", { divisor: schema.multipleOf }))
    }
    return checks
  }

  function collectArrayChecks(schema: JsonSchema.JsonSchema): Array<PersistedCheck> {
    const checks: Array<PersistedCheck> = []
    if (schema.prefixItems === undefined) {
      if (typeof schema.minItems === "number") {
        checks.push(jsonSchemaFilter("effect/schema/isMinLength", { minLength: schema.minItems }))
      }
      if (typeof schema.maxItems === "number") {
        checks.push(jsonSchemaFilter("effect/schema/isMaxLength", { maxLength: schema.maxItems }))
      }
    }
    if (typeof schema.uniqueItems === "boolean") {
      checks.push(jsonSchemaFilter("effect/schema/isUnique", null))
    }
    return checks
  }

  function collectProperties(
    schema: JsonSchema.JsonSchema,
    path: SchemaRepresentation.Path
  ): Array<SchemaRepresentation.PropertySignature<SchemaRepresentation.PersistedAnnotations>> {
    const properties =
      typeof schema.properties === "object" && schema.properties !== null && !Array.isArray(schema.properties)
        ? schema.properties as Record<string, unknown>
        : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === "string")
      : []
    const keys = new Set([...Object.keys(properties), ...required])
    return Array.from(keys, (name) => ({
      name,
      type: recur(properties[name], [...path, "properties", name]),
      isOptional: !required.includes(name),
      isMutable: false
    }))
  }

  function collectIndexSignatures(
    schema: JsonSchema.JsonSchema,
    path: SchemaRepresentation.Path
  ): Array<SchemaRepresentation.IndexSignature<SchemaRepresentation.PersistedAnnotations>> {
    const signatures: Array<SchemaRepresentation.IndexSignature<SchemaRepresentation.PersistedAnnotations>> = []
    if (
      typeof schema.patternProperties === "object" &&
      schema.patternProperties !== null &&
      !Array.isArray(schema.patternProperties)
    ) {
      for (const [pattern, value] of Object.entries(schema.patternProperties)) {
        signatures.push({
          parameter: {
            _tag: "String",
            checks: [jsonSchemaFilter("effect/schema/isPattern", { source: pattern, flags: "" })]
          },
          type: recur(value, [...path, "patternProperties", pattern])
        })
      }
    }
    if (schema.additionalProperties === undefined || schema.additionalProperties === true) {
      signatures.push({
        parameter: { _tag: "String", checks: [] },
        type: { _tag: "Unknown", checks: [] }
      })
    } else if (typeof schema.additionalProperties === "object" && schema.additionalProperties !== null) {
      signatures.push({
        parameter: { _tag: "String", checks: [] },
        type: recur(schema.additionalProperties, [...path, "additionalProperties"])
      })
    }
    return signatures
  }

  function collectObjectChecks(
    schema: JsonSchema.JsonSchema,
    path: SchemaRepresentation.Path
  ): Array<PersistedCheck> {
    const checks: Array<PersistedCheck> = []
    if (typeof schema.minProperties === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isMinProperties", { minProperties: schema.minProperties }))
    }
    if (typeof schema.maxProperties === "number") {
      checks.push(jsonSchemaFilter("effect/schema/isMaxProperties", { maxProperties: schema.maxProperties }))
    }
    if (schema.propertyNames !== undefined) {
      checks.push(jsonSchemaFilter(
        "effect/schema/isPropertyNames",
        null,
        [recur(schema.propertyNames, [...path, "propertyNames"])]
      ))
    }
    return checks
  }

  const references: Record<string, PersistedRepresentation> = {}
  for (const key of Object.keys(document.definitions)) {
    Object.defineProperty(references, key, {
      value: unknownJsonSchemas(translateDefinition(key, ["definitions", key])),
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  if (document.schemas.length === 0) {
    return failRevival({ _tag: "InvalidDocument", path: ["schemas"] })
  }
  const representations = document.schemas.map((schema, index) =>
    unknownJsonSchemas(recur(schema, singleRoot ? ["schema"] : ["schemas", index]))
  ) as [PersistedRepresentation, ...Array<PersistedRepresentation>]
  return { representations, references }
}

/** @internal */
export function fromJsonSchemaDocument(
  document: JsonSchema.Document<"draft-2020-12">,
  options?: SchemaRepresentation.FromJsonSchemaOptions
): ProjectionResult<PersistedDocument> {
  return captureRevival(() => {
    const translated = translateJsonSchemaMultiDocument(
      {
        dialect: document.dialect,
        schemas: [document.schema],
        definitions: document.definitions
      },
      options,
      true
    )
    return {
      representation: translated.representations[0],
      references: translated.references
    }
  })
}

/** @internal */
export function fromJsonSchemaMultiDocument(
  document: JsonSchema.MultiDocument<"draft-2020-12">,
  options?: SchemaRepresentation.FromJsonSchemaOptions
): ProjectionResult<PersistedMultiDocument> {
  return captureRevival(() => translateJsonSchemaMultiDocument(document, options))
}

class CompilerFailure {
  readonly issue: SchemaRepresentation.SchemaRepresentationIssue

  constructor(issue: SchemaRepresentation.SchemaRepresentationIssue) {
    this.issue = issue
  }
}

function failCompiler(issue: SchemaRepresentation.SchemaRepresentationIssue): never {
  throw new CompilerFailure(issue)
}

function captureCompiler<A>(evaluate: () => A): ProjectionResult<A> {
  const result = Result.try(evaluate)
  if (Result.isSuccess(result)) {
    return success(result.success)
  }
  return result.failure instanceof CompilerFailure
    ? failure(result.failure.issue)
    : failure({ _tag: "InvalidDocument", path: [], cause: result.failure })
}

const jsonSchemaAnnotationKeys: ReadonlySet<string> = new Set([
  "title",
  "description",
  "default",
  "examples",
  "readOnly",
  "writeOnly",
  "format",
  "contentEncoding",
  "contentMediaType",
  "contentSchema"
])

const compilerCapabilityKeys: ReadonlySet<string> = new Set([
  "representation",
  "toJsonSchema",
  "generation",
  "arbitrary",
  "toArbitrary",
  "toEquivalence",
  "toFormatter",
  "toCodec",
  "toCodecJson",
  "toCodecIso",
  "typeConstructor",
  "identifier",
  "brands",
  "meta",
  "expected"
])

function getDataAnnotation(
  annotations: Schema.Annotations.Annotations | undefined,
  key: string
): unknown {
  if (annotations === undefined) {
    return undefined
  }
  const descriptor = Object.getOwnPropertyDescriptor(annotations, key)
  return isDataDescriptor(descriptor) && descriptor.enumerable === true ? descriptor.value : undefined
}

function copyJsonSchemaAnnotation(input: unknown): Schema.Json | undefined {
  const value = copyStrictJson(input)
  return value._tag === "Success" ? value.value : undefined
}

function collectJsonSchemaAnnotations(
  annotations: Schema.Annotations.Annotations | undefined,
  options: Schema.ToJsonSchemaOptions | undefined
): JsonSchema.JsonSchema | undefined {
  if (annotations === undefined) {
    return undefined
  }

  const out: JsonSchema.JsonSchema = {}
  const title = getDataAnnotation(annotations, "title")
  if (typeof title === "string") out.title = title
  const description = getDataAnnotation(annotations, "description")
  const expected = getDataAnnotation(annotations, "expected")
  if (typeof description === "string") out.description = description
  else if (options?.generateDescriptions === true && typeof expected === "string") out.description = expected

  const defaultValue = copyJsonSchemaAnnotation(getDataAnnotation(annotations, "default"))
  if (defaultValue !== undefined) out.default = defaultValue
  const examples = getDataAnnotation(annotations, "examples")
  const copiedExamples = Array.isArray(examples) ? copyJsonSchemaAnnotation(examples) : undefined
  if (copiedExamples !== undefined) out.examples = copiedExamples
  const readOnly = getDataAnnotation(annotations, "readOnly")
  if (typeof readOnly === "boolean") out.readOnly = readOnly
  const writeOnly = getDataAnnotation(annotations, "writeOnly")
  if (typeof writeOnly === "boolean") out.writeOnly = writeOnly
  const format = getDataAnnotation(annotations, "format")
  if (typeof format === "string") out.format = format
  const contentEncoding = getDataAnnotation(annotations, "contentEncoding")
  if (typeof contentEncoding === "string") out.contentEncoding = contentEncoding
  const contentMediaType = getDataAnnotation(annotations, "contentMediaType")
  if (typeof contentMediaType === "string") out.contentMediaType = contentMediaType

  if (options?.includeAnnotationKey !== undefined) {
    const descriptors = Object.getOwnPropertyDescriptors(annotations)
    for (const key of Reflect.ownKeys(descriptors)) {
      if (
        typeof key !== "string" ||
        key.startsWith("~") ||
        jsonSchemaAnnotationKeys.has(key) ||
        compilerCapabilityKeys.has(key) ||
        !options.includeAnnotationKey(key)
      ) {
        continue
      }
      const descriptor = descriptors[key]
      if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true || descriptor.value === undefined) {
        continue
      }
      const value = copyJsonSchemaAnnotation(descriptor.value)
      if (value !== undefined) {
        out[key] = value
      }
    }
  }

  return Object.keys(out).length === 0 ? undefined : out
}

function appendJsonSchema(
  left: JsonSchema.JsonSchema,
  right: JsonSchema.JsonSchema
): JsonSchema.JsonSchema {
  if (Object.keys(left).length === 0) return right
  const rightKeys = Object.keys(right)
  if (rightKeys.length === 0) return left
  const members = Array.isArray(right.allOf) && rightKeys.length === 1 ? right.allOf : [right]
  if (Array.isArray(left.allOf)) {
    return { ...left, allOf: [...left.allOf, ...members] }
  }
  if (typeof left.$ref === "string") {
    return { allOf: [left, ...members] }
  }
  return { ...left, allOf: members }
}

function validateJsonSchemaResult(
  input: unknown,
  path: SchemaRepresentation.Path
): JsonSchema.JsonSchema {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    return failCompiler({ _tag: "InvalidJsonSchemaResult", path, actual: input })
  }
  const copied = copyStrictJson(input)
  if (copied._tag === "Failure" || Array.isArray(copied.value) || copied.value === null) {
    return failCompiler({ _tag: "InvalidJsonSchemaResult", path, actual: input })
  }
  return copied.value as JsonSchema.JsonSchema
}

function invokeJsonSchemaCallback(
  callback: () => unknown,
  path: SchemaRepresentation.Path
): JsonSchema.JsonSchema {
  const result = Result.try(callback)
  if (Result.isFailure(result)) {
    return failCompiler({ _tag: "InvalidJsonSchemaResult", path, cause: result.failure })
  }
  return validateJsonSchemaResult(result.success, path)
}

function compileJsonSchema(
  representations: readonly [
    SchemaRepresentation.LiveRepresentation,
    ...Array<SchemaRepresentation.LiveRepresentation>
  ],
  rootPaths: ReadonlyArray<SchemaRepresentation.Path>,
  references: SchemaRepresentation.References<SchemaRepresentation.LiveAnnotations>,
  options: Schema.ToJsonSchemaOptions | undefined
): JsonSchema.MultiDocument<"draft-2020-12"> {
  const definitions: Record<string, JsonSchema.JsonSchema> = {}
  for (const key of Object.keys(references)) {
    definitions[key] = recur(references[key], ["references", key])
  }
  const schemas = Arr.map(representations, (representation, index) => recur(representation, rootPaths[index]))
  return { dialect: "draft-2020-12", schemas, definitions }

  function annotationSchemas(
    annotations: Schema.Annotations.Annotations | undefined,
    path: SchemaRepresentation.Path
  ): ReadonlyArray<JsonSchema.JsonSchema> {
    const representation = getDataAnnotation(annotations, "representation")
    if (representation === undefined) {
      return []
    }
    if (typeof representation !== "object" || representation === null || Array.isArray(representation)) {
      return failCompiler({ _tag: "InvalidDocument", path: [...path, "representation"], cause: representation })
    }
    const schemas = (representation as { readonly schemas?: unknown }).schemas
    if (schemas === undefined) {
      return []
    }
    if (!Array.isArray(schemas)) {
      return failCompiler({
        _tag: "InvalidDocument",
        path: [...path, "representation", "schemas"],
        cause: schemas
      })
    }
    return schemas.map((schema, index) =>
      recur(
        schema as SchemaRepresentation.LiveRepresentation,
        [...path, "representation", "schemas", index]
      )
    )
  }

  function compileCheck(
    check: SchemaRepresentation.Check<SchemaRepresentation.LiveAnnotations>,
    type: JsonSchema.Type | undefined,
    path: SchemaRepresentation.Path
  ): JsonSchema.JsonSchema | undefined {
    const annotations = check.annotations
    const callback = getDataAnnotation(annotations, "toJsonSchema")
    if (check._tag === "Filter") {
      if (!Predicate.isFunction(callback)) {
        return undefined
      }
      const schemas = annotationSchemas(annotations, [...path, "annotations"])
      const fragment = invokeJsonSchemaCallback(
        () => callback({ type, schemas }),
        [...path, "annotations", "toJsonSchema"]
      )
      const ordinary = collectJsonSchemaAnnotations(annotations, options)
      return ordinary === undefined ? fragment : { ...fragment, ...ordinary }
    }

    if (Predicate.isFunction(callback)) {
      const schemas = annotationSchemas(annotations, [...path, "annotations"])
      const fragment = invokeJsonSchemaCallback(
        () => callback({ type, schemas }),
        [...path, "annotations", "toJsonSchema"]
      )
      const ordinary = collectJsonSchemaAnnotations(annotations, options)
      return ordinary === undefined ? fragment : { ...fragment, ...ordinary }
    }

    const children = check.checks
      .map((child, index) => compileCheck(child, type, [...path, "checks", index]))
      .filter((child): child is JsonSchema.JsonSchema => child !== undefined)
    if (children.length === 0) {
      return undefined
    }
    const ordinary = collectJsonSchemaAnnotations(annotations, options)
    const fragment: JsonSchema.JsonSchema = { allOf: children }
    return ordinary === undefined ? fragment : { ...fragment, ...ordinary }
  }

  function recur(
    representation: SchemaRepresentation.LiveRepresentation,
    path: SchemaRepresentation.Path
  ): JsonSchema.JsonSchema {
    if (representation._tag === "Reference") {
      if (!hasOwn.call(references, representation.$ref)) {
        return failCompiler({ _tag: "InvalidReference", path: [...path, "$ref"], $ref: representation.$ref })
      }
      return { $ref: `#/$defs/${escapeToken(representation.$ref)}` }
    }

    let output = on(representation, path)
    const ordinary = collectJsonSchemaAnnotations(representation.annotations, options)
    if (ordinary !== undefined) {
      output = { ...output, ...ordinary }
    }
    const type = typeof output.type === "string" && isJsonSchemaType(output.type) ? output.type : undefined
    for (let index = 0; index < representation.checks.length; index++) {
      const check = compileCheck(representation.checks[index], type, [...path, "checks", index])
      if (check !== undefined) {
        output = appendJsonSchema(output, check)
      }
    }
    return output
  }

  function on(
    representation: Exclude<SchemaRepresentation.LiveRepresentation, SchemaRepresentation.Reference>,
    path: SchemaRepresentation.Path
  ): JsonSchema.JsonSchema {
    switch (representation._tag) {
      case "Any":
      case "Unknown":
        return {}
      case "ObjectKeyword":
        return { anyOf: [{ type: "object" }, { type: "array" }] }
      case "Void":
      case "Undefined":
        return { type: "null" }
      case "BigInt":
        return { type: "string", allOf: [{ pattern: "^-?\\d+$" }] }
      case "Symbol":
      case "UniqueSymbol":
        return { type: "string", allOf: [{ pattern: "^Symbol\\((.*)\\)$" }] }
      case "Declaration": {
        const callback = getDataAnnotation(representation.annotations, "toJsonSchema")
        const callbackPath = [...path, "annotations", "toJsonSchema"]
        if (!Predicate.isFunction(callback)) {
          return failCompiler({ _tag: "MissingJsonSchema", path: callbackPath })
        }
        const typeParameters = representation.typeParameters.map((typeParameter, index) =>
          recur(typeParameter, [...path, "typeParameters", index])
        )
        const schemas = annotationSchemas(representation.annotations, [...path, "annotations"])
        return invokeJsonSchemaCallback(() => callback({ typeParameters, schemas }), callbackPath)
      }
      case "Suspend":
        return recur(representation.thunk, [...path, "thunk"])
      case "Null":
        return { type: "null" }
      case "Never":
        return { not: {} }
      case "String": {
        const out: JsonSchema.JsonSchema = { type: "string" }
        if (representation.contentMediaType !== undefined) {
          out.contentMediaType = representation.contentMediaType
        }
        if (representation.contentSchema !== undefined) {
          out.contentSchema = recur(representation.contentSchema, [...path, "contentSchema"])
        }
        return out
      }
      case "Number":
        return {
          anyOf: [
            { type: "number" },
            { type: "string", enum: ["NaN"] },
            { type: "string", enum: ["Infinity"] },
            { type: "string", enum: ["-Infinity"] }
          ]
        }
      case "Boolean":
        return { type: "boolean" }
      case "Literal":
        return typeof representation.literal === "bigint"
          ? { type: "string", enum: [globalThis.String(representation.literal)] }
          : { type: typeof representation.literal, enum: [representation.literal] }
      case "Enum": {
        const types = representation.enums.map(([title, literal]) => ({
          type: typeof literal,
          enum: [literal],
          title
        }))
        return representation.enums.length === 0 ? { not: {} } : { anyOf: types }
      }
      case "TemplateLiteral":
        return { type: "string", pattern: `^${representation.parts.map(getPartPattern).join("")}$` }
      case "Arrays": {
        if (representation.rest.length > 1) {
          return failCompiler({
            _tag: "InvalidDocument",
            path: [...path, "rest"],
            cause: "Generating JSON Schema for post-rest elements is not supported"
          })
        }
        const out: JsonSchema.JsonSchema = { type: "array" }
        let minItems = representation.elements.length
        const prefixItems = representation.elements.map((element, index) => {
          if (element.isOptional) minItems--
          const compiled = recur(element.type, [...path, "elements", index, "type"])
          const annotations = collectJsonSchemaAnnotations(element.annotations, options)
          return annotations === undefined ? compiled : appendJsonSchema(compiled, annotations)
        })
        if (prefixItems.length > 0) {
          out.prefixItems = prefixItems
          out.maxItems = representation.elements.length
          if (minItems > 0) out.minItems = minItems
        } else {
          out.items = false
        }
        if (representation.rest.length === 1) {
          delete out.maxItems
          const rest = recur(representation.rest[0], [...path, "rest", 0])
          if (Object.keys(rest).length > 0) out.items = rest
          else delete out.items
        }
        return out
      }
      case "Objects": {
        if (representation.propertySignatures.length === 0 && representation.indexSignatures.length === 0) {
          return { anyOf: [{ type: "object" }, { type: "array" }] }
        }
        const out: JsonSchema.JsonSchema = { type: "object" }
        const properties: Record<string, JsonSchema.JsonSchema> = {}
        const required: Array<string> = []
        for (let index = 0; index < representation.propertySignatures.length; index++) {
          const property = representation.propertySignatures[index]
          if (typeof property.name !== "string") {
            return failCompiler({
              _tag: "InvalidDocument",
              path: [...path, "propertySignatures", index, "name"],
              cause: property.name
            })
          }
          const compiled = recur(property.type, [...path, "propertySignatures", index, "type"])
          const annotations = collectJsonSchemaAnnotations(property.annotations, options)
          properties[property.name] = annotations === undefined ? compiled : appendJsonSchema(compiled, annotations)
          if (!property.isOptional) required.push(property.name)
        }
        if (Object.keys(properties).length > 0) out.properties = properties
        if (required.length > 0) out.required = required
        out.additionalProperties = options?.additionalProperties ?? false
        const patternProperties: Record<string, JsonSchema.JsonSchema | false> = {}
        for (let index = 0; index < representation.indexSignatures.length; index++) {
          const signature = representation.indexSignatures[index]
          let type: JsonSchema.JsonSchema | false = recur(
            signature.type,
            [...path, "indexSignatures", index, "type"]
          )
          if (Object.keys(type).length === 1 && "not" in type) type = false
          const patterns = getParameterPatterns(
            signature.parameter,
            [...path, "indexSignatures", index, "parameter"],
            new Set()
          )
          if (patterns.length === 0) {
            out.additionalProperties = type
          } else {
            for (const pattern of patterns) patternProperties[pattern] = type
          }
        }
        if (Object.keys(patternProperties).length > 0) {
          out.patternProperties = patternProperties
          delete out.additionalProperties
        }
        if (
          typeof out.additionalProperties === "object" &&
          out.additionalProperties !== null &&
          Object.keys(out.additionalProperties).length === 0
        ) {
          delete out.additionalProperties
        }
        return out
      }
      case "Union": {
        const types = representation.types.map((type, index) => recur(type, [...path, "types", index]))
        if (types.length === 0) return { not: {} }
        if (types.length > 1) {
          const compacted = compactEnums(types)
          if (compacted !== undefined) return compacted
        }
        return representation.mode === "anyOf" ? { anyOf: types } : { oneOf: types }
      }
    }
  }

  function getParameterPatterns(
    parameter: SchemaRepresentation.LiveRepresentation,
    path: SchemaRepresentation.Path,
    seenReferences: ReadonlySet<string>
  ): ReadonlyArray<string> {
    switch (parameter._tag) {
      case "Reference": {
        if (!hasOwn.call(references, parameter.$ref)) {
          return failCompiler({ _tag: "InvalidReference", path: [...path, "$ref"], $ref: parameter.$ref })
        }
        if (seenReferences.has(parameter.$ref)) return []
        const next = new Set(seenReferences)
        next.add(parameter.$ref)
        return getParameterPatterns(references[parameter.$ref], ["references", parameter.$ref], next)
      }
      case "String":
        return collectPatterns(recur(parameter, path))
      case "TemplateLiteral":
        return [`^${parameter.parts.map(getPartPattern).join("")}$`]
      case "Union":
        return parameter.types.flatMap((type, index) =>
          getParameterPatterns(type, [...path, "types", index], seenReferences)
        )
      default:
        return failCompiler({ _tag: "InvalidDocument", path, cause: parameter._tag })
    }
  }
}

function isJsonSchemaType(input: string): input is JsonSchema.Type {
  return input === "string" || input === "number" || input === "boolean" || input === "array" ||
    input === "object" || input === "null" || input === "integer"
}

function compactEnums(
  schemas: ReadonlyArray<JsonSchema.JsonSchema>
): JsonSchema.JsonSchema | undefined {
  let sharedType: unknown = undefined
  const values: Array<unknown> = []
  for (const schema of schemas) {
    const keys = Object.keys(schema)
    if (keys.length !== 2 || schema.type === undefined || !Array.isArray(schema.enum) || schema.enum.length === 0) {
      return undefined
    }
    if (sharedType === undefined) sharedType = schema.type
    else if (schema.type !== sharedType) return undefined
    values.push(...schema.enum)
  }
  return { type: sharedType, enum: values }
}

function collectPatterns(schema: JsonSchema.JsonSchema): ReadonlyArray<string> {
  const patterns: Array<string> = []
  if (typeof schema.pattern === "string") patterns.push(schema.pattern)
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    const members = schema[key]
    if (Array.isArray(members)) {
      for (const member of members) {
        if (typeof member === "object" && member !== null && !Array.isArray(member)) {
          patterns.push(...collectPatterns(member))
        }
      }
    }
  }
  return patterns
}

function getPartPattern(part: SchemaRepresentation.LiveRepresentation): string {
  switch (part._tag) {
    case "Literal":
      return RegEx.escape(globalThis.String(part.literal))
    case "String":
      return SchemaAST.STRING_PATTERN
    case "Number":
      return SchemaAST.FINITE_PATTERN
    case "TemplateLiteral":
      return part.parts.map(getPartPattern).join("")
    case "Union":
      return part.types.map(getPartPattern).join("|")
    default:
      return failCompiler({ _tag: "InvalidDocument", path: [], cause: part._tag })
  }
}

/** @internal */
export function toJsonSchemaDocument(
  document: SchemaRepresentation.Document<SchemaRepresentation.LiveAnnotations>,
  options?: Schema.ToJsonSchemaOptions
): ProjectionResult<JsonSchema.Document<"draft-2020-12">> {
  return captureCompiler(() => {
    const output = compileJsonSchema(
      [document.representation],
      [["representation"]],
      document.references,
      options
    )
    return {
      dialect: output.dialect,
      schema: output.schemas[0],
      definitions: output.definitions
    }
  })
}

/** @internal */
export function toJsonSchemaMultiDocument(
  document: SchemaRepresentation.MultiDocument<SchemaRepresentation.LiveAnnotations>,
  options?: Schema.ToJsonSchemaOptions
): ProjectionResult<JsonSchema.MultiDocument<"draft-2020-12">> {
  return captureCompiler(() =>
    compileJsonSchema(
      document.representations,
      document.representations.map((_, index) => ["representations", index]),
      document.references,
      options
    )
  )
}

function makeCode(runtime: string, Type: string): SchemaRepresentation.Code {
  return { runtime, Type }
}

function validateImportDeclarations(
  input: unknown,
  path: SchemaRepresentation.Path,
  actual: unknown
): ReadonlyArray<string> {
  if (input === undefined) return []
  const data = readArrayData(input)
  if (
    data._tag === "Failure" ||
    data.values.some((value) => typeof value !== "string" || value.length === 0)
  ) {
    return failCompiler({ _tag: "InvalidGenerationResult", path, actual })
  }
  return data.values as ReadonlyArray<string>
}

function validateGenerationObject(
  input: unknown,
  path: SchemaRepresentation.Path
): Record<string, unknown> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    return failCompiler({ _tag: "InvalidGenerationResult", path, actual: input })
  }
  return input as Record<string, unknown>
}

function getGenerationField(
  output: Record<string, unknown>,
  key: string,
  path: SchemaRepresentation.Path,
  actual: unknown
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(output, key)
  if (descriptor === undefined) return undefined
  if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true) {
    return failCompiler({ _tag: "InvalidGenerationResult", path, actual })
  }
  return descriptor.value
}

function invokeDeclarationGeneration(
  callback: SchemaRepresentation.Generation.Declaration,
  input: SchemaRepresentation.Generation.DeclarationInput,
  path: SchemaRepresentation.Path
): SchemaRepresentation.Generation.DeclarationOutput {
  const result = Result.try(() => callback(input))
  if (Result.isFailure(result)) {
    return failCompiler({ _tag: "InvalidGenerationResult", path, cause: result.failure })
  }
  const output = validateGenerationObject(result.success, path)
  const runtime = getGenerationField(output, "runtime", path, result.success)
  const Type = getGenerationField(output, "Type", path, result.success)
  const importDeclarations = getGenerationField(output, "importDeclarations", path, result.success)
  if (
    typeof runtime !== "string" ||
    runtime.length === 0 ||
    typeof Type !== "string" ||
    Type.length === 0
  ) {
    return failCompiler({ _tag: "InvalidGenerationResult", path, actual: result.success })
  }
  return {
    runtime,
    Type,
    importDeclarations: validateImportDeclarations(importDeclarations, path, result.success)
  }
}

function invokeCheckGeneration(
  callback: SchemaRepresentation.Generation.Check,
  input: SchemaRepresentation.Generation.CheckInput,
  path: SchemaRepresentation.Path
): SchemaRepresentation.Generation.CheckOutput {
  const result = Result.try(() => callback(input))
  if (Result.isFailure(result)) {
    return failCompiler({ _tag: "InvalidGenerationResult", path, cause: result.failure })
  }
  const output = validateGenerationObject(result.success, path)
  const runtime = getGenerationField(output, "runtime", path, result.success)
  const importDeclarations = getGenerationField(output, "importDeclarations", path, result.success)
  if (typeof runtime !== "string" || runtime.length === 0) {
    return failCompiler({ _tag: "InvalidGenerationResult", path, actual: result.success })
  }
  return {
    runtime,
    importDeclarations: validateImportDeclarations(importDeclarations, path, result.success)
  }
}

const codeAnnotationExcludedKeys: ReadonlySet<string> = new Set([
  "representation",
  "toJsonSchema",
  "generation",
  "arbitrary",
  "toArbitrary",
  "toEquivalence",
  "toFormatter",
  "toCodec",
  "toCodecJson",
  "toCodecIso",
  "typeConstructor",
  "identifier",
  "brands",
  "meta",
  "contentMediaType",
  "contentSchema"
])

function renderNumber(value: number): string {
  if (Object.is(value, -0)) return "-0"
  if (Number.isNaN(value)) return "NaN"
  if (value === Infinity) return "Infinity"
  if (value === -Infinity) return "-Infinity"
  return globalThis.String(value)
}

function renderEmittableAnnotation(
  input: unknown,
  ancestors: ReadonlySet<object> = new Set()
): string | undefined {
  if (input === null) return "null"
  if (typeof input === "string") return JSON.stringify(input)
  if (typeof input === "boolean") return globalThis.String(input)
  if (typeof input === "number") return renderNumber(input)
  if (typeof input === "bigint") return `${input}n`
  if (typeof input === "symbol") {
    const key = globalThis.Symbol.keyFor(input)
    return key === undefined ? undefined : `Symbol.for(${JSON.stringify(key)})`
  }
  if (typeof input !== "object" || ancestors.has(input)) return undefined

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(input)
  if (Array.isArray(input)) {
    const data = readArrayData(input)
    if (data._tag === "Failure") return undefined
    const values: Array<string> = []
    for (const value of data.values) {
      const rendered = renderEmittableAnnotation(value, nextAncestors)
      if (rendered === undefined) return undefined
      values.push(rendered)
    }
    return `[${values.join(", ")}]`
  }

  const prototype = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const entries: Array<string> = []
  const descriptors = Object.getOwnPropertyDescriptors(input)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") return undefined
    const descriptor = descriptors[key]
    if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true) return undefined
    const rendered = renderEmittableAnnotation(descriptor.value, nextAncestors)
    if (rendered === undefined) return undefined
    entries.push(`${JSON.stringify(key)}: ${rendered}`)
  }
  return `{ ${entries.join(", ")} }`
}

function renderAnnotations(
  annotations: Schema.Annotations.Annotations | undefined
): string | undefined {
  if (annotations === undefined) return undefined
  const entries: Array<string> = []
  const descriptors = Object.getOwnPropertyDescriptors(annotations)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (
      typeof key !== "string" ||
      key.startsWith("~") ||
      codeAnnotationExcludedKeys.has(key)
    ) {
      continue
    }
    const descriptor = descriptors[key]
    if (!isDataDescriptor(descriptor) || descriptor.enumerable !== true || descriptor.value === undefined) {
      continue
    }
    const rendered = renderEmittableAnnotation(descriptor.value)
    if (rendered !== undefined) {
      entries.push(`${JSON.stringify(key)}: ${rendered}`)
    }
  }
  return entries.length === 0 ? undefined : `{ ${entries.join(", ")} }`
}

function sanitizeJavaScriptIdentifier(input: string): string {
  if (input.length === 0) return "_"
  const out: Array<string> = []
  let prefix = false
  let index = 0
  for (const character of input) {
    if (index === 0) {
      if (character === "_" || character === "$" || (character >= "A" && character <= "Z")) {
        out.push(character)
      } else if (character >= "a" && character <= "z") {
        out.push(character.toUpperCase())
      } else if (character >= "0" && character <= "9") {
        out.push(character)
        prefix = true
      } else {
        out.push("_")
      }
    } else {
      out.push(
        character === "_" || character === "$" ||
          (character >= "A" && character <= "Z") ||
          (character >= "a" && character <= "z") ||
          (character >= "0" && character <= "9")
          ? character
          : "_"
      )
    }
    index++
  }
  return prefix ? `_${out.join("")}` : out.join("")
}

function renderLiteral(value: string | number | boolean | bigint): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value)
    case "number":
      return renderNumber(value)
    case "boolean":
      return globalThis.String(value)
    case "bigint":
      return `${value}n`
  }
}

function isSimpleLiveLiteral(
  representation: SchemaRepresentation.LiveRepresentation
): representation is SchemaRepresentation.Literal<SchemaRepresentation.LiveAnnotations> {
  return representation._tag === "Literal" && representation.checks.length === 0 &&
    representation.annotations === undefined
}

function toTypeParts(parts: ReadonlyArray<SchemaRepresentation.LiveRepresentation>): ReadonlyArray<string> {
  if (parts.length === 0) return [""]
  const [first, ...rest] = parts
  const suffixes = toTypeParts(rest)
  return toTypePart(first).flatMap((prefix) => suffixes.map((suffix) => prefix + suffix))
}

function toTypePart(part: SchemaRepresentation.LiveRepresentation): ReadonlyArray<string> {
  switch (part._tag) {
    case "Literal":
      return [globalThis.String(part.literal)]
    case "String":
      return ["${string}"]
    case "Number":
      return ["${number}"]
    case "BigInt":
      return ["${bigint}"]
    case "TemplateLiteral":
      return toTypeParts(part.parts)
    case "Union":
      return part.types.flatMap(toTypePart)
    default:
      return []
  }
}

interface TopologicalSort {
  readonly nonRecursives: ReadonlyArray<{
    readonly $ref: string
    readonly representation: SchemaRepresentation.LiveRepresentation
  }>
  readonly recursives: Readonly<Record<string, SchemaRepresentation.LiveRepresentation>>
}

function topologicalSort(
  references: SchemaRepresentation.References<SchemaRepresentation.LiveAnnotations>
): TopologicalSort {
  const identifiers = Object.keys(references)
  const identifierSet = new Set(identifiers)

  function collectRefs(root: SchemaRepresentation.LiveRepresentation): ReadonlySet<string> {
    const refs = new Set<string>()
    const visited = new WeakSet<object>()
    const stack: Array<SchemaRepresentation.LiveRepresentation> = [root]

    function pushAnnotationSchemas(annotations: Schema.Annotations.Annotations | undefined): void {
      const representation = getDataAnnotation(annotations, "representation")
      if (typeof representation !== "object" || representation === null) return
      const schemas = (representation as { readonly schemas?: unknown }).schemas
      if (Array.isArray(schemas)) {
        for (const schema of schemas) stack.push(schema as SchemaRepresentation.LiveRepresentation)
      }
    }

    function pushChecks(
      checks: ReadonlyArray<SchemaRepresentation.Check<SchemaRepresentation.LiveAnnotations>>
    ): void {
      for (const check of checks) {
        pushAnnotationSchemas(check.annotations)
        if (check._tag === "FilterGroup") pushChecks(check.checks)
      }
    }

    while (stack.length > 0) {
      const representation = stack.pop()!
      if (visited.has(representation)) continue
      visited.add(representation)
      if (representation._tag === "Reference") {
        if (identifierSet.has(representation.$ref)) refs.add(representation.$ref)
        continue
      }

      pushAnnotationSchemas(representation.annotations)
      pushChecks(representation.checks)
      switch (representation._tag) {
        case "Declaration":
          stack.push(...representation.typeParameters)
          break
        case "Suspend":
          stack.push(representation.thunk)
          break
        case "String":
          if (representation.contentSchema !== undefined) stack.push(representation.contentSchema)
          break
        case "TemplateLiteral":
          stack.push(...representation.parts)
          break
        case "Arrays":
          for (const element of representation.elements) stack.push(element.type)
          stack.push(...representation.rest)
          break
        case "Objects":
          for (const property of representation.propertySignatures) stack.push(property.type)
          for (const signature of representation.indexSignatures) {
            stack.push(signature.parameter, signature.type)
          }
          break
        case "Union":
          stack.push(...representation.types)
          break
      }
    }
    return refs
  }

  const dependencies = new Map<string, ReadonlySet<string>>(
    identifiers.map((identifier) => [identifier, collectRefs(references[identifier])])
  )
  const recursive = new Set<string>()
  const state = new Map<string, 0 | 1 | 2>()
  const stack: Array<string> = []
  const stackIndexes = new Map<string, number>()

  function visit(identifier: string): void {
    const current = state.get(identifier) ?? 0
    if (current === 1) {
      const start = stackIndexes.get(identifier)
      if (start !== undefined) {
        for (let index = start; index < stack.length; index++) recursive.add(stack[index])
      }
      return
    }
    if (current === 2) return
    state.set(identifier, 1)
    stackIndexes.set(identifier, stack.length)
    stack.push(identifier)
    for (const dependency of dependencies.get(identifier) ?? []) visit(dependency)
    stack.pop()
    stackIndexes.delete(identifier)
    state.set(identifier, 2)
  }

  for (const identifier of identifiers) visit(identifier)

  const inDegree = new Map<string, number>()
  const dependents = new Map<string, Set<string>>()
  for (const identifier of identifiers) {
    if (!recursive.has(identifier)) {
      inDegree.set(identifier, 0)
      dependents.set(identifier, new Set())
    }
  }
  for (const [identifier, internalDependencies] of dependencies) {
    if (recursive.has(identifier)) continue
    for (const dependency of internalDependencies) {
      if (recursive.has(dependency)) continue
      inDegree.set(identifier, (inDegree.get(identifier) ?? 0) + 1)
      dependents.get(dependency)?.add(identifier)
    }
  }

  const queue: Array<string> = []
  for (const [identifier, degree] of inDegree) {
    if (degree === 0) queue.push(identifier)
  }
  const nonRecursives: Array<{
    readonly $ref: string
    readonly representation: SchemaRepresentation.LiveRepresentation
  }> = []
  for (let index = 0; index < queue.length; index++) {
    const $ref = queue[index]
    nonRecursives.push({ $ref, representation: references[$ref] })
    for (const dependent of dependents.get($ref) ?? []) {
      const degree = (inDegree.get(dependent) ?? 0) - 1
      inDegree.set(dependent, degree)
      if (degree === 0) queue.push(dependent)
    }
  }
  const recursives: Record<string, SchemaRepresentation.LiveRepresentation> = {}
  for (const identifier of recursive) recursives[identifier] = references[identifier]
  return { nonRecursives, recursives }
}

function compileCodeDocument(
  document: SchemaRepresentation.MultiDocument<SchemaRepresentation.LiveAnnotations>
): SchemaRepresentation.CodeDocument {
  const artifacts: Array<SchemaRepresentation.Artifact> = []
  const sorted = topologicalSort(document.references)
  const sanitizedReferences = new Map<string, string>()
  const uniqueIdentifiers = new Set<string>()

  for (const { $ref } of sorted.nonRecursives) ensureUniqueIdentifier($ref)
  for (const $ref of Object.keys(sorted.recursives)) ensureUniqueIdentifier($ref)

  const nonRecursives = sorted.nonRecursives.map(({ $ref, representation }) => ({
    $ref: ensureUniqueIdentifier($ref),
    code: recur(representation, ["references", $ref])
  }))
  const recursives: Record<string, SchemaRepresentation.Code> = {}
  for (const [$ref, representation] of Object.entries(sorted.recursives)) {
    recursives[ensureUniqueIdentifier($ref)] = recur(representation, ["references", $ref])
  }
  const codes = document.representations.map((representation, index) =>
    recur(representation, ["representations", index])
  )

  return {
    codes,
    references: { nonRecursives, recursives },
    artifacts
  }

  function ensureUniqueIdentifier(original: string): string {
    const existing = sanitizedReferences.get(original)
    if (existing !== undefined) return existing
    const seed = sanitizeJavaScriptIdentifier(original)
    let candidate = seed
    let suffix = 0
    while (uniqueIdentifiers.has(candidate)) candidate = `${seed}${++suffix}`
    uniqueIdentifiers.add(candidate)
    sanitizedReferences.set(original, candidate)
    return candidate
  }

  function freshIdentifier(seed: string): string {
    const sanitized = sanitizeJavaScriptIdentifier(seed)
    let candidate = sanitized
    let suffix = 0
    while (uniqueIdentifiers.has(candidate)) candidate = `${sanitized}${++suffix}`
    uniqueIdentifiers.add(candidate)
    return candidate
  }

  function addImport(importDeclaration: string): void {
    if (!artifacts.some((artifact) => artifact._tag === "Import" && artifact.importDeclaration === importDeclaration)) {
      artifacts.push({ _tag: "Import", importDeclaration })
    }
  }

  function addImports(importDeclarations: ReadonlyArray<string> | undefined): void {
    if (importDeclarations === undefined) return
    for (const importDeclaration of importDeclarations) addImport(importDeclaration)
  }

  function addSymbol(symbol: symbol): string {
    const identifier = freshIdentifier("_symbol")
    const key = globalThis.Symbol.keyFor(symbol)
    const description = symbol.description
    artifacts.push({
      _tag: "Symbol",
      identifier,
      generation: makeCode(
        key === undefined
          ? `Symbol(${description === undefined ? "" : JSON.stringify(description)})`
          : `Symbol.for(${JSON.stringify(key)})`,
        `typeof ${identifier}`
      )
    })
    return identifier
  }

  function addEnum(representation: SchemaRepresentation.Enum<SchemaRepresentation.LiveAnnotations>): string {
    const identifier = freshIdentifier("_Enum")
    artifacts.push({
      _tag: "Enum",
      identifier,
      generation: makeCode(
        `enum ${identifier} { ${
          representation.enums.map(([name, value]) => `${JSON.stringify(name)} = ${renderLiteral(value)}`).join(", ")
        } }`,
        `typeof ${identifier}`
      )
    })
    return identifier
  }

  function annotationSchemas(
    annotations: Schema.Annotations.Annotations | undefined,
    path: SchemaRepresentation.Path
  ): ReadonlyArray<SchemaRepresentation.Code> {
    const representation = getDataAnnotation(annotations, "representation")
    if (representation === undefined) return []
    if (typeof representation !== "object" || representation === null || Array.isArray(representation)) {
      return failCompiler({ _tag: "InvalidDocument", path: [...path, "representation"], cause: representation })
    }
    const schemas = (representation as { readonly schemas?: unknown }).schemas
    if (schemas === undefined) return []
    if (!Array.isArray(schemas)) {
      return failCompiler({
        _tag: "InvalidDocument",
        path: [...path, "representation", "schemas"],
        cause: schemas
      })
    }
    return schemas.map((schema, index) =>
      recur(
        schema as SchemaRepresentation.LiveRepresentation,
        [...path, "representation", "schemas", index]
      )
    )
  }

  function ownBrands(annotations: Schema.Annotations.Annotations | undefined): ReadonlyArray<string> {
    return InternalAnnotations.collectBrands(annotations).filter(Predicate.isString)
  }

  function checkBrands(
    check: SchemaRepresentation.Check<SchemaRepresentation.LiveAnnotations>
  ): ReadonlyArray<string> {
    const own = ownBrands(check.annotations)
    if (
      check._tag === "FilterGroup" &&
      !Predicate.isFunction(getDataAnnotation(check.annotations, "generation"))
    ) {
      return [...own, ...check.checks.flatMap(checkBrands)]
    }
    return own
  }

  function runtimeBrands(brands: ReadonlyArray<string>): string {
    return brands.length === 0
      ? ""
      : `.pipe(${brands.map((brand) => `Schema.brand(${JSON.stringify(brand)})`).join(", ")})`
  }

  function typeBrands(brands: ReadonlyArray<string>): string {
    if (brands.length === 0) return ""
    addImport(`import type * as Brand from "effect/Brand"`)
    return brands.map((brand) => ` & Brand.Brand<${JSON.stringify(brand)}>`).join("")
  }

  function runtimeAnnotate(
    annotations: Schema.Annotations.Annotations | undefined,
    method: "annotate" | "annotateKey" = "annotate"
  ): string {
    const rendered = renderAnnotations(annotations)
    return rendered === undefined ? "" : `.${method}(${rendered})`
  }

  function compileCheck(
    check: SchemaRepresentation.Check<SchemaRepresentation.LiveAnnotations>,
    path: SchemaRepresentation.Path
  ): string {
    const callback = getDataAnnotation(check.annotations, "generation")
    const callbackPath = [...path, "annotations", "generation"]
    let runtime: string
    if (check._tag === "Filter") {
      if (!Predicate.isFunction(callback)) {
        return failCompiler({ _tag: "MissingGeneration", path: callbackPath })
      }
      const schemas = annotationSchemas(check.annotations, [...path, "annotations"])
      const output = invokeCheckGeneration(
        callback as SchemaRepresentation.Generation.Check,
        { schemas },
        callbackPath
      )
      addImports(output.importDeclarations)
      runtime = output.runtime
    } else if (Predicate.isFunction(callback)) {
      const schemas = annotationSchemas(check.annotations, [...path, "annotations"])
      const output = invokeCheckGeneration(
        callback as SchemaRepresentation.Generation.Check,
        { schemas },
        callbackPath
      )
      addImports(output.importDeclarations)
      runtime = output.runtime
    } else {
      runtime = `Schema.makeFilterGroup([${
        check.checks.map((child, index) => compileCheck(child, [...path, "checks", index])).join(", ")
      }])`
    }
    runtime += runtimeAnnotate(check.annotations)
    if (check._tag === "Filter" && check.aborted) runtime += ".abort()"
    return runtime
  }

  function applyNode(
    base: SchemaRepresentation.Code,
    representation: Exclude<SchemaRepresentation.LiveRepresentation, SchemaRepresentation.Reference>,
    path: SchemaRepresentation.Path,
    includeTypeBrands: boolean = true
  ): SchemaRepresentation.Code {
    const nodeBrands = ownBrands(representation.annotations)
    let runtime = base.runtime + runtimeAnnotate(representation.annotations) + runtimeBrands(nodeBrands)
    let Type = base.Type + (includeTypeBrands ? typeBrands(nodeBrands) : "")
    for (let index = 0; index < representation.checks.length; index++) {
      const check = representation.checks[index]
      const brands = checkBrands(check)
      runtime += `.check(${compileCheck(check, [...path, "checks", index])})${runtimeBrands(brands)}`
      if (includeTypeBrands) Type += typeBrands(brands)
    }
    return makeCode(runtime, Type)
  }

  function recurString(
    representation: SchemaRepresentation.String<SchemaRepresentation.LiveAnnotations>,
    path: SchemaRepresentation.Path
  ): SchemaRepresentation.Code {
    const contentSchema = representation.contentSchema === undefined
      ? undefined
      : recur(representation.contentSchema, [...path, "contentSchema"])
    const isJson = representation.contentMediaType === "application/json" && contentSchema !== undefined
    const structuralAnnotations: Array<string> = []
    if (representation.contentMediaType !== undefined) {
      structuralAnnotations.push(`"contentMediaType": ${JSON.stringify(representation.contentMediaType)}`)
    }
    if (contentSchema !== undefined) {
      addImport(`import * as SchemaAST from "effect/SchemaAST"`)
      structuralAnnotations.push(
        `"contentSchema": SchemaAST.toEncoded(${isJson ? "contentSchema" : contentSchema.runtime}.ast)`
      )
    }
    const structural = structuralAnnotations.length === 0
      ? ""
      : `.annotate({ ${structuralAnnotations.join(", ")} })`
    const source = applyNode(
      makeCode(`Schema.String${structural}`, "string"),
      representation,
      path,
      !isJson
    )
    if (!isJson || contentSchema === undefined) return source
    addImport(`import * as SchemaTransformation from "effect/SchemaTransformation"`)
    return makeCode(
      `(<S extends Schema.Top>(contentSchema: S) => ${source.runtime}.pipe(Schema.decodeTo(contentSchema, SchemaTransformation.fromJsonString)))(${contentSchema.runtime})`,
      contentSchema.Type
    )
  }

  function recur(
    representation: SchemaRepresentation.LiveRepresentation,
    path: SchemaRepresentation.Path
  ): SchemaRepresentation.Code {
    if (representation._tag === "Reference") {
      if (!hasOwn.call(document.references, representation.$ref)) {
        return failCompiler({ _tag: "InvalidReference", path: [...path, "$ref"], $ref: representation.$ref })
      }
      const identifier = ensureUniqueIdentifier(representation.$ref)
      return makeCode(identifier, identifier)
    }
    if (representation._tag === "String") return recurString(representation, path)
    return applyNode(on(representation, path), representation, path)
  }

  function on(
    representation: Exclude<
      SchemaRepresentation.LiveRepresentation,
      SchemaRepresentation.Reference | SchemaRepresentation.String<SchemaRepresentation.LiveAnnotations>
    >,
    path: SchemaRepresentation.Path
  ): SchemaRepresentation.Code {
    switch (representation._tag) {
      case "Declaration": {
        const callback = getDataAnnotation(representation.annotations, "generation")
        const callbackPath = [...path, "annotations", "generation"]
        if (!Predicate.isFunction(callback)) {
          return failCompiler({ _tag: "MissingGeneration", path: callbackPath })
        }
        const typeParameters = representation.typeParameters.map((typeParameter, index) =>
          recur(typeParameter, [...path, "typeParameters", index])
        )
        const schemas = annotationSchemas(representation.annotations, [...path, "annotations"])
        const output = invokeDeclarationGeneration(
          callback as SchemaRepresentation.Generation.Declaration,
          { typeParameters, schemas },
          callbackPath
        )
        addImports(output.importDeclarations)
        return makeCode(output.runtime, output.Type)
      }
      case "Suspend": {
        const thunk = recur(representation.thunk, [...path, "thunk"])
        return makeCode(`Schema.suspend((): Schema.Codec<${thunk.Type}> => ${thunk.runtime})`, thunk.Type)
      }
      case "Null":
        return makeCode("Schema.Null", "null")
      case "Undefined":
        return makeCode("Schema.Undefined", "undefined")
      case "Void":
        return makeCode("Schema.Void", "void")
      case "Never":
        return makeCode("Schema.Never", "never")
      case "Unknown":
        return makeCode("Schema.Unknown", "unknown")
      case "Any":
        return makeCode("Schema.Any", "any")
      case "Number":
        return makeCode("Schema.Number", "number")
      case "Boolean":
        return makeCode("Schema.Boolean", "boolean")
      case "BigInt":
        return makeCode("Schema.BigInt", "bigint")
      case "Symbol":
        return makeCode("Schema.Symbol", "symbol")
      case "Literal": {
        const literal = renderLiteral(representation.literal)
        return makeCode(`Schema.Literal(${literal})`, literal)
      }
      case "UniqueSymbol": {
        const identifier = addSymbol(representation.symbol)
        return makeCode(`Schema.UniqueSymbol(${identifier})`, `typeof ${identifier}`)
      }
      case "ObjectKeyword":
        return makeCode("Schema.ObjectKeyword", "object")
      case "Enum": {
        const identifier = addEnum(representation)
        return makeCode(`Schema.Enum(${identifier})`, `typeof ${identifier}`)
      }
      case "TemplateLiteral": {
        const parts = representation.parts.map((part, index) => recur(part, [...path, "parts", index]))
        const Type = toTypeParts(representation.parts).map((part) => `\`${part}\``).join(" | ")
        return makeCode(`Schema.TemplateLiteral([${parts.map((part) => part.runtime).join(", ")}])`, Type)
      }
      case "Arrays": {
        const elements = representation.elements.map((element, index) => ({
          ...element,
          type: recur(element.type, [...path, "elements", index, "type"])
        }))
        const rest = representation.rest.map((item, index) => recur(item, [...path, "rest", index]))
        if (Arr.isArrayNonEmpty(rest)) {
          const item = rest[0]
          if (elements.length === 0 && rest.length === 1) {
            return makeCode(`Schema.Array(${item.runtime})`, `ReadonlyArray<${item.Type}>`)
          }
          const post = rest.slice(1)
          return makeCode(
            `Schema.TupleWithRest(Schema.Tuple([${
              elements.map((element) =>
                `${element.isOptional ? "Schema.optionalKey(" : ""}${element.type.runtime}${
                  element.isOptional ? ")" : ""
                }${runtimeAnnotate(element.annotations, "annotateKey")}`
              ).join(", ")
            }]), [${rest.map((item) => item.runtime).join(", ")}])`,
            `readonly [${
              elements.map((element) => `${element.type.Type}${element.isOptional ? "?" : ""}`).join(", ")
            }, ...Array<${item.Type}>${post.length > 0 ? `, ${post.map((item) => item.Type).join(", ")}` : ""}]`
          )
        }
        return makeCode(
          `Schema.Tuple([${
            elements.map((element) =>
              `${element.isOptional ? "Schema.optionalKey(" : ""}${element.type.runtime}${
                element.isOptional ? ")" : ""
              }${runtimeAnnotate(element.annotations, "annotateKey")}`
            ).join(", ")
          }])`,
          `readonly [${elements.map((element) => `${element.type.Type}${element.isOptional ? "?" : ""}`).join(", ")}]`
        )
      }
      case "Objects": {
        const properties = representation.propertySignatures.map((property, index) => {
          const isSymbol = typeof property.name === "symbol"
          const name = isSymbol
            ? addSymbol(property.name as symbol)
            : typeof property.name === "number"
            ? globalThis.String(property.name)
            : JSON.stringify(property.name)
          const type = recur(property.type, [...path, "propertySignatures", index, "type"])
          let runtime = type.runtime
          if (property.isMutable) runtime = `Schema.mutableKey(${runtime})`
          if (property.isOptional) runtime = `Schema.optionalKey(${runtime})`
          const runtimeName = isSymbol ? `[${name}]` : name
          const typeName = `${property.isMutable ? "" : "readonly "}${runtimeName}${property.isOptional ? "?" : ""}`
          return makeCode(
            `${runtimeName}: ${runtime}${runtimeAnnotate(property.annotations, "annotateKey")}`,
            `${typeName}: ${type.Type}`
          )
        })
        const indexSignatures = representation.indexSignatures.map((signature, index) => ({
          parameter: recur(signature.parameter, [...path, "indexSignatures", index, "parameter"]),
          type: recur(signature.type, [...path, "indexSignatures", index, "type"])
        }))
        if (indexSignatures.length === 0) {
          return makeCode(
            `Schema.Struct({ ${properties.map((property) => property.runtime).join(", ")} })`,
            `{ ${properties.map((property) => property.Type).join(", ")} }`
          )
        }
        if (properties.length === 0 && indexSignatures.length === 1) {
          const signature = indexSignatures[0]
          return makeCode(
            `Schema.Record(${signature.parameter.runtime}, ${signature.type.runtime})`,
            `{ readonly [x: ${signature.parameter.Type}]: ${signature.type.Type} }`
          )
        }
        const indexRuntimes = indexSignatures.map((signature) =>
          `Schema.Record(${signature.parameter.runtime}, ${signature.type.runtime})`
        ).join(", ")
        const indexTypes = indexSignatures.map((signature) =>
          `readonly [x: ${signature.parameter.Type}]: ${signature.type.Type}`
        ).join(", ")
        return makeCode(
          `Schema.StructWithRest(Schema.Struct({ ${
            properties.map((property) => property.runtime).join(", ")
          } }), [${indexRuntimes}])`,
          `{ ${properties.map((property) => property.Type).join(", ")}${
            properties.length > 0 ? ", " : ""
          }${indexTypes} }`
        )
      }
      case "Union": {
        if (representation.types.length === 0) return makeCode("Schema.Never", "never")
        if (representation.types.every(isSimpleLiveLiteral)) {
          const literals = representation.types.map((literal) => renderLiteral(literal.literal))
          return literals.length === 1
            ? makeCode(`Schema.Literal(${literals[0]})`, literals[0])
            : makeCode(`Schema.Literals([${literals.join(", ")}])`, literals.join(" | "))
        }
        const types = representation.types.map((type, index) => recur(type, [...path, "types", index]))
        const mode = representation.mode === "anyOf" ? "" : `, { mode: "oneOf" }`
        return makeCode(
          `Schema.Union([${types.map((type) => type.runtime).join(", ")}]${mode})`,
          types.map((type) => type.Type).join(" | ")
        )
      }
    }
  }
}

/** @internal */
export function toCodeDocument(
  document: SchemaRepresentation.MultiDocument<SchemaRepresentation.LiveAnnotations>
): ProjectionResult<SchemaRepresentation.CodeDocument> {
  return captureCompiler(() => compileCodeDocument(document))
}

/** @internal */
export function toCodeDocumentFromSchemaMultiDocument(
  document: SchemaRepresentation.SchemaMultiDocument
): ProjectionResult<SchemaRepresentation.CodeDocument> {
  const definitions = Object.entries(document.definitions).map(([key, schema]) => {
    const original = schema.ast
    const encoded = SchemaAST.toEncoded(original)
    const body = SchemaAST.isSuspend(encoded) ? encoded.thunk() : encoded
    return { key, original, encoded, body }
  })
  const asts = Arr.map(document.schemas, (schema) => SchemaAST.toEncoded(schema.ast))
  return captureCompiler(() => compileCodeDocument(lowerASTs(asts, definitions)))
}

/** @internal */
export function fromAST(ast: SchemaAST.AST): SchemaRepresentation.Document<SchemaRepresentation.LiveAnnotations> {
  const { references, representations } = fromASTs([ast])
  return { representation: representations[0], references }
}

/** @internal */
export function fromASTs(
  asts: readonly [SchemaAST.AST, ...Array<SchemaAST.AST>]
): SchemaRepresentation.MultiDocument<SchemaRepresentation.LiveAnnotations> {
  return lowerASTs(Arr.map(asts, (ast) => SchemaAST.toType(ast)), [])
}

interface ExternalDefinition {
  readonly key: string
  readonly original: SchemaAST.AST
  readonly encoded: SchemaAST.AST
  readonly body: SchemaAST.AST
}

function lowerASTs(
  asts: readonly [SchemaAST.AST, ...Array<SchemaAST.AST>],
  externalDefinitions: ReadonlyArray<ExternalDefinition>
): SchemaRepresentation.MultiDocument<SchemaRepresentation.LiveAnnotations> {
  const references: Record<string, SchemaRepresentation.LiveRepresentation> = {}
  const referenceMap = new Map<SchemaAST.AST, string>()
  const uniqueReferences = new Set(externalDefinitions.map((definition) => definition.key))
  const visiting = new Set<SchemaAST.AST>()
  const externalBodyReferences = new Map<SchemaAST.AST, string | null>()

  for (const definition of externalDefinitions) {
    referenceMap.set(definition.original, definition.key)
    referenceMap.set(definition.encoded, definition.key)
    externalBodyReferences.set(
      definition.body,
      externalBodyReferences.has(definition.body) ? null : definition.key
    )
  }

  const representations = Arr.map(asts, (ast) => recur(ast))

  for (const definition of externalDefinitions) {
    references[definition.key] = recur(definition.body, definition.key)
  }

  return { representations, references }

  function generateReference(prefix: string): string {
    let candidate = prefix
    let suffix = 0
    while (uniqueReferences.has(candidate)) {
      candidate = `${prefix}${++suffix}`
    }
    uniqueReferences.add(candidate)
    return candidate
  }

  function recur(ast: SchemaAST.AST, ownedReference?: string): SchemaRepresentation.LiveRepresentation {
    let found = referenceMap.get(ast)
    if (found === undefined && SchemaAST.isSuspend(ast)) {
      const bodyReference = externalBodyReferences.get(ast.thunk())
      if (bodyReference !== undefined && bodyReference !== null) {
        found = bodyReference
        referenceMap.set(ast, bodyReference)
      }
    }
    if (found !== undefined && found !== ownedReference) {
      return { _tag: "Reference", $ref: found }
    }

    const identifier = ownedReference === undefined ? InternalAnnotations.resolveIdentifier(ast) : undefined
    if (identifier !== undefined) {
      const reference = generateReference(identifier)
      referenceMap.set(ast, reference)
      const representation = on(ast)
      const existing = references[identifier]
      if (existing !== undefined && Equal.equals(representation, existing)) {
        referenceMap.set(ast, identifier)
        return { _tag: "Reference", $ref: identifier }
      }
      references[reference] = representation
      return { _tag: "Reference", $ref: reference }
    }

    if (visiting.has(ast)) {
      const reference = generateReference(`${ast._tag}_`)
      referenceMap.set(ast, reference)
      return { _tag: "Reference", $ref: reference }
    }

    visiting.add(ast)
    const representation = on(ast)
    visiting.delete(ast)

    const reference = referenceMap.get(ast)
    if (reference !== undefined && reference !== ownedReference) {
      references[reference] = representation
      return { _tag: "Reference", $ref: reference }
    }

    return representation
  }

  function on(ast: SchemaAST.AST): SchemaRepresentation.LiveRepresentation {
    switch (ast._tag) {
      case "Declaration":
        return {
          _tag: "Declaration",
          typeParameters: ast.typeParameters.map((ast) => recur(ast)),
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "Null":
      case "Undefined":
      case "Void":
      case "Never":
      case "Unknown":
      case "Any":
      case "Boolean":
      case "Symbol":
      case "ObjectKeyword":
        return {
          _tag: ast._tag,
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "String": {
        const contentMediaType = ast.annotations?.contentMediaType
        const contentSchema = ast.annotations?.contentSchema
        return {
          _tag: "String",
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations, true),
          ...(typeof contentMediaType === "string" ? { contentMediaType } : undefined),
          ...(SchemaAST.isAST(contentSchema) ? { contentSchema: recur(SchemaAST.toType(contentSchema)) } : undefined)
        }
      }
      case "Number":
      case "BigInt":
        return {
          _tag: ast._tag,
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "Literal":
        return {
          _tag: "Literal",
          literal: ast.literal,
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "UniqueSymbol":
        return {
          _tag: "UniqueSymbol",
          symbol: ast.symbol,
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "Enum":
        return {
          _tag: "Enum",
          enums: ast.enums,
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "TemplateLiteral":
        return {
          _tag: "TemplateLiteral",
          parts: ast.parts.map((ast) => recur(ast)),
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "Arrays":
        return {
          _tag: "Arrays",
          elements: ast.elements.map((element) => ({
            isOptional: SchemaAST.isOptional(element),
            type: recur(element),
            ...fromKeyAnnotations(element.context?.annotations)
          })),
          rest: ast.rest.map((ast) => recur(ast)),
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "Objects":
        return {
          _tag: "Objects",
          propertySignatures: ast.propertySignatures.map((property) => ({
            name: property.name,
            type: recur(property.type),
            isOptional: SchemaAST.isOptional(property.type),
            isMutable: SchemaAST.isMutable(property.type),
            ...fromKeyAnnotations(property.type.context?.annotations)
          })),
          indexSignatures: ast.indexSignatures.map((index) => ({
            parameter: recur(index.parameter),
            type: recur(index.type)
          })),
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "Union":
        return {
          _tag: "Union",
          types: InternalSchema.jsonReorder(ast.types).map((ast) => recur(ast)),
          mode: ast.mode,
          checks: fromChecks(ast.checks),
          ...fromNodeAnnotations(ast.annotations)
        }
      case "Suspend":
        return {
          _tag: "Suspend",
          checks: [],
          thunk: recur(ast.thunk()),
          ...fromNodeAnnotations(ast.annotations)
        }
    }
  }

  function fromChecks(
    checks: readonly [SchemaAST.Check<any>, ...Array<SchemaAST.Check<any>>] | undefined
  ): Array<SchemaRepresentation.Check<SchemaRepresentation.LiveAnnotations>> {
    return checks?.map(fromCheck) ?? []
  }

  function fromCheck(
    check: SchemaAST.Check<any>
  ): SchemaRepresentation.Check<SchemaRepresentation.LiveAnnotations> {
    switch (check._tag) {
      case "Filter":
        return {
          _tag: "Filter",
          aborted: check.aborted,
          ...fromFilterAnnotations(check.annotations)
        }
      case "FilterGroup":
        return {
          _tag: "FilterGroup",
          checks: Arr.map(check.checks, fromCheck),
          ...fromFilterAnnotations(check.annotations)
        }
    }
  }

  function fromNodeAnnotations(
    annotations: Schema.Annotations.Annotations | undefined,
    stripStringContent: boolean = false
  ): { readonly annotations: SchemaRepresentation.LiveAnnotations["node"] } | undefined {
    const converted = convertRepresentationSchemas(annotations, stripStringContent)
    return converted === undefined ? undefined : { annotations: converted }
  }

  function fromFilterAnnotations(
    annotations: Schema.Annotations.Filter | undefined
  ): { readonly annotations: SchemaRepresentation.LiveAnnotations["filter"] } | undefined {
    const converted = convertRepresentationSchemas(annotations, false)
    return converted === undefined ? undefined : { annotations: converted }
  }

  function fromKeyAnnotations(
    annotations: Schema.Annotations.Key<unknown> | undefined
  ): { readonly annotations: SchemaRepresentation.LiveAnnotations["key"] } | undefined {
    return annotations === undefined ? undefined : { annotations }
  }

  function convertRepresentationSchemas<A extends Schema.Annotations.Annotations>(
    annotations: A | undefined,
    stripStringContent: boolean
  ): SchemaRepresentation.RebindRepresentation<A, SchemaRepresentation.LiveRepresentation> | undefined {
    if (annotations === undefined) {
      return undefined
    }

    let out: Record<string, unknown> = annotations
    const representation = annotations.representation
    if (
      typeof representation === "object" &&
      representation !== null &&
      "schemas" in representation &&
      Array.isArray(representation.schemas)
    ) {
      out = {
        ...out,
        representation: {
          ...representation,
          schemas: representation.schemas.map((schema) => recur(SchemaAST.toType(schema)))
        }
      }
    }

    if (stripStringContent && ("contentMediaType" in out || "contentSchema" in out)) {
      const { contentMediaType: _, contentSchema: __, ...rest } = out
      out = rest
    }

    return out as SchemaRepresentation.RebindRepresentation<A, SchemaRepresentation.LiveRepresentation>
  }
}
