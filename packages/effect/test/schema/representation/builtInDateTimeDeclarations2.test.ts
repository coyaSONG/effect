import { assert, describe, it } from "@effect/vitest"
import { DateTime, type JsonSchema, Schema, type SchemaAST, SchemaRepresentation, SchemaRepresentation2 } from "effect"
import { throws } from "../../utils/assert.ts"

interface DateTimeDeclarationCase {
  readonly name: string
  readonly id: string
  readonly typeConstructor: string
  readonly schema: Schema.Top
  readonly reviver: SchemaRepresentation2.AnyReviver
  readonly runtime: string
  readonly Type: string
  readonly valid: unknown
  readonly invalid: unknown
  readonly jsonSchema: JsonSchema.JsonSchema
}

const numberJsonSchema: JsonSchema.JsonSchema = {
  anyOf: [
    { type: "number" },
    { type: "string", enum: ["NaN"] },
    { type: "string", enum: ["Infinity"] },
    { type: "string", enum: ["-Infinity"] }
  ]
}

const utc = DateTime.makeUnsafe("2021-01-01T00:00:00.000Z")
const zoned = DateTime.makeZonedUnsafe("2021-01-01T00:00:00.000Z", { timeZone: "Europe/London" })
const named = DateTime.zoneMakeNamedUnsafe("Europe/London")
const offset = DateTime.zoneMakeOffset(3 * 60 * 60 * 1000)

const cases: ReadonlyArray<DateTimeDeclarationCase> = [
  {
    name: "TimeZone",
    id: "effect/schema/TimeZone",
    typeConstructor: "effect/DateTime.TimeZone",
    schema: Schema.TimeZone,
    reviver: Schema.TimeZoneReviver,
    runtime: "Schema.TimeZone",
    Type: "DateTime.TimeZone",
    valid: named,
    invalid: "Europe/London",
    jsonSchema: { type: "string" }
  },
  {
    name: "TimeZoneNamed",
    id: "effect/schema/TimeZoneNamed",
    typeConstructor: "effect/DateTime.TimeZone.Named",
    schema: Schema.TimeZoneNamed,
    reviver: Schema.TimeZoneNamedReviver,
    runtime: "Schema.TimeZoneNamed",
    Type: "DateTime.TimeZone.Named",
    valid: named,
    invalid: offset,
    jsonSchema: { type: "string" }
  },
  {
    name: "TimeZoneOffset",
    id: "effect/schema/TimeZoneOffset",
    typeConstructor: "effect/DateTime.TimeZone.Offset",
    schema: Schema.TimeZoneOffset,
    reviver: Schema.TimeZoneOffsetReviver,
    runtime: "Schema.TimeZoneOffset",
    Type: "DateTime.TimeZone.Offset",
    valid: offset,
    invalid: named,
    jsonSchema: numberJsonSchema
  },
  {
    name: "DateTimeUtc",
    id: "effect/schema/DateTimeUtc",
    typeConstructor: "effect/DateTime.Utc",
    schema: Schema.DateTimeUtc,
    reviver: Schema.DateTimeUtcReviver,
    runtime: "Schema.DateTimeUtc",
    Type: "DateTime.Utc",
    valid: utc,
    invalid: zoned,
    jsonSchema: { type: "string" }
  },
  {
    name: "DateTimeZoned",
    id: "effect/schema/DateTimeZoned",
    typeConstructor: "effect/DateTime.Zoned",
    schema: Schema.DateTimeZoned,
    reviver: Schema.DateTimeZonedReviver,
    runtime: "Schema.DateTimeZoned",
    Type: "DateTime.Zoned",
    valid: zoned,
    invalid: utc,
    jsonSchema: { type: "string" }
  }
]

function noServices(schema: Schema.Top): Schema.Codec<unknown> {
  return schema as Schema.Codec<unknown>
}

describe("SchemaRepresentation2 built-in DateTime declarations", () => {
  it("emits the nullary protocol and preserves legacy metadata", () => {
    for (const entry of cases) {
      const annotations = entry.schema.ast.annotations as Schema.Annotations.Declaration<unknown>
      assert.deepStrictEqual(annotations.representation, {
        id: entry.id,
        payload: null
      })
      assert.deepStrictEqual(annotations.toJsonSchema?.({ typeParameters: [], schemas: [] }), entry.jsonSchema)
      assert.strictEqual(typeof annotations.generation, "function")
      if (typeof annotations.generation === "function") {
        assert.deepStrictEqual(annotations.generation({ typeParameters: [], schemas: [] }), {
          runtime: entry.runtime,
          Type: entry.Type,
          importDeclarations: [`import * as DateTime from "effect/DateTime"`]
        })
      }

      const legacy = SchemaRepresentation.fromAST(entry.schema.ast)
      assert.strictEqual(legacy.representation._tag, "Declaration")
      if (legacy.representation._tag === "Declaration") {
        assert.deepStrictEqual(legacy.representation.annotations?.typeConstructor, {
          _tag: entry.typeConstructor
        })
        assert.deepStrictEqual(legacy.representation.annotations?.generation, {
          runtime: entry.runtime,
          Type: entry.Type,
          importDeclaration: `import * as DateTime from "effect/DateTime"`
        })
      }
    }
  })

  it("revives every declaration without a global registry", () => {
    const asts = cases.map((entry) => entry.schema.annotate({ description: entry.name }).ast) as [
      SchemaAST.AST,
      ...Array<SchemaAST.AST>
    ]
    const json = SchemaRepresentation2.toJsonMultiDocument(SchemaRepresentation2.fromASTs(asts))
    const revived = SchemaRepresentation2.fromJsonMultiDocument(json, {
      revivers: cases.map((entry) => entry.reviver)
    })

    assert.strictEqual(revived.schemas.length, cases.length)
    for (let index = 0; index < cases.length; index++) {
      const entry = cases[index]
      const schema = noServices(revived.schemas[index])
      const annotations = schema.ast.annotations as Schema.Annotations.Declaration<unknown>
      assert.isTrue(Schema.decodeUnknownResult(schema)(entry.valid)._tag === "Success")
      assert.isTrue(Schema.decodeUnknownResult(schema)(entry.invalid)._tag === "Failure")
      assert.strictEqual(annotations.description, entry.name)
      assert.strictEqual(annotations.representation?.id, entry.id)
      assert.isTrue(typeof annotations.toJsonSchema === "function")
      assert.isTrue(typeof annotations.generation === "function")
    }

    const lowered = SchemaRepresentation2.fromASTs(
      revived.schemas.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    )
    assert.deepStrictEqual(SchemaRepresentation2.toJsonMultiDocument(lowered), json)
  })

  it("compiles every encoded contract and deduplicates the DateTime import", () => {
    const document = SchemaRepresentation2.fromASTs(
      cases.map((entry) => entry.schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    )
    const jsonSchema = SchemaRepresentation2.toJsonSchemaMultiDocument(document)
    const code = SchemaRepresentation2.toCodeDocument(document)

    assert.deepStrictEqual(jsonSchema.schemas, [
      cases[0].jsonSchema,
      cases[1].jsonSchema,
      cases[2].jsonSchema,
      cases[3].jsonSchema,
      cases[4].jsonSchema
    ])
    for (let index = 0; index < cases.length; index++) {
      assert.isTrue(code.codes[index].runtime.includes(cases[index].runtime))
      assert.strictEqual(code.codes[index].Type, cases[index].Type)
    }
    assert.deepStrictEqual(code.artifacts, [{
      _tag: "Import",
      importDeclaration: `import * as DateTime from "effect/DateTime"`
    }])
  })

  it("rejects non-null payloads and unexpected type parameters", () => {
    for (const entry of cases) {
      const json = SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(entry.schema.ast)) as any
      json.representation.annotations.representation.payload = {}
      throws(
        () => SchemaRepresentation2.fromJson(json, { revivers: [entry.reviver] }),
        `Invalid representation payload for ${entry.reviver.id}\n  at ["representation"]["annotations"]["representation"]["payload"]`
      )
    }

    const json = SchemaRepresentation2.toJson(
      SchemaRepresentation2.fromAST(Schema.DateTimeZoned.ast)
    ) as any
    json.representation.typeParameters.push({ _tag: "String", checks: [] })
    throws(
      () => SchemaRepresentation2.fromJson(json, { revivers: [Schema.DateTimeZonedReviver] }),
      `Invalid type parameters arity for ${Schema.DateTimeZonedReviver.id}: expected ${Schema.DateTimeZonedReviver.typeParametersArity}, got ${json.representation.typeParameters.length}\n  at ["representation"]["typeParameters"]`
    )
  })
})
