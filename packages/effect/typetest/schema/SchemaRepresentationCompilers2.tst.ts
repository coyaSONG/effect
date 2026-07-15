import { type JsonSchema, Schema, SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("SchemaRepresentation2 compilers", () => {
  it("distinguishes live compiler inputs and their outputs", () => {
    const document = SchemaRepresentation2.fromAST(Schema.String.ast)
    const multiDocument = SchemaRepresentation2.fromASTs([Schema.String.ast])

    expect(SchemaRepresentation2.toJsonSchemaDocument(document)).type.toBe<
      JsonSchema.Document<"draft-2020-12">
    >()
    expect(SchemaRepresentation2.toJsonSchemaMultiDocument(multiDocument)).type.toBe<
      JsonSchema.MultiDocument<"draft-2020-12">
    >()
    expect(SchemaRepresentation2.toCodeDocument(multiDocument)).type.toBe<
      SchemaRepresentation2.CodeDocument
    >()
  })
})
