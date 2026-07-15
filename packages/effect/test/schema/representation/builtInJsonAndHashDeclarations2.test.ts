import { assert, describe, it } from "@effect/vitest"
import {
  HashMap,
  HashSet,
  type JsonSchema,
  Schema,
  type SchemaAST,
  SchemaRepresentation,
  SchemaRepresentation2
} from "effect"
import { throws } from "../../utils/assert.ts"

const numberJsonSchema: JsonSchema.JsonSchema = {
  anyOf: [
    { type: "number" },
    { type: "string", enum: ["NaN"] },
    { type: "string", enum: ["Infinity"] },
    { type: "string", enum: ["-Infinity"] }
  ]
}

function hashMapJsonSchema(
  key: JsonSchema.JsonSchema,
  value: JsonSchema.JsonSchema
): JsonSchema.JsonSchema {
  return {
    type: "array",
    items: {
      type: "array",
      prefixItems: [key, value],
      minItems: 2,
      maxItems: 2
    }
  }
}

function noServices(schema: Schema.Top): Schema.Codec<unknown> {
  return schema as Schema.Codec<unknown>
}

describe("SchemaRepresentation2 built-in JSON and hash collection declarations", () => {
  it("emits compact nullary protocols for Json and MutableJson", () => {
    const cases = [
      {
        schema: Schema.Json,
        id: "effect/schema/Json",
        typeConstructor: { _tag: "effect/Json" },
        runtime: "Schema.Json",
        Type: "Schema.Json"
      },
      {
        schema: Schema.MutableJson,
        id: "effect/schema/MutableJson",
        typeConstructor: { _tag: "effect/MutableJson" },
        runtime: "Schema.MutableJson",
        Type: "Schema.MutableJson"
      }
    ] as const

    for (const entry of cases) {
      const annotations = entry.schema.ast.annotations as Schema.Annotations.Declaration<unknown>
      assert.deepStrictEqual(annotations.representation, {
        id: entry.id,
        payload: null
      })
      assert.deepStrictEqual(annotations.toJsonSchema?.({ typeParameters: [], schemas: [] }), {})
      assert.strictEqual(typeof annotations.generation, "function")
      if (typeof annotations.generation === "function") {
        assert.deepStrictEqual(annotations.generation({ typeParameters: [], schemas: [] }), {
          runtime: entry.runtime,
          Type: entry.Type
        })
      }

      const legacy = SchemaRepresentation.fromAST(entry.schema.ast)
      assert.strictEqual(legacy.representation._tag, "Declaration")
      if (legacy.representation._tag === "Declaration") {
        assert.deepStrictEqual(legacy.representation.annotations?.typeConstructor, entry.typeConstructor)
        assert.deepStrictEqual(legacy.representation.annotations?.generation, {
          runtime: entry.runtime,
          Type: entry.Type
        })
      }

      const persisted = Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(
        SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(entry.schema.ast))
      )
      assert.strictEqual(persisted.representation._tag, "Declaration")
      if (persisted.representation._tag === "Declaration") {
        assert.deepStrictEqual(persisted.representation.typeParameters, [])
        assert.isFalse("encodedSchema" in persisted.representation)
      }
    }
  })

  it("uses HashMap and HashSet type parameters while preserving legacy metadata", () => {
    const cases = [
      {
        schema: Schema.HashMap(Schema.String, Schema.Number),
        id: "effect/schema/HashMap",
        jsonTypeParameters: [{ const: "key" }, { const: "value" }],
        jsonSchema: hashMapJsonSchema({ const: "key" }, { const: "value" }),
        codeTypeParameters: [{ runtime: "Key", Type: "K" }, { runtime: "Value", Type: "V" }],
        generation: {
          runtime: "Schema.HashMap(Key, Value)",
          Type: "HashMap.HashMap<K, V>",
          importDeclarations: [`import * as HashMap from "effect/HashMap"`]
        },
        typeConstructor: { _tag: "effect/HashMap" },
        legacyGeneration: {
          runtime: "Schema.HashMap(?, ?)",
          Type: "HashMap.HashMap<?, ?>",
          importDeclaration: `import * as HashMap from "effect/HashMap"`
        }
      },
      {
        schema: Schema.HashSet(Schema.String),
        id: "effect/schema/HashSet",
        jsonTypeParameters: [{ const: "value" }],
        jsonSchema: { type: "array", items: { const: "value" } },
        codeTypeParameters: [{ runtime: "Value", Type: "V" }],
        generation: {
          runtime: "Schema.HashSet(Value)",
          Type: "HashSet.HashSet<V>"
        },
        typeConstructor: { _tag: "effect/HashSet" },
        legacyGeneration: {
          runtime: "Schema.HashSet(?)",
          Type: "HashSet.HashSet<?>"
        }
      }
    ] as const

    for (const entry of cases) {
      const annotations = entry.schema.ast.annotations as Schema.Annotations.Declaration<unknown>
      assert.deepStrictEqual(annotations.representation, {
        id: entry.id,
        payload: null
      })
      assert.deepStrictEqual(
        annotations.toJsonSchema?.({ typeParameters: entry.jsonTypeParameters, schemas: [] }),
        entry.jsonSchema
      )
      assert.strictEqual(typeof annotations.generation, "function")
      if (typeof annotations.generation === "function") {
        assert.deepStrictEqual(
          annotations.generation({ typeParameters: entry.codeTypeParameters, schemas: [] }),
          entry.generation
        )
      }

      const legacy = SchemaRepresentation.fromAST(entry.schema.ast)
      assert.strictEqual(legacy.representation._tag, "Declaration")
      if (legacy.representation._tag === "Declaration") {
        assert.deepStrictEqual(legacy.representation.annotations?.typeConstructor, entry.typeConstructor)
        assert.deepStrictEqual(legacy.representation.annotations?.generation, entry.legacyGeneration)
      }
    }
  })

  it("revives JSON and hash collection semantics without a global registry", () => {
    const originals = [
      Schema.Json.annotate({ description: "json" }),
      Schema.MutableJson.annotate({ description: "mutable json" }),
      Schema.HashMap(Schema.String, Schema.Boolean).annotate({ description: "map" }),
      Schema.HashSet(Schema.String).annotate({ description: "set" })
    ] as const
    const json = SchemaRepresentation2.toJsonMultiDocument(SchemaRepresentation2.fromASTs(
      originals.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    ))
    const revived = SchemaRepresentation2.fromJsonMultiDocument(json, {
      revivers: [Schema.JsonReviver, Schema.MutableJsonReviver, Schema.HashMapReviver, Schema.HashSetReviver]
    })

    const immutableJson = noServices(revived.schemas[0])
    assert.isTrue(Schema.decodeUnknownResult(immutableJson)({ value: [1, true, null] })._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(immutableJson)(Number.NaN)._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(immutableJson)(new Date(0))._tag === "Failure")

    const mutableJson = noServices(revived.schemas[1])
    assert.isTrue(Schema.decodeUnknownResult(mutableJson)(["value", { nested: false }])._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(mutableJson)(undefined)._tag === "Failure")

    const map = noServices(revived.schemas[2])
    assert.isTrue(Schema.decodeUnknownResult(map)(HashMap.make(["a", true]))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(map)(HashMap.make([1, true]))._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(map)(HashMap.make(["a", 1]))._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(map)(new Map([["a", true]]))._tag === "Failure")

    const set = noServices(revived.schemas[3])
    assert.isTrue(Schema.decodeUnknownResult(set)(HashSet.make("a", "b"))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(set)(HashSet.make(1))._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(set)(new Set(["a"]))._tag === "Failure")

    assert.deepStrictEqual(revived.schemas.map((schema) => schema.ast.annotations?.description), [
      "json",
      "mutable json",
      "map",
      "set"
    ])
    const lowered = SchemaRepresentation2.fromASTs(
      revived.schemas.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    )
    assert.deepStrictEqual(SchemaRepresentation2.toJsonMultiDocument(lowered), json)
  })

  it("compiles the opaque JSON and structural hash collection contracts", () => {
    const document = SchemaRepresentation2.fromASTs([
      Schema.Json.ast,
      Schema.MutableJson.ast,
      Schema.HashMap(Schema.String, Schema.Number).ast,
      Schema.HashSet(Schema.String).ast
    ])

    assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaMultiDocument(document).schemas, [
      {},
      {},
      hashMapJsonSchema({ type: "string" }, numberJsonSchema),
      { type: "array", items: { type: "string" } }
    ])
    const code = SchemaRepresentation2.toCodeDocument(document)
    assert.deepStrictEqual(code.codes, [
      {
        runtime: "Schema.Json.annotate({ \"expected\": \"JSON value\" })",
        Type: "Schema.Json"
      },
      {
        runtime: "Schema.MutableJson.annotate({ \"expected\": \"JSON value\" })",
        Type: "Schema.MutableJson"
      },
      {
        runtime: "Schema.HashMap(Schema.String, Schema.Number).annotate({ \"expected\": \"HashMap\" })",
        Type: "HashMap.HashMap<string, number>"
      },
      {
        runtime: "Schema.HashSet(Schema.String).annotate({ \"expected\": \"HashSet\" })",
        Type: "HashSet.HashSet<string>"
      }
    ])
    assert.deepStrictEqual(code.artifacts, [
      { _tag: "Import", importDeclaration: `import * as HashMap from "effect/HashMap"` }
    ])
  })

  it("rejects non-null payloads and invalid type-parameter arities", () => {
    const declarations = [
      { schema: Schema.Json, reviver: Schema.JsonReviver },
      { schema: Schema.MutableJson, reviver: Schema.MutableJsonReviver },
      { schema: Schema.HashMap(Schema.String, Schema.Boolean), reviver: Schema.HashMapReviver },
      { schema: Schema.HashSet(Schema.String), reviver: Schema.HashSetReviver }
    ] as const

    for (const entry of declarations) {
      const invalidPayload = SchemaRepresentation2.toJson(
        SchemaRepresentation2.fromAST(entry.schema.ast)
      ) as any
      invalidPayload.representation.annotations.representation.payload = {}
      throws(
        () => SchemaRepresentation2.fromJson(invalidPayload, { revivers: [entry.reviver] }),
        `Invalid representation payload for ${entry.reviver.id}\n  at ["representation"]["annotations"]["representation"]["payload"]`
      )

      const invalidArity = SchemaRepresentation2.toJson(
        SchemaRepresentation2.fromAST(entry.schema.ast)
      ) as any
      invalidArity.representation.typeParameters.push({ _tag: "String", checks: [] })
      throws(
        () => SchemaRepresentation2.fromJson(invalidArity, { revivers: [entry.reviver] }),
        `Invalid type parameters arity for ${entry.reviver.id}: expected ${entry.reviver.typeParametersArity}, got ${invalidArity.representation.typeParameters.length}\n  at ["representation"]["typeParameters"]`
      )
    }
  })
})
