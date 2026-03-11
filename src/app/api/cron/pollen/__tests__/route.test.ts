import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the db module before importing the route
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
    execute: vi.fn(() => Promise.resolve()),
  },
  dogs: {
    id: "id",
    environmentEnabled: "environment_enabled",
  },
  dailyPollen: {
    id: "id",
    provider: "provider",
    location: "location",
    date: "date",
    source: "source",
  },
}))

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

// Import after mocks
const { POST } = await import("../route")

describe("POST /api/cron/pollen", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    mockFetch.mockReset()
  })

  it("rejects requests without CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")

    const request = new Request("http://localhost/api/cron/pollen", {
      method: "POST",
    })

    const response = await POST(request as Parameters<typeof POST>[0])
    expect(response.status).toBe(401)

    const data = await response.json()
    expect(data.error).toBe("Unauthorized")
  })

  it("rejects requests with wrong CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")

    const request = new Request("http://localhost/api/cron/pollen", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    })

    const response = await POST(request as Parameters<typeof POST>[0])
    expect(response.status).toBe(401)
  })

  it("returns 500 when CRON_SECRET not configured", async () => {
    vi.stubEnv("CRON_SECRET", "")

    const request = new Request("http://localhost/api/cron/pollen", {
      method: "POST",
      headers: { Authorization: "Bearer something" },
    })

    const response = await POST(request as Parameters<typeof POST>[0])
    expect(response.status).toBe(500)
  })

  it("skips when no dogs have pollen tracking enabled", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")

    const request = new Request("http://localhost/api/cron/pollen", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    })

    const response = await POST(request as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.status).toBe("skipped")
  })
})
