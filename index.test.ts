import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test"
import { loadConfig, resolveTemplate, sendBarkNotification, BarkNotifyPlugin } from "./index"
import * as fs from "fs"

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------
describe("loadConfig", () => {
  it("returns empty object when notify-ios.json does not exist", () => {
    spyOn(fs, "existsSync").mockReturnValue(false)
    expect(loadConfig("/fake/dir")).toEqual({})
  })

  it("parses notify-ios.json when it exists", () => {
    const config = {
      deviceKey: "key-123",
      sound: "alarm",
      enable: ["session.idle"],
      templates: {
        "session.idle": { title: "Done", body: "Finished" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const result = loadConfig("/fake/dir")
    expect(result.deviceKey).toBe("key-123")
    expect(result.sound).toBe("alarm")
    expect(result.enable).toEqual(["session.idle"])
    expect(result.templates!["session.idle"].title).toBe("Done")
  })

  it("returns empty object on malformed JSON", () => {
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue("{invalid")
    expect(loadConfig("/fake/dir")).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// resolveTemplate
// ---------------------------------------------------------------------------
describe("resolveTemplate", () => {
  it("returns fallback when templates is undefined", () => {
    const result = resolveTemplate(undefined, "session.idle")
    expect(result).toEqual({ title: "OpenCode", body: "Event: session.idle" })
  })

  it("returns fallback when event type not in templates", () => {
    const result = resolveTemplate({ "session.error": { title: "Err" } }, "session.idle")
    expect(result).toEqual({ title: "OpenCode", body: "Event: session.idle" })
  })

  it("returns configured template", () => {
    const templates = {
      "session.idle": { title: "Done", body: "Task\ncompleted" },
    }
    expect(resolveTemplate(templates, "session.idle")).toEqual({
      title: "Done",
      body: "Task\ncompleted",
    })
  })

  it("falls back for missing title or body", () => {
    expect(resolveTemplate({ "e": { body: "B" } }, "e")).toEqual({ title: "OpenCode", body: "B" })
    expect(resolveTemplate({ "e": { title: "T" } }, "e")).toEqual({ title: "T", body: "Event: e" })
  })
})

// ---------------------------------------------------------------------------
// sendBarkNotification
// ---------------------------------------------------------------------------
describe("sendBarkNotification", () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response())
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("calls fetch with correct URL", async () => {
    await sendBarkNotification("my-key", "Hello", "World", "alarm")

    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain("https://api.day.app/my-key/Hello/World")
    expect(url).toContain("sound=alarm")
  })

  it("logs error on fetch failure", async () => {
    fetchSpy.mockRestore()
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"))
    const errSpy = spyOn(console, "error").mockImplementation(() => {})

    await sendBarkNotification("key", "T", "B", "default")
    expect(errSpy).toHaveBeenCalledTimes(1)
    errSpy.mockRestore()
    spyOn(globalThis, "fetch").mockRestore()
  })
})

// ---------------------------------------------------------------------------
// BarkNotifyPlugin
// ---------------------------------------------------------------------------
describe("BarkNotifyPlugin", () => {
  let fetchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response())
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it("always returns event handler", async () => {
    spyOn(fs, "existsSync").mockReturnValue(false)
    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    expect(plugin).toHaveProperty("event")
    expect(typeof plugin.event).toBe("function")
  })

  it("skips silently when no deviceKey", async () => {
    spyOn(fs, "existsSync").mockReturnValue(false)
    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.idle" } })
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it("sends notification for event in enable list", async () => {
    const config = { deviceKey: "k", enable: ["session.idle"] }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.idle" } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("skips notification for event not in enable list", async () => {
    const config = { deviceKey: "k", enable: ["permission.asked"] }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.idle" } })
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it("uses default enable list when not configured", async () => {
    const config = { deviceKey: "k" }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "permission.asked" } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("sends notification for session.created with defaults", async () => {
    const config = { deviceKey: "k" }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.created" } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain("OpenCode")
    expect(url).toContain(encodeURIComponent("Event: session.created"))
  })

  it("respects empty enable list", async () => {
    const config = { deviceKey: "k", enable: [] }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.idle" } })
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it("deduplicates identical messages within time window", async () => {
    const config = { deviceKey: "k" }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.idle" } })
    await plugin.event!({ event: { type: "session.idle" } })
    await plugin.event!({ event: { type: "session.idle" } })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("deduplicates non-consecutive identical messages within window", async () => {
    const config = {
      deviceKey: "k",
      templates: {
        "session.idle": { body: "Idle" },
        "session.error": { body: "Error" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.idle" } })
    await plugin.event!({ event: { type: "session.error" } })
    await plugin.event!({ event: { type: "session.idle" } })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("sends different event types with different templates", async () => {
    const config = {
      deviceKey: "k",
      templates: {
        "session.idle": { body: "Idle" },
        "session.error": { body: "Error" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.idle" } })
    await plugin.event!({ event: { type: "session.error" } })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("re-reads config on each event (hot reload)", async () => {
    const config1 = { deviceKey: "k1", enable: ["session.idle", "session.error"] }
    const config2 = { deviceKey: "k2", enable: ["session.idle", "session.error"] }
    spyOn(fs, "existsSync").mockReturnValue(true)

    let callCount = 0
    spyOn(fs, "readFileSync").mockImplementation(() => {
      callCount++
      return JSON.stringify(callCount === 1 ? config1 : config2)
    })

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({ event: { type: "session.idle" } })

    let url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain("k1")

    // modify config, next event should use new key (different event type to bypass dedup)
    await plugin.event!({ event: { type: "session.error" } })

    url = fetchSpy.mock.calls[1][0] as string
    expect(url).toContain("k2")
  })
})
