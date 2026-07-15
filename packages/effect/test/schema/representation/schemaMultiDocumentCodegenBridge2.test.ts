import { assert, describe, it } from "@effect/vitest"
import { Schema, SchemaRepresentation2 } from "effect"

describe("SchemaMultiDocument codegen bridge v2", () => {
  it("projects roots to their encoded side", () => {
    const output = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
      schemas: [Schema.FiniteFromString],
      definitions: {}
    })

    assert.deepStrictEqual(output.codes, [{
      runtime: `Schema.String.annotate({ "expected": "a string that will be decoded as a finite number" })`,
      Type: "string"
    }])
  })

  it("keeps definitions out of roots and emits unreachable definitions", () => {
    const Shared = Schema.suspend(() => Schema.Struct({ value: Schema.String }))
    const Unused = Schema.suspend(() => Schema.Number)
    const output = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
      schemas: [Schema.Struct({ shared: Shared })],
      definitions: {
        Shared,
        Unused
      }
    })

    assert.strictEqual(output.codes.length, 1)
    assert.strictEqual(output.codes[0].runtime, `Schema.Struct({ "shared": Shared })`)
    assert.deepStrictEqual(
      Object.fromEntries(output.references.nonRecursives.map(({ $ref, code }) => [$ref, code])),
      {
        Shared: {
          runtime: `Schema.Struct({ "value": Schema.String })`,
          Type: `{ readonly "value": string }`
        },
        Unused: { runtime: "Schema.Number", Type: "number" }
      }
    )
  })

  it("reserves external definition keys before naming internal references", () => {
    const Internal = Schema.String.annotate({ identifier: "Taken" })
    const output = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
      schemas: [Schema.Struct({ internal: Internal })],
      definitions: { Taken: Schema.suspend(() => Schema.Number) }
    })
    const references = Object.fromEntries(
      output.references.nonRecursives.map(({ $ref, code }) => [$ref, code])
    )

    assert.strictEqual(output.codes[0].runtime, `Schema.Struct({ "internal": Taken1 })`)
    assert.deepStrictEqual(references.Taken, { runtime: "Schema.Number", Type: "number" })
    assert.deepStrictEqual(references.Taken1, { runtime: "Schema.String", Type: "string" })
  })

  it("disambiguates colliding identifiers for non-suspend definitions", () => {
    const output = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
      schemas: [Schema.String, Schema.Number],
      definitions: {
        "a-b": Schema.String,
        "a b": Schema.Number
      }
    })

    assert.deepStrictEqual(output.codes, [
      { runtime: "A_b", Type: "A_b" },
      { runtime: "A_b1", Type: "A_b1" }
    ])
    assert.deepStrictEqual(output.references.nonRecursives, [
      { $ref: "A_b", code: { runtime: "Schema.String", Type: "string" } },
      { $ref: "A_b1", code: { runtime: "Schema.Number", Type: "number" } }
    ])
  })

  it("preserves two external keys that share the same non-suspend body", () => {
    const Shared = Schema.Struct({ value: Schema.String })
    const output = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
      schemas: [Shared],
      definitions: { A: Shared, B: Shared }
    })

    assert.deepStrictEqual(output.codes, [{ runtime: "B", Type: "B" }])
    assert.deepStrictEqual(output.references.nonRecursives, [
      {
        $ref: "B",
        code: {
          runtime: `Schema.Struct({ "value": Schema.String })`,
          Type: `{ readonly "value": string }`
        }
      },
      { $ref: "A", code: { runtime: "B", Type: "B" } }
    ])
  })

  it("preserves aliases between stable definition wrappers", () => {
    const Target = Schema.suspend(() => Schema.String)
    const Alias = Schema.suspend(() => Target)
    const output = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
      schemas: [Alias],
      definitions: { Alias, Target }
    })

    assert.deepStrictEqual(output.codes, [{ runtime: "Alias", Type: "Alias" }])
    assert.deepStrictEqual(output.references.nonRecursives, [
      { $ref: "Target", code: { runtime: "Schema.String", Type: "string" } },
      { $ref: "Alias", code: { runtime: "Target", Type: "Target" } }
    ])
  })

  it("preserves recursive references through their stable wrapper", () => {
    interface Node {
      readonly next?: Node | undefined
    }
    const Node: Schema.Codec<Node> = Schema.suspend(() => Schema.Struct({ next: Schema.optionalKey(Node) }))
    const output = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument({
      schemas: [Node],
      definitions: { Node }
    })

    assert.deepStrictEqual(output.codes, [{ runtime: "Node", Type: "Node" }])
    assert.deepStrictEqual(output.references, {
      nonRecursives: [],
      recursives: {
        Node: {
          runtime: `Schema.Struct({ "next": Schema.optionalKey(Node) })`,
          Type: `{ readonly "next"?: Node }`
        }
      }
    })
  })
})
