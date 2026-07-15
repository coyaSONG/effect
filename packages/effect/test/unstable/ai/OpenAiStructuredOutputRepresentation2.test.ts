import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { toCodecOpenAI2 } from "effect/unstable/ai/OpenAiStructuredOutput"

describe("OpenAiStructuredOutput representation v2", () => {
  it("projects the encoded side before JSON Schema generation", () => {
    assert.strictEqual(toCodecOpenAI2(Schema.FiniteFromString).jsonSchema.type, "string")
  })

  it("uses custom JSON Schema compiler annotations before provider rewrites", () => {
    const schema = Schema.String.check(Schema.makeFilter<string>((value) => value.length >= 2, {
      representation: {
        id: "test/ai/openai/minTwoCharacters",
        payload: null
      },
      toJsonSchema: () => ({ minLength: 2 })
    }))

    assert.deepStrictEqual(toCodecOpenAI2(schema).jsonSchema, {
      type: "string",
      minLength: 2
    })
  })
})
