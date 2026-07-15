import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in Error and collection declaration revivers", () => {
  it("exposes exact payload and declaration reviver types", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.ErrorReviver,
      Schema.ReadonlyMapReviver,
      Schema.ReadonlySetReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.ErrorReviver).type.toBe<
      SchemaRepresentation2.DeclarationReviver<
        | null
        | {
          readonly includeStack?: true | undefined
          readonly excludeCause?: true | undefined
        }
      >
    >()
    expect(Schema.ReadonlyMapReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.ReadonlySetReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
  })
})
