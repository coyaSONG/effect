import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in DateTime declaration revivers", () => {
  it("composes every DateTime declaration reviver without casts", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.TimeZoneReviver,
      Schema.TimeZoneNamedReviver,
      Schema.TimeZoneOffsetReviver,
      Schema.DateTimeUtcReviver,
      Schema.DateTimeZonedReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.TimeZoneReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.TimeZoneNamedReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.TimeZoneOffsetReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.DateTimeUtcReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.DateTimeZonedReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
  })
})
