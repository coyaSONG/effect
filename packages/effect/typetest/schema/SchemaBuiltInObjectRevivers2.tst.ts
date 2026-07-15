import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in object revivers", () => {
  it("composes every object check reviver without casts", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.isMinPropertiesReviver,
      Schema.isMaxPropertiesReviver,
      Schema.isPropertiesLengthBetweenReviver,
      Schema.isPropertyNamesReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.isMinPropertiesReviver).type.toBe<
      SchemaRepresentation2.FilterReviver<{ readonly minProperties: number }>
    >()
    expect(Schema.isPropertiesLengthBetweenReviver).type.toBe<
      SchemaRepresentation2.FilterReviver<{
        readonly minimum: number
        readonly maximum: number
      }>
    >()
    expect(Schema.isPropertyNamesReviver).type.toBe<SchemaRepresentation2.FilterReviver<null>>()
  })
})
