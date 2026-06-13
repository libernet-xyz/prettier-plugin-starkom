// Copyright 2026 The Libernet Team
// SPDX-License-Identifier: Apache-2.0

import type { AstPath, Doc, Options, Plugin } from "prettier";
import { doc } from "prettier";
import { parse } from "@libernet/starkom";

import * as starkom_ast from "@libernet/starkom/ast";
import ast = starkom_ast.starkom.ast.v1;

// ---- Type aliases ----------------------------------------------------------------

type File = ReturnType<typeof parse>;
type ExpressionNode = File["expressions"][number];
type StatementNode = File["statements"][number];
type Declaration = NonNullable<NonNullable<StatementNode["declaration"]>["declarations"]>[number];
type PostfixExpression = NonNullable<
  NonNullable<ExpressionNode["postfixChain"]>["postfix"]
>[number];
type TemplateDefinition = NonNullable<File["definitions"][number]["templateDefinition"]>;
type FunctionDefinition = NonNullable<File["definitions"][number]["functionDefinition"]>;
type MainComponent = NonNullable<File["mainComponent"]>;

// ---- Prettier doc builders -------------------------------------------------------

const { hardline, softline, line, group, indent, join, ifBreak } = doc.builders;

// ---- Enum constants (matching proto values) --------------------------------------

const TokenType = ast.Token.Type;

interface Comment {
  readonly offset: number;
  readonly endOffset: number;
  readonly label: string;
  readonly isLineComment: boolean;
}

const DeclarationType = ast.DeclarationStatement.Type;
const DeclarationModifier = ast.DeclarationStatement.Modifier;
const AssignmentDirection = ast.AssignmentDirection;
const InfixType = ast.InfixExpression.Type;
const AssignType = ast.AssignExpression.Type;
const PrefixType = ast.PrefixChainExpression.Type;

const INFIX_SYMBOLS: Readonly<Record<number, string>> = {
  [InfixType.INFIX_EXPRESSION_TYPE_ADD]: "+",
  [InfixType.INFIX_EXPRESSION_TYPE_SUBTRACT]: "-",
  [InfixType.INFIX_EXPRESSION_TYPE_MULTIPLY]: "*",
  [InfixType.INFIX_EXPRESSION_TYPE_POWER]: "**",
  [InfixType.INFIX_EXPRESSION_TYPE_DIVIDE]: "/",
  [InfixType.INFIX_EXPRESSION_TYPE_DIVIDE_INTEGER]: "\\",
  [InfixType.INFIX_EXPRESSION_TYPE_MODULUS]: "%",
  [InfixType.INFIX_EXPRESSION_TYPE_LOGICAL_AND]: "&&",
  [InfixType.INFIX_EXPRESSION_TYPE_LOGICAL_OR]: "||",
  [InfixType.INFIX_EXPRESSION_TYPE_BITWISE_AND]: "&",
  [InfixType.INFIX_EXPRESSION_TYPE_BITWISE_OR]: "|",
  [InfixType.INFIX_EXPRESSION_TYPE_BITWISE_XOR]: "^",
  [InfixType.INFIX_EXPRESSION_TYPE_SHIFT_LEFT]: "<<",
  [InfixType.INFIX_EXPRESSION_TYPE_SHIFT_RIGHT]: ">>",
  [InfixType.INFIX_EXPRESSION_TYPE_LESS_THAN]: "<",
  [InfixType.INFIX_EXPRESSION_TYPE_LESS_THAN_OR_EQUAL_TO]: "<=",
  [InfixType.INFIX_EXPRESSION_TYPE_GREATER_THAN]: ">",
  [InfixType.INFIX_EXPRESSION_TYPE_GREATER_THAN_OR_EQUAL_TO]: ">=",
  [InfixType.INFIX_EXPRESSION_TYPE_EQUAL_TO]: "==",
  [InfixType.INFIX_EXPRESSION_TYPE_NOT_EQUAL_TO]: "!=",
};

const ASSIGN_SYMBOLS: Readonly<Record<number, string>> = {
  [AssignType.ASSIGNMENT_TYPE_SIMPLE]: "=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_ADD]: "+=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_SUBTRACT]: "-=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_MULTIPLY]: "*=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_POWER]: "**=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_DIVIDE]: "/=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_DIVIDE_INTEGER]: "\\=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_MODULUS]: "%=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_LOGICAL_AND]: "&&=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_LOGICAL_OR]: "||=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_BITWISE_AND]: "&=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_BITWISE_OR]: "|=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_BITWISE_XOR]: "^=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_SHIFT_LEFT]: "<<=",
  [AssignType.ASSIGNMENT_TYPE_COMPOUND_SHIFT_RIGHT]: ">>=",
};

const PREFIX_SYMBOLS: Readonly<Record<number, string>> = {
  [PrefixType.PREFIX_EXRESSION_INCREMENT]: "++",
  [PrefixType.PREFIX_EXRESSION_DECREMENT]: "--",
  [PrefixType.PREFIX_EXRESSION_LOGICAL_NOT]: "!",
  [PrefixType.PREFIX_EXRESSION_BITWISE_NOT]: "~",
  [PrefixType.PREFIX_EXRESSION_UNARY_PLUS]: "+",
  [PrefixType.PREFIX_EXRESSION_UNARY_MINUS]: "-",
};

// ---- Helpers --------------------------------------------------------------------

function mustExpression(file: File, idx: number): ExpressionNode {
  if (idx === 0) {
    throw new Error("Cannot print sentinel expression");
  }
  const node = file["expressions"][idx];
  if (!node) {
    throw new Error(`Expression index ${idx} out of range`);
  }
  return node;
}

function mustStatement(file: File, idx: number): StatementNode {
  if (idx === 0) {
    throw new Error("Cannot print sentinel statement");
  }
  const node = file["statements"][idx];
  if (!node) {
    throw new Error(`Statement index ${idx} out of range`);
  }
  return node;
}

// Returns the index, defaulting to 0 (sentinel) if absent.
function ref(idx: number | null | undefined): number {
  return idx ?? 0;
}

function hasRef(idx: number | null | undefined): boolean {
  return (idx ?? 0) !== 0;
}

function lineOf(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

function hasBlankLineBetweenOffsets(
  lineStarts: number[],
  offsetA: number,
  offsetB: number,
): boolean {
  if (!lineStarts || lineStarts.length === 0) {
    return false;
  }
  return lineOf(lineStarts, offsetB) - lineOf(lineStarts, offsetA) >= 2;
}

function buildComments(file: File): Comment[] {
  const result: Comment[] = [];
  for (const tok of file["tokens"] ?? []) {
    const offset = tok["offset"] ?? 0;
    const label = tok["label"] ?? "";
    if (tok["type"] === TokenType.TOKEN_TYPE_SINGLE_LINE_COMMENT) {
      result.push({ offset, endOffset: offset + label.length + 2, label, isLineComment: true });
    } else if (tok["type"] === TokenType.TOKEN_TYPE_MULTI_LINE_COMMENT) {
      result.push({ offset, endOffset: offset + label.length + 4, label, isLineComment: false });
    }
  }
  return result;
}

function commentsInRange(
  allComments: Comment[],
  startOffset: number,
  endOffset: number,
): Comment[] {
  return allComments.filter((c) => c.offset >= startOffset && c.offset < endOffset);
}

function printComment(comment: Comment): Doc {
  return comment.isLineComment ? `//${comment.label}` : `/*${comment.label}*/`;
}

function escapeString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\0/g, "\\0");
}

// ---- File -----------------------------------------------------------------------

function printFile(file: File): Doc {
  const comments = buildComments(file);
  const lineStarts = file["lineStarts"] ?? [];
  const sections: Doc[] = [];

  // Find the byte offset of the pragma keyword (first non-comment token).
  let pragmaOffset = 0;
  for (const tok of file["tokens"] ?? []) {
    const type = tok["type"] ?? 0;
    if (
      type !== TokenType.TOKEN_TYPE_SINGLE_LINE_COMMENT &&
      type !== TokenType.TOKEN_TYPE_MULTI_LINE_COMMENT
    ) {
      pragmaOffset = tok["offset"] ?? 0;
      break;
    }
  }

  const v = file["version"];
  const pragmaDoc: Doc = `pragma starkom ${v?.["major"] ?? 0}.${v?.["minor"] ?? 0}.${v?.["patch"] ?? 0};`;

  // Interleave any leading comments with the pragma using blank-line-aware separators.
  const preComments = commentsInRange(comments, 0, pragmaOffset);
  if (preComments.length === 0) {
    sections.push(pragmaDoc);
  } else {
    type FileLevelItem = { doc: Doc; startOffset: number; endOffset: number };
    const items: FileLevelItem[] = [
      ...preComments.map((c) => ({
        doc: printComment(c),
        startOffset: c.offset,
        endOffset: c.endOffset,
      })),
      { doc: pragmaDoc, startOffset: pragmaOffset, endOffset: pragmaOffset },
    ];
    const parts: Doc[] = [items[0]!.doc];
    for (let i = 1; i < items.length; i++) {
      const sep: Doc = hasBlankLineBetweenOffsets(
        lineStarts,
        items[i - 1]!.endOffset,
        items[i]!.startOffset,
      )
        ? [hardline, hardline]
        : hardline;
      parts.push(sep, items[i]!.doc);
    }
    sections.push(parts);
  }

  const includes = file["includes"] ?? [];
  if (includes.length > 0) {
    sections.push(
      join(
        hardline,
        includes.map((inc) => `include "${escapeString(inc)}";`),
      ),
    );
  }

  for (const def of file["definitions"] ?? []) {
    if (def["templateDefinition"]) {
      sections.push(printTemplate(file, def["templateDefinition"], comments));
    } else if (def["functionDefinition"]) {
      sections.push(printFunction(file, def["functionDefinition"], comments));
    }
  }

  if (file["mainComponent"]) {
    sections.push(printMainComponent(file, file["mainComponent"]));
  }

  return [join([hardline, hardline], sections), hardline];
}

// ---- Definitions ----------------------------------------------------------------

function formatParams(params: string[]): Doc {
  if (params.length === 0) return "()";
  return group(["(", indent([softline, join([",", line], params)]), softline, ")"]);
}

function printTemplate(file: File, t: TemplateDefinition, comments: Comment[]): Doc {
  return [
    "template ",
    t["name"] ?? "",
    formatParams(t["params"] ?? []),
    " ",
    printBlock(file, ref(t["bodyIndex"]), comments),
  ];
}

function printFunction(file: File, f: FunctionDefinition, comments: Comment[]): Doc {
  return [
    "function ",
    f["name"] ?? "",
    formatParams(f["params"] ?? []),
    " ",
    printBlock(file, ref(f["bodyIndex"]), comments),
  ];
}

function printMainComponent(file: File, mc: MainComponent): Doc {
  const sigs = mc["publicSignals"] ?? [];
  const pubPart: Doc = sigs.length > 0 ? [" { public [", join(", ", sigs), "] }"] : [];
  return ["component main", pubPart, " = ", printExpression(file, ref(mc["instantiation"])), ";"];
}

// ---- Statements -----------------------------------------------------------------

function printBlock(file: File, idx: number, comments: Comment[]): Doc {
  const node = mustStatement(file, idx);
  if (node["statement"] !== "block") {
    return ["{", indent([hardline, printStatement(file, idx, comments)]), hardline, "}"];
  }

  const statements = node["block"]?.["statements"] ?? [];
  const blockRange = node["range"];
  const blockStart = blockRange ? (blockRange["offset"] ?? 0) : 0;
  const blockEnd = blockRange ? blockStart + (blockRange["length"] ?? 0) : Infinity;
  const lineStarts = file["lineStarts"] ?? [];

  type Item =
    | { kind: "statement"; idx: number; startOffset: number; endOffset: number }
    | { kind: "comment"; comment: Comment };

  const statementItems: Item[] = statements.map((stmtIdx) => {
    const stmt = mustStatement(file, stmtIdx);
    const range = stmt["range"];
    const startOffset = range ? (range["offset"] ?? 0) : 0;
    const endOffset = range ? startOffset + (range["length"] ?? 0) : 0;
    return { kind: "statement" as const, idx: stmtIdx, startOffset, endOffset };
  });

  const blockComments = commentsInRange(comments, blockStart + 1, blockEnd);
  const commentItems: Item[] = blockComments.map((c) => ({ kind: "comment" as const, comment: c }));

  const items: Item[] = [...statementItems, ...commentItems].sort((a, b) => {
    const aOffset = a.kind === "statement" ? a.startOffset : a.comment.offset;
    const bOffset = b.kind === "statement" ? b.startOffset : b.comment.offset;
    return aOffset - bOffset;
  });

  if (items.length === 0) return "{}";

  const itemStartOffset = (item: Item): number =>
    item.kind === "statement" ? item.startOffset : item.comment.offset;
  const itemEndOffset = (item: Item): number =>
    item.kind === "statement" ? item.endOffset : item.comment.endOffset;
  const printItem = (item: Item): Doc =>
    item.kind === "statement"
      ? printStatement(file, item.idx, comments)
      : printComment(item.comment);

  const body: Doc[] = [printItem(items[0]!)];
  for (let i = 1; i < items.length; i++) {
    const separator: Doc = hasBlankLineBetweenOffsets(
      lineStarts,
      itemEndOffset(items[i - 1]!),
      itemStartOffset(items[i]!),
    )
      ? [hardline, hardline]
      : hardline;
    body.push(separator, printItem(items[i]!));
  }

  return ["{", indent([hardline, body]), hardline, "}"];
}

function printStatement(file: File, idx: number, comments: Comment[]): Doc {
  const node = mustStatement(file, idx);
  switch (node["statement"]) {
    case "empty":
      return ";";

    case "block":
      return printBlock(file, idx, comments);

    case "declaration":
      return [printDeclarationStatement(file, node["declaration"]!), ";"];

    case "expression":
      return [printExpression(file, ref(node["expression"]?.["expression"])), ";"];

    case "ifStatement": {
      const s = node["ifStatement"]!;
      const head: Doc = ["if (", printExpression(file, ref(s["condition"])), ") "];
      const then_: Doc = printBlock(file, ref(s["thenBranch"]), comments);
      if (!hasRef(s["elseBranch"])) {
        return [head, then_];
      }
      const elseNode = mustStatement(file, ref(s["elseBranch"]));
      if (elseNode["statement"] === "ifStatement") {
        // else-if chain: omit braces around the nested if
        return [head, then_, " else ", printStatement(file, ref(s["elseBranch"]), comments)];
      }
      return [head, then_, " else ", printBlock(file, ref(s["elseBranch"]), comments)];
    }

    case "whileLoopStatement": {
      const s = node["whileLoopStatement"]!;
      return [
        "while (",
        printExpression(file, ref(s["condition"])),
        ") ",
        printBlock(file, ref(s["body"]), comments),
      ];
    }

    case "doWhileLoopStatement": {
      const s = node["doWhileLoopStatement"]!;
      return [
        "do ",
        printBlock(file, ref(s["body"]), comments),
        " while (",
        printExpression(file, ref(s["condition"])),
        ");",
      ];
    }

    case "forLoopStatement": {
      const s = node["forLoopStatement"]!;
      const hasCondition = hasRef(s["condition"]);
      const hasStep = hasRef(s["step"]);
      const initializer: Doc = hasRef(s["initializer"])
        ? printForInit(file, ref(s["initializer"]), comments)
        : "";
      const condition: Doc = hasCondition ? [" ", printExpression(file, ref(s["condition"]))] : "";
      const step: Doc = hasStep ? [" ", printExpression(file, ref(s["step"]))] : "";
      return [
        "for (",
        initializer,
        ";",
        condition,
        ";",
        step,
        ") ",
        printBlock(file, ref(s["body"]), comments),
      ];
    }

    case "breakStatement":
      return "break;";

    case "continueStatement":
      return "continue;";

    case "returnStatement":
      return ["return ", printExpression(file, ref(node["returnStatement"]?.["returnValue"])), ";"];

    case "logStatement":
      return ["log ", printExpression(file, ref(node["logStatement"]?.["value"])), ";"];

    case "assertStatement":
      return ["assert ", printExpression(file, ref(node["assertStatement"]?.["condition"])), ";"];

    default:
      throw new Error(`Unknown statement type: ${String(node["statement"])}`);
  }
}

// Prints a for-loop initializer (declaration or expression, without trailing semicolon).
function printForInit(file: File, idx: number, _comments: Comment[]): Doc {
  const node = mustStatement(file, idx);
  switch (node["statement"]) {
    case "empty":
      return "";
    case "declaration":
      return printDeclarationStatement(file, node["declaration"]!);
    case "expression":
      return printExpression(file, ref(node["expression"]?.["expression"]));
    default:
      throw new Error(`Invalid for-init statement type: ${String(node["statement"])}`);
  }
}

// ---- Declarations ---------------------------------------------------------------

function printDeclarationStatement(
  file: File,
  stmt: NonNullable<StatementNode["declaration"]>,
): Doc {
  const type = stmt["type"] ?? DeclarationType.DECLARATION_TYPE_VARIABLE;
  const declarations = stmt["declarations"] ?? [];

  let keyword: string;
  switch (type) {
    case DeclarationType.DECLARATION_TYPE_VARIABLE:
      keyword = "var";
      break;
    case DeclarationType.DECLARATION_TYPE_CONSTANT:
      keyword = "const";
      break;
    case DeclarationType.DECLARATION_TYPE_SIGNAL: {
      const mod = declarations[0]?.["modifier"] ?? DeclarationModifier.MODIFIER_NONE;
      keyword =
        mod === DeclarationModifier.MODIFIER_SIGNAL_TYPE_INPUT
          ? "signal input"
          : mod === DeclarationModifier.MODIFIER_SIGNAL_TYPE_OUTPUT
            ? "signal output"
            : "signal";
      break;
    }
    case DeclarationType.DECLARATION_TYPE_COMPONENT:
      keyword = "component";
      break;
    default:
      throw new Error(`Unknown declaration type: ${type}`);
  }

  const declDocs = declarations.map((d) => printDeclarator(file, d));
  if (declDocs.length === 1) {
    return [keyword, " ", declDocs[0]!];
  }
  return group([keyword, " ", indent([join([",", line], declDocs)])]);
}

function printDeclarator(file: File, d: Declaration): Doc {
  const name = d["name"] ?? "";
  const dimensions: Doc[] = (d["dimensions"] ?? []).map(
    (i) => ["[", printExpression(file, i), "]"] as Doc,
  );
  const initializer: Doc[] = hasRef(d["initializer"])
    ? [" = ", printExpression(file, ref(d["initializer"]))]
    : [];
  return [name, ...dimensions, ...initializer];
}

// ---- Expressions ----------------------------------------------------------------

function printExpression(file: File, idx: number): Doc {
  const node = mustExpression(file, idx);
  switch (node["expression"]) {
    case "booleanLiteral":
      return node["booleanLiteral"]?.["value"] ? "true" : "false";

    case "numericLiteral":
      return node["numericLiteral"]?.["value"] ?? "0";

    case "stringLiteral":
      // The parser stores the literal verbatim (with surrounding quotes and raw escapes).
      return node["stringLiteral"]?.["value"] ?? '""';

    case "arrayLiteral": {
      const elements = (node["arrayLiteral"]?.["elements"] ?? []).map((i) =>
        printExpression(file, i),
      );
      if (elements.length === 0) {
        return "[]";
      }
      return group([
        "[",
        indent([softline, join([",", line], elements), ifBreak(",", "")]),
        softline,
        "]",
      ]);
    }

    case "variable":
      return node["variable"]?.["name"] ?? "";

    case "subExpression":
      return ["(", printExpression(file, ref(node["subExpression"]?.["inner"])), ")"];

    case "tuple": {
      const components = node["tuple"]?.["components"] ?? [];
      if (components.length === 0) {
        return "()";
      }
      if (components.length === 1) {
        // Single-element tuple: (x,) — trailing comma is mandatory.
        return ["(", printExpression(file, components[0]!), ",)"];
      }
      const elements = components.map((i) => printExpression(file, i));
      return group(["(", indent([softline, join([",", line], elements)]), softline, ")"]);
    }

    case "postfixChain": {
      const chain = node["postfixChain"]!;
      let result: Doc = printExpression(file, ref(chain["operand"]));
      for (const pf of chain["postfix"] ?? []) {
        result = printPostfix(file, result, pf);
      }
      return result;
    }

    case "prefixChain": {
      const chain = node["prefixChain"]!;
      // types are listed innermost-to-outermost, so reverse for printing.
      const prefixes = [...(chain["types"] ?? [])].reverse().map((t) => PREFIX_SYMBOLS[t] ?? "");
      return [...prefixes, printExpression(file, ref(chain["operand"]))];
    }

    case "infixExpression": {
      const inf = node["infixExpression"]!;
      const op = INFIX_SYMBOLS[inf["type"] ?? 0] ?? "?";
      return [
        printExpression(file, ref(inf["lhs"])),
        " ",
        op,
        " ",
        printExpression(file, ref(inf["rhs"])),
      ];
    }

    case "assign": {
      const a = node["assign"]!;
      const op = ASSIGN_SYMBOLS[a["type"] ?? 0] ?? "=";
      return [
        printExpression(file, ref(a["lhs"])),
        " ",
        op,
        " ",
        printExpression(file, ref(a["rhs"])),
      ];
    }

    case "unconstrainedAssign": {
      const a = node["unconstrainedAssign"]!;
      const op =
        (a["direction"] ?? AssignmentDirection.ASSIGNMENT_DIRECTION_INVALID) ===
        AssignmentDirection.ASSIGNMENT_DIRECTION_LEFT_TO_RIGHT
          ? "-->"
          : "<--";
      return [
        printExpression(file, ref(a["lhs"])),
        " ",
        op,
        " ",
        printExpression(file, ref(a["rhs"])),
      ];
    }

    case "constrainedAssign": {
      const a = node["constrainedAssign"]!;
      const op =
        (a["direction"] ?? AssignmentDirection.ASSIGNMENT_DIRECTION_INVALID) ===
        AssignmentDirection.ASSIGNMENT_DIRECTION_LEFT_TO_RIGHT
          ? "==>"
          : "<==";
      return [
        printExpression(file, ref(a["lhs"])),
        " ",
        op,
        " ",
        printExpression(file, ref(a["rhs"])),
      ];
    }

    case "constrainedEquality": {
      const eq = node["constrainedEquality"]!;
      return [
        printExpression(file, ref(eq["lhs"])),
        " === ",
        printExpression(file, ref(eq["rhs"])),
      ];
    }

    default:
      throw new Error(`Unknown expression type: ${String(node["expression"])}`);
  }
}

function printPostfix(file: File, operand: Doc, pf: PostfixExpression): Doc {
  switch (pf["postfix"]) {
    case "fieldName":
      return [operand, ".", pf["fieldName"]!];

    case "subscriptExpression":
      return [operand, "[", printExpression(file, pf["subscriptExpression"] ?? 0), "]"];

    case "invocation": {
      const args = (pf["invocation"]?.["arguments"] ?? []).map((i) => printExpression(file, i));
      if (args.length === 0) {
        return [operand, "()"];
      }
      return [operand, group(["(", indent([softline, join([",", line], args)]), softline, ")"])];
    }

    case "increment":
      return [operand, "++"];

    case "decrement":
      return [operand, "--"];

    default:
      throw new Error(`Unknown postfix type: ${String(pf["postfix"])}`);
  }
}

// ---- Plugin export --------------------------------------------------------------

const plugin: Plugin<File> = {
  languages: [
    {
      name: "Starkom",
      parsers: ["starkom"],
      extensions: [".starkom"],
      vscodeLanguageIds: ["starkom"],
    },
  ],

  parsers: {
    starkom: {
      parse(text, options) {
        return parse(options["filepath"] ?? "<anonymous>", text, {
          withTokens: true,
          withRanges: true,
        });
      },
      astFormat: "starkom",
      locStart: (_node: unknown) => 0,
      locEnd: (_node: unknown) => 0,
    },
  },

  printers: {
    starkom: {
      print(path: AstPath<File>, _options: Options, _print) {
        return printFile(path.node);
      },
    },
  },
};

export default plugin;
