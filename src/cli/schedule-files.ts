const PRESERVED_ENV = [
  'PATH',
  'TABKEEPER_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'ORCA_USER_DATA_PATH',
  'CMUX_STATE_DIR',
  'CLAUDE_CONFIG_DIR',
] as const

export interface Invocation {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

export function sweepInvocation(
  node: string,
  script: string,
  configPath: string,
  env: Readonly<Record<string, string | undefined>>,
): Invocation {
  const kept = PRESERVED_ENV.flatMap((key) => {
    const value = env[key]
    return value === undefined ? [] : [[key, value] as const]
  })
  return { argv: [node, script, 'sweep', '--config', configPath], env: Object.fromEntries(kept) }
}

export function cronLine(invocation: Invocation, everyMs: number, logFile: string): string {
  const minutes = Math.max(1, Math.round(everyMs / 60_000))
  const hours = Math.round(minutes / 60)
  const schedule = minutes < 60 ? `*/${minutes} * * * *` : hours < 24 ? `0 */${hours} * * *` : '0 0 * * *'
  const env = Object.entries(invocation.env).map(([k, v]) => `${k}=${shellQuote(v)}`)
  return [schedule, ...env, ...invocation.argv.map(shellQuote), '>>', shellQuote(logFile), '2>&1'].join(' ')
}

export function launchdPlist(label: string, invocation: Invocation, everyMs: number, logFile: string): string {
  const strings = (items: readonly string[], indent: string) =>
    items.map((s) => `${indent}<string>${escapeXml(s)}</string>`).join('\n')
  const env = Object.entries(invocation.env)
    .map(([k, v]) => `    <key>${escapeXml(k)}</key>\n    <string>${escapeXml(v)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings(invocation.argv, '    ')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>StartInterval</key>
  <integer>${Math.max(60, Math.round(everyMs / 1000))}</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logFile)}</string>
</dict>
</plist>
`
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function shellQuote(arg: string): string {
  return /^[\w./:=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}
