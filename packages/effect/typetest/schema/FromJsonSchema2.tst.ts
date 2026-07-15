import { type JsonSchema, type Schema, SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("JSON Schema importer v2", () => {
  it("exposes exact synchronous signatures", () => {
    const fromDocument: (
      document: JsonSchema.Document<"draft-2020-12">,
      options?: SchemaRepresentation2.FromJsonSchemaOptions
    ) => SchemaRepresentation2.Document = SchemaRepresentation2.fromJsonSchemaDocument
    const fromMultiDocument: (
      document: JsonSchema.MultiDocument<"draft-2020-12">,
      options?: SchemaRepresentation2.FromJsonSchemaOptions
    ) => SchemaRepresentation2.MultiDocument = SchemaRepresentation2.fromJsonSchemaMultiDocument
    const toSchemaFromDocument: (
      document: JsonSchema.Document<"draft-2020-12">,
      options?: SchemaRepresentation2.FromJsonSchemaOptions
    ) => Schema.Top = SchemaRepresentation2.toSchemaFromJsonSchemaDocument
    const toSchemaFromMultiDocument: (
      document: JsonSchema.MultiDocument<"draft-2020-12">,
      options?: SchemaRepresentation2.FromJsonSchemaOptions
    ) => SchemaRepresentation2.SchemaMultiDocument = SchemaRepresentation2.toSchemaFromJsonSchemaMultiDocument

    expect(fromDocument).type.toBe<
      (
        document: JsonSchema.Document<"draft-2020-12">,
        options?: SchemaRepresentation2.FromJsonSchemaOptions
      ) => SchemaRepresentation2.Document
    >()
    expect(fromMultiDocument).type.toBe<
      (
        document: JsonSchema.MultiDocument<"draft-2020-12">,
        options?: SchemaRepresentation2.FromJsonSchemaOptions
      ) => SchemaRepresentation2.MultiDocument
    >()
    expect(toSchemaFromDocument).type.toBe<
      (
        document: JsonSchema.Document<"draft-2020-12">,
        options?: SchemaRepresentation2.FromJsonSchemaOptions
      ) => Schema.Top
    >()
    expect(toSchemaFromMultiDocument).type.toBe<
      (
        document: JsonSchema.MultiDocument<"draft-2020-12">,
        options?: SchemaRepresentation2.FromJsonSchemaOptions
      ) => SchemaRepresentation2.SchemaMultiDocument
    >()
  })

  it("keeps onEnter limited to JSON Schema nodes", () => {
    const options: SchemaRepresentation2.FromJsonSchemaOptions = {
      onEnter: (schema) => ({ ...schema, description: "entered" })
    }

    expect(options.onEnter).type.toBe<
      ((schema: JsonSchema.JsonSchema) => JsonSchema.JsonSchema) | undefined
    >()
  })
})
