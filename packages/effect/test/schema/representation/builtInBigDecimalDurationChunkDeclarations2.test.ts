import { assert, describe, it } from "@effect/vitest"
import {
  BigDecimal,
  Chunk,
  Duration,
  type JsonSchema,
  Schema,
  type SchemaAST,
  SchemaRepresentation,
  SchemaRepresentation2
} from "effect"
import { throws } from "../../utils/assert.ts"

const durationJsonSchema: JsonSchema.JsonSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        _tag: { type: "string", enum: ["Infinity"] }
      },
      required: ["_tag"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        _tag: { type: "string", enum: ["NegativeInfinity"] }
      },
      required: ["_tag"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        _tag: { type: "string", enum: ["Nanos"] },
        value: { type: "string", allOf: [{ pattern: "^-?\\d+$" }] }
      },
      required: ["_tag", "value"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        _tag: { type: "string", enum: ["Millis"] },
        value: { type: "integer" }
      },
      required: ["_tag", "value"],
      additionalProperties: false
    }
  ]
}

function noServices(schema: Schema.Top): Schema.Codec<unknown> {
  return schema as Schema.Codec<unknown>
}

describe("SchemaRepresentation2 built-in BigDecimal, Duration and Chunk declarations", () => {
  it("emits the nullary BigDecimal and Duration protocols", () => {
    const cases = [
      {
        schema: Schema.BigDecimal,
        id: "effect/schema/BigDecimal",
        typeConstructor: "effect/BigDecimal",
        runtime: "Schema.BigDecimal",
        Type: "BigDecimal.BigDecimal",
        importDeclaration: `import * as BigDecimal from "effect/BigDecimal"`,
        jsonSchema: { type: "string" } satisfies JsonSchema.JsonSchema
      },
      {
        schema: Schema.Duration,
        id: "effect/schema/Duration",
        typeConstructor: "effect/Duration",
        runtime: "Schema.Duration",
        Type: "Duration.Duration",
        importDeclaration: `import * as Duration from "effect/Duration"`,
        jsonSchema: durationJsonSchema
      }
    ] as const

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
          importDeclarations: [entry.importDeclaration]
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
          importDeclaration: entry.importDeclaration
        })
      }
    }
  })

  it("uses the Chunk element type parameter in both compilers", () => {
    const schema = Schema.Chunk(Schema.String)
    const annotations = schema.ast.annotations as Schema.Annotations.Declaration<unknown>
    assert.deepStrictEqual(annotations.representation, {
      id: "effect/schema/Chunk",
      payload: null
    })
    assert.deepStrictEqual(
      annotations.toJsonSchema?.({ typeParameters: [{ const: "value" }], schemas: [] }),
      { type: "array", items: { const: "value" } }
    )
    assert.strictEqual(typeof annotations.generation, "function")
    if (typeof annotations.generation === "function") {
      assert.deepStrictEqual(
        annotations.generation({
          typeParameters: [{ runtime: "Value", Type: "A" }],
          schemas: []
        }),
        {
          runtime: "Schema.Chunk(Value)",
          Type: "Chunk.Chunk<A>"
        }
      )
    }

    const legacy = SchemaRepresentation.fromAST(schema.ast)
    assert.strictEqual(legacy.representation._tag, "Declaration")
    if (legacy.representation._tag === "Declaration") {
      assert.deepStrictEqual(legacy.representation.annotations?.typeConstructor, {
        _tag: "effect/Chunk"
      })
      assert.deepStrictEqual(legacy.representation.annotations?.generation, {
        runtime: "Schema.Chunk(?)",
        Type: "Chunk.Chunk<?>"
      })
    }
  })

  it("revives all three declarations without a global registry", () => {
    const originals = [
      Schema.BigDecimal.annotate({ description: "decimal" }),
      Schema.Duration.annotate({ description: "duration" }),
      Schema.Chunk(Schema.String).annotate({ description: "chunk" })
    ] as const
    const json = SchemaRepresentation2.toJsonMultiDocument(SchemaRepresentation2.fromASTs(
      originals.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    ))
    const revived = SchemaRepresentation2.fromJsonMultiDocument(json, {
      revivers: [Schema.BigDecimalReviver, Schema.DurationReviver, Schema.ChunkReviver]
    })

    const bigDecimal = noServices(revived.schemas[0])
    assert.isTrue(
      Schema.decodeUnknownResult(bigDecimal)(BigDecimal.fromStringUnsafe("123.45"))._tag === "Success"
    )
    assert.isTrue(Schema.decodeUnknownResult(bigDecimal)(123.45)._tag === "Failure")

    const duration = noServices(revived.schemas[1])
    assert.isTrue(Schema.decodeUnknownResult(duration)(Duration.seconds(5))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(duration)(5000)._tag === "Failure")

    const chunk = noServices(revived.schemas[2])
    assert.isTrue(Schema.decodeUnknownResult(chunk)(Chunk.make("a", "b"))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(chunk)(Chunk.make(1))._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(chunk)(["a", "b"])._tag === "Failure")

    assert.deepStrictEqual(revived.schemas.map((schema) => schema.ast.annotations?.description), [
      "decimal",
      "duration",
      "chunk"
    ])
    const lowered = SchemaRepresentation2.fromASTs(
      revived.schemas.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    )
    assert.deepStrictEqual(SchemaRepresentation2.toJsonMultiDocument(lowered), json)
  })

  it("compiles the encoded contracts while preserving legacy imports", () => {
    const document = SchemaRepresentation2.fromASTs([
      Schema.BigDecimal.ast,
      Schema.Duration.ast,
      Schema.Chunk(Schema.String).ast
    ])
    const jsonSchema = SchemaRepresentation2.toJsonSchemaMultiDocument(document)
    const code = SchemaRepresentation2.toCodeDocument(document)

    assert.deepStrictEqual(jsonSchema.schemas, [
      { type: "string" },
      durationJsonSchema,
      { type: "array", items: { type: "string" } }
    ])
    assert.deepStrictEqual(code.codes.map(({ Type }) => Type), [
      "BigDecimal.BigDecimal",
      "Duration.Duration",
      "Chunk.Chunk<string>"
    ])
    assert.isTrue(code.codes[0].runtime.includes("Schema.BigDecimal"))
    assert.isTrue(code.codes[1].runtime.includes("Schema.Duration"))
    assert.isTrue(code.codes[2].runtime.includes("Schema.Chunk(Schema.String)"))
    assert.deepStrictEqual(code.artifacts, [
      { _tag: "Import", importDeclaration: `import * as BigDecimal from "effect/BigDecimal"` },
      { _tag: "Import", importDeclaration: `import * as Duration from "effect/Duration"` }
    ])
  })

  it("rejects non-null payloads and invalid Chunk arity", () => {
    const declarations = [
      { schema: Schema.BigDecimal, reviver: Schema.BigDecimalReviver },
      { schema: Schema.Duration, reviver: Schema.DurationReviver },
      { schema: Schema.Chunk(Schema.String), reviver: Schema.ChunkReviver }
    ] as const
    for (const entry of declarations) {
      const json = SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(entry.schema.ast)) as any
      json.representation.annotations.representation.payload = {}
      throws(
        () => SchemaRepresentation2.fromJson(json, { revivers: [entry.reviver] }),
        (error: unknown) => {
          assert.isTrue(error instanceof SchemaRepresentation2.SchemaRepresentationError)
          if (error instanceof SchemaRepresentation2.SchemaRepresentationError) {
            assert.strictEqual(error.issue._tag, "InvalidRepresentationPayload")
            assert.deepStrictEqual(error.issue.path, [
              "representation",
              "annotations",
              "representation",
              "payload"
            ])
          }
          return undefined
        }
      )
    }

    const json = SchemaRepresentation2.toJson(
      SchemaRepresentation2.fromAST(Schema.Chunk(Schema.String).ast)
    ) as any
    json.representation.typeParameters.pop()
    throws(
      () => SchemaRepresentation2.fromJson(json, { revivers: [Schema.ChunkReviver] }),
      (error: unknown) => {
        assert.isTrue(error instanceof SchemaRepresentation2.SchemaRepresentationError)
        if (error instanceof SchemaRepresentation2.SchemaRepresentationError) {
          assert.strictEqual(error.issue._tag, "InvalidTypeParametersArity")
          assert.deepStrictEqual(error.issue.path, ["representation", "typeParameters"])
        }
        return undefined
      }
    )
  })
})
