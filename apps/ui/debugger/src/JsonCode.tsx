interface JsonCodeProps {
  value: unknown;
  label: string;
}

/** Carbon has no syntax highlighter; render escaped React text with JSON token colors. */
export function JsonCode({ value, label }: JsonCodeProps) {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value) as unknown; } catch { parsed = value; /* Plain text responses remain readable. */ }
  }
  const text = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2) ?? "(empty)";
  const tokens = text.split(/("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g);
  return (
    <pre className="debugger-code" tabIndex={0} aria-label={label}>
      <code>{tokens.map((token, index) => {
        const kind = token.startsWith('"')
          ? (/^\s*:/.test(tokens[index + 1] ?? "") ? "key" : "string")
          : /^(true|false|null)$/.test(token) ? "literal"
            : /^-?\d/.test(token) ? "number" : "plain";
        return <span key={index} className={`debugger-json-${kind}`}>{token}</span>;
      })}</code>
    </pre>
  );
}
