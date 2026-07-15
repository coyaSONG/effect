import { Schema, SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("SchemaMultiDocument codegen bridge v2", () => {
  it("exposes an exact synchronous signature", () => {
    const document: SchemaRepresentation2.SchemaMultiDocument = {
      schemas: [Schema.String],
      definitions: {}
    }
    const bridge: (
      document: SchemaRepresentation2.SchemaMultiDocument
    ) => SchemaRepresentation2.CodeDocument = SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument

    expect(SchemaRepresentation2.toCodeDocumentFromSchemaMultiDocument(document)).type.toBe<
      SchemaRepresentation2.CodeDocument
    >()
    expect(bridge).type.toBe<
      (document: SchemaRepresentation2.SchemaMultiDocument) => SchemaRepresentation2.CodeDocument
    >()
  })
})
