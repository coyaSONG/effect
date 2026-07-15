import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

describe("OpenApi representation v2 consumer", () => {
  it("projects request and response schemas to the encoded side", () => {
    const Api = HttpApi.make("Api").add(
      HttpApiGroup.make("test").add(
        HttpApiEndpoint.post("create", "/create", {
          payload: Schema.FiniteFromString,
          success: Schema.FiniteFromString
        })
      )
    )

    const spec = OpenApi.fromApi2(Api)

    assert.deepStrictEqual(
      spec.paths["/create"]?.post?.requestBody?.content["application/json"]?.schema,
      { type: "string" }
    )
    assert.deepStrictEqual(
      spec.paths["/create"]?.post?.responses[200]?.content?.["application/json"]?.schema,
      { type: "string" }
    )
    assert.deepStrictEqual(spec, OpenApi.fromApi(Api))
  })

  it("uses custom JSON Schema compiler annotations", () => {
    const CustomString = Schema.String.check(Schema.makeFilter<string>((value) => value.length >= 2, {
      representation: {
        id: "test/openapi/minTwoCharacters",
        payload: null
      },
      toJsonSchema: () => ({ minLength: 2 })
    }))
    const Api = HttpApi.make("Api").add(
      HttpApiGroup.make("test").add(
        HttpApiEndpoint.post("create", "/create", { payload: CustomString })
      )
    )

    assert.deepStrictEqual(
      OpenApi.fromApi2(Api).paths["/create"]?.post?.requestBody?.content["application/json"]?.schema,
      {
        type: "string",
        allOf: [{ minLength: 2 }]
      }
    )
  })

  it("shares definitions and keeps an identity-only cache separate from the legacy path", () => {
    const Shared = Schema.Struct({ value: Schema.FiniteFromString }).annotate({ identifier: "Shared" })
    const Api = HttpApi.make("Api").add(
      HttpApiGroup.make("test").add(
        HttpApiEndpoint.post("shared", "/shared", {
          payload: Schema.Struct({ first: Shared, second: Shared }),
          success: Shared
        })
      )
    )

    const legacy = OpenApi.fromApi(Api)
    const first = OpenApi.fromApi2(Api)

    assert.notStrictEqual(first, legacy)
    assert.strictEqual(OpenApi.fromApi2(Api), first)
    assert.deepStrictEqual(first, legacy)
    assert.deepStrictEqual(first.components.schemas.Shared, {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false
    })
  })
})
