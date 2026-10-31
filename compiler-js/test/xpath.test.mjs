/**
 * The XPath subset where it could silently differ from XPath 3.1: what it accepts
 * must evaluate as XSLT's native XPath does, or fail with a message.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { xpath } from "../../runtime/xpath.mjs";
import { parseXmlToXast } from "../odd-parser.mjs";

/** @type {any} */
const context = { node: parseXmlToXast(`<p n="10" m="9"><a n="1"><b/></a><a n="2"><b/></a></p>`).children[0], up: [] };
/** @type {any} */
const inner = { node: context.node.children[1].children[0], up: [context.node, context.node.children[1]] };
const value = (expr, at = context) => xpath(expr)(at);

test("a path gives each node once, in document order", () => {
  assert.equal(value("count(a/..)"), 1);
  assert.equal(value("count(a/b/ancestor::*)"), 3);
  assert.equal(value("string(ancestor::*/@n)", inner), "10", "a reverse axis, outermost first");
  assert.equal(value("string(ancestor::*[1]/@n)", inner), "2", "though its predicates count from the nearest");
  assert.deepEqual(value("a/@n"), ["1", "2"], "equal attribute values stay distinct items");
  assert.deepEqual(value("(a/@n, a/@n)"), ["1", "2", "1", "2"], "a sequence keeps duplicates");
});

test("comparisons follow the types of their operands", () => {
  assert.equal(value("'a' lt 'b'"), true);
  assert.equal(value("'a' < 'b'"), true);
  assert.equal(value("@n < @m"), true, "two attributes compare as strings");
  assert.equal(value("@n < 11"), true, "against a number, as numbers");
  assert.equal(value("a/@n = 2"), true, "a general comparison takes any pair");
  assert.equal(value("() eq 1"), false, "an empty side compares to nothing");
  assert.throws(() => value("(1, 2) eq 2"), /XPath "\(1, 2\) eq 2": eq compares single items, not 2/);
  assert.throws(() => value("a/@n eq 1"), /eq compares single items/);
});

test("the effective Boolean value of a singleton is that of its item", () => {
  assert.equal(value("not((false(), ()))"), true);
  assert.equal(value("not((0, ()))"), true);
  assert.equal(value("not((true(), ()))"), false);
  assert.equal(value("not(@n)"), false, "an attribute exists");
  assert.equal(value("not(@e)", /** @type {any} */ ({ node: parseXmlToXast(`<p e=""/>`).children[0], up: [] })), false, "even empty");
});

test("functions take the arguments they declare, and no others", () => {
  assert.equal(value("replace('A', 'a', 'x', 'i')"), "x");
  assert.equal(value("replace('aa', 'a', 'x')"), "xx");
  assert.equal(value("string()", inner), "", "the context item, where an argument is optional");
  for (const [expr, why] of [["contains('a')", "contains() cannot take 1"], ["true(1)", "true() cannot take 1"], ["replace('a', 'b')", "replace() cannot take 2"], ["concat('a')", "concat() cannot take 1"]]) {
    assert.throws(() => xpath(expr), new RegExp(why.replace(/[()]/g, "\\$&")), expr);
  }
});
