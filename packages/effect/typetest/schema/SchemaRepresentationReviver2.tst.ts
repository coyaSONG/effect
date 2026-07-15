import { Schema, SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("SchemaRepresentation2 revivers", () => {
  it("accepts concrete payload revivers at the erased collection boundary", () => {
    const reviver: SchemaRepresentation2.FilterReviver<{ readonly source: string }> = {
      _tag: "Filter",
      id: "acme/schema/isPattern",
      payloadSchema: Schema.Struct({ source: Schema.String }),
      schemasArity: 0,
      revive: ({ payload, annotations }) => Schema.isPattern(new RegExp(payload.source), annotations)
    }
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [reviver]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
  })

  it("requires explicit options for single and multi-document revival", () => {
    expect(SchemaRepresentation2.fromJson).type.toBe<
      (input: unknown, options: SchemaRepresentation2.FromJsonOptions) => Schema.Top
    >()
    expect(SchemaRepresentation2.fromJsonMultiDocument).type.toBe<
      (input: unknown, options: SchemaRepresentation2.FromJsonOptions) => SchemaRepresentation2.SchemaMultiDocument
    >()

    // @ts-expect-error Expected 2 arguments, but got 1.
    SchemaRepresentation2.fromJson({})
    // @ts-expect-error Expected 2 arguments, but got 1.
    SchemaRepresentation2.fromJsonMultiDocument({})
  })
})
