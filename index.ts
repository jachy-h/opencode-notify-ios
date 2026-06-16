import { readFileSync, existsSync } from "fs"
import { join, basename } from "path"
import { homedir } from "os"

interface Template {
  title?: string
  body?: string
}

interface BarkConfig {
  deviceKey?: string
  sound?: string
  enable?: string[]
  templates?: Record<string, Template>
  dedupWindowMs?: number
}

interface OpenCodeEvent {
  type: string
  properties?: {
    info?: { title?: string; id?: string }
    title?: string
    sessionID?: string
  }
}

const DEFAULT_ENABLE = ["permission.updated", "session.error", "session.idle", "session.created"]
const DEFAULT_DEDUP_WINDOW_MS = 5000
const MAX_SESSION_CACHE = 50

class DedupBuffer {
  private seen = new Map<string, number>()
  windowMs: number

  constructor(windowMs = DEFAULT_DEDUP_WINDOW_MS) {
    this.windowMs = windowMs
  }

  shouldSkip(key: string): boolean {
    const now = Date.now()
    for (const [k, ts] of this.seen) {
      if (now - ts > this.windowMs) this.seen.delete(k)
    }
    if (this.seen.has(key)) return true
    this.seen.set(key, now)
    return false
  }
}

export function loadConfig(directory: string): BarkConfig {
  const candidates = [
    join(directory, "notify-ios.json"),
    join(homedir(), ".config", "opencode", "notify-ios.json"),
  ]
  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      return JSON.parse(readFileSync(path, "utf-8"))
    } catch {
      return {}
    }
  }
  return {}
}

export function resolveTemplate(
  templates: Record<string, Template> | undefined,
  eventType: string,
): { title: string; body: string } {
  const tpl = templates?.[eventType]
  return {
    title: tpl?.title || "OpenCode",
    body: tpl?.body || `Event: ${eventType}`,
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, "0")
}

function extractSessionTitle(event: OpenCodeEvent, sessionTitles?: Map<string, string>): string {
  const fromInfo = event.properties?.info?.title
  if (fromInfo) return fromInfo

  const fromProps = event.properties?.title
  if (fromProps) return fromProps

  if (sessionTitles) {
    const sid = event.properties?.sessionID
    if (sid) {
      const cached = sessionTitles.get(sid)
      if (cached) return cached
    }
  }

  return ""
}

export function resolveVariables(
  template: string,
  event: OpenCodeEvent,
  sessionTitles?: Map<string, string>,
  projectName?: string,
): string {
  const now = new Date()
  const time = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

  const sessionTitle = extractSessionTitle(event, sessionTitles)

  return template
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{session\.title\}\}/g, sessionTitle)
    .replace(/\{\{project\.name\}\}/g, projectName || "")
}

export async function sendBarkNotification(
  deviceKey: string,
  title: string,
  body: string,
  sound: string,
): Promise<void> {
  const encodedTitle = encodeURIComponent(title)
  const encodedBody = encodeURIComponent(body)
  const url = `https://api.day.app/${deviceKey}/${encodedTitle}/${encodedBody}?sound=${sound}&group=OpenCode`

  try {
    await fetch(url)
  } catch (err) {
    console.error("[notify-ios] Failed to send notification:", err)
  }
}

export const BarkNotifyPlugin = async ({ directory }: { directory: string }) => {
  let dedupBuffer = new DedupBuffer()
  const sessionTitles = new Map<string, string>()
  const projectName = basename(directory)

  return {
    event: async ({ event }: { event: OpenCodeEvent }) => {
      const config = loadConfig(directory)
      if (!config.deviceKey) return

      const title = event.properties?.info?.title
      const sid = event.properties?.info?.id || event.properties?.sessionID

      if (event.type === "session.deleted" && sid) {
        sessionTitles.delete(sid)
      } else if (title && sid) {
        if (sessionTitles.size >= MAX_SESSION_CACHE && !sessionTitles.has(sid)) {
          const oldest = sessionTitles.keys().next().value
          if (oldest !== undefined) sessionTitles.delete(oldest)
        }
        sessionTitles.set(sid, title)
      }

      const enable = config.enable ?? DEFAULT_ENABLE
      if (!enable.includes(event.type)) return

      const { title: tplTitle, body: tplBody } = resolveTemplate(config.templates, event.type)
      const sessionTitle = extractSessionTitle(event, sessionTitles)

      const windowMs = config.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS
      if (dedupBuffer.windowMs !== windowMs) {
        dedupBuffer = new DedupBuffer(windowMs)
      }

      const dedupKey = `${event.type}\x00${tplTitle}\x00${tplBody}\x00${sessionTitle}`
      if (dedupBuffer.shouldSkip(dedupKey)) return

      const resolvedTitle = resolveVariables(tplTitle, event, sessionTitles, projectName)
      const resolvedBody = resolveVariables(tplBody, event, sessionTitles, projectName)

      await sendBarkNotification(config.deviceKey, resolvedTitle, resolvedBody, config.sound || "default")
    },
  }
}
