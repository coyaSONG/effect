import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { describe, expect, it } from "tstyche"

describe("OpenApi representation v2 consumer", () => {
  it("keeps the synchronous fromApi signature", () => {
    const Api = HttpApi.make("Api").add(
      HttpApiGroup.make("test").add(HttpApiEndpoint.get("health", "/health"))
    )

    expect(OpenApi.fromApi2).type.toBe<typeof OpenApi.fromApi>()
    expect(OpenApi.fromApi2(Api)).type.toBe<OpenApi.OpenAPISpec>()
  })
})
