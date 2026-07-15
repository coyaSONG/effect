import { type Schema, SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("SchemaRepresentation2 persisted wire", () => {
  it("exposes codecs for documents", () => {
    expect(SchemaRepresentation2.DocumentFromJson).type.toBe<
      Schema.Codec<
        SchemaRepresentation2.Document,
        Schema.Json
      >
    >()
    expect(SchemaRepresentation2.MultiDocumentFromJson).type.toBe<
      Schema.Codec<
        SchemaRepresentation2.MultiDocument,
        Schema.Json
      >
    >()
  })

  it("keeps projection explicit for single and multi documents", () => {
    expect(SchemaRepresentation2.toJson).type.toBe<
      (document: SchemaRepresentation2.Document) => Schema.Json
    >()
    expect(SchemaRepresentation2.toJsonMultiDocument).type.toBe<
      (document: SchemaRepresentation2.MultiDocument) => Schema.Json
    >()
  })
})
