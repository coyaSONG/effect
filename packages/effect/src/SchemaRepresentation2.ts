/**
 * Open, compiler-extensible representation of Effect schemas.
 *
 * @since 4.0.0
 */
import * as InternalRepresentation from "./internal/schema/representation2.ts"
import * as InternalRepresentationSchema from "./internal/schema/representation2Schema.ts"
import type * as JsonSchema from "./JsonSchema.ts"
import type * as Schema from "./Schema.ts"
import type * as SchemaAST from "./SchemaAST.ts"

/**
 * Annotation slots used by every representation node.
 *
 * @category models
 * @since 4.0.0
 */
export interface RepresentationAnnotationSlots {
  readonly node: unknown
  readonly filter: unknown
  readonly key: unknown
}

/**
 * Open persistence identity carried by declarations and opaque checks.
 *
 * @category annotations
 * @since 4.0.0
 */
export interface RepresentationAnnotation<S> {
  readonly id: string
  readonly payload: Schema.Json
  readonly schemas?: ReadonlyArray<S> | undefined
}

/**
 * Rebinds only the schema dependencies of a representation annotation.
 *
 * @category utility types
 * @since 4.0.0
 */
export type RebindRepresentation<A, S> =
  & Omit<A, "representation">
  & { readonly representation?: RepresentationAnnotation<S> | undefined }

/**
 * Annotation slots retained by a live representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface LiveAnnotations extends RepresentationAnnotationSlots {
  readonly node: RebindRepresentation<Schema.Annotations.Annotations, LiveRepresentation>
  readonly filter: RebindRepresentation<Schema.Annotations.Filter, LiveRepresentation>
  readonly key: Schema.Annotations.Key<unknown>
}

/**
 * JSON annotations retained on ordinary structural positions.
 *
 * @category models
 * @since 4.0.0
 */
export interface PersistedOrdinaryAnnotations {
  readonly [key: string]: Schema.Json
}

/**
 * JSON annotations retained on declarations and opaque checks.
 *
 * @category models
 * @since 4.0.0
 */
export interface PersistedOpaqueAnnotations<S> {
  readonly [key: string]: Schema.Json | RepresentationAnnotation<S> | undefined
  readonly representation?: RepresentationAnnotation<S> | undefined
}

/**
 * Annotation slots retained by a persisted representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface PersistedAnnotations extends RepresentationAnnotationSlots {
  readonly node: PersistedOpaqueAnnotations<PersistedRepresentation>
  readonly filter: PersistedOpaqueAnnotations<PersistedRepresentation>
  readonly key: PersistedOrdinaryAnnotations
}

/**
 * Input passed to JSON Schema compiler annotations.
 *
 * @since 4.0.0
 */
export declare namespace ToJsonSchema {
  /**
   * Input for a check compiler.
   *
   * @category models
   * @since 4.0.0
   */
  export interface CheckInput {
    readonly type: JsonSchema.Type | undefined
    readonly schemas: ReadonlyArray<JsonSchema.JsonSchema>
  }

  /**
   * Input for a declaration compiler.
   *
   * @category models
   * @since 4.0.0
   */
  export interface DeclarationInput {
    readonly typeParameters: ReadonlyArray<JsonSchema.JsonSchema>
    readonly schemas: ReadonlyArray<JsonSchema.JsonSchema>
  }

  /**
   * JSON Schema compiler for a check.
   *
   * @category models
   * @since 4.0.0
   */
  export type Check = (input: CheckInput) => JsonSchema.JsonSchema

  /**
   * JSON Schema compiler for a declaration.
   *
   * @category models
   * @since 4.0.0
   */
  export type Declaration = (input: DeclarationInput) => JsonSchema.JsonSchema
}

/**
 * Input and output contracts for code generation annotations.
 *
 * @since 4.0.0
 */
export declare namespace Generation {
  /**
   * Input for declaration code generation.
   *
   * @category models
   * @since 4.0.0
   */
  export interface DeclarationInput {
    readonly typeParameters: ReadonlyArray<Code>
    readonly schemas: ReadonlyArray<Code>
  }

  /**
   * Output of declaration code generation.
   *
   * @category models
   * @since 4.0.0
   */
  export interface DeclarationOutput {
    readonly runtime: string
    readonly Type: string
    readonly importDeclarations?: ReadonlyArray<string> | undefined
  }

  /**
   * Declaration code generator.
   *
   * @category models
   * @since 4.0.0
   */
  export type Declaration = (input: DeclarationInput) => DeclarationOutput

  /**
   * Input for check code generation.
   *
   * @category models
   * @since 4.0.0
   */
  export interface CheckInput {
    readonly schemas: ReadonlyArray<Code>
  }

  /**
   * Output of check code generation.
   *
   * @category models
   * @since 4.0.0
   */
  export interface CheckOutput {
    readonly runtime: string
    readonly importDeclarations?: ReadonlyArray<string> | undefined
  }

  /**
   * Check code generator.
   *
   * @category models
   * @since 4.0.0
   */
  export type Check = (input: CheckInput) => CheckOutput
}

/**
 * A custom opaque declaration.
 *
 * @category models
 * @since 4.0.0
 */
export interface Declaration<A extends RepresentationAnnotationSlots> {
  readonly _tag: "Declaration"
  readonly annotations?: A["node"] | undefined
  readonly typeParameters: ReadonlyArray<Representation<A>>
  readonly checks: ReadonlyArray<Check<A>>
}

/**
 * A lazily resolved representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Suspend<A extends RepresentationAnnotationSlots> {
  readonly _tag: "Suspend"
  readonly annotations?: A["node"] | undefined
  readonly checks: readonly []
  readonly thunk: Representation<A>
}

/**
 * A named reference.
 *
 * @category models
 * @since 4.0.0
 */
export interface Reference {
  readonly _tag: "Reference"
  readonly $ref: string
}

interface Keyword<A extends RepresentationAnnotationSlots, Tag extends string> {
  readonly _tag: Tag
  readonly annotations?: A["node"] | undefined
  readonly checks: ReadonlyArray<Check<A>>
}

/**
 * The null keyword representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Null<A extends RepresentationAnnotationSlots> extends Keyword<A, "Null"> {}
/**
 * The undefined keyword representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Undefined<A extends RepresentationAnnotationSlots> extends Keyword<A, "Undefined"> {}
/**
 * The void keyword representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Void<A extends RepresentationAnnotationSlots> extends Keyword<A, "Void"> {}
/**
 * The never keyword representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Never<A extends RepresentationAnnotationSlots> extends Keyword<A, "Never"> {}
/**
 * The unknown keyword representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Unknown<A extends RepresentationAnnotationSlots> extends Keyword<A, "Unknown"> {}
/**
 * The any keyword representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Any<A extends RepresentationAnnotationSlots> extends Keyword<A, "Any"> {}

/**
 * A string representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface String<A extends RepresentationAnnotationSlots> extends Keyword<A, "String"> {
  readonly contentMediaType?: string | undefined
  readonly contentSchema?: Representation<A> | undefined
}

/**
 * A number representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Number<A extends RepresentationAnnotationSlots> extends Keyword<A, "Number"> {}
/**
 * A boolean representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Boolean<A extends RepresentationAnnotationSlots> extends Keyword<A, "Boolean"> {}
/**
 * A bigint representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface BigInt<A extends RepresentationAnnotationSlots> extends Keyword<A, "BigInt"> {}
/**
 * A symbol representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Symbol<A extends RepresentationAnnotationSlots> extends Keyword<A, "Symbol"> {}

/**
 * A literal representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Literal<A extends RepresentationAnnotationSlots> extends Keyword<A, "Literal"> {
  readonly literal: string | number | boolean | bigint
}

/**
 * A unique global symbol representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface UniqueSymbol<A extends RepresentationAnnotationSlots> extends Keyword<A, "UniqueSymbol"> {
  readonly symbol: symbol
}

/**
 * The object keyword representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface ObjectKeyword<A extends RepresentationAnnotationSlots> extends Keyword<A, "ObjectKeyword"> {}

/**
 * An enum representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Enum<A extends RepresentationAnnotationSlots> extends Keyword<A, "Enum"> {
  readonly enums: ReadonlyArray<readonly [string, string | number]>
}

/**
 * A template literal representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface TemplateLiteral<A extends RepresentationAnnotationSlots> extends Keyword<A, "TemplateLiteral"> {
  readonly parts: ReadonlyArray<Representation<A>>
}

/**
 * A tuple element.
 *
 * @category models
 * @since 4.0.0
 */
export interface Element<A extends RepresentationAnnotationSlots> {
  readonly isOptional: boolean
  readonly type: Representation<A>
  readonly annotations?: A["key"] | undefined
}

/**
 * An array or tuple representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Arrays<A extends RepresentationAnnotationSlots> extends Keyword<A, "Arrays"> {
  readonly elements: ReadonlyArray<Element<A>>
  readonly rest: ReadonlyArray<Representation<A>>
}

/**
 * A property signature.
 *
 * @category models
 * @since 4.0.0
 */
export interface PropertySignature<A extends RepresentationAnnotationSlots> {
  readonly name: PropertyKey | number
  readonly type: Representation<A>
  readonly isOptional: boolean
  readonly isMutable: boolean
  readonly annotations?: A["key"] | undefined
}

/**
 * An index signature.
 *
 * @category models
 * @since 4.0.0
 */
export interface IndexSignature<A extends RepresentationAnnotationSlots> {
  readonly parameter: Representation<A>
  readonly type: Representation<A>
}

/**
 * An object representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Objects<A extends RepresentationAnnotationSlots> extends Keyword<A, "Objects"> {
  readonly propertySignatures: ReadonlyArray<PropertySignature<A>>
  readonly indexSignatures: ReadonlyArray<IndexSignature<A>>
}

/**
 * A union representation.
 *
 * @category models
 * @since 4.0.0
 */
export interface Union<A extends RepresentationAnnotationSlots> extends Keyword<A, "Union"> {
  readonly types: ReadonlyArray<Representation<A>>
  readonly mode: "anyOf" | "oneOf"
}

/**
 * The structural schema representation.
 *
 * @category models
 * @since 4.0.0
 */
export type Representation<A extends RepresentationAnnotationSlots> =
  | Declaration<A>
  | Reference
  | Suspend<A>
  | Null<A>
  | Undefined<A>
  | Void<A>
  | Never<A>
  | Unknown<A>
  | Any<A>
  | String<A>
  | Number<A>
  | Boolean<A>
  | BigInt<A>
  | Symbol<A>
  | Literal<A>
  | UniqueSymbol<A>
  | ObjectKeyword<A>
  | Enum<A>
  | TemplateLiteral<A>
  | Arrays<A>
  | Objects<A>
  | Union<A>

/**
 * A live representation.
 *
 * @category models
 * @since 4.0.0
 */
export type LiveRepresentation = Representation<LiveAnnotations>

/**
 * A persisted representation.
 *
 * @category models
 * @since 4.0.0
 */
export type PersistedRepresentation = Representation<PersistedAnnotations>

/**
 * A structural check.
 *
 * @category models
 * @since 4.0.0
 */
export type Check<A extends RepresentationAnnotationSlots> = Filter<A> | FilterGroup<A>

/**
 * An opaque leaf check.
 *
 * @category models
 * @since 4.0.0
 */
export interface Filter<A extends RepresentationAnnotationSlots> {
  readonly _tag: "Filter"
  readonly annotations?: A["filter"] | undefined
  readonly aborted: boolean
}

/**
 * A non-empty group of checks.
 *
 * @category models
 * @since 4.0.0
 */
export interface FilterGroup<A extends RepresentationAnnotationSlots> {
  readonly _tag: "FilterGroup"
  readonly annotations?: A["filter"] | undefined
  readonly checks: readonly [Check<A>, ...Array<Check<A>>]
}

/**
 * Named representation definitions.
 *
 * @category models
 * @since 4.0.0
 */
export interface References<A extends RepresentationAnnotationSlots> {
  readonly [$ref: string]: Representation<A>
}

/**
 * A single representation and its definitions.
 *
 * @category models
 * @since 4.0.0
 */
export interface Document<A extends RepresentationAnnotationSlots> {
  readonly representation: Representation<A>
  readonly references: References<A>
}

/**
 * Multiple representations sharing definitions.
 *
 * @category models
 * @since 4.0.0
 */
export interface MultiDocument<A extends RepresentationAnnotationSlots> {
  readonly representations: readonly [Representation<A>, ...Array<Representation<A>>]
  readonly references: References<A>
}

/**
 * Live schemas reconstructed from a multi-document.
 *
 * @category models
 * @since 4.0.0
 */
export interface SchemaMultiDocument {
  readonly schemas: readonly [Schema.Top, ...Array<Schema.Top>]
  readonly definitions: Readonly<Record<string, Schema.Top>>
}

/**
 * Base contract shared by revivers.
 *
 * @category models
 * @since 4.0.0
 */
export interface ReviverBase<P> {
  readonly id: string
  readonly payloadSchema: Schema.Decoder<P>
  readonly schemasArity: number
}

/**
 * Reviver for a declaration.
 *
 * @category models
 * @since 4.0.0
 */
export interface DeclarationReviver<P> extends ReviverBase<P> {
  readonly _tag: "Declaration"
  readonly typeParametersArity: number
  readonly revive: (input: {
    readonly payload: P
    readonly schemas: ReadonlyArray<Schema.Top>
    readonly typeParameters: ReadonlyArray<Schema.Top>
    readonly annotations: Schema.Annotations.Annotations | undefined
  }) => Schema.Top
}

/**
 * Reviver for a leaf check.
 *
 * @category models
 * @since 4.0.0
 */
export interface FilterReviver<P> extends ReviverBase<P> {
  readonly _tag: "Filter"
  readonly revive: (input: {
    readonly payload: P
    readonly schemas: ReadonlyArray<Schema.Top>
    readonly annotations: Schema.Annotations.Filter | undefined
  }) => SchemaAST.Filter<any>
}

/**
 * Reviver for a check group.
 *
 * @category models
 * @since 4.0.0
 */
export interface FilterGroupReviver<P> extends ReviverBase<P> {
  readonly _tag: "FilterGroup"
  readonly revive: (input: {
    readonly payload: P
    readonly schemas: ReadonlyArray<Schema.Top>
    readonly annotations: Schema.Annotations.Filter | undefined
  }) => SchemaAST.FilterGroup<any>
}

/**
 * A check reviver.
 *
 * @category models
 * @since 4.0.0
 */
export type CheckReviver<P> = FilterReviver<P> | FilterGroupReviver<P>

/**
 * A typed reviver.
 *
 * @category models
 * @since 4.0.0
 */
export type Reviver<P> = DeclarationReviver<P> | CheckReviver<P>

/**
 * A reviver erased only at collection boundaries.
 *
 * @category models
 * @since 4.0.0
 */
export type AnyReviver = Reviver<any>

/**
 * Options for reconstructing schemas from persisted representation documents.
 *
 * **Details**
 *
 * Revivers are indexed locally by `id` for each call. No built-in or global revivers are installed implicitly.
 *
 * @category models
 * @since 4.0.0
 */
export interface FromJsonOptions {
  readonly revivers: ReadonlyArray<AnyReviver>
}

/**
 * Options for importing JSON Schema Draft 2020-12 documents.
 *
 * **When to use**
 *
 * Use when each JSON Schema node must be transformed before it is translated.
 *
 * **Gotchas**
 *
 * `onEnter` must return a JSON Schema object. Its result is used directly, and exceptions raised by the callback pass through unchanged.
 *
 * @category models
 * @since 4.0.0
 */
export interface FromJsonSchemaOptions {
  readonly onEnter?: ((schema: JsonSchema.JsonSchema) => JsonSchema.JsonSchema) | undefined
}

/**
 * Runtime and TypeScript source generated for one schema.
 *
 * @category models
 * @since 4.0.0
 */
export interface Code {
  readonly runtime: string
  readonly Type: string
}

/**
 * Auxiliary source artifact emitted while generating schema code.
 *
 * @category models
 * @since 4.0.0
 */
export type Artifact =
  | {
    readonly _tag: "Symbol"
    readonly identifier: string
    readonly generation: Code
  }
  | {
    readonly _tag: "Enum"
    readonly identifier: string
    readonly generation: Code
  }
  | {
    readonly _tag: "Import"
    readonly importDeclaration: string
  }

/**
 * Generated schema code together with named references and auxiliary artifacts.
 *
 * @category models
 * @since 4.0.0
 */
export interface CodeDocument {
  readonly codes: ReadonlyArray<Code>
  readonly references: {
    readonly nonRecursives: ReadonlyArray<{
      readonly $ref: string
      readonly code: Code
    }>
    readonly recursives: Readonly<Record<string, Code>>
  }
  readonly artifacts: ReadonlyArray<Artifact>
}

/**
 * Lowers the type side of an AST to a live representation document.
 *
 * @category constructors
 * @since 4.0.0
 */
export function fromAST(ast: SchemaAST.AST): Document<LiveAnnotations> {
  return InternalRepresentation.fromAST(ast)
}

/**
 * Lowers one or more AST type sides in a shared reference environment.
 *
 * @category constructors
 * @since 4.0.0
 */
export function fromASTs(
  asts: readonly [SchemaAST.AST, ...Array<SchemaAST.AST>]
): MultiDocument<LiveAnnotations> {
  return InternalRepresentation.fromASTs(asts)
}

/**
 * Compiles a live representation document to JSON Schema Draft 2020-12.
 *
 * **When to use**
 *
 * Use when you need JSON Schema output from a representation whose custom declarations and checks carry compiler annotations.
 *
 * **Gotchas**
 *
 * Check compilation is best-effort, but opaque declarations require a `toJsonSchema` callback. Callback results are used directly, and exceptions raised by the callback pass through unchanged.
 *
 * @see {@link toJsonSchemaMultiDocument} for multiple roots sharing definitions
 *
 * @category transforming
 * @since 4.0.0
 */
export function toJsonSchemaDocument(
  document: Document<LiveAnnotations>,
  options?: Schema.ToJsonSchemaOptions
): JsonSchema.Document<"draft-2020-12"> {
  return InternalRepresentation.toJsonSchemaDocument(document, options)
}

/**
 * Compiles multiple live representations to a shared JSON Schema Draft 2020-12 document.
 *
 * **When to use**
 *
 * Use when several representation roots must share the same JSON Schema definitions.
 *
 * **Gotchas**
 *
 * Every definition is compiled, including definitions that are not reachable from a root.
 *
 * @see {@link toJsonSchemaDocument} for a single root
 *
 * @category transforming
 * @since 4.0.0
 */
export function toJsonSchemaMultiDocument(
  document: MultiDocument<LiveAnnotations>,
  options?: Schema.ToJsonSchemaOptions
): JsonSchema.MultiDocument<"draft-2020-12"> {
  return InternalRepresentation.toJsonSchemaMultiDocument(document, options)
}

/**
 * Generates TypeScript source for live schema representations and their definitions.
 *
 * **When to use**
 *
 * Use when custom declarations and checks provide `generation` callbacks and must be emitted without a central handler registry.
 *
 * **Gotchas**
 *
 * Opaque declarations and leaf checks require generation callbacks. Callback results are used directly, and exceptions raised by a callback pass through unchanged.
 *
 * @category transforming
 * @since 4.0.0
 */
export function toCodeDocument(document: MultiDocument<LiveAnnotations>): CodeDocument {
  return InternalRepresentation.toCodeDocument(document)
}

/**
 * Generates TypeScript source from live schemas and their named definitions.
 *
 * **When to use**
 *
 * Use when imported roots and definitions must be compiled in one shared reference environment.
 *
 * **Gotchas**
 *
 * Every schema is projected to its encoded side. Definitions are emitted as references, including definitions that no root reaches.
 *
 * @see {@link toCodeDocument} for compiling an existing live representation document
 *
 * @category transforming
 * @since 4.0.0
 */
export function toCodeDocumentFromSchemaMultiDocument(document: SchemaMultiDocument): CodeDocument {
  return InternalRepresentation.toCodeDocumentFromSchemaMultiDocument(document)
}

/**
 * Schema for persisted single-root representation documents encoded as JSON.
 *
 * **When to use**
 *
 * Use when you need to inspect or transport the persisted representation without reviving runtime callbacks.
 *
 * **Gotchas**
 *
 * Extended structural primitives use tagged JSON envelopes. Payloads and generic annotations remain ordinary JSON.
 *
 * @see {@link PersistedMultiDocumentFromJson} for documents with multiple roots
 * @see {@link toJson} for projecting a live document before encoding it
 *
 * @category schemas
 * @since 4.0.0
 */
export const PersistedDocumentFromJson: Schema.Codec<Document<PersistedAnnotations>, Schema.Json> =
  InternalRepresentationSchema.getPersistedDocumentFromJson()

/**
 * Schema for persisted multi-root representation documents encoded as JSON.
 *
 * **When to use**
 *
 * Use when you need to inspect or transport multiple persisted roots that share references.
 *
 * **Gotchas**
 *
 * Decoding validates persisted data but does not reconstruct schemas or runtime callbacks.
 *
 * @see {@link PersistedDocumentFromJson} for a single-root document
 * @see {@link toJsonMultiDocument} for projecting a live multi-document before encoding it
 *
 * @category schemas
 * @since 4.0.0
 */
export const PersistedMultiDocumentFromJson: Schema.Codec<MultiDocument<PersistedAnnotations>, Schema.Json> =
  InternalRepresentationSchema.getPersistedMultiDocumentFromJson()

/**
 * Projects a live single-root representation document and encodes it as JSON.
 *
 * **When to use**
 *
 * Use when you need a stable JSON value for storage or transport after calling `fromAST`.
 *
 * **Gotchas**
 *
 * Generic annotations that are not JSON are omitted. Invalid persistence identities and unsupported structural values throw an `Error` containing their representation path.
 *
 * @see {@link fromAST} for constructing the live document
 * @see {@link PersistedDocumentFromJson} for direct access to the persisted codec
 * @see {@link toJsonMultiDocument} for documents with multiple roots
 *
 * @category encoding
 * @since 4.0.0
 */
export function toJson(document: Document<LiveAnnotations>): Schema.Json {
  return InternalRepresentationSchema.toJson(document)
}

/**
 * Projects a live multi-root representation document and encodes it as JSON.
 *
 * **When to use**
 *
 * Use when you need one JSON value for multiple live roots that share a reference environment.
 *
 * **Gotchas**
 *
 * The root order and shared reference keys are preserved, while non-JSON generic annotations are omitted.
 *
 * @see {@link fromASTs} for constructing the live multi-document
 * @see {@link PersistedMultiDocumentFromJson} for direct access to the persisted codec
 * @see {@link toJson} for a single-root document
 *
 * @category encoding
 * @since 4.0.0
 */
export function toJsonMultiDocument(document: MultiDocument<LiveAnnotations>): Schema.Json {
  return InternalRepresentationSchema.toJsonMultiDocument(document)
}

/**
 * Reconstructs a runtime schema from a persisted single-root representation document.
 *
 * **When to use**
 *
 * Use when crossing a JSON boundary after registering the declaration and check revivers that the document may reference.
 *
 * **Gotchas**
 *
 * `options` is required even when `revivers` is empty. Invalid documents throw a schema decoding error. Reviver results are used directly, and exceptions raised by a reviver pass through unchanged.
 *
 * @see {@link toJson} for producing the persisted document
 * @see {@link fromJsonMultiDocument} for multiple roots sharing references
 *
 * @category decoding
 * @since 4.0.0
 */
export function fromJson(input: unknown, options: FromJsonOptions): Schema.Top {
  return InternalRepresentationSchema.fromJson(input, options.revivers)
}

/**
 * Reconstructs multiple runtime schemas and their shared definitions from a persisted document.
 *
 * **When to use**
 *
 * Use when every root and named definition must be rebuilt in one shared reference environment.
 *
 * **Gotchas**
 *
 * Every definition is revived, including definitions not reachable from a root. Reference entries remain stable suspended wrappers.
 *
 * @see {@link toJsonMultiDocument} for producing the persisted document
 * @see {@link fromJson} for a single root
 *
 * @category decoding
 * @since 4.0.0
 */
export function fromJsonMultiDocument(input: unknown, options: FromJsonOptions): SchemaMultiDocument {
  return InternalRepresentationSchema.fromJsonMultiDocument(input, options.revivers)
}

/**
 * Translates a JSON Schema Draft 2020-12 document into a persisted representation document.
 *
 * **When to use**
 *
 * Use when you need to inspect or transport imported structure without constructing a runtime schema.
 *
 * **Gotchas**
 *
 * Import is best-effort. The result contains persisted identities but no revived runtime callbacks. Callback results are used directly, and exceptions raised by a callback pass through unchanged.
 *
 * @see {@link fromJsonSchemaMultiDocument} for multiple roots sharing definitions
 * @see {@link toSchemaFromJsonSchemaDocument} for importing directly as a runtime schema
 *
 * @category constructors
 * @since 4.0.0
 */
export function fromJsonSchemaDocument(
  document: JsonSchema.Document<"draft-2020-12">,
  options?: FromJsonSchemaOptions
): Document<PersistedAnnotations> {
  return InternalRepresentation.fromJsonSchemaDocument(document, options)
}

/**
 * Translates multiple JSON Schema Draft 2020-12 roots into a persisted representation document.
 *
 * **When to use**
 *
 * Use when you need persisted roots and definitions without constructing runtime schemas.
 *
 * **Gotchas**
 *
 * Every definition is translated, including definitions that no root references. Callback results are used directly, and exceptions raised by a callback pass through unchanged.
 *
 * @see {@link fromJsonSchemaDocument} for a single root
 * @see {@link toSchemaFromJsonSchemaMultiDocument} for importing directly as runtime schemas
 *
 * @category constructors
 * @since 4.0.0
 */
export function fromJsonSchemaMultiDocument(
  document: JsonSchema.MultiDocument<"draft-2020-12">,
  options?: FromJsonSchemaOptions
): MultiDocument<PersistedAnnotations> {
  return InternalRepresentation.fromJsonSchemaMultiDocument(document, options)
}

/**
 * Imports a JSON Schema Draft 2020-12 document as a runtime schema.
 *
 * **When to use**
 *
 * Use when you need to validate or transform values directly from an external JSON Schema document.
 *
 * **Gotchas**
 *
 * Import is best-effort. Built-in checks are revived with an importer-private resolver. Callback results are used directly, and exceptions raised by a callback pass through unchanged.
 *
 * @see {@link fromJsonSchemaDocument} for translating without runtime revival
 * @see {@link toSchemaFromJsonSchemaMultiDocument} for multiple roots sharing definitions
 *
 * @category decoding
 * @since 4.0.0
 */
export function toSchemaFromJsonSchemaDocument(
  document: JsonSchema.Document<"draft-2020-12">,
  options?: FromJsonSchemaOptions
): Schema.Top {
  return InternalRepresentationSchema.toSchemaFromJsonSchemaDocument(document, options)
}

/**
 * Imports multiple JSON Schema Draft 2020-12 roots as runtime schemas in one shared definition environment.
 *
 * **When to use**
 *
 * Use when root order, definition identity, aliases, and recursion must be preserved across runtime schemas.
 *
 * **Gotchas**
 *
 * Every definition is revived, including definitions that no root references. Callback results are used directly, and exceptions raised by a callback pass through unchanged.
 *
 * @see {@link fromJsonSchemaMultiDocument} for translating without runtime revival
 * @see {@link toSchemaFromJsonSchemaDocument} for a single root
 * @see {@link toCodeDocumentFromSchemaMultiDocument} for generating code from the imported result
 *
 * @category decoding
 * @since 4.0.0
 */
export function toSchemaFromJsonSchemaMultiDocument(
  document: JsonSchema.MultiDocument<"draft-2020-12">,
  options?: FromJsonSchemaOptions
): SchemaMultiDocument {
  return InternalRepresentationSchema.toSchemaFromJsonSchemaMultiDocument(document, options)
}
