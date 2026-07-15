import { assert, describe, it } from "@effect/vitest"
import { Schema, SchemaAST, SchemaRepresentation2 } from "effect"
import { throws } from "../../utils/assert.ts"

function asRecord(value: Schema.Json): Record<string, any> {
  assert.isTrue(typeof value === "object" && value !== null && !Array.isArray(value))
  return value as Record<string, any>
}

describe("SchemaRepresentation2 persisted wire codecs", () => {
  it("roundtrips a custom check without reviving callbacks", () => {
    const check = Schema.makeFilter<string>(() => true, {
      description: "custom check",
      callback: () => "live only",
      representation: {
        id: "acme/schema/customCheck",
        payload: { _tag: "BigInt", value: "1" },
        schemas: [Schema.Number.ast]
      }
    }).abort()
    const json = SchemaRepresentation2.toJson(
      SchemaRepresentation2.fromAST(Schema.String.check(check).ast)
    )

    assert.deepStrictEqual(json, {
      representation: {
        _tag: "String",
        checks: [{
          _tag: "Filter",
          annotations: {
            description: "custom check",
            representation: {
              id: "acme/schema/customCheck",
              payload: { _tag: "BigInt", value: "1" },
              schemas: [{ _tag: "Number", checks: [] }]
            }
          },
          aborted: true
        }]
      },
      references: {}
    })

    const persisted = Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(json)
    const encoded = Schema.encodeSync(SchemaRepresentation2.PersistedDocumentFromJson)(persisted)
    assert.deepStrictEqual(encoded, json)

    const representation = persisted.representation
    assert.strictEqual(representation._tag, "String")
    if (representation._tag !== "String") {
      return
    }
    const persistedCheck = representation.checks[0]
    assert.strictEqual(persistedCheck._tag, "Filter")
    assert.deepStrictEqual(persistedCheck.annotations?.representation?.payload, {
      _tag: "BigInt",
      value: "1"
    })
  })

  it("uses envelopes only for compatible structural fields", () => {
    const symbol = Symbol.for("acme/schema/key")
    const schema = Schema.Tuple([
      Schema.Literal("1"),
      Schema.Literal(1n),
      Schema.Literal(0),
      Schema.Literal(-0),
      Schema.UniqueSymbol(symbol),
      Schema.Struct({ [symbol]: Schema.String })
    ])
    const json = SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(schema.ast))
    const root = asRecord(json).representation

    assert.strictEqual(root._tag, "Arrays")
    assert.strictEqual(root.elements[0].type.literal, "1")
    assert.deepStrictEqual(root.elements[1].type.literal, { _tag: "BigInt", value: "1" })
    assert.strictEqual(root.elements[2].type.literal, 0)
    assert.deepStrictEqual(root.elements[3].type.literal, { _tag: "ExceptionalNumber", value: "-0" })
    assert.deepStrictEqual(root.elements[4].type.symbol, { _tag: "GlobalSymbol", key: "acme/schema/key" })
    assert.deepStrictEqual(root.elements[5].type.propertySignatures[0].name, {
      _tag: "GlobalSymbol",
      key: "acme/schema/key"
    })

    const persisted = Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(json)
    assert.strictEqual(persisted.representation._tag, "Arrays")
    if (persisted.representation._tag !== "Arrays") {
      return
    }
    const elements = persisted.representation.elements
    const bigint = elements[1].type
    const negativeZero = elements[3].type
    const uniqueSymbol = elements[4].type
    const object = elements[5].type
    assert.strictEqual(bigint._tag, "Literal")
    assert.strictEqual(negativeZero._tag, "Literal")
    assert.strictEqual(uniqueSymbol._tag, "UniqueSymbol")
    assert.strictEqual(object._tag, "Objects")
    if (
      bigint._tag === "Literal" &&
      negativeZero._tag === "Literal" &&
      uniqueSymbol._tag === "UniqueSymbol" &&
      object._tag === "Objects"
    ) {
      assert.strictEqual(bigint.literal, 1n)
      assert.isTrue(Object.is(negativeZero.literal, -0))
      assert.strictEqual(uniqueSymbol.symbol, symbol)
      assert.strictEqual(object.propertySignatures[0].name, symbol)
    }
  })

  it("roundtrips every exceptional structural number", () => {
    const document: SchemaRepresentation2.Document<SchemaRepresentation2.PersistedAnnotations> = {
      representation: {
        _tag: "Enum",
        enums: [
          ["negativeZero", -0],
          ["notANumber", Number.NaN],
          ["positiveInfinity", Number.POSITIVE_INFINITY],
          ["negativeInfinity", Number.NEGATIVE_INFINITY]
        ],
        checks: []
      },
      references: {}
    }
    const json = Schema.encodeSync(SchemaRepresentation2.PersistedDocumentFromJson)(document)
    assert.deepStrictEqual(asRecord(json).representation.enums, [
      ["negativeZero", { _tag: "ExceptionalNumber", value: "-0" }],
      ["notANumber", { _tag: "ExceptionalNumber", value: "NaN" }],
      ["positiveInfinity", { _tag: "ExceptionalNumber", value: "Infinity" }],
      ["negativeInfinity", { _tag: "ExceptionalNumber", value: "-Infinity" }]
    ])

    const decoded = Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(json)
    assert.strictEqual(decoded.representation._tag, "Enum")
    if (decoded.representation._tag === "Enum") {
      assert.isTrue(Object.is(decoded.representation.enums[0][1], -0))
      assert.isTrue(Number.isNaN(decoded.representation.enums[1][1]))
      assert.strictEqual(decoded.representation.enums[2][1], Number.POSITIVE_INFINITY)
      assert.strictEqual(decoded.representation.enums[3][1], Number.NEGATIVE_INFINITY)
    }
  })

  it("rejects malformed and non-canonical structural envelopes", () => {
    const json = SchemaRepresentation2.toJson(
      SchemaRepresentation2.fromAST(Schema.Literal(1n).ast)
    )

    for (
      const value of [
        { _tag: "BigInt", value: "01" },
        { _tag: "BigInt", value: "+1" },
        { _tag: "BigInt", value: "-0" },
        { _tag: "ExceptionalNumber", value: "0" },
        { _tag: "Unknown", value: "1" }
      ]
    ) {
      const invalid = JSON.parse(JSON.stringify(json))
      invalid.representation.literal = value
      throws(
        () => Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(invalid),
        (error) => {
          assert.isTrue(Schema.isSchemaError(error))
          return undefined
        }
      )
    }
  })

  it("does not coerce strings that resemble legacy primitive encodings", () => {
    const schema = Schema.Tuple([
      Schema.Literal("1"),
      Schema.Literal("Symbol(a)"),
      Schema.Literal("NaN")
    ])
    const json = SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(schema.ast))
    const persisted = Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(json)
    assert.strictEqual(persisted.representation._tag, "Arrays")
    if (persisted.representation._tag === "Arrays") {
      assert.deepStrictEqual(
        persisted.representation.elements.map((element) =>
          element.type._tag === "Literal" ? element.type.literal : undefined
        ),
        ["1", "Symbol(a)", "NaN"]
      )
    }
  })

  it("rejects invalid manual annotations instead of omitting them", () => {
    const invalid = {
      representation: {
        _tag: "String",
        annotations: { invalid: -0 },
        checks: []
      },
      references: {}
    }
    throws(
      () => Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(invalid),
      (error) => {
        assert.isTrue(Schema.isSchemaError(error))
        return undefined
      }
    )
    assert.isTrue(Object.is(invalid.representation.annotations.invalid, -0))
  })

  it("does not invoke getters or toJSON while decoding", () => {
    let getterCalls = 0
    let toJsonCalls = 0
    const representation = {
      _tag: "String",
      checks: [] as Array<never>
    }
    Object.defineProperty(representation, "annotations", {
      enumerable: true,
      get() {
        getterCalls++
        return {}
      }
    })
    const input = {
      representation,
      references: {},
      toJSON() {
        toJsonCalls++
        return null
      }
    }

    throws(
      () => Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(input),
      (error) => {
        assert.isTrue(Schema.isSchemaError(error))
        return undefined
      }
    )
    assert.strictEqual(getterCalls, 0)
    assert.strictEqual(toJsonCalls, 0)
  })

  it("rejects reserved identities on structural nodes during direct decode", () => {
    const input = {
      representation: {
        _tag: "String",
        annotations: {
          representation: {
            id: "acme/schema/notAllowed",
            payload: null
          }
        },
        checks: []
      },
      references: {}
    }
    throws(
      () => Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(input),
      (error) => {
        assert.isTrue(Schema.isSchemaError(error))
        return undefined
      }
    )
  })

  it("wraps high-level projection failures", () => {
    const symbol = Symbol("local")
    throws(
      () => SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(Schema.UniqueSymbol(symbol).ast)),
      (error) => {
        assert.isTrue(error instanceof SchemaRepresentation2.SchemaRepresentationError)
        if (error instanceof SchemaRepresentation2.SchemaRepresentationError) {
          assert.deepStrictEqual(error.issue, {
            _tag: "InvalidStructuralValue",
            path: ["representation", "symbol"],
            actual: symbol
          })
        }
        return undefined
      }
    )
  })

  it("encodes and decodes multi-documents independently", () => {
    const live = SchemaRepresentation2.fromASTs([Schema.String.ast, Schema.Number.ast])
    const json = SchemaRepresentation2.toJsonMultiDocument(live)
    assert.deepStrictEqual(json, {
      representations: [
        { _tag: "String", checks: [] },
        { _tag: "Number", checks: [] }
      ],
      references: {}
    })

    const persisted = Schema.decodeUnknownSync(SchemaRepresentation2.PersistedMultiDocumentFromJson)(json)
    assert.deepStrictEqual(persisted.representations.map((representation) => representation._tag), [
      "String",
      "Number"
    ])
    assert.deepStrictEqual(
      Schema.encodeSync(SchemaRepresentation2.PersistedMultiDocumentFromJson)(persisted),
      json
    )
  })

  it("roundtrips recursive references", () => {
    let recursive: Schema.Codec<unknown>
    recursive = Schema.suspend((): Schema.Codec<unknown> => recursive)

    const json = SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(recursive.ast))
    assert.deepStrictEqual(json, {
      representation: { _tag: "Reference", $ref: "Suspend_" },
      references: {
        Suspend_: {
          _tag: "Suspend",
          checks: [],
          thunk: { _tag: "Reference", $ref: "Suspend_" }
        }
      }
    })
    assert.deepStrictEqual(
      Schema.encodeSync(SchemaRepresentation2.PersistedDocumentFromJson)(
        Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(json)
      ),
      json
    )
  })

  it("roundtrips structural string content schemas", () => {
    const schema = Schema.fromJsonString(Schema.Struct({ value: Schema.Number }))
    const live = SchemaRepresentation2.fromAST(SchemaAST.toEncoded(schema.ast))
    const json = SchemaRepresentation2.toJson(live)
    const root = asRecord(json).representation
    assert.strictEqual(root.contentMediaType, "application/json")
    assert.strictEqual(root.contentSchema._tag, "Objects")

    const persisted = Schema.decodeUnknownSync(SchemaRepresentation2.PersistedDocumentFromJson)(json)
    assert.strictEqual(persisted.representation._tag, "String")
    if (persisted.representation._tag === "String") {
      assert.strictEqual(persisted.representation.contentMediaType, "application/json")
      assert.strictEqual(persisted.representation.contentSchema?._tag, "Objects")
    }
  })
})
