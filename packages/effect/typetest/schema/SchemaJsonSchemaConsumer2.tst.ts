import { type JsonSchema, Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema JSON Schema v2 consumer", () => {
  it("exposes exact synchronous high-level signatures", () => {
    const toJsonSchema: (
      schema: Schema.Constraint,
      options?: Schema.ToJsonSchemaOptions
    ) => JsonSchema.Document<"draft-2020-12"> = Schema.toJsonSchemaDocument2

    expect(Schema.toRepresentation2(Schema.String)).type.toBe<
      SchemaRepresentation2.Document
    >()
    expect(Schema.toJsonSchemaDocument2(Schema.String)).type.toBe<JsonSchema.Document<"draft-2020-12">>()
    expect(toJsonSchema).type.toBe<
      (
        schema: Schema.Constraint,
        options?: Schema.ToJsonSchemaOptions
      ) => JsonSchema.Document<"draft-2020-12">
    >()
  })
})
