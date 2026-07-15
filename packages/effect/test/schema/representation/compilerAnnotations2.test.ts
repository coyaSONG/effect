import { assert, describe, it } from "@effect/vitest"
import { Schema, SchemaRepresentation2 } from "effect"
import { assertInclude, throws } from "../../utils/assert.ts"

function expectIssue(
  thunk: () => void,
  tag: SchemaRepresentation2.SchemaRepresentationIssue["_tag"],
  path: SchemaRepresentation2.Path,
  cause?: unknown
): void {
  throws(thunk, (error: unknown) => {
    assert.isTrue(error instanceof SchemaRepresentation2.SchemaRepresentationError)
    if (error instanceof SchemaRepresentation2.SchemaRepresentationError) {
      assert.strictEqual(error.issue._tag, tag)
      assert.deepStrictEqual(error.issue.path, path)
      if (cause !== undefined && "cause" in error.issue) {
        assert.strictEqual(error.issue.cause, cause)
      }
    }
    return undefined
  })
}

const StringRepresentation: SchemaRepresentation2.LiveRepresentation = {
  _tag: "String",
  checks: []
}

const NumberRepresentation: SchemaRepresentation2.LiveRepresentation = {
  _tag: "Number",
  checks: []
}

describe("SchemaRepresentation2 compiler annotations", () => {
  describe("JSON Schema", () => {
    it("compiles the isPattern and Option vertical slice", () => {
      const pattern = SchemaRepresentation2.toJsonSchemaDocument(
        SchemaRepresentation2.fromAST(Schema.String.check(Schema.isPattern(/^[a-z]+$/i)).ast)
      )
      assert.deepStrictEqual(pattern, {
        dialect: "draft-2020-12",
        schema: {
          type: "string",
          allOf: [{ pattern: "^[a-z]+$" }]
        },
        definitions: {}
      })

      const option = SchemaRepresentation2.toJsonSchemaDocument(
        SchemaRepresentation2.fromAST(Schema.Option(Schema.String).ast)
      )
      assert.deepStrictEqual(option.schema, {
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
      })
    })

    it("uses group overrides without visiting children and otherwise falls back to allOf", () => {
      let visits = 0
      const child: SchemaRepresentation2.Filter<SchemaRepresentation2.LiveAnnotations> = {
        _tag: "Filter",
        aborted: false,
        annotations: {
          toJsonSchema: () => {
            visits++
            return { minLength: 1 }
          }
        }
      }
      const override: SchemaRepresentation2.FilterGroup<SchemaRepresentation2.LiveAnnotations> = {
        _tag: "FilterGroup",
        checks: [child],
        annotations: {
          description: "override",
          toJsonSchema: () => ({ format: "custom" })
        }
      }
      const fallback: SchemaRepresentation2.FilterGroup<SchemaRepresentation2.LiveAnnotations> = {
        _tag: "FilterGroup",
        checks: [child, { _tag: "Filter", aborted: false }],
        annotations: { description: "fallback" }
      }
      const document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [
          { _tag: "String", checks: [override] },
          { _tag: "String", checks: [fallback] }
        ],
        references: {}
      }

      const output = SchemaRepresentation2.toJsonSchemaMultiDocument(document)
      assert.strictEqual(visits, 1)
      assert.deepStrictEqual(output.schemas, [
        {
          type: "string",
          allOf: [{ format: "custom", description: "override" }]
        },
        {
          type: "string",
          allOf: [{ allOf: [{ minLength: 1 }], description: "fallback" }]
        }
      ])
    })

    it("treats an empty override as authoritative and ignores a leaf without a callback", () => {
      let visits = 0
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "String",
          checks: [{
            _tag: "FilterGroup",
            annotations: { toJsonSchema: () => ({}) },
            checks: [{
              _tag: "Filter",
              aborted: false,
              annotations: {
                description: "ignored",
                toJsonSchema: () => {
                  visits++
                  return { minLength: 1 }
                }
              }
            }]
          }, {
            _tag: "Filter",
            aborted: false,
            annotations: { description: "no callback" }
          }]
        },
        references: {}
      }

      assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaDocument(document).schema, { type: "string" })
      assert.strictEqual(visits, 0)
    })

    it("compiles representation.schemas before invoking a callback", () => {
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "Objects",
          propertySignatures: [],
          indexSignatures: [],
          checks: [{
            _tag: "Filter",
            aborted: false,
            annotations: {
              representation: {
                id: "acme/schema/propertyNames",
                payload: null,
                schemas: [StringRepresentation]
              },
              toJsonSchema: ({ schemas }: SchemaRepresentation2.ToJsonSchema.CheckInput) => ({
                propertyNames: schemas[0]
              })
            }
          }]
        },
        references: {}
      }

      assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaDocument(document).schema, {
        anyOf: [{ type: "object" }, { type: "array" }],
        allOf: [{ propertyNames: { type: "string" } }]
      })
    })

    it("passes type parameters and dependencies to declaration callbacks", () => {
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "Declaration",
          typeParameters: [StringRepresentation],
          checks: [],
          annotations: {
            representation: {
              id: "acme/schema/Box",
              payload: null,
              schemas: [NumberRepresentation]
            },
            toJsonSchema: ({
              schemas,
              typeParameters
            }: SchemaRepresentation2.ToJsonSchema.DeclarationInput) => ({
              allOf: [typeParameters[0], schemas[0]]
            })
          }
        },
        references: {}
      }

      assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaDocument(document).schema, {
        allOf: [
          { type: "string" },
          {
            anyOf: [
              { type: "number" },
              { type: "string", enum: ["NaN"] },
              { type: "string", enum: ["Infinity"] },
              { type: "string", enum: ["-Infinity"] }
            ]
          }
        ]
      })
    })

    it("never exposes compiler capabilities as extension annotations", () => {
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "String",
          annotations: {
            description: "text",
            identifier: "Internal",
            meta: { _tag: "legacy" },
            representation: { id: "acme/schema/String", payload: null },
            generation: () => ({ runtime: "ignored" }),
            toJsonSchema: () => ({ title: "ignored" }),
            "~internal": "ignored",
            "x-custom": { enabled: true }
          },
          checks: []
        },
        references: {}
      }

      assert.deepStrictEqual(
        SchemaRepresentation2.toJsonSchemaDocument(document, {
          includeAnnotationKey: () => true
        }).schema,
        {
          type: "string",
          description: "text",
          "x-custom": { enabled: true }
        }
      )
    })

    it("reports missing and invalid declaration callbacks", () => {
      const missing: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "Declaration",
          typeParameters: [],
          checks: []
        },
        references: {}
      }
      expectIssue(
        () => SchemaRepresentation2.toJsonSchemaDocument(missing),
        "MissingJsonSchema",
        ["representation", "annotations", "toJsonSchema"]
      )

      const invalid: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          ...missing.representation,
          annotations: { toJsonSchema: (() => null) as any }
        } as SchemaRepresentation2.LiveRepresentation,
        references: {}
      }
      expectIssue(
        () => SchemaRepresentation2.toJsonSchemaDocument(invalid),
        "InvalidJsonSchemaResult",
        ["representation", "annotations", "toJsonSchema"]
      )
    })

    it("captures exceptions from JSON Schema callbacks", () => {
      const cause = new Error("json schema callback")
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "String",
          checks: [{
            _tag: "Filter",
            aborted: false,
            annotations: {
              toJsonSchema: () => {
                throw cause
              }
            }
          }]
        },
        references: {}
      }
      expectIssue(
        () => SchemaRepresentation2.toJsonSchemaDocument(document),
        "InvalidJsonSchemaResult",
        ["representation", "checks", 0, "annotations", "toJsonSchema"],
        cause
      )
    })

    it("compiles String contentSchema structurally", () => {
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "String",
          contentMediaType: "application/json",
          contentSchema: {
            _tag: "Objects",
            propertySignatures: [{
              name: "value",
              type: NumberRepresentation,
              isOptional: false,
              isMutable: false
            }],
            indexSignatures: [],
            checks: []
          },
          checks: []
        },
        references: {}
      }

      assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaDocument(document).schema, {
        type: "string",
        contentMediaType: "application/json",
        contentSchema: {
          type: "object",
          properties: {
            value: {
              anyOf: [
                { type: "number" },
                { type: "string", enum: ["NaN"] },
                { type: "string", enum: ["Infinity"] },
                { type: "string", enum: ["-Infinity"] }
              ]
            }
          },
          required: ["value"],
          additionalProperties: false
        }
      })
    })

    it("reports missing references with their document path", () => {
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: { _tag: "Reference", $ref: "Missing" },
        references: {}
      }
      expectIssue(
        () => SchemaRepresentation2.toJsonSchemaDocument(document),
        "InvalidReference",
        ["representation", "$ref"]
      )
    })
  })

  describe("code generation", () => {
    it("compiles the isPattern and Option vertical slice", () => {
      const document = SchemaRepresentation2.fromASTs([
        Schema.String.check(Schema.isPattern(/^a+$/)).ast,
        Schema.Option(Schema.String).ast
      ])
      const output = SchemaRepresentation2.toCodeDocument(document)

      assert.deepStrictEqual(output.codes, [
        {
          runtime:
            `Schema.String.check(Schema.isPattern(new RegExp("^a+$")).annotate({ "expected": "a string matching the RegExp ^a+$" }))`,
          Type: "string"
        },
        {
          runtime: `Schema.Option(Schema.String).annotate({ "expected": "Option" })`,
          Type: "Option.Option<string>"
        }
      ])
      assert.deepStrictEqual(output.artifacts, [{
        _tag: "Import",
        importDeclaration: `import * as Option from "effect/Option"`
      }])
    })

    it("passes compiled dependencies to checks and deduplicates imports", () => {
      const check = (name: string): SchemaRepresentation2.Filter<SchemaRepresentation2.LiveAnnotations> => ({
        _tag: "Filter",
        aborted: false,
        annotations: {
          representation: {
            id: `acme/schema/${name}`,
            payload: null,
            schemas: [StringRepresentation]
          },
          generation: ({ schemas }: SchemaRepresentation2.Generation.CheckInput) => ({
            runtime: `Custom.${name}(${schemas[0].runtime})`,
            importDeclarations: [`import * as Custom from "acme/Custom"`]
          })
        }
      })
      const document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [{ _tag: "String", checks: [check("first"), check("second")] }],
        references: {}
      }

      const output = SchemaRepresentation2.toCodeDocument(document)
      assert.strictEqual(
        output.codes[0].runtime,
        "Schema.String.check(Custom.first(Schema.String)).check(Custom.second(Schema.String))"
      )
      assert.deepStrictEqual(output.artifacts, [{
        _tag: "Import",
        importDeclaration: `import * as Custom from "acme/Custom"`
      }])
    })

    it("emits supported annotation trees atomically", () => {
      const document = SchemaRepresentation2.fromASTs([
        Schema.String.annotate({
          emitted: {
            bigint: 1n,
            symbol: Symbol.for("shared"),
            negativeZero: -0,
            nan: NaN,
            positive: Infinity,
            negative: -Infinity
          },
          omitted: { value: 1, callback: () => 2 }
        }).ast
      ])

      const runtime = SchemaRepresentation2.toCodeDocument(document).codes[0].runtime
      assertInclude(runtime, `"bigint": 1n`)
      assertInclude(runtime, `"symbol": Symbol.for("shared")`)
      assertInclude(runtime, `"negativeZero": -0`)
      assertInclude(runtime, `"nan": NaN`)
      assertInclude(runtime, `"positive": Infinity`)
      assertInclude(runtime, `"negative": -Infinity`)
      assert.isFalse(runtime.includes("omitted"))
      assert.isFalse(runtime.includes("callback"))
    })

    it("emits tuple element and property annotations", () => {
      const document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [
          {
            _tag: "Arrays",
            elements: [{
              isOptional: false,
              type: StringRepresentation,
              annotations: {
                element: { value: 1 },
                omitted: { callback: () => 1 }
              }
            }],
            rest: [],
            checks: []
          },
          {
            _tag: "Objects",
            propertySignatures: [{
              name: "value",
              type: NumberRepresentation,
              isOptional: false,
              isMutable: false,
              annotations: { property: true }
            }],
            indexSignatures: [],
            checks: []
          }
        ],
        references: {}
      }

      assert.deepStrictEqual(SchemaRepresentation2.toCodeDocument(document).codes, [
        {
          runtime: `Schema.Tuple([Schema.String.annotateKey({ "element": { "value": 1 } })])`,
          Type: "readonly [string]"
        },
        {
          runtime: `Schema.Struct({ "value": Schema.Number.annotateKey({ "property": true }) })`,
          Type: `{ readonly "value": number }`
        }
      ])
    })

    it("uses group overrides without visiting children and preserves abort", () => {
      let visits = 0
      const child: SchemaRepresentation2.Filter<SchemaRepresentation2.LiveAnnotations> = {
        _tag: "Filter",
        aborted: true,
        annotations: {
          generation: () => {
            visits++
            return { runtime: "Custom.child()" }
          }
        }
      }
      const document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [
          {
            _tag: "String",
            checks: [{
              _tag: "FilterGroup",
              checks: [child],
              annotations: { generation: () => ({ runtime: "Custom.group()" }) }
            }]
          },
          {
            _tag: "String",
            checks: [{ _tag: "FilterGroup", checks: [child] }]
          }
        ],
        references: {}
      }

      const output = SchemaRepresentation2.toCodeDocument(document)
      assert.strictEqual(visits, 1)
      assert.strictEqual(output.codes[0].runtime, "Schema.String.check(Custom.group())")
      assert.strictEqual(
        output.codes[1].runtime,
        "Schema.String.check(Schema.makeFilterGroup([Custom.child().abort()]))"
      )
    })

    it("passes type parameters and dependencies to declaration callbacks", () => {
      const declaration: SchemaRepresentation2.LiveRepresentation = {
        _tag: "Declaration",
        typeParameters: [StringRepresentation],
        checks: [],
        annotations: {
          representation: {
            id: "acme/schema/Box",
            payload: null,
            schemas: [NumberRepresentation]
          },
          generation: ({
            schemas,
            typeParameters
          }: SchemaRepresentation2.Generation.DeclarationInput) => ({
            runtime: `Custom.box(${typeParameters[0].runtime}, ${schemas[0].runtime})`,
            Type: `Custom.Box<${typeParameters[0].Type}, ${schemas[0].Type}>`,
            importDeclarations: [`import * as Custom from "acme/Custom"`]
          })
        }
      }
      const output = SchemaRepresentation2.toCodeDocument({
        representations: [declaration],
        references: {}
      })

      assert.deepStrictEqual(output.codes, [{
        runtime: "Custom.box(Schema.String, Schema.Number)",
        Type: "Custom.Box<string, number>"
      }])
    })

    it("reports missing, invalid and throwing generation callbacks", () => {
      const missing: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [{
          _tag: "String",
          checks: [{ _tag: "Filter", aborted: false }]
        }],
        references: {}
      }
      expectIssue(
        () => SchemaRepresentation2.toCodeDocument(missing),
        "MissingGeneration",
        ["representations", 0, "checks", 0, "annotations", "generation"]
      )

      const invalid: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [{
          _tag: "Declaration",
          typeParameters: [],
          checks: [],
          annotations: { generation: (() => ({ runtime: "", Type: "string" })) as any }
        }],
        references: {}
      }
      expectIssue(
        () => SchemaRepresentation2.toCodeDocument(invalid),
        "InvalidGenerationResult",
        ["representations", 0, "annotations", "generation"]
      )

      const cause = new Error("generation callback")
      const throwing: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [{
          _tag: "String",
          checks: [{
            _tag: "Filter",
            aborted: false,
            annotations: {
              generation: () => {
                throw cause
              }
            }
          }]
        }],
        references: {}
      }
      expectIssue(
        () => SchemaRepresentation2.toCodeDocument(throwing),
        "InvalidGenerationResult",
        ["representations", 0, "checks", 0, "annotations", "generation"],
        cause
      )
    })

    it("composes application/json content schemas once and emits required imports", () => {
      const contentSchema: SchemaRepresentation2.LiveRepresentation = {
        _tag: "Objects",
        propertySignatures: [{
          name: "value",
          type: NumberRepresentation,
          isOptional: false,
          isMutable: false
        }],
        indexSignatures: [],
        checks: []
      }
      const document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [{
          _tag: "String",
          contentMediaType: "application/json",
          contentSchema,
          annotations: { description: "encoded payload", brands: ["Encoded"] },
          checks: [{
            _tag: "Filter",
            aborted: false,
            annotations: { generation: () => ({ runtime: "Custom.validJson()" }) }
          }]
        }],
        references: {}
      }

      const output = SchemaRepresentation2.toCodeDocument(document)
      const runtime = output.codes[0].runtime
      assertInclude(runtime, "<S extends Schema.Top>(contentSchema: S)")
      assertInclude(runtime, "SchemaAST.toEncoded(contentSchema.ast)")
      assertInclude(runtime, "SchemaTransformation.fromJsonString")
      assertInclude(runtime, ".check(Custom.validJson())")
      assert.strictEqual(runtime.split(`Schema.Struct({ "value": Schema.Number })`).length - 1, 1)
      assert.strictEqual(output.codes[0].Type, `{ readonly "value": number }`)
      assert.deepStrictEqual(output.artifacts, [
        { _tag: "Import", importDeclaration: `import * as SchemaAST from "effect/SchemaAST"` },
        {
          _tag: "Import",
          importDeclaration: `import * as SchemaTransformation from "effect/SchemaTransformation"`
        }
      ])
    })

    it("emits references that are not reachable from a root", () => {
      const document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [StringRepresentation],
        references: {
          Unused: NumberRepresentation
        }
      }
      assert.deepStrictEqual(SchemaRepresentation2.toCodeDocument(document).references, {
        nonRecursives: [{
          $ref: "Unused",
          code: { runtime: "Schema.Number", Type: "number" }
        }],
        recursives: {}
      })
    })

    it("reports missing references with their document path", () => {
      const document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [{ _tag: "Reference", $ref: "Missing" }],
        references: {}
      }
      expectIssue(
        () => SchemaRepresentation2.toCodeDocument(document),
        "InvalidReference",
        ["representations", 0, "$ref"]
      )
    })
  })
})
