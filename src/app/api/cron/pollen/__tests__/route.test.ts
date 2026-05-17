import { describe, it, expect, vi, beforeEach } from "vitest"

const enabledDogRow = [{ id: "dog-1" }]
const lastDateRow: Array<{ date: string }> = []

const limitMock = vi.fn(() => Promise.resolve(enabledDogRow))
const orderByLimitMock = vi.fn(() => Promise.resolve(lastDateRow))

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: limitMock,
          orderBy: vi.fn(() => ({
            limit: orderByLimitMock,
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

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

const { POST } = await import("../route")

function makeRequest(secret: string) {
  return new Request("http://localhost/api/cron/pollen", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  })
}

describe("POST /api/cron/pollen", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    mockFetch.mockReset()
    limitMock.mockClear()
    orderByLimitMock.mockClear()
    limitMock.mockImplementation(() => Promise.resolve(enabledDogRow))
    orderByLimitMock.mockImplementation(() => Promise.resolve(lastDateRow))
  })

  it("rejects requests without CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.stubEnv("POLLEN_SPARR_API_KEY", "test-pollen-key")

    const request = new Request("http://localhost/api/cron/pollen", { method: "POST" })

    const response = await POST(request as Parameters<typeof POST>[0])
    expect(response.status).toBe(401)

    const data = await response.json()
    expect(data.error).toBe("Unauthorized")
  })

  it("rejects requests with wrong CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")

    const response = await POST(makeRequest("wrong-secret") as Parameters<typeof POST>[0])
    expect(response.status).toBe(401)
  })

  it("returns 500 when CRON_SECRET not configured", async () => {
    vi.stubEnv("CRON_SECRET", "")

    const response = await POST(makeRequest("anything") as Parameters<typeof POST>[0])
    expect(response.status).toBe(500)
  })

  it("skips when no dogs have pollen tracking enabled", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.stubEnv("POLLEN_SPARR_API_KEY", "test-pollen-key")
    limitMock.mockImplementationOnce(() => Promise.resolve([]))

    const response = await POST(makeRequest("test-secret") as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.status).toBe("skipped")
  })

  it("resolves nearest station from v2 results[] and upserts mapped readings", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.stubEnv("POLLEN_SPARR_API_KEY", "test-pollen-key")

    mockFetch
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              query: { lat: 43.16, lng: -79.25 },
              results: [
                {
                  id: 42,
                  provider: "aerobiology",
                  external_id: "218",
                  name: "St. Catharines",
                  country_code: "CA",
                  region: "ON",
                  lat: 43.16,
                  lng: -79.25,
                  distance_km: 1.2,
                  data_type: "measured",
                  scale_basis: "aerobiology_proprietary",
                  status: "active",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              location: { id: 42 },
              readings: [
                {
                  location_id: 42,
                  date: "2026-05-17",
                  provider: "aerobiology",
                  source: "actual",
                  data_type: "measured",
                  scale_basis: "aerobiology_proprietary",
                  overall_level: 3,
                  categories: {
                    trees: {
                      level: 3,
                      species: [
                        { name: "Oak", scientific_name: "QUERCUS", level: 3 },
                        { name: "Pine", scientific_name: "PINUS", level: 0 },
                      ],
                    },
                    grasses: { level: 1, species: [] },
                    weeds: { level: 0 },
                    spores: { level: 2, species: [{ name: "Cladosporium", scientific_name: "CLAD", level: 2 }] },
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      )

    const response = await POST(makeRequest("test-secret") as Parameters<typeof POST>[0])
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.station).toEqual({ provider: "aerobiology", location: "st-catharines-on", id: 42 })
    expect(data.result.status).toBe("ok")
    expect(data.result.processed).toBe(1)
    expect(data.result.skipped).toBe(0)

    // Verify auth header was sent on both calls
    for (const call of mockFetch.mock.calls) {
      const init = call[1] as RequestInit | undefined
      const headers = init?.headers as Record<string, string> | undefined
      expect(headers?.["X-API-Key"]).toBe("test-pollen-key")
    }
  })

  it("returns 502 when /api/nearest has no results", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.stubEnv("POLLEN_SPARR_API_KEY", "test-pollen-key")

    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ query: {}, results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    )

    const response = await POST(makeRequest("test-secret") as Parameters<typeof POST>[0])
    expect(response.status).toBe(502)
  })

  it("returns 500 when POLLEN_SPARR_API_KEY is missing", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret")
    vi.stubEnv("POLLEN_SPARR_API_KEY", "")

    const response = await POST(makeRequest("test-secret") as Parameters<typeof POST>[0])
    expect(response.status).toBe(500)

    const data = await response.json()
    expect(data.error).toBe("POLLEN_SPARR_API_KEY not configured")
  })
})
