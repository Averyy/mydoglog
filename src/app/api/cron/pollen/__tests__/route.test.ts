import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the db module before importing the route
vi.mock("@/lib/db", () => ({
  db: {
    selectDistinct: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
  dogs: { location: "location" },
  pollenLogs: { id: "id", location: "location", date: "date" },
}))

// Import after mocks
const { POST } = await import("../route")

describe("POST /api/cron/pollen", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it("rejects requests without CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.stubEnv("AMBEE_API_KEY", "test-key")

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
    vi.stubEnv("AMBEE_API_KEY", "test-key")

    const request = new Request("http://localhost/api/cron/pollen", {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    })

    const response = await POST(request as Parameters<typeof POST>[0])
    expect(response.status).toBe(401)
  })

  it("returns 500 when CRON_SECRET not configured", async () => {
    vi.stubEnv("CRON_SECRET", "")
    // Unset by making it empty string — route checks for falsy

    const request = new Request("http://localhost/api/cron/pollen", {
      method: "POST",
      headers: { Authorization: "Bearer something" },
    })

    const response = await POST(request as Parameters<typeof POST>[0])
    expect(response.status).toBe(500)
  })

  it("accepts requests with correct CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.stubEnv("AMBEE_API_KEY", "test-key")

    const request = new Request("http://localhost/api/cron/pollen", {
      method: "POST",
      headers: { Authorization: "Bearer test-secret" },
    })

    const response = await POST(request as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty("processed")
    expect(data).toHaveProperty("skipped")
  })
})
