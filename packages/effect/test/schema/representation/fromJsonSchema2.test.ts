import { assert, describe, it } from "@effect/vitest"
import { Schema, SchemaRepresentation2 } from "effect"
import { assertInclude, throws } from "../../utils/assert.ts"

function noServices(schema: Schema.Top): Schema.Codec<unknown> {
  return schema as Schema.Codec<unknown>
}

describe("JSON Schema importer v2", () => {
  it("returns persisted single and multi documents without revival", () => {
    const document = SchemaRepresentation2.fromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: { type: "string", minLength: 2 },
      definitions: {}
    })
    const multiDocument = SchemaRepresentation2.fromJsonSchemaMultiDocument({
      dialect: "draft-2020-12",
      schemas: [{ type: "boolean" }],
      definitions: {}
    })

    assert.deepStrictEqual(document, {
      representation: {
        _tag: "String",
        checks: [{
          _tag: "Filter",
          aborted: false,
          annotations: {
            representation: {
              id: "effect/schema/isMinLength",
              payload: { minLength: 2 }
            }
          }
        }]
      },
      references: {}
    })
    assert.deepStrictEqual(multiDocument, {
      representations: [{ _tag: "Boolean", checks: [] }],
      references: {}
    })
  })

  it("returns a live schema and revives built-in checks privately", () => {
    const schema = SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 2 },
          count: { type: "integer", minimum: 1 }
        },
        required: ["name", "count"],
        additionalProperties: false
      },
      definitions: {}
    })

    assert.isTrue(Schema.decodeUnknownResult(noServices(schema))({ name: "ok", count: 1 })._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(noServices(schema))({ name: "x", count: 1 })._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(noServices(schema))({ name: "ok", count: 1.5 })._tag === "Failure")
  })

  it("maps an unconstrained JSON Schema to the Json declaration", () => {
    const schema = SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: { description: "payload" },
      definitions: {}
    })

    assert.isTrue(Schema.decodeUnknownResult(noServices(schema))({ value: [null, 1, true] })._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(noServices(schema))(undefined)._tag === "Failure")
    assert.strictEqual(schema.ast.annotations?.description, "payload")
  })

  it("preserves root order, shared aliases and unused definitions", () => {
    const document = SchemaRepresentation2.toSchemaFromJsonSchemaMultiDocument({
      dialect: "draft-2020-12",
      schemas: [
        { $ref: "#/$defs/Alias" },
        { type: "boolean" },
        { type: "array", items: { $ref: "#/$defs/Value" } }
      ],
      definitions: {
        Value: { type: "string", minLength: 1 },
        Alias: { $ref: "#/$defs/Value" },
        Unused: { type: "number" }
      }
    })

    assert.strictEqual(document.schemas.length, 3)
    assert.deepStrictEqual(Object.keys(document.definitions), ["Value", "Alias", "Unused"])
    assert.strictEqual(document.schemas[0], document.definitions.Alias)
    assert.isTrue(Schema.decodeUnknownResult(noServices(document.schemas[0]))("value")._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(noServices(document.schemas[0]))("")._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(noServices(document.schemas[1]))(true)._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(noServices(document.schemas[2]))(["a", "b"])._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(noServices(document.definitions.Unused))(1)._tag === "Success")
  })

  it("revives recursive definitions through stable shared wrappers", () => {
    const document = SchemaRepresentation2.toSchemaFromJsonSchemaMultiDocument({
      dialect: "draft-2020-12",
      schemas: [{ $ref: "#/$defs/Node" }],
      definitions: {
        Node: {
          type: "object",
          properties: {
            value: { type: "string" },
            next: { $ref: "#/$defs/Node" }
          },
          required: ["value"],
          additionalProperties: false
        }
      }
    })

    assert.strictEqual(document.schemas[0], document.definitions.Node)
    assert.isTrue(
      Schema.decodeUnknownResult(noServices(document.schemas[0]))({
        value: "first",
        next: { value: "second" }
      })._tag === "Success"
    )
  })

  it("applies onEnter to each node before translating it", () => {
    const schema = SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"]
      },
      definitions: {}
    }, {
      onEnter: (node) => node.type === "string" ? { ...node, minLength: 2 } : node
    })

    assert.isTrue(Schema.decodeUnknownResult(noServices(schema))({ value: "ok" })._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(noServices(schema))({ value: "x" })._tag === "Failure")
  })

  it("contextualizes invalid JSON Schema values", () => {
    throws(
      () =>
        SchemaRepresentation2.fromJsonSchemaDocument({
          dialect: "draft-2020-12",
          schema: { type: "string", invalid: undefined },
          definitions: {}
        }),
      `Invalid schema representation document\n  at ["schema"]["invalid"]`
    )
  })

  it("contextualizes invalid onEnter results", () => {
    throws(
      () =>
        SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
          dialect: "draft-2020-12",
          schema: { type: "string" },
          definitions: {}
        }, {
          onEnter: () => [] as any
        }),
      (error: unknown) => {
        assert.instanceOf(error, Error)
        assert.strictEqual(error.message, "Invalid schema representation document\n  at [\"schema\"]")
        return undefined
      }
    )
    throws(
      () =>
        SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
          dialect: "draft-2020-12",
          schema: { type: "string" },
          definitions: {}
        }, {
          onEnter: () => ({ type: "string", invalid: undefined })
        }),
      `Invalid schema representation document\n  at ["schema"]["invalid"]`
    )
  })

  it("contextualizes exceptions thrown by onEnter", () => {
    const cause = new Error("boom")

    throws(
      () =>
        SchemaRepresentation2.toSchemaFromJsonSchemaMultiDocument({
          dialect: "draft-2020-12",
          schemas: [{ type: "string" }],
          definitions: {}
        }, {
          onEnter: () => {
            throw cause
          }
        }),
      (error: unknown) => {
        assert.strictEqual(error, cause)
        return undefined
      }
    )
  })

  it("reduces an impossible refined literal to Never", () => {
    const schema = SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: {
        allOf: [
          { type: "string", minLength: 2 },
          { const: "a" }
        ]
      },
      definitions: {}
    })

    assert.isTrue(Schema.decodeUnknownResult(noServices(schema))("a")._tag === "Failure")
    assert.deepStrictEqual(Schema.toJsonSchemaDocument2(schema), {
      dialect: "draft-2020-12",
      schema: { not: {} },
      definitions: {}
    })
  })

  it("combines allOf constraints through definition aliases", () => {
    const document = SchemaRepresentation2.toSchemaFromJsonSchemaMultiDocument({
      dialect: "draft-2020-12",
      schemas: [{
        allOf: [
          { $ref: "#/$defs/Alias" },
          { type: "string", maxLength: 3 }
        ]
      }],
      definitions: {
        Value: { type: "string", minLength: 2 },
        Alias: { $ref: "#/$defs/Value" }
      }
    })
    const schema = noServices(document.schemas[0])

    assert.isTrue(Schema.decodeUnknownResult(schema)("ab")._tag === "Success")
    assert.isTrue(Schema.decodeUnknownResult(schema)("a")._tag === "Failure")
    assert.isTrue(Schema.decodeUnknownResult(schema)("abcd")._tag === "Failure")
    assert.deepStrictEqual(Object.keys(document.definitions), ["Value", "Alias"])
  })

  it("does not compact unions containing Never or annotated literals", () => {
    const checked = SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: {
        anyOf: [
          { allOf: [{ type: "string", minLength: 2 }, { const: "a" }] },
          { const: "bb" }
        ]
      },
      definitions: {}
    })
    const annotated = SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: {
        anyOf: [
          { const: "a", description: "annotated" },
          { const: "b" }
        ]
      },
      definitions: {}
    })

    for (const schema of [checked, annotated]) {
      const runtime = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
        schemas: [schema],
        definitions: {}
      }).codes[0].runtime
      assertInclude(runtime, "Schema.Union([")
      assert.isFalse(runtime.includes("Schema.Literals("))
      const emitted = Schema.toJsonSchemaDocument2(schema).schema
      assert.isTrue(Array.isArray(emitted.anyOf))
      assert.isFalse(Array.isArray(emitted.enum))
    }
    assertInclude(
      SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
        schemas: [checked],
        definitions: {}
      }).codes[0].runtime,
      "Schema.Never"
    )

    const simple = SchemaRepresentation2.toSchemaFromJsonSchemaDocument({
      dialect: "draft-2020-12",
      schema: { enum: ["a", "b"] },
      definitions: {}
    })
    assert.strictEqual(
      SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
        schemas: [simple],
        definitions: {}
      }).codes[0].runtime,
      `Schema.Literals(["a", "b"])`
    )
  })

  it("roundtrips a shared contentSchema through revival, JSON Schema and codegen", () => {
    const document = SchemaRepresentation2.toSchemaFromJsonSchemaMultiDocument({
      dialect: "draft-2020-12",
      schemas: [{
        type: "string",
        contentMediaType: "application/json",
        contentSchema: { $ref: "#/$defs/Payload" }
      }],
      definitions: {
        Payload: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: false
        }
      }
    })

    assert.deepStrictEqual(
      Schema.decodeUnknownSync(noServices(document.schemas[0]))("{\"value\":1}"),
      { value: 1 }
    )

    const emitted = Schema.toJsonSchemaDocument2(document.schemas[0])
    assert.deepStrictEqual(emitted, {
      dialect: "draft-2020-12",
      schema: { $ref: "#/$defs/PayloadJsonString" },
      definitions: {
        Payload: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: false
        },
        PayloadJsonString: {
          type: "string",
          contentMediaType: "application/json",
          contentSchema: { $ref: "#/$defs/Payload" }
        }
      }
    })

    const code = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument(document)
    const referenceKeys = [
      ...code.references.nonRecursives.map(({ $ref }) => $ref),
      ...Object.keys(code.references.recursives)
    ]
    assert.deepStrictEqual(referenceKeys, ["Payload", "PayloadJsonString"])
    assert.strictEqual(code.codes[0].runtime, "PayloadJsonString")
    const references = {
      ...Object.fromEntries(code.references.nonRecursives.map(({ $ref, code }) => [$ref, code])),
      ...code.references.recursives
    }
    assertInclude(references.PayloadJsonString.runtime, "SchemaTransformation.fromJsonString")
    assertInclude(references.PayloadJsonString.runtime, "Payload")
  })
})
