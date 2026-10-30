/** Quote values so comments, whitespace and multiline strings survive editing as .env text. */
export function serializeEnvironmentText(variables: Array<{ key: string; value: string }>): string {
  return variables
    .map(({ key, value }) => {
      const escaped = value.replace(
        /[\\"\n\r\t]/g,
        (character) =>
          ({
            '\\': '\\\\',
            '"': '\\"',
            '\n': '\\n',
            '\r': '\\r',
            '\t': '\\t',
          })[character]!,
      )
      return `${key}="${escaped}"`
    })
    .join('\n')
}

/** Parse single-line .env entries without expanding values or executing substitutions. */
export function parseEnvironmentText(text: string): Array<{ key: string; value: string }> {
  const variables: Array<{ key: string; value: string }> = []
  const seen = new Set<string>()
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=(.*)$/.exec(line)
    if (!match) throw new Error(`Baris ${index + 1}: gunakan format KEY=value.`)
    const key = match[1]!
    if (seen.has(key)) throw new Error(`Baris ${index + 1}: ${key} duplikat.`)
    let value = match[2]!.trim()
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]!
      let end = 1
      for (; end < value.length; end++) {
        if (quote === '"' && value[end] === '\\') {
          end++
          continue
        }
        if (value[end] === quote) break
      }
      if (end >= value.length || !/^(?:\s*#.*)?$/.test(value.slice(end + 1))) {
        throw new Error(
          `Baris ${index + 1}: kutip tidak valid. Gunakan editor nilai untuk teks multiline.`,
        )
      }
      value = value.slice(1, end)
      if (quote === '"')
        value = value.replace(
          /\\([nrt"\\])/g,
          (_, character: string) =>
            ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[character]!,
        )
    } else {
      value = value.split('#', 1)[0]!.trimEnd()
    }
    seen.add(key)
    variables.push({ key, value })
  }
  return variables
}
