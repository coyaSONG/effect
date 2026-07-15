import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in revivers", () => {
  it("exports the isPattern and Option revivers with concrete payload types", () => {
    expect(Schema.isPatternReviver).type.toBe<
      SchemaRepresentation2.FilterReviver<{ readonly source: string; readonly flags: string }>
    >()
    expect(Schema.OptionReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()

    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.isPatternReviver,
      Schema.OptionReviver
    ]
    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
  })
})
