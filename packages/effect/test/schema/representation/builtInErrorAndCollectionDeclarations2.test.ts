import { assert, describe, it } from "@effect/vitest"
import { type JsonSchema, Schema, type SchemaAST, SchemaRepresentation, SchemaRepresentation2 } from "effect"
import { throws } from "../../utils/assert.ts"

const errorJsonSchema: JsonSchema.JsonSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    name: { type: "string" },
    stack: { type: "string" },
    cause: {}
  },
  required: ["message"],
  additionalProperties: false
}

function noServices(schema: Schema.Top): Schema.Codec<unknown> {
  return schema as Schema.Codec<unknown>
}

describe("SchemaRepresentation2 built-in Error and collection declarations", () => {
  it("normalizes Error options into the persisted declaration protocol", () => {
    const cases = [
      { schema: Schema.Error(), payload: null, runtime: "Schema.Error()" },
      {
        schema: Schema.Error({ includeStack: false, excludeCause: false }),
        payload: null,
        runtime: "Schema.Error()"
      },
      {
        schema: Schema.Error({ includeStack: true }),
        payload: { includeStack: true },
        runtime: "Schema.Error({\"includeStack\":true})"
      },
      {
        schema: Schema.Error({ excludeCause: true }),
        payload: { excludeCause: true },
        runtime: "Schema.Error({\"excludeCause\":true})"
      },
      {
        schema: Schema.Error({ includeStack: true, excludeCause: true }),
        payload: { includeStack: true, excludeCause: true },
        runtime: "Schema.Error({\"includeStack\":true,\"excludeCause\":true})"
      }
    ] as const

    for (const entry of cases) {
      const annotations = entry.schema.ast.annotations as Schema.Annotations.Declaration<unknown>
      assert.deepStrictEqual(annotations.representation, {
        id: "effect/schema/Error",
        payload: entry.payload
      })
      assert.deepStrictEqual(annotations.toJsonSchema?.({ typeParameters: [], schemas: [] }), errorJsonSchema)
      assert.strictEqual(typeof annotations.generation, "function")
      if (typeof annotations.generation === "function") {
        assert.deepStrictEqual(annotations.generation({ typeParameters: [], schemas: [] }), {
          runtime: entry.runtime,
          Type: "globalThis.Error"
        })
      }

      const legacy = SchemaRepresentation.fromAST(entry.schema.ast)
      assert.strictEqual(legacy.representation._tag, "Declaration")
      if (legacy.representation._tag === "Declaration") {
        assert.deepStrictEqual(legacy.representation.annotations?.typeConstructor, {
          _tag: "Error",
          ...(entry.payload === null ? {} : { options: entry.payload })
        })
        assert.deepStrictEqual(legacy.representation.annotations?.generation, {
          runtime: entry.runtime,
          Type: "globalThis.Error"
        })
      }
    }
  })

  it("uses ReadonlyMap and ReadonlySet type parameters in both compilers", () => {
    const map = Schema.ReadonlyMap(Schema.String, Schema.Boolean)
    const mapAnnotations = map.ast.annotations as Schema.Annotations.Declaration<unknown>
    assert.deepStrictEqual(mapAnnotations.representation, {
      id: "effect/schema/ReadonlyMap",
      payload: null
    })
    assert.deepStrictEqual(
      mapAnnotations.toJsonSchema?.({
        typeParameters: [{ const: "key" }, { const: "value" }],
        schemas: []
      }),
      {
        type: "array",
        items: {
          type: "array",
          prefixItems: [{ const: "key" }, { const: "value" }],
          minItems: 2,
          maxItems: 2
        }
      }
    )
    assert.strictEqual(typeof mapAnnotations.generation, "function")
    if (typeof mapAnnotations.generation === "function") {
      assert.deepStrictEqual(
        mapAnnotations.generation({
          typeParameters: [
            { runtime: "Key", Type: "K" },
            { runtime: "Value", Type: "V" }
          ],
          schemas: []
        }),
        {
          runtime: "Schema.ReadonlyMap(Key, Value)",
          Type: "globalThis.ReadonlyMap<K, V>"
        }
      )
    }

    const set = Schema.ReadonlySet(Schema.String)
    const setAnnotations = set.ast.annotations as Schema.Annotations.Declaration<unknown>
    assert.deepStrictEqual(setAnnotations.representation, {
      id: "effect/schema/ReadonlySet",
      payload: null
    })
    assert.deepStrictEqual(
      setAnnotations.toJsonSchema?.({ typeParameters: [{ const: "value" }], schemas: [] }),
      { type: "array", items: { const: "value" } }
    )
    assert.strictEqual(typeof setAnnotations.generation, "function")
    if (typeof setAnnotations.generation === "function") {
      assert.deepStrictEqual(
        setAnnotations.generation({
          typeParameters: [{ runtime: "Value", Type: "V" }],
          schemas: []
        }),
        {
          runtime: "Schema.ReadonlySet(Value)",
          Type: "globalThis.ReadonlySet<V>"
        }
      )
    }

    const legacyMap = SchemaRepresentation.fromAST(map.ast)
    assert.strictEqual(legacyMap.representation._tag, "Declaration")
    if (legacyMap.representation._tag === "Declaration") {
      assert.deepStrictEqual(legacyMap.representation.annotations?.generation, {
        runtime: "Schema.ReadonlyMap(?, ?)",
        Type: "globalThis.ReadonlyMap<?, ?>"
      })
    }
    const legacySet = SchemaRepresentation.fromAST(set.ast)
    assert.strictEqual(legacySet.representation._tag, "Declaration")
    if (legacySet.representation._tag === "Declaration") {
      assert.deepStrictEqual(legacySet.representation.annotations?.generation, {
        runtime: "Schema.ReadonlySet(?)",
        Type: "globalThis.ReadonlySet<?>"
      })
    }
  })

  it("revives the declarations with annotations and collection checks", () => {
    const originals = [
      Schema.Error({ includeStack: true, excludeCause: true }).annotate({ description: "error" }),
      Schema.ReadonlyMap(Schema.String, Schema.Boolean).annotate({ description: "map" }),
      Schema.ReadonlySet(Schema.String).annotate({ description: "set" }).check(Schema.isMinSize(1))
    ] as const
    const json = SchemaRepresentation2.toJsonMultiDocument(SchemaRepresentation2.fromASTs(
      originals.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    ))
    const revived = SchemaRepresentation2.fromJsonMultiDocument(json, {
      revivers: [
        Schema.ErrorReviver,
        Schema.ReadonlyMapReviver,
        Schema.ReadonlySetReviver,
        Schema.isMinSizeReviver
      ]
    })

    const error = noServices(revived.schemas[0])
    assert.isTrue(Schema.decodeUnknownResult(error)(new globalThis.Error("boom"))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(error)({ message: "boom" })._tag === "Failure")

    const map = noServices(revived.schemas[1])
    assert.isTrue(Schema.decodeUnknownResult(map)(new Map([["a", true]]))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(map)(new Map([["a", 1]]))._tag === "Failure")

    const set = noServices(revived.schemas[2])
    assert.isTrue(Schema.decodeUnknownResult(set)(new Set(["a"]))._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(set)(new Set<string>())._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(set)(new Set([1]))._tag === "Failure")

    assert.deepStrictEqual(revived.schemas.map((schema) => schema.ast.annotations?.description), [
      "error",
      "map",
      "set"
    ])
    const lowered = SchemaRepresentation2.fromASTs(
      revived.schemas.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    )
    assert.deepStrictEqual(SchemaRepresentation2.toJsonMultiDocument(lowered), json)
  })

  it("compiles the encoded contracts and composed collection checks", () => {
    const originals = [
      Schema.Error({ includeStack: true, excludeCause: true }),
      Schema.ReadonlyMap(Schema.String, Schema.Boolean),
      Schema.ReadonlySet(Schema.String).check(Schema.isMinSize(1))
    ] as const
    const document = SchemaRepresentation2.fromASTs(
      originals.map((schema) => schema.ast) as [SchemaAST.AST, ...Array<SchemaAST.AST>]
    )

    assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaMultiDocument(document).schemas, [
      errorJsonSchema,
      {
        type: "array",
        items: {
          type: "array",
          prefixItems: [{ type: "string" }, { type: "boolean" }],
          minItems: 2,
          maxItems: 2
        }
      },
      { type: "array", items: { type: "string" } }
    ])
    assert.deepStrictEqual(SchemaRepresentation2.toCodeDocument(document).codes, [
      {
        runtime: "Schema.Error({\"includeStack\":true,\"excludeCause\":true}).annotate({ \"expected\": \"Error\" })",
        Type: "globalThis.Error"
      },
      {
        runtime: "Schema.ReadonlyMap(Schema.String, Schema.Boolean).annotate({ \"expected\": \"ReadonlyMap\" })",
        Type: "globalThis.ReadonlyMap<string, boolean>"
      },
      {
        runtime:
          "Schema.ReadonlySet(Schema.String).annotate({ \"expected\": \"ReadonlySet\" }).check(Schema.isMinSize(1).annotate({ \"expected\": \"a value with a size of at least 1\" }))",
        Type: "globalThis.ReadonlySet<string>"
      }
    ])
  })

  it("rejects non-canonical Error payloads and invalid collection arity", () => {
    const payloads = [
      {},
      { includeStack: false },
      { excludeCause: false },
      { includeStack: true, unexpected: true },
      "includeStack"
    ]
    for (const payload of payloads) {
      const json = SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(Schema.Error().ast)) as any
      json.representation.annotations.representation.payload = payload
      throws(
        () => SchemaRepresentation2.fromJson(json, { revivers: [Schema.ErrorReviver] }),
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

    const mapJson = SchemaRepresentation2.toJson(
      SchemaRepresentation2.fromAST(Schema.ReadonlyMap(Schema.String, Schema.Boolean).ast)
    ) as any
    mapJson.representation.typeParameters.pop()
    throws(
      () => SchemaRepresentation2.fromJson(mapJson, { revivers: [Schema.ReadonlyMapReviver] }),
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
