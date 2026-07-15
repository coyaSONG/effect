import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in BigDecimal, Duration and Chunk declaration revivers", () => {
  it("composes every declaration reviver without casts", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.BigDecimalReviver,
      Schema.DurationReviver,
      Schema.ChunkReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.BigDecimalReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.DurationReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.ChunkReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
  })
})
