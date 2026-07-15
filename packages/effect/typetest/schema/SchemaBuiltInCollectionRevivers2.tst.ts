import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in collection revivers", () => {
  it("composes every collection check reviver without casts", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.isMinSizeReviver,
      Schema.isMaxSizeReviver,
      Schema.isSizeBetweenReviver,
      Schema.isUniqueReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.isMinSizeReviver).type.toBe<
      SchemaRepresentation2.FilterReviver<{ readonly minSize: number }>
    >()
    expect(Schema.isSizeBetweenReviver).type.toBe<
      SchemaRepresentation2.FilterReviver<{
        readonly minimum: number
        readonly maximum: number
      }>
    >()
    expect(Schema.isUniqueReviver).type.toBe<SchemaRepresentation2.FilterReviver<null>>()
  })
})
