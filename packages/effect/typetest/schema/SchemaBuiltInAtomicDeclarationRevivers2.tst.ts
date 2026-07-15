import { Schema, type SchemaRepresentation2 } from "effect"
import { describe, expect, it } from "tstyche"

describe("Schema built-in atomic declaration revivers", () => {
  it("composes every atomic declaration reviver without casts", () => {
    const revivers: ReadonlyArray<SchemaRepresentation2.AnyReviver> = [
      Schema.DateReviver,
      Schema.FileReviver,
      Schema.FormDataReviver,
      Schema.RegExpReviver,
      Schema.Uint8ArrayReviver,
      Schema.URLReviver,
      Schema.URLSearchParamsReviver
    ]

    expect(revivers).type.toBe<ReadonlyArray<SchemaRepresentation2.AnyReviver>>()
    expect(Schema.DateReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.FileReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
    expect(Schema.FormDataReviver).type.toBe<SchemaRepresentation2.DeclarationReviver<null>>()
  })
})
