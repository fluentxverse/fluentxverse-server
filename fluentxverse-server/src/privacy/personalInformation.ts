import { Parser } from "htmlparser2";

export interface PrivateIdentity {
  names?: string[];
  emails?: string[];
  addresses?: string[];
  identifiers?: string[];
}

type Rule = { kind: string; pattern: RegExp };
const rules: Rule[] = [
  {
    kind: "email",
    pattern:
      /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+\s*(?:@|\[at\]|\(at\))\s*[\p{L}\p{N}.-]+\s*(?:\.|\[dot\]|\(dot\))\s*[\p{L}]{2,}/giu,
  },
  { kind: "phone", pattern: /(?<!\d)(?:\+\d{1,3}[\s().-]*)?(?:\(?\d{2,4}\)?[\s.-]*){2,4}\d{3,4}(?!\d)/gu },
  {
    kind: "address",
    pattern:
      /\b\d{1,6}\s+(?:[\p{L}\p{N}.'-]+\s+){1,6}(?:street|st\.?|road|rd\.?|avenue|ave\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?|court|ct\.?|way)\b[^\n.!?]*/giu,
  },
  {
    kind: "personal detail",
    pattern:
      /\b(?:my|their|his|her|the student'?s|student'?s)\s+(?:full\s+)?(?:name|address|email|e-mail|phone|telephone|mobile|birthday|date of birth|passport|national id|social security|employer)\s*(?:is\b|:|=)[^\n.!?]*/giu,
  },
  {
    kind: "personal detail",
    pattern:
      /\b(?:i live at|student lives at|lives at|resides at|contact me at|contact the student at)\s+[^\n.!?]+/giu,
  },
  {
    kind: "identifier",
    pattern:
      /\b(?:student|tutor|booking|session|exam|account|user)[ _-]?(?:id|identifier)\s*[:=]\s*[\w@./+-]+/giu,
  },
  { kind: "identifier", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu },
  { kind: "link", pattern: /(?:https?:\/\/|www\.)[^\s<>]+/giu },
];

export function normalizedPrivateText(value: string) {
  let text = "";
  const block = new Set([
    "p",
    "div",
    "br",
    "li",
    "ul",
    "ol",
    "section",
    "table",
    "tr",
    "td",
    "h1",
    "h2",
    "h3",
  ]);
  const boundary = (tag: string) => {
    if (block.has(tag)) text += " ";
  };
  const parser = new Parser(
    {
      ontext: (part) => {
        text += part;
      },
      onopentag: boundary,
      onclosetag: boundary,
    },
    { decodeEntities: true },
  );
  parser.write(value.normalize("NFKC").replace(/\p{Cf}/gu, ""));
  parser.end();
  return text
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\t\r ]+/g, " ")
    .trim();
}
const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function identityRules(identity: PrivateIdentity): Rule[] {
  return (["names", "emails", "addresses", "identifiers"] as const).flatMap((field) =>
    [
      ...new Set(
        (identity[field] || [])
          .filter((value) => typeof value === "string")
          .map(normalizedPrivateText)
          .filter((value) => value.length >= 2 && !/^(student|tutor|learner)$/i.test(value)),
      ),
    ]
      .sort((a, b) => b.length - a.length)
      .map((value) => ({
        kind: field === "names" ? "student name" : "student detail",
        pattern: new RegExp(
          /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value)
            ? literal(value).replace(/\s+/g, "\\s*")
            : `(?<![\\p{L}\\p{N}])${literal(value).replace(/\s+/g, "\\s+")}(?![\\p{Script=Latin}\\p{N}])`,
          "giu",
        ),
      })),
  );
}
export function privateInformationKinds(value: string, identity: PrivateIdentity = {}): string[] {
  const text = normalizedPrivateText(value);
  return [
    ...new Set(
      [...identityRules(identity), ...rules]
        .filter((rule) => {
          rule.pattern.lastIndex = 0;
          return rule.pattern.test(text);
        })
        .map((rule) => rule.kind),
    ),
  ];
}
export function redactPrivateText(value: string, identity: PrivateIdentity = {}): string {
  let text = normalizedPrivateText(value);
  // Redact whole contact values before a known name can split an email local part.
  for (const rule of [...rules, ...identityRules(identity)]) {
    rule.pattern.lastIndex = 0;
    text = text.replace(rule.pattern, "[PRIVATE]");
  }
  return text;
}

const privateKeys =
  /^(?:student|tutor|learner|applicant|candidate|booking|session|exam|account|user|owner|request|trace|correlation)[_-]?(?:id|ids)$|^(?:student|tutor|learner|applicant|candidate)(?:[_-]?(?:name|email|phone|address|profile))?$|^(?:email|e_mail|phone|telephone|mobile|address|fullName|firstName|lastName|givenName|familyName|displayName|dateOfBirth|birthday|profile|studentProfile|tutorProfile|tutorMemos|tutorMemo|history|unrelatedHistory)$/i;
export function minimizeAIInput(input: unknown, identity: PrivateIdentity = {}, depth = 0): unknown {
  if (depth > 12) throw new Error("AI input nesting exceeds privacy limits");
  if (typeof input === "string") {
    if (input.length > 200000) throw new Error("AI input exceeds privacy limits");
    const trimmed = input.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input);
      } catch {
        /* Ordinary text can start with a bracket. */
      }
      if (parsed && typeof parsed === "object")
        return JSON.stringify(minimizeAIInput(parsed, identity, depth + 1));
    }
    return redactPrivateText(input, identity);
  }
  if (Array.isArray(input)) {
    if (input.length > 1000) throw new Error("AI input exceeds privacy limits");
    return input.map((item) => minimizeAIInput(item, identity, depth + 1));
  }
  if (input && typeof input === "object") {
    if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
      throw new Error("Unsupported AI input type");
    return Object.fromEntries(
      Object.entries(input)
        .filter(([key]) => !privateKeys.test(key))
        .map(([key, value]) => [key, minimizeAIInput(value, identity, depth + 1)]),
    );
  }
  return input;
}
