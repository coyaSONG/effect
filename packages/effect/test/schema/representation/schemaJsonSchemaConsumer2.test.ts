import { assert, describe, it } from "@effect/vitest"
import { Schema, SchemaRepresentation2 } from "effect"
import { throws } from "../../utils/assert.ts"

describe("Schema JSON Schema v2 consumer", () => {
  it("keeps toRepresentation2 on the type side and projects the encoded side for JSON Schema", () => {
    const representation = Schema.toRepresentation2(Schema.FiniteFromString)
    assert.strictEqual(representation.representation._tag, "Number")

    assert.deepStrictEqual(Schema.toJsonSchemaDocument2(Schema.FiniteFromString), {
      dialect: "draft-2020-12",
      schema: { type: "string" },
      definitions: {}
    })
  })

  it("preserves legacy output, references and generation options", () => {
    const shared = Schema.String.check(Schema.isMinLength(2)).annotate({
      identifier: "Shared",
      description: "shared text",
      "x-consumer": "kept"
    })
    const schema = Schema.Struct({
      first: shared,
      second: shared,
      count: Schema.FiniteFromString
    }).annotate({ description: "root" })
    const options: Schema.ToJsonSchemaOptions = {
      additionalProperties: true,
      generateDescriptions: true,
      includeAnnotationKey: (key) => key === "x-consumer"
    }

    assert.deepStrictEqual(
      Schema.toJsonSchemaDocument2(schema, options),
      Schema.toJsonSchemaDocument(schema, options)
    )
  })

  it("uses custom compiler annotations without a central built-in switch", () => {
    const custom = Schema.String.check(Schema.makeFilter<string>((value) => value.length >= 2, {
      representation: {
        id: "test/schema/minTwoCharacters",
        payload: null
      },
      toJsonSchema: () => ({ minLength: 2 })
    }))

    assert.deepStrictEqual(Schema.toJsonSchemaDocument2(custom), {
      dialect: "draft-2020-12",
      schema: {
        type: "string",
        allOf: [{ minLength: 2 }]
      },
      definitions: {}
    })
  })

  it("preserves structural JSON content schemas after encoded projection", () => {
    const schema = Schema.fromJsonString(Schema.Struct({
      value: Schema.FiniteFromString
    }))

    assert.deepStrictEqual(
      Schema.toJsonSchemaDocument2(schema),
      Schema.toJsonSchemaDocument(schema)
    )
    assert.deepStrictEqual(Schema.toJsonSchemaDocument2(schema).schema, {
      type: "string",
      contentMediaType: "application/json",
      contentSchema: {
        type: "object",
        properties: {
          value: { type: "string" }
        },
        required: ["value"],
        additionalProperties: false
      }
    })
  })

  it("throws the shared SchemaRepresentationError for compiler failures", () => {
    const schema = Schema.declare((input): input is string => typeof input === "string", {
      representation: {
        id: "test/schema/opaqueString",
        payload: null
      }
    })

    throws(
      () => Schema.toJsonSchemaDocument2(schema),
      (error: unknown) => {
        assert.isTrue(error instanceof SchemaRepresentation2.SchemaRepresentationError)
        if (error instanceof SchemaRepresentation2.SchemaRepresentationError) {
          assert.strictEqual(error.issue._tag, "MissingJsonSchema")
          assert.deepStrictEqual(error.issue.path, ["representation", "annotations", "toJsonSchema"])
        }
        return undefined
      }
    )
  })
})
