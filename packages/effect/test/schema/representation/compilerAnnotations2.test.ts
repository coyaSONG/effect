import { assert, describe, it } from "@effect/vitest"
import { Schema, SchemaAST, SchemaRepresentation2 } from "effect"
import { assertInclude, throws } from "../../utils/assert.ts"

function expectError(thunk: () => void, expected: string | Error): void {
  if (typeof expected === "string") {
    throws(thunk, expected)
  } else {
    throws(thunk, (error: unknown) => {
      assert.strictEqual(error, expected)
      return undefined
    })
  }
}

const StringRepresentation: SchemaRepresentation2.LiveRepresentation = {
  _tag: "String",
  checks: []
}

const NumberRepresentation: SchemaRepresentation2.LiveRepresentation = {
  _tag: "Number",
  checks: []
}

const EmptyUnionRepresentation: SchemaRepresentation2.LiveRepresentation = {
  _tag: "Union",
  types: [],
  mode: "anyOf",
  checks: []
}

describe("SchemaRepresentation2 compiler annotations", () => {
  describe("JSON Schema", () => {
    it("compiles an empty union as Never", () => {
      assert.deepStrictEqual(
        SchemaRepresentation2.toJsonSchemaDocument({
          representation: EmptyUnionRepresentation,
          references: {}
        }).schema,
        { not: {} }
      )
    })

    it("emits standard annotations and oneOf unions", () => {
      const output = SchemaRepresentation2.toJsonSchemaMultiDocument({
        representations: [
          {
            _tag: "String",
            annotations: {
              format: "email",
              contentEncoding: "base64",
              contentMediaType: "text/plain"
            },
            checks: []
          },
          {
            _tag: "Union",
            types: [StringRepresentation, { _tag: "Boolean", checks: [] }],
            mode: "oneOf",
            checks: []
          }
        ],
        references: {}
      })

      assert.deepStrictEqual(output.schemas, [
        {
          type: "string",
          format: "email",
          contentEncoding: "base64",
          contentMediaType: "text/plain"
        },
        { oneOf: [{ type: "string" }, { type: "boolean" }] }
      ])
    })

    it("removes items when an empty tuple has an open rest", () => {
      assert.deepStrictEqual(
        SchemaRepresentation2.toJsonSchemaDocument({
          representation: {
            _tag: "Arrays",
            elements: [],
            rest: [{ _tag: "Unknown", checks: [] }],
            checks: []
          },
          references: {}
        }).schema,
        { type: "array" }
      )
    })

    it("composes annotated reference wrappers and ignores callback-free groups", () => {
      const output = SchemaRepresentation2.toJsonSchemaMultiDocument({
        representations: [
          {
            _tag: "Declaration",
            typeParameters: [],
            annotations: {
              description: "alias",
              toJsonSchema: () => ({ $ref: "#/$defs/Value" })
            },
            checks: [{
              _tag: "Filter",
              aborted: false,
              annotations: { toJsonSchema: () => ({ minLength: 1 }) }
            }]
          },
          {
            _tag: "String",
            checks: [{
              _tag: "FilterGroup",
              checks: [
                { _tag: "Filter", aborted: false },
                { _tag: "Filter", aborted: false }
              ]
            }]
          }
        ],
        references: { Value: StringRepresentation }
      })

      assert.deepStrictEqual(output.schemas, [
        {
          allOf: [
            { $ref: "#/$defs/Value", description: "alias" },
            { minLength: 1 }
          ]
        },
        { type: "string" }
      ])
      assert.deepStrictEqual(output.definitions, { Value: { type: "string" } })
    })

    it("passes the type produced by isInt to following check callbacks", () => {
      let receivedType: unknown
      const dependent = Schema.makeFilter<number>(() => true, {
        toJsonSchema: ({ type }) => {
          receivedType = type
          return { minimum: 0 }
        }
      })
      const document = SchemaRepresentation2.fromAST(
        Schema.Number.check(Schema.isInt(), dependent).ast
      )

      assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaDocument(document).schema, {
        type: "integer",
        allOf: [{ minimum: 0 }]
      })
      assert.strictEqual(receivedType, "integer")
    })

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

    it("compiles every member of a union index-signature parameter", () => {
      const template = SchemaRepresentation2.fromAST(
        Schema.TemplateLiteral(["a", Schema.String]).ast
      ).representation
      const pattern = SchemaRepresentation2.fromAST(
        Schema.String.check(Schema.isPattern(/^b/)).ast
      ).representation
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "Objects",
          propertySignatures: [],
          indexSignatures: [{
            parameter: {
              _tag: "Union",
              types: [template, pattern],
              mode: "anyOf",
              checks: []
            },
            type: StringRepresentation
          }],
          checks: []
        },
        references: {}
      }

      const schema = SchemaRepresentation2.toJsonSchemaDocument(document).schema
      assert.deepStrictEqual(Object.keys(schema.patternProperties ?? {}), ["^a[\\s\\S]*?$", "^b"])
    })

    it("ignores boolean members while collecting index-signature patterns", () => {
      const document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "Objects",
          propertySignatures: [],
          indexSignatures: [{
            parameter: {
              _tag: "String",
              checks: [{
                _tag: "Filter",
                aborted: false,
                annotations: {
                  toJsonSchema: () => ({ allOf: [false, { pattern: "^a" }] })
                }
              }]
            },
            type: StringRepresentation
          }],
          checks: []
        },
        references: {}
      }

      assert.deepStrictEqual(SchemaRepresentation2.toJsonSchemaDocument(document).schema, {
        type: "object",
        patternProperties: { "^a": { type: "string" } }
      })
    })

    it("resolves referenced index-signature parameters and stops cycles", () => {
      const record = (
        parameter: SchemaRepresentation2.LiveRepresentation
      ): SchemaRepresentation2.LiveRepresentation => ({
        _tag: "Objects",
        propertySignatures: [],
        indexSignatures: [{ parameter, type: StringRepresentation }],
        checks: []
      })
      const pattern = SchemaRepresentation2.fromAST(
        Schema.String.check(Schema.isPattern(/^a/)).ast
      ).representation
      const output = SchemaRepresentation2.toJsonSchemaMultiDocument({
        representations: [
          record({ _tag: "Reference", $ref: "Pattern" }),
          record({ _tag: "Reference", $ref: "Cycle" })
        ],
        references: {
          Pattern: pattern,
          Cycle: { _tag: "Reference", $ref: "Cycle" }
        }
      })

      assert.deepStrictEqual(output.schemas, [
        {
          type: "object",
          patternProperties: { "^a": { type: "string" } }
        },
        {
          type: "object",
          additionalProperties: { type: "string" }
        }
      ])

      expectError(
        () =>
          SchemaRepresentation2.toJsonSchemaDocument({
            representation: record({ _tag: "Reference", $ref: "Missing" }),
            references: {}
          }),
        `Invalid reference Missing\n  at ["representation"]["indexSignatures"][0]["parameter"]["$ref"]`
      )
    })

    it("compiles all supported template-literal parts and rejects other nodes", () => {
      const representation: SchemaRepresentation2.LiveRepresentation = {
        _tag: "TemplateLiteral",
        parts: [
          { _tag: "Literal", literal: "p", checks: [] },
          NumberRepresentation,
          {
            _tag: "TemplateLiteral",
            parts: [
              { _tag: "Literal", literal: "x", checks: [] },
              StringRepresentation
            ],
            checks: []
          },
          {
            _tag: "Union",
            types: [
              { _tag: "Literal", literal: "a", checks: [] },
              { _tag: "Literal", literal: "b", checks: [] }
            ],
            mode: "anyOf",
            checks: []
          }
        ],
        checks: []
      }

      assert.deepStrictEqual(
        SchemaRepresentation2.toJsonSchemaDocument({ representation, references: {} }).schema,
        {
          type: "string",
          pattern: `^p${SchemaAST.FINITE_PATTERN}x${SchemaAST.STRING_PATTERN}a|b$`
        }
      )

      expectError(
        () =>
          SchemaRepresentation2.toJsonSchemaDocument({
            representation: {
              _tag: "TemplateLiteral",
              parts: [{ _tag: "Boolean", checks: [] }],
              checks: []
            },
            references: {}
          }),
        "Invalid schema representation document"
      )
    })

    it("extracts nested number types without losing other allOf members", () => {
      const output = SchemaRepresentation2.toJsonSchemaDocument({
        representation: {
          _tag: "Number",
          checks: [{
            _tag: "Filter",
            aborted: false,
            annotations: {
              toJsonSchema: () => ({
                allOf: [
                  {
                    description: "nested",
                    allOf: [{ type: "number" }, { minimum: 1 }]
                  },
                  { type: "integer", maximum: 10 },
                  { title: "kept" }
                ]
              })
            }
          }]
        },
        references: {}
      })

      assert.deepStrictEqual(output.schema, {
        type: "integer",
        allOf: [
          { description: "nested", allOf: [{ minimum: 1 }] },
          { maximum: 10 },
          { title: "kept" }
        ]
      })

      assert.deepStrictEqual(
        SchemaRepresentation2.toJsonSchemaDocument({
          representation: {
            _tag: "Number",
            checks: [{
              _tag: "Filter",
              aborted: false,
              annotations: {
                toJsonSchema: () => ({ allOf: [{ type: "number" }, { type: "number" }] })
              }
            }]
          },
          references: {}
        }).schema,
        { type: "number" }
      )
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
            "x-custom": { enabled: true },
            "x-invalid": () => "ignored"
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

    it("reports missing declaration callbacks", () => {
      const missing: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations> = {
        representation: {
          _tag: "Declaration",
          typeParameters: [],
          checks: []
        },
        references: {}
      }
      expectError(
        () => SchemaRepresentation2.toJsonSchemaDocument(missing),
        `Missing JSON Schema callback\n  at ["representation"]["annotations"]["toJsonSchema"]`
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
      expectError(
        () => SchemaRepresentation2.toJsonSchemaDocument(document),
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
      expectError(
        () => SchemaRepresentation2.toJsonSchemaDocument(document),
        `Invalid reference Missing\n  at ["representation"]["$ref"]`
      )
    })
  })

  describe("code generation", () => {
    it("compiles an empty union as Never", () => {
      assert.deepStrictEqual(
        SchemaRepresentation2.toCodeDocument({
          representations: [EmptyUnionRepresentation],
          references: {}
        }).codes,
        [{ runtime: "Schema.Never", Type: "never" }]
      )
    })

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

    it("skips unsafe annotation trees without evaluating accessors", () => {
      let reads = 0
      const nullPrototype = Object.create(null)
      nullPrototype.value = 1
      const cycle: Record<string, unknown> = {}
      cycle.self = cycle
      const exotic = Object.assign(Object.create({}), { value: 1 })
      const withSymbol = { value: 1 }
      Object.defineProperty(withSymbol, Symbol("hidden"), { value: 2, enumerable: true })
      const withAccessor = {}
      Object.defineProperty(withAccessor, "value", {
        enumerable: true,
        get() {
          reads++
          return "not read"
        }
      })
      const annotations: Record<PropertyKey, unknown> = {
        safe: { nil: null, nested: [true, { value: "ok" }] },
        nullPrototype,
        localSymbol: Symbol("local"),
        cycle,
        exotic,
        withSymbol,
        withAccessor,
        nonEmittableNested: { value: 1, callback: () => 2 },
        nonEmittableArray: [1, () => 2],
        sparse: new Array(1)
      }
      Object.defineProperty(annotations, "topAccessor", {
        enumerable: true,
        get() {
          reads++
          return "not read"
        }
      })
      Object.defineProperty(annotations, "hidden", { value: "hidden", enumerable: false })
      Object.defineProperty(annotations, Symbol("annotation"), { value: "hidden", enumerable: true })

      const output = SchemaRepresentation2.toCodeDocument({
        representations: [{
          _tag: "String",
          annotations,
          checks: []
        }],
        references: {}
      })

      assert.strictEqual(
        output.codes[0].runtime,
        `Schema.String.annotate({ "safe": { "nil": null, "nested": [true, { "value": "ok" }] }, "nullPrototype": { "value": 1 } })`
      )
      assert.strictEqual(reads, 0)
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

    it("reports missing generation callbacks and preserves callback exceptions", () => {
      const missing: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [{
          _tag: "String",
          checks: [{ _tag: "Filter", aborted: false }]
        }],
        references: {}
      }
      expectError(
        () => SchemaRepresentation2.toCodeDocument(missing),
        `Missing generation callback\n  at ["representations"][0]["checks"][0]["annotations"]["generation"]`
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
      expectError(
        () => SchemaRepresentation2.toCodeDocument(throwing),
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

    it("generates non-JSON content schemas, optional pre-rest elements and numeric properties", () => {
      const output = SchemaRepresentation2.toCodeDocument({
        representations: [
          {
            _tag: "String",
            contentMediaType: "text/plain",
            contentSchema: NumberRepresentation,
            checks: []
          },
          {
            _tag: "Arrays",
            elements: [{
              type: StringRepresentation,
              isOptional: true
            }],
            rest: [NumberRepresentation],
            checks: []
          },
          {
            _tag: "Objects",
            propertySignatures: [{
              name: 1,
              type: { _tag: "Boolean", checks: [] },
              isOptional: false,
              isMutable: false
            }],
            indexSignatures: [],
            checks: []
          }
        ],
        references: {}
      })

      assert.deepStrictEqual(output.codes, [
        {
          runtime:
            `Schema.String.annotate({ "contentMediaType": "text/plain", "contentSchema": SchemaAST.toEncoded(Schema.Number.ast) })`,
          Type: "string"
        },
        {
          runtime: `Schema.TupleWithRest(Schema.Tuple([Schema.optionalKey(Schema.String)]), [Schema.Number])`,
          Type: `readonly [string?, ...Array<number>]`
        },
        {
          runtime: `Schema.Struct({ 1: Schema.Boolean })`,
          Type: `{ readonly 1: boolean }`
        }
      ])
      assert.deepStrictEqual(output.artifacts, [{
        _tag: "Import",
        importDeclaration: `import * as SchemaAST from "effect/SchemaAST"`
      }])
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

    it("sanitizes ASCII and non-ASCII reference identifiers", () => {
      for (
        const [input, expected] of [
          ["abc", "Abc"],
          ["1a", "_1a"],
          ["a-b", "A_b"],
          ["café", "Caf_"],
          ["你好", "__"],
          ["🤖", "_"]
        ]
      ) {
        const output = SchemaRepresentation2.toCodeDocument({
          representations: [StringRepresentation],
          references: { [input]: NumberRepresentation }
        })
        assert.strictEqual(output.references.nonRecursives[0].$ref, expected)
      }
    })

    it("reports missing references with their document path", () => {
      const document: SchemaRepresentation2.MultiDocument<SchemaRepresentation2.LiveAnnotations> = {
        representations: [{ _tag: "Reference", $ref: "Missing" }],
        references: {}
      }
      expectError(
        () => SchemaRepresentation2.toCodeDocument(document),
        `Invalid reference Missing\n  at ["representations"][0]["$ref"]`
      )
    })
  })
})
