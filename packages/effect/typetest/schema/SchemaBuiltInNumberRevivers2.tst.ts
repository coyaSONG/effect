import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in number revivers", () => {
  it("composes every number check reviver without casts", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.isFiniteReviver,
      Schema.isIntReviver,
      Schema.isMultipleOfReviver,
      Schema.isGreaterThanReviver,
      Schema.isGreaterThanOrEqualToReviver,
      Schema.isLessThanReviver,
      Schema.isLessThanOrEqualToReviver,
      Schema.isBetweenReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.isMultipleOfReviver).type.toBe<
      SchemaRepresentation2.FilterReviver<{ readonly divisor: number }>
    >()
    expect(Schema.isGreaterThanReviver).type.toBe<
      SchemaRepresentation2.FilterReviver<{ readonly exclusiveMinimum: number }>
    >()
    expect(Schema.isBetweenReviver).type.toBe<
      SchemaRepresentation2.FilterReviver<{
        readonly minimum: number
        readonly maximum: number
        readonly exclusiveMinimum?: true | undefined
        readonly exclusiveMaximum?: true | undefined
      }>
    >()
  })
})
