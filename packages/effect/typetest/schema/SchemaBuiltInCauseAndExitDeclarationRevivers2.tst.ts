import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in Cause and Exit declaration revivers", () => {
  it("exposes exact null payload reviver types", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.CauseReasonReviver,
      Schema.CauseReviver,
      Schema.ExitReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.CauseReasonReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.CauseReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.ExitReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
  })
})
