import { assert, describe, it } from "@effect/vitest"
import { Schema, SchemaRepresentation2 } from "effect"
import * as InternalRepresentation from "effect/internal/schema/representation2"

function project(
  document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations>
): SchemaRepresentation2.Document<SchemaRepresentation2.PersistedAnnotations> {
  const result = InternalRepresentation.projectDocument(document)
  if (result._tag === "Failure") {
    assert.fail(`Unexpected projection failure: ${result.issue._tag}`)
  }
  return result.value
}

function projectFailure(
  document: SchemaRepresentation2.Document<SchemaRepresentation2.LiveAnnotations>
): SchemaRepresentation2.SchemaRepresentationIssue {
  const result = InternalRepresentation.projectDocument(document)
  if (result._tag === "Success") {
    assert.fail("Expected projection to fail")
  }
  return result.issue
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
    assert.deepStrictEqual(projectFailure(SchemaRepresentation2.fromAST(declaration.ast)), {
      _tag: "MissingRepresentation",
      path: ["representation", "annotations", "representation"]
    })

    const check = Schema.makeFilter<string>(() => true, { description: "custom" })
    assert.deepStrictEqual(
      projectFailure(SchemaRepresentation2.fromAST(Schema.String.check(check).ast)),
      {
        _tag: "MissingRepresentation",
        path: ["representation", "checks", 0, "annotations", "representation"]
      }
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

    assert.deepStrictEqual(
      projectFailure(SchemaRepresentation2.fromAST(Schema.String.check(check).ast)),
      {
        _tag: "InvalidRepresentationPayload",
        id: "acme/schema/accessor",
        path: ["representation", "checks", 0, "annotations", "representation", "payload"]
      }
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
      assert.deepStrictEqual(
        projectFailure(SchemaRepresentation2.fromAST(Schema.String.check(check).ast)),
        {
          _tag: "InvalidRepresentationPayload",
          id: "acme/schema/invalidPayload",
          path: ["representation", "checks", 0, "annotations", "representation", "payload"]
        }
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
    assert.deepStrictEqual(projectFailure(SchemaRepresentation2.fromAST(schema.ast)), {
      _tag: "InvalidStructuralValue",
      path: ["representation", "annotations", "representation"],
      actual: {
        id: "acme/schema/notAllowedHere",
        payload: null
      }
    })
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
    assert.deepStrictEqual(
      projectFailure(SchemaRepresentation2.fromAST(Schema.UniqueSymbol(localSymbol).ast)),
      {
        _tag: "InvalidStructuralValue",
        path: ["representation", "symbol"],
        actual: localSymbol
      }
    )
  })

  it("projects every root of a multi-document with root-specific paths", () => {
    const missing = Schema.String.check(Schema.makeFilter<string>(() => true))
    const result = InternalRepresentation.projectMultiDocument(
      SchemaRepresentation2.fromASTs([Schema.Number.ast, missing.ast])
    )
    assert.strictEqual(result._tag, "Failure")
    if (result._tag === "Failure") {
      assert.deepStrictEqual(result.issue, {
        _tag: "MissingRepresentation",
        path: ["representations", 1, "checks", 0, "annotations", "representation"]
      })
    }
  })
})
