import { SchemaRepresentation2 as SchemaRepresentation } from "effect"
import { describe, it } from "vitest"
import { deepStrictEqual, throws } from "../../utils/assert.ts"
import { canonicalize } from "./v2Parity.ts"

describe("fromJsonSchemaMultiDocument2 parity", () => {
  it("preserves root order and shares definitions", () => {
    const document = SchemaRepresentation.fromJsonSchemaMultiDocument({
      dialect: "draft-2020-12",
      schemas: [
        { $ref: "#/$defs/A" },
        { $ref: "#/$defs/A", description: "second" },
        { type: "array", items: { $ref: "#/$defs/A" } },
        { $ref: "#/$defs/A", description: "fourth" }
      ],
      definitions: {
        A: { type: "string", minLength: 1 }
      }
    })

    const definition = {
      _tag: "String" as const,
      checks: [{ _tag: "Filter" as const, meta: { _tag: "isMinLength" as const, minLength: 1 } }]
    }
    deepStrictEqual(
      canonicalize(document),
      canonicalize({
        representations: [
          { _tag: "Reference", $ref: "A" },
          {
            _tag: "Suspend",
            checks: [],
            annotations: { description: "second" },
            thunk: { _tag: "Reference", $ref: "A" }
          },
          {
            _tag: "Arrays",
            elements: [],
            rest: [{ _tag: "Reference", $ref: "A" }],
            checks: []
          },
          {
            _tag: "Suspend",
            checks: [],
            annotations: { description: "fourth" },
            thunk: { _tag: "Reference", $ref: "A" }
          }
        ],
        references: { A: definition }
      })
    )
  })

  it("resolves alias chains when combining a reference", () => {
    const document = SchemaRepresentation.fromJsonSchemaMultiDocument({
      dialect: "draft-2020-12",
      schemas: [{ $ref: "#/$defs/A", description: "root" }],
      definitions: {
        A: { $ref: "#/$defs/B" },
        B: { $ref: "#/$defs/C" },
        C: { type: "number" }
      }
    })

    deepStrictEqual(
      canonicalize(document),
      canonicalize({
        representations: [{
          _tag: "Suspend",
          checks: [],
          annotations: { description: "root" },
          thunk: { _tag: "Reference", $ref: "A" }
        }],
        references: {
          A: { _tag: "Reference", $ref: "B" },
          B: { _tag: "Reference", $ref: "C" },
          C: {
            _tag: "Number",
            checks: [{ _tag: "Filter", meta: { _tag: "isFinite" } }]
          }
        }
      })
    )
  })

  it("tracks recursive definitions independently", () => {
    const document = SchemaRepresentation.fromJsonSchemaMultiDocument({
      dialect: "draft-2020-12",
      schemas: [{ $ref: "#/$defs/A" }, { $ref: "#/$defs/B" }],
      definitions: {
        A: { $ref: "#/$defs/A" },
        B: { $ref: "#/$defs/B" }
      }
    })

    deepStrictEqual(
      canonicalize(document),
      canonicalize({
        representations: [
          { _tag: "Reference", $ref: "A" },
          { _tag: "Reference", $ref: "B" }
        ],
        references: {
          A: { _tag: "Reference", $ref: "A" },
          B: { _tag: "Reference", $ref: "B" }
        }
      })
    )
  })

  it("throws when a reference that must be resolved is missing", () => {
    throws(
      () =>
        SchemaRepresentation.fromJsonSchemaMultiDocument({
          dialect: "draft-2020-12",
          schemas: [{ $ref: "#/$defs/Missing", description: "resolve" }],
          definitions: {}
        }),
      "Invalid reference Missing\n  at [\"schemas\"][0][\"$ref\"]"
    )
  })

  it("throws when resolving a circular alias chain", () => {
    throws(
      () =>
        SchemaRepresentation.fromJsonSchemaMultiDocument({
          dialect: "draft-2020-12",
          schemas: [{ $ref: "#/$defs/A", description: "resolve" }],
          definitions: {
            A: { $ref: "#/$defs/B" },
            B: { $ref: "#/$defs/A" }
          }
        }),
      "Invalid reference A\n  at [\"schemas\"][0][\"$ref\"]"
    )
  })
})
