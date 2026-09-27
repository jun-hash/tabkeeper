import type { PurgeOutcome } from '../app/purge.js'
import type { HostReport } from '../app/sweep.js'
import type { ArchiveRecord } from '../domain/model.js'
import type { Action, Kept } from '../domain/policy.js'
import { formatDuration } from '../shared/duration.js'

export function renderSweep(reports: readonly HostReport[], dryRun: boolean, verbose: boolean): string {
  return reports.map((report) => renderHost(report, dryRun, verbose)).join('\n\n')
}

export function renderRecords(records: readonly ArchiveRecord[], now: number): string {
  if (records.length === 0) return 'No archives.'
  const rows = records.map((r) => [
    r.id,
    r.host,
    r.kind,
    r.status,
    `${formatDuration(now - r.archivedAt)} ago`,
    describeRecord(r),
  ])
  return table(['ID', 'HOST', 'KIND', 'STATUS', 'ARCHIVED', 'TARGET'], rows)
}

export function renderRecord(record: ArchiveRecord, now: number): string {
  const lines = [
    `${record.id}  ${record.kind} on ${record.host} — ${record.status}`,
    `archived   ${new Date(record.archivedAt).toISOString()} (${formatDuration(now - record.archivedAt)} ago, ${record.reason})`,
    `workspace  ${record.workspace.title}${record.workspace.path ? `  ${record.workspace.path}` : ''}`,
    `mode       ${record.mode === 'native' ? `suspended by ${record.host}` : 'closed by tabkeeper'}`,
  ]
  for (const session of record.sessions) {
    const agent = session.agent ? `  ↻ ${session.agent.resumeCommand}` : ''
    lines.push(`  • ${session.title}${session.hasScrollback ? '  [scrollback]' : ''}${agent}`)
  }
  return lines.join('\n')
}

export function renderPurge(outcomes: readonly PurgeOutcome[]): string {
  if (outcomes.length === 0) return 'Nothing to purge.'
  return outcomes
    .map((o) => `${o.result.padEnd(11)} ${o.record.id}  ${describeRecord(o.record)}${'reason' in o ? `  (${o.reason})` : ''}`)
    .join('\n')
}

function renderHost(report: HostReport, dryRun: boolean, verbose: boolean): string {
  if (report.status !== 'ok') return `${report.host}: ${report.status} — ${report.reason}`

  const lines = [`${report.host}: ${summarize(report, dryRun)}`]
  if (dryRun) lines.push(...report.planned.map((a) => `  would archive ${describeAction(a)}`))
  else lines.push(...report.archived.map((r) => `  archived ${r.id}  ${describeRecord(r)}`))
  lines.push(...report.failures.map((f) => `  failed   ${describeAction(f.action)}: ${f.message}`))
  if (verbose) lines.push(...report.kept.map((k) => `  kept     ${describeKept(k)}`))
  return lines.join('\n')
}

function summarize(report: Extract<HostReport, { status: 'ok' }>, dryRun: boolean): string {
  const count = dryRun ? report.planned.length : report.archived.length
  const verb = dryRun ? 'would archive' : 'archived'
  const failures = report.failures.length > 0 ? `, ${report.failures.length} failed` : ''
  return `${verb} ${count}, kept ${report.kept.length} protected${failures}`
}

function describeAction(action: Action): string {
  const idle = `idle ${formatDuration(action.idleMs)}`
  return action.kind === 'archive-workspace'
    ? `workspace "${action.workspace.title}" with ${action.workspace.sessions.length} session(s) (${idle})`
    : `session "${action.session.title}" in "${action.workspace.title}" (${idle})`
}

function describeKept(kept: Kept): string {
  const target = kept.session ? `session "${kept.session.title}" in "${kept.workspace.title}"` : `workspace "${kept.workspace.title}"`
  return `${target} — ${kept.protection}`
}

function describeRecord(record: ArchiveRecord): string {
  if (record.kind === 'workspace') return `${record.workspace.title} (${record.sessions.length} session(s))`
  return `${record.sessions[0]?.title ?? 'session'} @ ${record.workspace.title}`
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)))
  const format = (row: readonly string[]) =>
    row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  ')
  return [format(header), ...rows.map(format)].join('\n')
}
