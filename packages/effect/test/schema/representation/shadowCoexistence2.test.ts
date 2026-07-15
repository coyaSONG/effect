import { assert, describe, it } from "@effect/vitest"
import { Option as Option_, Schema, SchemaRepresentation, SchemaRepresentation2 } from "effect"
import { throws } from "../../utils/assert.ts"

function noServices(schema: Schema.Top): Schema.Codec<unknown> {
  return schema as Schema.Codec<unknown>
}

describe("SchemaRepresentation2 shadow built-ins", () => {
  it("keeps isPattern legacy metadata while adding the open protocol", () => {
    const check = Schema.isPattern(/^[a-z]+$/i, { description: "letters" })

    assert.strictEqual(check.annotations?.meta?._tag, "isPattern")
    assert.deepStrictEqual(check.annotations?.representation, {
      id: "effect/schema/isPattern",
      payload: { source: "^[a-z]+$", flags: "i" }
    })
    assert.deepStrictEqual(check.annotations?.toJsonSchema?.({ type: "string", schemas: [] }), {
      pattern: "^[a-z]+$"
    })
    assert.deepStrictEqual(check.annotations?.generation?.({ schemas: [] }), {
      runtime: `Schema.isPattern(new RegExp("^[a-z]+$", "i"))`
    })

    const legacy = SchemaRepresentation.fromAST(Schema.String.check(check).ast)
    assert.strictEqual(legacy.representation._tag, "String")
    if (legacy.representation._tag === "String") {
      const legacyCheck = legacy.representation.checks[0]
      assert.strictEqual(legacyCheck._tag, "Filter")
      if (legacyCheck._tag === "Filter") {
        assert.strictEqual(legacyCheck.meta._tag, "isPattern")
        assert.deepStrictEqual(legacyCheck.annotations, {
          expected: "a string matching the RegExp ^[a-z]+$",
          description: "letters"
        })
      }
    }

    const json = SchemaRepresentation2.toJson(
      SchemaRepresentation2.fromAST(Schema.String.check(check).ast)
    )
    const revived = SchemaRepresentation2.fromJson(json, { revivers: [Schema.isPatternReviver] })
    assert.strictEqual(Schema.decodeUnknownSync(noServices(revived))("ABC"), "ABC")
    assert.isTrue(Schema.decodeUnknownResult(noServices(revived))("123")._tag === "Failure")
    assert.strictEqual(revived.ast.checks?.[0].annotations?.description, "letters")
    assert.strictEqual(revived.ast.checks?.[0].annotations?.representation?.id, "effect/schema/isPattern")
    assert.isTrue(typeof revived.ast.checks?.[0].annotations?.generation === "function")
  })

  it("rejects non-canonical RegExp payloads before invoking isPatternReviver", () => {
    const base = SchemaRepresentation2.toJson(
      SchemaRepresentation2.fromAST(Schema.String.check(Schema.isPattern(/a/i)).ast)
    ) as any
    for (
      const payload of [
        { source: "a", flags: "ii" },
        { source: "a", flags: "mi" },
        { source: "(", flags: "" }
      ]
    ) {
      const json = JSON.parse(JSON.stringify(base))
      json.representation.checks[0].annotations.representation.payload = payload
      throws(
        () => SchemaRepresentation2.fromJson(json, { revivers: [Schema.isPatternReviver] }),
        (error: unknown) => {
          assert.isTrue(error instanceof SchemaRepresentation2.SchemaRepresentationError)
          if (error instanceof SchemaRepresentation2.SchemaRepresentationError) {
            assert.strictEqual(error.issue._tag, "InvalidRepresentationPayload")
            assert.deepStrictEqual(error.issue.path, [
              "representation",
              "checks",
              0,
              "annotations",
              "representation",
              "payload"
            ])
          }
          return undefined
        }
      )
    }
  })

  it("keeps Option legacy behavior while reviving through its individual reviver", () => {
    const schema = Schema.Option(Schema.String).annotate({ description: "maybe text" })
    assert.strictEqual(schema.ast._tag, "Declaration")
    if (schema.ast._tag !== "Declaration") {
      return
    }

    const annotations = schema.ast.annotations as Schema.Annotations.Declaration<unknown>
    assert.deepStrictEqual(annotations.typeConstructor, { _tag: "effect/Option" })
    assert.deepStrictEqual(annotations.representation, {
      id: "effect/schema/Option",
      payload: null
    })
    assert.isTrue(typeof annotations.generation === "function")
    if (typeof annotations.generation === "function") {
      assert.deepStrictEqual(
        annotations.generation({
          typeParameters: [{ runtime: "Schema.String", Type: "string" }],
          schemas: []
        }),
        {
          runtime: "Schema.Option(Schema.String)",
          Type: "Option.Option<string>",
          importDeclarations: [`import * as Option from "effect/Option"`]
        }
      )
    }
    assert.deepStrictEqual(
      annotations.toJsonSchema?.({
        typeParameters: [{ type: "string" }],
        schemas: []
      }),
      {
        anyOf: [
          {
            type: "object",
            properties: {
              _tag: { type: "string", enum: ["Some"] },
              value: { type: "string" }
            },
            required: ["_tag", "value"],
            additionalProperties: false
          },
          {
            type: "object",
            properties: {
              _tag: { type: "string", enum: ["None"] }
            },
            required: ["_tag"],
            additionalProperties: false
          }
        ]
      }
    )

    const legacy = SchemaRepresentation.fromAST(schema.ast)
    assert.strictEqual(legacy.representation._tag, "Declaration")
    if (legacy.representation._tag === "Declaration") {
      assert.deepStrictEqual(legacy.representation.annotations?.generation, {
        runtime: "Schema.Option(?)",
        Type: "Option.Option<?>",
        importDeclaration: `import * as Option from "effect/Option"`
      })
    }
    const code = SchemaRepresentation.toCodeDocument(SchemaRepresentation.fromASTs([schema.ast]))
    assert.deepStrictEqual(code.codes, [{
      runtime: `Schema.Option(Schema.String).annotate({ "description": "maybe text" })`,
      Type: "Option.Option<string>"
    }])
    assert.deepStrictEqual(code.artifacts, [{
      _tag: "Import",
      importDeclaration: `import * as Option from "effect/Option"`
    }])

    const callbackDocument: SchemaRepresentation.MultiDocument = {
      ...SchemaRepresentation.fromASTs([Schema.Option(Schema.String).ast]),
      representations: [{
        _tag: "Declaration",
        typeParameters: [{ _tag: "String", checks: [] }],
        encodedSchema: { _tag: "Null" },
        checks: [],
        annotations: {
          generation: ({ typeParameters }: { readonly typeParameters: ReadonlyArray<SchemaRepresentation.Code> }) => ({
            runtime: `Schema.Option(${typeParameters[0].runtime})`,
            Type: `Option.Option<${typeParameters[0].Type}>`,
            importDeclarations: [`import * as Option from "effect/Option"`]
          })
        }
      }]
    }
    const callbackCode = SchemaRepresentation.toCodeDocument(callbackDocument)
    assert.deepStrictEqual(callbackCode.codes, [{
      runtime: "Schema.Option(Schema.String)",
      Type: "Option.Option<string>"
    }])
    assert.deepStrictEqual(callbackCode.artifacts, [{
      _tag: "Import",
      importDeclaration: `import * as Option from "effect/Option"`
    }])

    const json = SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(schema.ast))
    const revived = SchemaRepresentation2.fromJson(json, { revivers: [Schema.OptionReviver] })
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(noServices(revived))(Option_.some("value")),
      Option_.some("value")
    )
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(noServices(revived))(Option_.none()),
      Option_.none()
    )
    const revivedAnnotations = revived.ast.annotations as Schema.Annotations.Declaration<unknown> | undefined
    assert.strictEqual(revivedAnnotations?.description, "maybe text")
    assert.strictEqual(revivedAnnotations?.representation?.id, "effect/schema/Option")
    assert.isTrue(typeof revivedAnnotations?.generation === "function")
    assert.deepStrictEqual(
      SchemaRepresentation2.toJson(SchemaRepresentation2.fromAST(revived.ast)),
      json
    )
  })
})
