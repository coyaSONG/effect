import { assert, describe, it } from "@effect/vitest"
import { Schema, SchemaRepresentation2 } from "effect"
import * as InternalRepresentation from "effect/internal/schema/representation2"
import { throws } from "../../utils/assert.ts"

function project(
  document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations>
): SchemaRepresentation2.Document<SchemaRepresentation2.PersistedAnnotations> {
  return InternalRepresentation.projectDocument(document)
}

function projectErrorMessage(
  document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations>
): string {
  let message: string | undefined
  throws(() => InternalRepresentation.projectDocument(document), (error: unknown) => {
    assert.instanceOf(error, Error)
    message = error.message
    return undefined
  })
  assert.isDefined(message)
  return message
}

describe("SchemaRepresentation2 JSON projection", () => {
  it("projects a custom check identity and removes live callbacks", () => {
    const payload = { expected: "a" }
    const marker = () => "live"
    const check = Schema.makeFilter<"a">(() => true, {
      description: "is a",
      marker,
      representation: {
        id: "acme/schema/isA",
        payload,
        schemas: [Schema.Number.ast]
      },
      generation: () => ({ runtime: "Schema.makeFilter(() => true)" }),
      toJsonSchema: () => ({ const: "a" })
    }).abort()

    const representation = project(
      SchemaRepresentation2.fromAST(Schema.Literal("a").check(check).ast)
    ).representation
    assert.strictEqual(representation._tag, "Literal")
    if (representation._tag !== "Literal") {
      return
    }
    const persistedCheck = representation.checks[0]
    assert.strictEqual(persistedCheck._tag, "Filter")
    if (persistedCheck._tag !== "Filter") {
      return
    }

    assert.isTrue(persistedCheck.aborted)
    assert.deepStrictEqual(persistedCheck.annotations, {
      description: "is a",
      representation: {
        id: "acme/schema/isA",
        payload: { expected: "a" },
        schemas: [{ _tag: "Number", checks: [] }]
      }
    })
    assert.isFalse("marker" in (persistedCheck.annotations ?? {}))
    assert.isFalse("generation" in (persistedCheck.annotations ?? {}))
    assert.isFalse("toJsonSchema" in (persistedCheck.annotations ?? {}))

    payload.expected = "changed"
    assert.deepStrictEqual(persistedCheck.annotations?.representation?.payload, { expected: "a" })
  })

  it("projects a custom declaration without encoded-side state", () => {
    const schema = Schema.declare<string>((input): input is string => typeof input === "string", {
      description: "custom string",
      representation: {
        id: "acme/schema/CustomString",
        payload: null
      },
      generation: () => ({ runtime: "CustomString", Type: "string" }),
      toJsonSchema: () => ({ type: "string" })
    })

    const representation = project(SchemaRepresentation2.fromAST(schema.ast)).representation
    assert.strictEqual(representation._tag, "Declaration")
    if (representation._tag !== "Declaration") {
      return
    }
    assert.deepStrictEqual(representation.annotations, {
      description: "custom string",
      representation: {
        id: "acme/schema/CustomString",
        payload: null
      }
    })
    assert.isFalse("encodedSchema" in representation)
  })

  it("requires identities on declarations and leaf checks", () => {
    const declaration = Schema.declare<string>((input): input is string => typeof input === "string")
    assert.strictEqual(
      projectErrorMessage(SchemaRepresentation2.fromAST(declaration.ast)),
      `Missing representation annotation\n  at ["representation"]["annotations"]["representation"]`
    )

    const check = Schema.makeFilter<string>(() => true, { description: "custom" })
    assert.strictEqual(
      projectErrorMessage(SchemaRepresentation2.fromAST(Schema.String.check(check).ast)),
      `Missing representation annotation\n  at ["representation"]["checks"][0]["annotations"]["representation"]`
    )
  })

  it("copies strict JSON annotations and omits invalid annotations atomically", () => {
    const shared = { value: "before" }
    const dag = { left: shared, right: shared }
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    const sparse = new Array<unknown>(1)
    const withBigInt = { nested: { value: 1n } }
    const withUndefined = { nested: undefined }

    const representation = project(SchemaRepresentation2.fromAST(
      Schema.String.annotate({
        strings: ["1", "Symbol(a)", "NaN"],
        dag,
        cycle,
        sparse,
        withBigInt,
        withUndefined
      }).ast
    )).representation
    assert.strictEqual(representation._tag, "String")
    if (representation._tag !== "String") {
      return
    }

    assert.deepStrictEqual(representation.annotations?.strings, ["1", "Symbol(a)", "NaN"])
    assert.deepStrictEqual(representation.annotations?.dag, {
      left: { value: "before" },
      right: { value: "before" }
    })
    assert.isFalse("cycle" in (representation.annotations ?? {}))
    assert.isFalse("sparse" in (representation.annotations ?? {}))
    assert.isFalse("withBigInt" in (representation.annotations ?? {}))
    assert.isFalse("withUndefined" in (representation.annotations ?? {}))

    const copiedDag = representation.annotations?.dag as {
      readonly left: { readonly value: string }
      readonly right: { readonly value: string }
    }
    assert.notStrictEqual(copiedDag.left, copiedDag.right)
    shared.value = "changed"
    assert.strictEqual(copiedDag.left.value, "before")
  })

  it("copies only strict JSON containers without evaluating accessors", () => {
    let calls = 0
    const arrayWithAccessor = [0]
    Object.defineProperty(arrayWithAccessor, "0", {
      enumerable: true,
      configurable: true,
      get() {
        calls++
        return 1
      }
    })
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const withSymbol = {}
    Object.defineProperty(withSymbol, Symbol("key"), { value: 1, enumerable: true })
    const withNonEnumerable = {}
    Object.defineProperty(withNonEnumerable, "hidden", { value: 1, enumerable: false })

    for (
      const input of [
        cycle,
        new Array(1),
        arrayWithAccessor,
        Object.assign(Object.create({}), { value: 1 }),
        withSymbol,
        withNonEnumerable
      ]
    ) {
      assert.strictEqual(InternalRepresentation.copyStrictJson(input)._tag, "Failure")
    }
    assert.strictEqual(calls, 0)

    const input = Object.assign(Object.create(null), { value: [null, true, 1, "a"] })
    const copied = InternalRepresentation.copyStrictJson(input)
    assert.strictEqual(copied._tag, "Success")
    if (copied._tag === "Success") {
      assert.strictEqual(Object.getPrototypeOf(copied.value), null)
      assert.deepStrictEqual((copied.value as { readonly value: unknown }).value, [null, true, 1, "a"])
    }
  })

  it("does not invoke accessors while filtering generic annotations", () => {
    let calls = 0
    const accessor = {}
    Object.defineProperty(accessor, "value", {
      enumerable: true,
      get() {
        calls++
        return "unexpected"
      }
    })

    const representation = project(SchemaRepresentation2.fromAST(
      Schema.String.annotate({
        accessor,
        title: "kept"
      }).ast
    )).representation
    assert.strictEqual(calls, 0)
    assert.strictEqual(representation._tag, "String")
    if (representation._tag !== "String") {
      return
    }
    assert.strictEqual(representation.annotations?.title, "kept")
    assert.isFalse("accessor" in (representation.annotations ?? {}))
  })

  it("rejects invalid payloads without invoking accessors", () => {
    let calls = 0
    const payload = {}
    Object.defineProperty(payload, "value", {
      enumerable: true,
      get() {
        calls++
        return "unexpected"
      }
    })
    const check = Schema.makeFilter<string>(() => true, {
      representation: {
        id: "acme/schema/accessor",
        payload: payload as never
      }
    })

    assert.strictEqual(
      projectErrorMessage(SchemaRepresentation2.fromAST(Schema.String.check(check).ast)),
      `Invalid representation payload for acme/schema/accessor\n  at ["representation"]["checks"][0]["annotations"]["representation"]["payload"]`
    )
    assert.strictEqual(calls, 0)
  })

  it("rejects exceptional and non-JSON payload leaves", () => {
    for (const payload of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 1n]) {
      const check = Schema.makeFilter<string>(() => true, {
        representation: {
          id: "acme/schema/invalidPayload",
          payload: payload as never
        }
      })
      assert.strictEqual(
        projectErrorMessage(SchemaRepresentation2.fromAST(Schema.String.check(check).ast)),
        `Invalid representation payload for acme/schema/invalidPayload\n  at ["representation"]["checks"][0]["annotations"]["representation"]["payload"]`
      )
    }
  })

  it("rejects the reserved identity on structural nodes", () => {
    const schema = Schema.String.annotate({
      representation: {
        id: "acme/schema/notAllowedHere",
        payload: null
      }
    })
    assert.strictEqual(
      projectErrorMessage(SchemaRepresentation2.fromAST(schema.ast)),
      `Invalid structural value\n  at ["representation"]["annotations"]["representation"]`
    )
  })

  it("keeps group children and allows the group identity to be absent", () => {
    const first = Schema.makeFilter<string>(() => true, {
      representation: { id: "acme/schema/first", payload: null }
    })
    const second = Schema.makeFilter<string>(() => true, {
      representation: { id: "acme/schema/second", payload: null }
    }).abort()
    const group = Schema.makeFilterGroup([first, second], { description: "both" })

    const representation = project(
      SchemaRepresentation2.fromAST(Schema.String.check(group).ast)
    ).representation
    assert.strictEqual(representation._tag, "String")
    if (representation._tag !== "String") {
      return
    }
    assert.deepStrictEqual(representation.checks, [{
      _tag: "FilterGroup",
      annotations: { description: "both" },
      checks: [
        {
          _tag: "Filter",
          annotations: {
            representation: { id: "acme/schema/first", payload: null }
          },
          aborted: false
        },
        {
          _tag: "Filter",
          annotations: {
            representation: { id: "acme/schema/second", payload: null }
          },
          aborted: true
        }
      ]
    }])
  })

  it("rejects malformed representation nodes with exact paths", () => {
    const identity = { id: "acme/schema/check", payload: null }
    const filter = {
      _tag: "Filter",
      annotations: { representation: identity },
      aborted: false
    }
    const cyclic: any = { _tag: "Union", types: [], mode: "anyOf", checks: [] }
    cyclic.types.push(cyclic)
    const sparseTypes = new Array<SchemaRepresentation2.LiveRepresentation>(1)
    const invalid = (path: string) => `Invalid structural value\n  at ${path}`
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["non-object root", null, invalid(`["representation"]`)],
      ["cyclic representation", cyclic, invalid(`["representation"]["types"][0]`)],
      ["empty reference", { _tag: "Reference", $ref: "" }, invalid(`["representation"]["$ref"]`)],
      ["unknown tag", { _tag: "Missing" }, invalid(`["representation"]["_tag"]`)],
      [
        "non-empty Suspend checks",
        { _tag: "Suspend", thunk: { _tag: "String", checks: [] }, checks: [filter] },
        invalid(`["representation"]["checks"]`)
      ],
      [
        "invalid content media type",
        { _tag: "String", contentMediaType: 1, checks: [] },
        invalid(`["representation"]["contentMediaType"]`)
      ],
      [
        "invalid literal",
        { _tag: "Literal", literal: null, checks: [] },
        invalid(`["representation"]["literal"]`)
      ],
      [
        "invalid enum entry",
        { _tag: "Enum", enums: [["A"]], checks: [] },
        invalid(`["representation"]["enums"][0]`)
      ],
      [
        "invalid enum value",
        { _tag: "Enum", enums: [["A", true]], checks: [] },
        invalid(`["representation"]["enums"][0]`)
      ],
      [
        "sparse union members",
        { _tag: "Union", types: sparseTypes, mode: "anyOf", checks: [] },
        invalid(`["representation"]["types"]`)
      ],
      [
        "invalid union mode",
        { _tag: "Union", types: [], mode: "invalid", checks: [] },
        invalid(`["representation"]["mode"]`)
      ],
      [
        "non-object tuple element",
        { _tag: "Arrays", elements: [null], rest: [], checks: [] },
        invalid(`["representation"]["elements"][0]`)
      ],
      [
        "invalid tuple optionality",
        {
          _tag: "Arrays",
          elements: [{ isOptional: "yes", type: { _tag: "String", checks: [] } }],
          rest: [],
          checks: []
        },
        invalid(`["representation"]["elements"][0]["isOptional"]`)
      ],
      [
        "non-object property",
        { _tag: "Objects", propertySignatures: [null], indexSignatures: [], checks: [] },
        invalid(`["representation"]["propertySignatures"][0]`)
      ],
      [
        "local-symbol property",
        {
          _tag: "Objects",
          propertySignatures: [{
            name: Symbol("local"),
            type: { _tag: "String", checks: [] },
            isOptional: false,
            isMutable: false
          }],
          indexSignatures: [],
          checks: []
        },
        invalid(`["representation"]["propertySignatures"][0]["name"]`)
      ],
      [
        "invalid property optionality",
        {
          _tag: "Objects",
          propertySignatures: [{
            name: "value",
            type: { _tag: "String", checks: [] },
            isOptional: "no",
            isMutable: false
          }],
          indexSignatures: [],
          checks: []
        },
        invalid(`["representation"]["propertySignatures"][0]["isOptional"]`)
      ],
      [
        "invalid property mutability",
        {
          _tag: "Objects",
          propertySignatures: [{
            name: "value",
            type: { _tag: "String", checks: [] },
            isOptional: false,
            isMutable: "no"
          }],
          indexSignatures: [],
          checks: []
        },
        invalid(`["representation"]["propertySignatures"][0]["isMutable"]`)
      ],
      [
        "non-object index signature",
        { _tag: "Objects", propertySignatures: [], indexSignatures: [null], checks: [] },
        invalid(`["representation"]["indexSignatures"][0]`)
      ],
      [
        "non-object check",
        { _tag: "String", checks: [null] },
        invalid(`["representation"]["checks"][0]`)
      ],
      [
        "invalid filter abort flag",
        {
          _tag: "String",
          checks: [{ ...filter, aborted: "no" }]
        },
        invalid(`["representation"]["checks"][0]["aborted"]`)
      ],
      [
        "empty filter group",
        { _tag: "String", checks: [{ _tag: "FilterGroup", checks: [] }] },
        invalid(`["representation"]["checks"][0]["checks"]`)
      ]
    ]

    for (const [name, representation, expected] of cases) {
      assert.strictEqual(
        projectErrorMessage({
          representation: representation as SchemaRepresentation2.LiveRepresentation,
          references: {}
        }),
        expected,
        name
      )
    }

    assert.deepStrictEqual(
      project({
        representation: { _tag: "Enum", enums: [["One", 1]], checks: [] },
        references: {}
      }).representation,
      { _tag: "Enum", enums: [["One", 1]], checks: [] }
    )
  })

  it("rejects malformed representation annotations without evaluating accessors", () => {
    let calls = 0
    const representationAccessor = {}
    Object.defineProperty(representationAccessor, "representation", {
      enumerable: true,
      get() {
        calls++
        return { id: "acme/schema/accessor", payload: null }
      }
    })
    const payloadAccessor = { id: "acme/schema/payloadAccessor" }
    Object.defineProperty(payloadAccessor, "payload", {
      enumerable: true,
      get() {
        calls++
        return null
      }
    })
    const schemasAccessor = { id: "acme/schema/schemasAccessor", payload: null }
    Object.defineProperty(schemasAccessor, "schemas", {
      enumerable: true,
      get() {
        calls++
        return []
      }
    })
    const symbolIdentity = { id: "acme/schema/symbol", payload: null }
    Object.defineProperty(symbolIdentity, Symbol("extra"), { value: true, enumerable: true })
    const structuralRepresentationAccessor = {}
    Object.defineProperty(structuralRepresentationAccessor, "representation", {
      enumerable: true,
      get() {
        calls++
        return { id: "acme/schema/structuralAccessor", payload: null }
      }
    })
    const invalid = (path: string) => `Invalid structural value\n  at ${path}`
    const annotationPath = `["representation"]["annotations"]`
    const identityPath = `${annotationPath}["representation"]`
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["non-object annotations", "invalid", invalid(annotationPath)],
      ["non-object identity", { representation: "invalid" }, invalid(identityPath)],
      [
        "extra identity key",
        { representation: { id: "acme/schema/extra", payload: null, extra: true } },
        invalid(`${identityPath}["extra"]`)
      ],
      [
        "empty identity",
        { representation: { id: "", payload: null } },
        invalid(`${identityPath}["id"]`)
      ],
      [
        "missing identity ID",
        { representation: { payload: null } },
        invalid(`${identityPath}["id"]`)
      ],
      ["symbol identity key", { representation: symbolIdentity }, invalid(identityPath)],
      [
        "missing payload",
        { representation: { id: "acme/schema/missingPayload" } },
        `Invalid representation payload for acme/schema/missingPayload\n  at ${identityPath}["payload"]`
      ],
      [
        "payload accessor",
        { representation: payloadAccessor },
        `Invalid representation payload\n  at ${identityPath}["payload"]`
      ],
      [
        "non-array schemas",
        { representation: { id: "acme/schema/schemas", payload: null, schemas: "invalid" } },
        invalid(`${identityPath}["schemas"]`)
      ],
      [
        "schemas accessor",
        { representation: schemasAccessor },
        invalid(`${identityPath}["schemas"]`)
      ],
      ["representation accessor", representationAccessor, invalid(identityPath)],
      [
        "undefined required identity",
        { representation: undefined },
        `Missing representation annotation\n  at ${identityPath}`
      ]
    ]

    for (const [name, annotations, expected] of cases) {
      assert.strictEqual(
        projectErrorMessage({
          representation: {
            _tag: "Declaration",
            typeParameters: [],
            checks: [],
            annotations: annotations as SchemaRepresentation2.LiveAnnotations["node"]
          },
          references: {}
        }),
        expected,
        name
      )
    }

    assert.strictEqual(
      projectErrorMessage({
        representation: {
          _tag: "String",
          annotations: structuralRepresentationAccessor,
          checks: []
        },
        references: {}
      }),
      invalid(identityPath)
    )

    const nullPrototypeIdentity = Object.assign(Object.create(null), {
      id: "acme/schema/nullPrototype",
      payload: null
    })
    const projectedDeclaration = project({
      representation: {
        _tag: "Declaration",
        typeParameters: [],
        checks: [],
        annotations: { representation: nullPrototypeIdentity }
      },
      references: {}
    }).representation
    assert.strictEqual(projectedDeclaration._tag, "Declaration")
    if (projectedDeclaration._tag === "Declaration") {
      assert.deepStrictEqual(projectedDeclaration.annotations?.representation, {
        id: "acme/schema/nullPrototype",
        payload: null
      })
    }

    const optionalGroup = project({
      representation: {
        _tag: "String",
        checks: [{
          _tag: "FilterGroup",
          annotations: { representation: undefined },
          checks: [{
            _tag: "Filter",
            aborted: false,
            annotations: { representation: { id: "acme/schema/child", payload: null } }
          }]
        }]
      },
      references: {}
    }).representation
    assert.strictEqual(optionalGroup._tag, "String")
    if (optionalGroup._tag === "String") {
      assert.isFalse("annotations" in optionalGroup.checks[0])
    }
    assert.strictEqual(calls, 0)
  })

  it("projects tuple and property annotations independently", () => {
    const schema = Schema.Tuple([
      Schema.String.annotateKey({ description: "tuple", callback: () => "live" }),
      Schema.Struct({
        value: Schema.Number.annotateKey({ description: "property", callback: () => "live" })
      })
    ])
    const representation = project(SchemaRepresentation2.fromAST(schema.ast)).representation
    assert.strictEqual(representation._tag, "Arrays")
    if (representation._tag !== "Arrays") {
      return
    }
    assert.deepStrictEqual(representation.elements[0].annotations, { description: "tuple" })
    const struct = representation.elements[1].type
    assert.strictEqual(struct._tag, "Objects")
    if (struct._tag !== "Objects") {
      return
    }
    assert.deepStrictEqual(struct.propertySignatures[0].annotations, { description: "property" })
  })

  it("preserves global symbols and rejects local symbols structurally", () => {
    const globalSymbol = Symbol.for("acme/schema/global")
    const globalRepresentation = project(
      SchemaRepresentation2.fromAST(Schema.UniqueSymbol(globalSymbol).ast)
    ).representation
    assert.strictEqual(globalRepresentation._tag, "UniqueSymbol")
    if (globalRepresentation._tag === "UniqueSymbol") {
      assert.strictEqual(globalRepresentation.symbol, globalSymbol)
    }

    const localSymbol = Symbol("local")
    assert.strictEqual(
      projectErrorMessage(SchemaRepresentation2.fromAST(Schema.UniqueSymbol(localSymbol).ast)),
      `Invalid structural value\n  at ["representation"]["symbol"]`
    )
  })

  it("projects every root of a multi-document with root-specific paths", () => {
    const missing = Schema.String.check(Schema.makeFilter<string>(() => true))
    throws(
      () =>
        InternalRepresentation.projectMultiDocument(
          SchemaRepresentation2.fromASTs([Schema.Number.ast, missing.ast])
        ),
      `Missing representation annotation\n  at ["representations"][1]["checks"][0]["annotations"]["representation"]`
    )
  })

  it("rejects malformed references and multi-document roots without evaluating accessors", () => {
    let calls = 0
    const accessorReferences = {}
    Object.defineProperty(accessorReferences, "Value", {
      enumerable: true,
      get() {
        calls++
        return { _tag: "String", checks: [] }
      }
    })
    const symbolReferences = {}
    Object.defineProperty(symbolReferences, Symbol("Value"), {
      value: { _tag: "String", checks: [] },
      enumerable: true
    })
    const invalid = (path: string) => `Invalid structural value\n  at ${path}`
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["non-object references", null, invalid(`["references"]`)],
      ["exotic references", Object.create({}), invalid(`["references"]`)],
      ["symbol reference key", symbolReferences, invalid(`["references"]`)],
      ["reference accessor", accessorReferences, invalid(`["references"]["Value"]`)],
      ["non-object reference value", { Value: null }, invalid(`["references"]["Value"]`)]
    ]

    for (const [name, references, expected] of cases) {
      assert.strictEqual(
        projectErrorMessage({
          representation: { _tag: "String", checks: [] },
          references: references as SchemaRepresentation2.References<SchemaRepresentation2.LiveAnnotations>
        }),
        expected,
        name
      )
    }
    assert.strictEqual(calls, 0)

    const nullPrototypeReferences = Object.assign(Object.create(null), {
      Value: { _tag: "String", checks: [] }
    })
    assert.deepStrictEqual(
      project({
        representation: { _tag: "Reference", $ref: "Value" },
        references: nullPrototypeReferences
      }).references,
      { Value: { _tag: "String", checks: [] } }
    )

    for (
      const [representations, expected] of [
        [[], invalid(`["representations"]`)],
        ["invalid", invalid(`["representations"]`)],
        [new Array(1), invalid(`["representations"]`)],
        [[null], invalid(`["representations"][0]`)]
      ] as const
    ) {
      throws(
        () =>
          InternalRepresentation.projectMultiDocument({
            representations: representations as any,
            references: {}
          }),
        expected
      )
    }
  })
})
