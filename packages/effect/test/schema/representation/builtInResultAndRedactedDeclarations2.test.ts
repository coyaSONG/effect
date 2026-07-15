import { assert, describe, it } from "@effect/vitest"
import {
  type JsonSchema,
  Redacted,
  Result,
  Schema,
  type SchemaAST,
  SchemaRepresentation,
  SchemaRepresentation2
} from "effect"
import { throws } from "../../utils/assert.ts"

function resultJsonSchema(
  success: JsonSchema.JsonSchema,
  failure: JsonSchema.JsonSchema
): JsonSchema.JsonSchema {
  return {
    anyOf: [
      {
        type: "object",
        properties: {
          _tag: { type: "string", enum: ["Success"] },
          success
        },
        required: ["_tag", "success"],
        additionalProperties: false
      },
      {
        type: "object",
        properties: {
          _tag: { type: "string", enum: ["Failure"] },
          failure
        },
        required: ["_tag", "failure"],
        additionalProperties: false
      }
    ]
  }
}

function noServices(schema: Schema.Top): Schema.Codec<unknown> {
  return schema as Schema.Codec<unknown>
}

describe("SchemaRepresentation2 built-in Result and Redacted declarations", () => {
  it("uses Result type parameters in both compilers and preserves legacy metadata", () => {
    const schema = Schema.Result(Schema.String, Schema.Boolean)
    const annotations = schema.ast.annotations as Schema.Annotations.Declaration<unknown>
    assert.deepStrictEqual(annotations.representation, {
      id: "effect/schema/Result",
      payload: null
    })
    assert.deepStrictEqual(
      annotations.toJsonSchema?.({
        typeParameters: [{ const: "success" }, { const: "failure" }],
        schemas: []
      }),
      resultJsonSchema({ const: "success" }, { const: "failure" })
    )
    assert.strictEqual(typeof annotations.generation, "function")
    if (typeof annotations.generation === "function") {
      assert.deepStrictEqual(
        annotations.generation({
          typeParameters: [
            { runtime: "Success", Type: "A" },
            { runtime: "Failure", Type: "E" }
          ],
          schemas: []
        }),
        {
          runtime: "Schema.Result(Success, Failure)",
          Type: "Result.Result<A, E>",
          importDeclarations: [`import * as Result from "effect/Result"`]
        }
      )
    }

    const legacy = SchemaRepresentation.fromAST(schema.ast)
    assert.strictEqual(legacy.representation._tag, "Declaration")
    if (legacy.representation._tag === "Declaration") {
      assert.deepStrictEqual(legacy.representation.annotations?.typeConstructor, {
        _tag: "effect/Result"
      })
      assert.deepStrictEqual(legacy.representation.annotations?.generation, {
        runtime: "Schema.Result(?, ?)",
        Type: "Result.Result<?, ?>",
        importDeclaration: `import * as Result from "effect/Result"`
      })
    }
  })

  it("normalizes Redacted options into its persisted declaration protocol", () => {
    const cases = [
      {
        schema: Schema.Redacted(Schema.String),
        payload: null,
        options: undefined,
        runtime: "Schema.Redacted(Value)"
      },
      {
        schema: Schema.Redacted(Schema.String, { label: undefined, disallowJsonEncode: false }),
        payload: null,
        options: undefined,
        runtime: "Schema.Redacted(Value)"
      },
      {
        schema: Schema.Redacted(Schema.String, { label: "" }),
        payload: { label: "" },
        options: { label: "" },
        runtime: "Schema.Redacted(Value, {\"label\":\"\"})"
      },
      {
        schema: Schema.Redacted(Schema.String, { label: "password", disallowJsonEncode: false }),
        payload: { label: "password" },
        options: { label: "password" },
        runtime: "Schema.Redacted(Value, {\"label\":\"password\"})"
      },
      {
        schema: Schema.Redacted(Schema.String, { disallowJsonEncode: true }),
        payload: { disallowJsonEncode: true },
        options: { disallowJsonEncode: true },
        runtime: "Schema.Redacted(Value, {\"disallowJsonEncode\":true})"
      },
      {
        schema: Schema.Redacted(Schema.String, { label: "password", disallowJsonEncode: true }),
        payload: { label: "password", disallowJsonEncode: true },
        options: { label: "password", disallowJsonEncode: true },
        runtime: "Schema.Redacted(Value, {\"label\":\"password\",\"disallowJsonEncode\":true})"
      }
    ] as const

    for (const entry of cases) {
      const annotations = entry.schema.ast.annotations as Schema.Annotations.Declaration<unknown>
      assert.deepStrictEqual(annotations.representation, {
        id: "effect/schema/Redacted",
        payload: entry.payload
      })
      assert.deepStrictEqual(
        annotations.toJsonSchema?.({ typeParameters: [{ const: "value" }], schemas: [] }),
        { const: "value" }
      )
      assert.strictEqual(typeof annotations.generation, "function")
      if (typeof annotations.generation === "function") {
        assert.deepStrictEqual(
          annotations.generation({
            typeParameters: [{ runtime: "Value", Type: "A" }],
            schemas: []
          }),
          {
            runtime: entry.runtime,
            Type: "Redacted.Redacted<A>",
            importDeclarations: [`import * as Redacted from "effect/Redacted"`]
          }
        )
      }

      const legacy = SchemaRepresentation.fromAST(entry.schema.ast)
      assert.strictEqual(legacy.representation._tag, "Declaration")
      if (legacy.representation._tag === "Declaration") {
        assert.deepStrictEqual(legacy.representation.annotations?.typeConstructor, {
          _tag: "effect/Redacted",
          options: entry.options
        })
        assert.deepStrictEqual(legacy.representation.annotations?.generation, {
          runtime: entry.runtime.replace("Value", "?"),
          Type: "Redacted.Redacted<?>",
          importDeclaration: `import * as Redacted from "effect/Redacted"`
        })
      }
    }
  })

  it("revives Result and Redacted semantics without a global registry", () => {
    const originals = [
      Schema.Result(Schema.String, Schema.Boolean).annotate({ description: "result" }),
      Schema.Redacted(Schema.String, {
        label: "password",
        disallowJsonEncode: true
      }).annotate({ description: "redacted" })
    ] as const
    const json = SchemaRepresentation2.toJsonMultiDocument(SchemaRepresentation2.fromASTs(
      originals.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    ))
    const revived = SchemaRepresentation2.fromJsonMultiDocument(json, {
      revivers: [Schema.ResultReviver, Schema.RedactedReviver]
    })

    const result = noServices(revived.schemas[0])
    assert.isTrue(Schema.decodeUnknownResult(result)(Result.succeed("ok"))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(result)(Result.fail(true))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(result)(Result.succeed(1))._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(result)(Result.fail("no"))._tag === "Failure")

    const redacted = noServices(revived.schemas[1])
    assert.isTrue(
      Schema.decodeUnknownResult(redacted)(Redacted.make("secret", { label: "password" }))._tag === "Success"
    )
    assert.isTrue(
      Schema.decodeUnknownResult(redacted)(Redacted.make("secret", { label: "other" }))._tag === "Failure"
    )
    assert.isTrue(
      Schema.decodeUnknownResult(redacted)(Redacted.make(1, { label: "password" }))._tag === "Failure"
    )
    const encoded = Schema.encodeUnknownExit(noServices(Schema.toCodecJson(redacted)))(
      Redacted.make("secret", { label: "password" })
    )
    assert.isTrue(encoded._tag === "Failure")
    assert.isTrue(String(encoded).includes(`Cannot serialize Redacted with label: "password"`))

    assert.deepStrictEqual(revived.schemas.map((schema) => schema.ast.annotations?.description), [
      "result",
      "redacted"
    ])
    const lowered = SchemaRepresentation2.fromASTs(
      revived.schemas.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    )
    assert.deepStrictEqual(SchemaRepresentation2.toJsonMultiDocument(lowered), json)
  })

  it("compiles the encoded contracts and declaration code", () => {
    const document = SchemaRepresentation2.fromASTs([
      Schema.Result(Schema.String, Schema.Boolean).ast,
      Schema.Redacted(Schema.String, { label: "password", disallowJsonEncode: true }).ast
    ])

    assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaMultiDocument(document).schemas, [
      resultJsonSchema({ type: "string" }, { type: "boolean" }),
      { type: "string" }
    ])
    const code = SchemaRepresentation2.toCodeDocument(document)
    assert.deepStrictEqual(code.codes, [
      {
        runtime: "Schema.Result(Schema.String, Schema.Boolean).annotate({ \"expected\": \"Result\" })",
        Type: "Result.Result<string, boolean>"
      },
      {
        runtime:
          "Schema.Redacted(Schema.String, {\"label\":\"password\",\"disallowJsonEncode\":true}).annotate({ \"expected\": \"Redacted\" })",
        Type: "Redacted.Redacted<string>"
      }
    ])
    assert.deepStrictEqual(code.artifacts, [
      { _tag: "Import", importDeclaration: `import * as Result from "effect/Result"` },
      { _tag: "Import", importDeclaration: `import * as Redacted from "effect/Redacted"` }
    ])
  })

  it("rejects non-canonical Redacted payloads and invalid declaration arity", () => {
    const payloads = [
      {},
      { label: 1 },
      { disallowJsonEncode: false },
      { label: "password", disallowJsonEncode: false },
      { label: "password", unexpected: true },
      "password"
    ]
    for (const payload of payloads) {
      const json = SchemaRepresentation2.toJson(
        SchemaRepresentation2.fromAST(Schema.Redacted(Schema.String).ast)
      ) as any
      json.representation.annotations.representation.payload = payload
      throws(
        () => SchemaRepresentation2.fromJson(json, { revivers: [Schema.RedactedReviver] }),
        `Invalid representation payload for ${Schema.RedactedReviver.id}\n  at ["representation"]["annotations"]["representation"]["payload"]`
      )
    }

    const declarations = [
      {
        json: SchemaRepresentation2.toJson(
          SchemaRepresentation2.fromAST(Schema.Result(Schema.String, Schema.Boolean).ast)
        ) as any,
        reviver: Schema.ResultReviver
      },
      {
        json: SchemaRepresentation2.toJson(
          SchemaRepresentation2.fromAST(Schema.Redacted(Schema.String).ast)
        ) as any,
        reviver: Schema.RedactedReviver
      }
    ] as const
    for (const entry of declarations) {
      entry.json.representation.typeParameters.pop()
      throws(
        () => SchemaRepresentation2.fromJson(entry.json, { revivers: [entry.reviver] }),
        `Invalid type parameters arity for ${entry.reviver.id}: expected ${entry.reviver.typeParametersArity}, got ${entry.json.representation.typeParameters.length}\n  at ["representation"]["typeParameters"]`
      )
    }
  })
})
