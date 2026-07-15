import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in JSON and hash collection declaration revivers", () => {
  it("exposes exact null payload reviver types", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.JsonReviver,
      Schema.MutableJsonReviver,
      Schema.HashMapReviver,
      Schema.HashSetReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.JsonReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.MutableJsonReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.HashMapReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.HashSetReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
  })
})
