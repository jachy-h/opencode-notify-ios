import { readFileSync, existsSync } from "fs"
import { join } from "path"

interface Template {
  title?: string
  body?: string
}

interface BarkConfig {
  deviceKey?: string
  sound?: string
  enable?: string[]
  templates?: Record<string, Template>
}

const DEFAULT_ENABLE = ["permission.asked", "session.error", "session.idle"]

export function loadConfig(directory: string): BarkConfig {
  const configPath = join(directory, "notify-ios.json")
  if (!existsSync(configPath)) return {}
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"))
  } catch {
    return {}
  }
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
  return {
    event: async ({ event }: { event: { type: string } }) => {
      const config = loadConfig(directory)
      if (!config.deviceKey) return

      const enable = config.enable ?? DEFAULT_ENABLE
      if (!enable.includes(event.type)) return

      const { title, body } = resolveTemplate(config.templates, event.type)
      await sendBarkNotification(config.deviceKey, title, body, config.sound || "default")
    },
  }
}
