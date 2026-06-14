import { describe, it, expect, mock, spyOn, beforeEach, afterEach } from "bun:test"
import { loadConfig, resolveTemplate, resolveVariables, sendBarkNotification, BarkNotifyPlugin } from "./index"
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
// resolveVariables
// ---------------------------------------------------------------------------
describe("resolveVariables", () => {
  it("replaces {{time}} with current local time", () => {
    const result = resolveVariables("Time: {{time}}", { type: "session.idle" })
    expect(result).toMatch(/^Time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it("replaces {{session.title}} from properties.info.title (session.created style)", () => {
    const result = resolveVariables("Session: {{session.title}}", {
      type: "session.created",
      properties: { info: { title: "Fix login bug" } },
    })
    expect(result).toBe("Session: Fix login bug")
  })

  it("replaces {{session.title}} from properties.title (permission style)", () => {
    const result = resolveVariables("Session: {{session.title}}", {
      type: "permission.updated",
      properties: { title: "Approve change" },
    })
    expect(result).toBe("Session: Approve change")
  })

  it("replaces {{session.title}} with empty string when properties is missing", () => {
    const result = resolveVariables("Session: {{session.title}}", { type: "session.idle" })
    expect(result).toBe("Session: ")
  })

  it("replaces {{session.title}} with empty string when info.title is missing", () => {
    const result = resolveVariables("Session: {{session.title}}", {
      type: "session.created",
      properties: { info: {} },
    })
    expect(result).toBe("Session: ")
  })

  it("falls back to sessionTitles cache when event has only sessionID", () => {
    const cache = new Map<string, string>()
    cache.set("abc123", "Cached Session Title")
    const result = resolveVariables("Session: {{session.title}}", {
      type: "session.idle",
      properties: { sessionID: "abc123" },
    }, cache)
    expect(result).toBe("Session: Cached Session Title")
  })

  it("returns empty when sessionID not in cache", () => {
    const cache = new Map<string, string>()
    const result = resolveVariables("Session: {{session.title}}", {
      type: "session.idle",
      properties: { sessionID: "unknown" },
    }, cache)
    expect(result).toBe("Session: ")
  })

  it("info.title takes priority over cache", () => {
    const cache = new Map<string, string>()
    cache.set("abc123", "Stale Cached Title")
    const result = resolveVariables("Session: {{session.title}}", {
      type: "session.updated",
      properties: { info: { id: "abc123", title: "Fresh Title" } },
    }, cache)
    expect(result).toBe("Session: Fresh Title")
  })

  it("replaces multiple variables in one template", () => {
    const result = resolveVariables("[{{time}}] {{session.title}}", {
      type: "session.created",
      properties: { info: { title: "Fix bug" } },
    })
    expect(result).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Fix bug$/)
  })

  it("leaves unrecognized variables unchanged", () => {
    const result = resolveVariables("Hello {{unknown}}", { type: "session.idle" })
    expect(result).toBe("Hello {{unknown}}")
  })

  it("replaces {{project.name}} with provided project name", () => {
    const result = resolveVariables("Project: {{project.name}}", { type: "session.idle" }, undefined, "my-project")
    expect(result).toBe("Project: my-project")
  })

  it("replaces {{project.name}} with empty string when not provided", () => {
    const result = resolveVariables("Project: {{project.name}}", { type: "session.idle" })
    expect(result).toBe("Project: ")
  })

  it("replaces all three variables in one template", () => {
    const result = resolveVariables("[{{time}}] {{project.name}} {{session.title}}", {
      type: "session.created",
      properties: { info: { title: "Fix bug" } },
    }, undefined, "my-project")
    expect(result).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] my-project Fix bug$/)
  })

  it("returns template unchanged when no variables present", () => {
    const result = resolveVariables("Plain text", { type: "session.idle" })
    expect(result).toBe("Plain text")
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
    await plugin.event!({ event: { type: "permission.updated" } })
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

  it("resolves variables in template before sending (info.title style)", async () => {
    const config = {
      deviceKey: "k",
      templates: {
        "session.created": { title: "{{session.title}}", body: "Time: {{time}}" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({
      event: {
        type: "session.created",
        properties: { info: { title: "My Session" } },
      },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain(encodeURIComponent("My Session"))
    expect(url).toMatch(/Time%3A%20\d{4}-\d{2}-\d{2}%20\d{2}%3A\d{2}%3A\d{2}/)
  })

  it("resolves variables in template before sending (properties.title style)", async () => {
    const config = {
      deviceKey: "k",
      enable: ["permission.updated"],
      templates: {
        "permission.updated": { title: "{{session.title}}", body: "Time: {{time}}" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })
    await plugin.event!({
      event: {
        type: "permission.updated",
        properties: { title: "Approve change" },
      },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain(encodeURIComponent("Approve change"))
  })

  it("resolves {{session.title}} from cache for session.idle after session.created", async () => {
    const config = {
      deviceKey: "k",
      templates: {
        "session.created": { title: "Created: {{session.title}}" },
        "session.idle": { title: "Idle: {{session.title}}" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })

    // First, create a session to populate the cache
    await plugin.event!({
      event: {
        type: "session.created",
        properties: { info: { id: "sess-1", title: "Fix login" } },
      },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    let url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain(encodeURIComponent("Fix login"))

    // Then, idle event that only has sessionID - should lookup cache
    await plugin.event!({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess-1" },
      },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    url = fetchSpy.mock.calls[1][0] as string
    expect(url).toContain(encodeURIComponent("Fix login"))
  })

  it("session.updated refreshes cached title", async () => {
    const config = {
      deviceKey: "k",
      enable: ["session.created", "session.updated", "session.idle"],
      templates: {
        "session.created": { title: "C: {{session.title}}" },
        "session.updated": { title: "U: {{session.title}}" },
        "session.idle": { title: "I: {{session.title}}" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })

    // Create session with initial title
    await plugin.event!({
      event: {
        type: "session.created",
        properties: { info: { id: "sess-1", title: "Old Title" } },
      },
    })

    // Update session with new title
    await plugin.event!({
      event: {
        type: "session.updated",
        properties: { info: { id: "sess-1", title: "New Title" } },
      },
    })

    // Idle event should use updated title
    await plugin.event!({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess-1" },
      },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(3)
    const url = fetchSpy.mock.calls[2][0] as string
    expect(url).toContain(encodeURIComponent("New Title"))
  })

  it("resolves {{project.name}} from directory basename", async () => {
    const config = {
      deviceKey: "k",
      templates: {
        "session.created": { title: "{{project.name}}", body: "Started" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/home/user/my-awesome-project" })
    await plugin.event!({ event: { type: "session.created" } })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain(encodeURIComponent("my-awesome-project"))
  })

  it("clears cached title on session.deleted", async () => {
    const config = {
      deviceKey: "k",
      templates: {
        "session.created": { title: "C: {{session.title}}" },
        "session.idle": { title: "I: {{session.title}}" },
      },
    }
    spyOn(fs, "existsSync").mockReturnValue(true)
    spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(config))

    const plugin = await BarkNotifyPlugin({ directory: "/x" })

    // Create and cache
    await plugin.event!({
      event: {
        type: "session.created",
        properties: { info: { id: "sess-1", title: "Removed" } },
      },
    })

    // Delete -> cache entry removed
    await plugin.event!({
      event: {
        type: "session.deleted",
        properties: { info: { id: "sess-1" } },
      },
    })

    // Idle -> title should be empty (cache miss)
    await plugin.event!({
      event: {
        type: "session.idle",
        properties: { sessionID: "sess-1" },
      },
    })

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const url = fetchSpy.mock.calls[1][0] as string
    expect(url).toContain(encodeURIComponent("I: "))
  })
})
