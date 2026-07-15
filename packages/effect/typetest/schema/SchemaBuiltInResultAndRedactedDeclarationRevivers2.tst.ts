import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in Result and Redacted declaration revivers", () => {
  it("exposes exact payload and declaration reviver types", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.ResultReviver,
      Schema.RedactedReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.ResultReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.RedactedReviver).type.toBe<
      SchemaRepresentation2.DeclarationReviver<
        | null
        | {
          readonly label?: string | undefined
          readonly disallowJsonEncode?: true | undefined
        }
      >
    >()
  })
})
