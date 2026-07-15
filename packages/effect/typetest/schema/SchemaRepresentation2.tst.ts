import { type Schema, SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("SchemaRepresentation2 persisted wire", () => {
  it("exposes codecs for the persisted specializations", () => {
    expect(SchemaRepresentation2.PersistedDocumentFromJson).type.toBe<
      Schema.Codec<
        SchemaRepresentation2.Document<SchemaRepresentation2.PersistedAnnotations>,
        Schema.Json
      >
    >()
    expect(SchemaRepresentation2.PersistedMultiDocumentFromJson).type.toBe<
      Schema.Codec<
        SchemaRepresentation2.MultiDocument<SchemaRepresentation2.PersistedAnnotations>,
        Schema.Json
      >
    >()
  })

  it("keeps live projection explicit for single and multi documents", () => {
    expect(SchemaRepresentation2.toJson).type.toBe<
      (document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations>) => Schema.Json
    >()
    expect(SchemaRepresentation2.toJsonMultiDocument).type.toBe<
      (document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations>) => Schema.Json
    >()
  })
})
