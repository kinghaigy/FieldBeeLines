import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SymbolNode = { symbol: string };
type Form = string | number | SymbolNode | Form[];
type Value = null | true | string | number | SymbolNode | Value[];
type Token = { kind: "punctuation" | "string" | "atom"; text: string };
type LayerRecord = Array<[number, number]>;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/.test(character)) {
      cursor++;
    } else if (character === ";") {
      while (cursor < source.length && source[cursor] !== "\n") cursor++;
    } else if ("()'".includes(character)) {
      tokens.push({ kind: "punctuation", text: character });
      cursor++;
    } else if (character === '"') {
      cursor++;
      let text = "";
      let closed = false;
      while (cursor < source.length) {
        const next = source[cursor++];
        if (next === '"') {
          closed = true;
          break;
        }
        if (next === "\\") {
          if (cursor === source.length) throw new Error("Unterminated escape");
          const escape = source[cursor++];
          text += ({ n: "\n", r: "\r", t: "\t" } as Record<string, string>)[escape] ?? escape;
        } else {
          text += next;
        }
      }
      if (!closed) throw new Error("Unterminated string");
      tokens.push({ kind: "string", text });
    } else {
      const start = cursor;
      while (cursor < source.length && !/[\s()';"]/.test(source[cursor])) cursor++;
      tokens.push({ kind: "atom", text: source.slice(start, cursor) });
    }
  }
  return tokens;
}

function parse(source: string): Form[] {
  const tokens = tokenize(source);
  let cursor = 0;
  function read(): Form {
    const token = tokens[cursor++];
    if (!token) throw new Error("Unexpected end of form");
    if (token.kind === "string") return token.text;
    if (token.kind === "atom") {
      return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token.text)
        ? Number(token.text)
        : { symbol: token.text.toLowerCase() };
    }
    if (token.text === "'") return [{ symbol: "quote" }, read()];
    if (token.text === ")") throw new Error("Unexpected closing parenthesis");
    const list: Form[] = [];
    while (tokens[cursor]?.text !== ")" || tokens[cursor]?.kind !== "punctuation") {
      if (cursor === tokens.length) throw new Error("Unclosed parenthesis");
      list.push(read());
    }
    cursor++;
    return list;
  }
  const forms: Form[] = [];
  while (cursor < tokens.length) forms.push(read());
  return forms;
}

function symbol(form: Form): string {
  if (typeof form !== "object" || Array.isArray(form)) throw new Error("Expected symbol");
  return form.symbol;
}

function list(form: Form): Form[] {
  if (!Array.isArray(form)) throw new Error("Expected list");
  return form;
}

function isCall(form: Form, name: string): form is Form[] {
  return Array.isArray(form) && typeof form[0] === "object" &&
    !Array.isArray(form[0]) && form[0].symbol === name.toLowerCase();
}

function walk(form: Form): Form[] {
  return [form, ...(Array.isArray(form) ? form.flatMap(walk) : [])];
}

const source = readFileSync(new URL("../BakeToDXF.lsp", import.meta.url), "utf8");
const forms = parse(source);

function definition(name: string): Form[] {
  const matches = forms.filter((form) => isCall(form, "defun") && symbol(form[1]) === name.toLowerCase());
  if (matches.length !== 1) throw new Error(`Expected one definition of ${name}`);
  return list(matches[0]);
}

function contains(form: Form, snippet: string): boolean {
  const expected = JSON.stringify(parse(snippet)[0]);
  return walk(form).some((node) => JSON.stringify(node) === expected);
}

function calls(form: Form, name: string): Form[][] {
  return walk(form).filter((node): node is Form[] => isCall(node, name));
}

const truthy = (value: Value): boolean => value !== null && !(Array.isArray(value) && value.length === 0);
const boolean = (value: boolean): Value => value ? true : null;

function executeHelper(name: string, argument: string, layers = new Map<string, LayerRecord>()): Value {
  if (!["btd:layervisiblep", "btd:unbindlayername"].includes(name.toLowerCase())) {
    throw new Error("Only the two pure helpers may be evaluated");
  }
  const helper = definition(name);
  const parameters = list(helper[2]).map(symbol);
  const separator = parameters.indexOf("/");
  if (separator !== 1) throw new Error("Expected one parameter and explicit local list");
  const environment = new Map<string, Value>([[parameters[0], argument]]);
  for (const local of parameters.slice(separator + 1)) environment.set(local, null);
  let remainingSteps = 10_000;
  const numeric = (value: Value): number => {
    if (typeof value !== "number") throw new Error("Expected number");
    return value;
  };
  const text = (value: Value): string => {
    if (typeof value !== "string") throw new Error("Expected string");
    return value;
  };
  function evaluate(form: Form): Value {
    if (--remainingSteps < 0) throw new Error("Helper evaluation safety limit exceeded");
    if (typeof form === "number" || typeof form === "string") return form;
    if (!Array.isArray(form)) {
      if (form.symbol === "nil") return null;
      if (form.symbol === "t") return true;
      if (!environment.has(form.symbol)) throw new Error(`Unknown variable ${form.symbol}`);
      return environment.get(form.symbol)!;
    }
    if (!form.length) return null;
    const operation = symbol(form[0]);
    const arguments_ = form.slice(1);
    if (operation === "quote") return arguments_[0];
    if (operation === "setq") {
      if (arguments_.length % 2) throw new Error("Odd setq argument count");
      let result: Value = null;
      for (let index = 0; index < arguments_.length; index += 2) {
        const variable = symbol(arguments_[index]);
        if (!environment.has(variable)) throw new Error(`Nonlocal assignment ${variable}`);
        result = evaluate(arguments_[index + 1]);
        environment.set(variable, result);
      }
      return result;
    }
    if (operation === "if") {
      const branch = truthy(evaluate(arguments_[0])) ? arguments_[1] : arguments_[2];
      return branch === undefined ? null : evaluate(branch);
    }
    if (operation === "and") {
      for (const argument_ of arguments_) if (!truthy(evaluate(argument_))) return null;
      return true;
    }
    if (operation === "progn") {
      let result: Value = null;
      for (const argument_ of arguments_) result = evaluate(argument_);
      return result;
    }
    if (operation === "while") {
      while (truthy(evaluate(arguments_[0]))) {
        for (const body of arguments_.slice(1)) evaluate(body);
      }
      return null;
    }
    const values = arguments_.map(evaluate);
    switch (operation) {
      case "not": return boolean(!truthy(values[0]));
      case "=": return boolean(values.every((value) => value === values[0]));
      case ">": return boolean(numeric(values[0]) > numeric(values[1]));
      case "1+": return numeric(values[0]) + 1;
      case "+": return values.reduce<number>((total, value) => total + numeric(value), 0);
      case "-": return values.length === 1 ? -numeric(values[0]) :
        values.slice(1).reduce<number>((total, value) => total - numeric(value), numeric(values[0]));
      case "logand": return values.map(numeric).reduce((result, value) => result & value);
      case "tblsearch":
        if (text(values[0]).toUpperCase() !== "LAYER") throw new Error("Only LAYER tables are mocked");
        return layers.get(text(values[1])) ?? null;
      case "assoc": {
        if (!Array.isArray(values[1])) throw new Error("Expected association list");
        return values[1].find((pair) => Array.isArray(pair) && pair[0] === values[0]) ?? null;
      }
      case "cdr": {
        if (values[0] === null) return null;
        if (!Array.isArray(values[0]) || values[0].length !== 2 || typeof values[0][0] !== "number") {
          throw new Error("Only numeric-key association pairs support cdr");
        }
        return values[0][1];
      }
      case "vl-string-search": {
        const position = text(values[1]).indexOf(text(values[0]), values.length === 3 ? numeric(values[2]) : 0);
        return position === -1 ? null : position;
      }
      case "substr": {
        const start = numeric(values[1]) - 1;
        const count = values.length === 3 ? numeric(values[2]) : undefined;
        if (start < 0 || (count !== undefined && count < 0)) throw new Error("Invalid substring range");
        return text(values[0]).slice(start, count === undefined ? undefined : start + count);
      }
      case "strlen": return text(values[0]).length;
      case "strcat": return values.map(text).join("");
      case "wcmatch":
        if (text(values[1]) !== "*[~0-9]*") throw new Error("Unsupported wildcard mock");
        return boolean(/[^0-9]/.test(text(values[0])));
      default: throw new Error(`Unsupported helper operation ${operation}`);
    }
  }
  let result: Value = null;
  for (const body of helper.slice(3)) result = evaluate(body);
  return result;
}

describe("limited Lisp source parser", () => {
  it("parses strings, escapes, comments, numbers, symbols, quotes and dotted quoted lists", () => {
    expect(parse('; ignored (\n(SETQ Name "a;()\\\"\\\\\\n" value -2.5) \'((70 . 1))')).toEqual([
      [{ symbol: "setq" }, { symbol: "name" }, 'a;()"\\\n', { symbol: "value" }, -2.5],
      [{ symbol: "quote" }, [[70, { symbol: "." }, 1]]],
    ]);
  });

  it.each(["(", ")", "(a))", "'", '"unfinished', '"escape\\'])('rejects malformed source %j', (text) => {
    expect(() => parse(text)).toThrow();
  });

  it("parses the complete actual source including nested definitions and quoted lambdas", () => {
    expect(forms.filter((form) => isCall(form, "defun"))).toHaveLength(6);
    expect(calls(definition("ProcessTextToStaticHeight"), "quote").length).toBeGreaterThan(0);
  });
});

describe("BTD:LayerVisibleP evaluated from actual source", () => {
  it.each([
    ["normal", 0, 7, true],
    ["frozen", 1, 7, false],
    ["off", 0, -7, false],
    ["locked", 4, 7, true],
    ["frozen and locked", 5, 7, false],
    ["zero color", 0, 0, false],
  ])("handles %s layers", (_label, flags, color, visible) => {
    const layers = new Map<string, LayerRecord>([["Layer", [[70, flags], [62, color]]]]);
    expect(executeHelper("BTD:LayerVisibleP", "Layer", layers)).toBe(visible ? true : null);
  });

  it("returns nil for an absent layer without evaluating numeric operations on nil", () => {
    expect(executeHelper("BTD:LayerVisibleP", "Missing")).toBeNull();
  });
});

describe("BTD:UnbindLayerName evaluated from actual source", () => {
  it.each([
    ["xref$0$Layer", "xref|Layer"],
    ["xref$0$nested$12$Layer", "xref|nested|Layer"],
    ["text$foo$", "text$foo$"],
    ["$$", "$$"],
    ["text$$Layer", "text$$Layer"],
    ["Layer", "Layer"],
    ["xref|Layer", "xref|Layer"],
    ["", ""],
    ["$0$Layer", "|Layer"],
    ["xref$12$", "xref|"],
    ["xref$01$Layer", "xref|Layer"],
    ["xref$1a$Layer", "xref$1a$Layer"],
    ["xref$-1$Layer", "xref$-1$Layer"],
    ["xref$0", "xref$0"],
    ["literal$foo$xref$0$Layer", "literal$foo$xref|Layer"],
  ])("maps %j to %j", (input, expected) => {
    expect(executeHelper("BTD:UnbindLayerName", input)).toBe(expected);
  });
});

describe("BakeToDXF source structure (not CAD runtime verification)", () => {
  const main = definition("c:BAKETODXF");
  const cleanup = calls(main, "defun").find((node) => symbol(node[1]) === "btd:cleanup")!;
  const error = calls(main, "defun").find((node) => symbol(node[1]) === "*error*")!;
  const mainBody: Form = main.slice(3).filter((node) => !isCall(node, "defun"));
  const rollback = "(vl-catch-all-apply 'command-s (list \"_.UNDO\" \"_Back\"))";

  it("localizes cleanup and error handlers and invokes cleanup from the error handler", () => {
    const locals = list(main[2]).map(symbol);
    expect(locals.indexOf("*error*")).toBeGreaterThan(locals.indexOf("/"));
    expect(locals.indexOf("btd:cleanup")).toBeGreaterThan(locals.indexOf("/"));
    expect(cleanup).toBeDefined();
    expect(contains(error, "(BTD:Cleanup)")).toBe(true);
  });

  it("uses command-s UNDO Back in cleanup and normal rollback, never command/vl-cmdf", () => {
    expect(contains(cleanup, rollback)).toBe(true);
    expect(contains(mainBody, rollback)).toBe(true);
    const backCalls = walk(main).filter((node) => Array.isArray(node) &&
      node.includes("_.UNDO") && node.includes("_Back"));
    expect(backCalls).toHaveLength(2);
    expect(backCalls.every((node) => isCall(node, "list"))).toBe(true);
    expect(calls(main, "if").some((node) => symbol(node[1]) === "undomarked" && contains(node, rollback))).toBe(true);
  });

  it("exports to temp, verifies nonempty output, rolls back, then renames to the destination", () => {
    const sequence = walk(mainBody);
    const position = (snippet: string): number => {
      const expected = JSON.stringify(parse(snippet)[0]);
      const index = sequence.findIndex((node) => JSON.stringify(node) === expected);
      expect(index, snippet).toBeGreaterThanOrEqual(0);
      return index;
    };
    const exported = position('(vl-cmdf "_.DXFOUT" tempPath "6")');
    const checked = position('(if (or (not (findfile tempPath)) (not (> (vl-file-size tempPath) 0))) (progn (princ "\\nDXFOUT did not produce a nonempty DXF. Destination left unchanged.") (exit)))');
    const undone = position(rollback);
    const rollbackChecked = position('(if (vl-catch-all-error-p rollbackResult) (progn (princ "\\nWARNING: Rollback failed. Inspect the drawing and use UNDO manually; destination left unchanged.") (exit)))');
    const backedUp = position("(vl-file-rename dxfPath backupPath)");
    const published = position("(vl-file-rename tempPath dxfPath)");
    expect(exported).toBeLessThan(checked);
    expect(checked).toBeLessThan(undone);
    expect(undone).toBeLessThan(rollbackChecked);
    expect(rollbackChecked).toBeLessThan(backedUp);
    expect(backedUp).toBeLessThan(published);
  });

  it("does not delete the destination, including through catch-all apply", () => {
    const direct = calls(main, "vl-file-delete");
    expect(direct.length).toBeGreaterThan(0);
    for (const deletion of direct) expect(symbol(deletion[1])).not.toBe("dxfpath");
    expect(contains(main, "(vl-catch-all-apply 'vl-file-delete (list dxfPath))")).toBe(false);
    expect(contains(cleanup, "(vl-catch-all-apply 'vl-file-rename (list backupPath dxfPath))")).toBe(true);
  });

  it("collects hidden objects and hatches during enumeration and deletes only afterwards", () => {
    const prune = definition("BTD:PruneHiddenGeometry");
    const body = prune.slice(3);
    const enumeration = body.findIndex((node) => isCall(node, "vlax-for"));
    const deletion = body.findIndex((node) => isCall(node, "foreach"));
    expect(enumeration).toBeGreaterThanOrEqual(0);
    expect(deletion).toBeGreaterThan(enumeration);
    expect(contains(body[enumeration], '(if (or (not (BTD:LayerVisibleP layerName)) (= (cdr (assoc 0 entData)) "HATCH")) (setq objects (cons obj objects)))')).toBe(true);
    expect(contains(body[enumeration], '(= (vla-get-IsXRef blk) :vlax-false)')).toBe(true);
    expect(calls(body[enumeration], "vl-catch-all-apply")).toHaveLength(0);
    expect(contains(body[deletion], "(vl-catch-all-apply 'vla-Delete (list obj))")).toBe(true);
    expect(list(body[deletion]).slice(1, 3).map(symbol)).toEqual(["obj", "objects"]);
  });

  it("guards text, inserts and attributes with their own visible-layer checks", () => {
    const text = definition("ProcessTextToStaticHeight");
    const conditions = calls(text, "if");
    for (const receiver of ["obj", "insertObj", "att"]) {
      expect(conditions.some((node) => contains(node[1], `(BTD:LayerVisibleP (vla-get-Layer ${receiver}))`) &&
        contains(node[2], "(vl-catch-all-apply 'vla-put-Height (list obj 0.15))".replace("list obj", `list ${receiver === "insertObj" ? "att" : receiver}`)))).toBe(true);
    }
  });

  it("records hidden layers, restores bound hidden names, and unlocks both layer passes before pruning", () => {
    const loops = calls(mainBody, "vlax-for").filter((node) => contains(node, "(vla-get-Layers doc)"));
    expect(loops).toHaveLength(2);
    expect(contains(loops[0], "(if (not (BTD:LayerVisibleP layerName)) (setq hiddenLayers (cons layerName hiddenLayers)))")).toBe(true);
    expect(contains(loops[1], "(or (member layerName hiddenLayers) (and (not (member layerName sourceLayers)) (member (BTD:UnbindLayerName layerName) hiddenLayers)))")).toBe(true);
    expect(contains(loops[1], "(vl-catch-all-apply 'vla-put-LayerOn (list layer :vlax-false))")).toBe(true);
    for (const loop of loops) {
      expect(calls(loop, "if").some((node) => contains(node[1], "(= (vla-get-Lock layer) :vlax-true)") &&
        contains(node[2], "(vl-catch-all-apply 'vla-put-Lock (list layer :vlax-false))"))).toBe(true);
    }
    const sequence = walk(mainBody);
    const prunes = calls(mainBody, "BTD:PruneHiddenGeometry");
    expect(prunes).toHaveLength(2);
    expect(sequence.indexOf(loops[0])).toBeLessThan(sequence.indexOf(prunes[0]));
    expect(sequence.indexOf(prunes[0])).toBeLessThan(sequence.indexOf(loops[1]));
    expect(sequence.indexOf(loops[1])).toBeLessThan(sequence.indexOf(prunes[1]));
  });
});