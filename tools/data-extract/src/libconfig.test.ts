import { describe, it, expect } from "vitest";
import { parseConf, asObject, asArray } from "./libconfig.js";

describe("libconfig parser", () => {
  it("parses basic key/value with : and = separators", () => {
    const { value } = parseConf(`A: 1\nB = 2\nC: "hi"`);
    expect(value).toEqual({ A: 1, B: 2, C: "hi" });
  });

  it("strips // and /* */ comments outside strings", () => {
    const src = `
      // leading comment
      A: 1 // trailing
      /* block
         comment */
      B: 2
    `;
    expect(parseConf(src).value).toEqual({ A: 1, B: 2 });
  });

  it("captures <\" ... \"> long strings verbatim (trimmed)", () => {
    const src = `Script: <" itemheal rand(45,65),0; ">`;
    const o = asObject(parseConf(src).value);
    expect(o.Script).toBe("itemheal rand(45,65),0;");
  });

  it("does not treat // inside a long string as a comment", () => {
    const src = `Script: <" if (x) // not a comment\n bonus bStr,1; ">`;
    const o = asObject(parseConf(src).value);
    expect(String(o.Script)).toContain("// not a comment");
  });

  it("parses arrays [] and tuples () as arrays", () => {
    const o = asObject(parseConf(`Attack: [8, 1]\nElement: ("Ele_Water", 1)`).value);
    expect(o.Attack).toEqual([8, 1]);
    expect(o.Element).toEqual(["Ele_Water", 1]);
  });

  it("tolerates trailing commas", () => {
    const o = asObject(parseConf(`L: [1, 2, 3,]\nO: { a: 1, b: 2, }`).value);
    expect(o.L).toEqual([1, 2, 3]);
    expect(o.O).toEqual({ a: 1, b: 2 });
  });

  it("keeps the first occurrence of duplicate keys and warns", () => {
    const { value, warnings } = parseConf(`Drops: { Apple: 1000, Apple: 150 }`);
    const drops = asObject(asObject(value).Drops);
    expect(drops.Apple).toBe(1000);
    expect(warnings.some((w) => w.includes("Apple"))).toBe(true);
  });

  it("handles barewords that start with a digit (the regression)", () => {
    // mob drop "3rd_Floor_Pass" and skill weapon types "1HSwords"
    const o = asObject(parseConf(`Drops: { 3rd_Floor_Pass: 1000 }\nW: { 1HSwords: true, 2HMaces: false }`).value);
    expect(asObject(o.Drops)["3rd_Floor_Pass"]).toBe(1000);
    expect(asObject(o.W)["1HSwords"]).toBe(true);
    expect(asObject(o.W)["2HMaces"]).toBe(false);
  });

  it("parses negative numbers and hex", () => {
    const o = asObject(parseConf(`Range: -1\nMask: 0x1F`).value);
    expect(o.Range).toBe(-1);
    expect(o.Mask).toBe(31);
  });

  it("parses a top-level array wrapper like db: ( {...}, {...} )", () => {
    const src = `mob_db: (\n { Id: 1, Name: "A" },\n { Id: 2, Name: "B" },\n)`;
    const list = asArray(asObject(parseConf(src).value).mob_db);
    expect(list).toHaveLength(2);
    expect(asObject(list[0]).Id).toBe(1);
  });

  it("parses nested objects (Stats)", () => {
    const o = asObject(parseConf(`Stats: { Str: 6, Agi: 1 }`).value);
    expect(o.Stats).toEqual({ Str: 6, Agi: 1 });
  });
});
