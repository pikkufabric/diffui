/**
 * How read commands print.
 *
 * Every read command takes `--json` and then prints the server's answer
 * verbatim, so a script gets the same shape the web app does. Without it, a
 * plain column table: no colour and no box drawing, so it pipes into `grep`
 * and `column` cleanly.
 */

export const printJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export const printTable = (headers: string[], rows: Array<Array<string | number>>) => {
  if (rows.length === 0) return
  const cells = [headers, ...rows.map((row) => row.map(String))]
  const widths = headers.map((_, i) => Math.max(...cells.map((row) => (row[i] ?? '').length)))
  for (const row of cells) {
    process.stdout.write(
      `${row
        .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!)))
        .join('  ')}\n`,
    )
  }
}

export const percent = (ratio: number | null | undefined) =>
  ratio === null || ratio === undefined ? '' : `${(ratio * 100).toFixed(2)}%`
