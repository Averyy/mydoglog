/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import path from "path"

vi.mock("sharp", () => {
  const mockSharp = vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("fake-image")),
  }))
  return { default: mockSharp }
})

vi.mock("fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    access: vi.fn(),
  },
}))

import { savePhoto, getPhotoPath } from "./photos"
import fs from "fs/promises"

describe("savePhoto", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects non-image files", async () => {
    const file = new File(["data"], "test.pdf", { type: "application/pdf" })
    await expect(savePhoto(file, "dog-1", "2026-03-01")).rejects.toThrow(
      "Only JPEG and PNG files are accepted",
    )
  })

  it("rejects files over 10MB", async () => {
    const bigData = new Uint8Array(11 * 1024 * 1024)
    const file = new File([bigData], "big.jpg", { type: "image/jpeg" })
    await expect(savePhoto(file, "dog-1", "2026-03-01")).rejects.toThrow(
      "File must be under 10MB",
    )
  })

  it("accepts JPEG and returns URL with correct path segments", async () => {
    const file = new File(["image-data"], "photo.jpg", { type: "image/jpeg" })
    const url = await savePhoto(file, "dog-1", "2026-03-01")
    expect(url).toMatch(/^\/api\/photos\/dog-1\/2026-03-01\/[a-f0-9-]+\.jpg$/)
  })

  it("accepts PNG files", async () => {
    const file = new File(["image-data"], "photo.png", { type: "image/png" })
    const url = await savePhoto(file, "dog-1", "2026-03-01")
    expect(url).toMatch(/^\/api\/photos\/dog-1\/2026-03-01\/[a-f0-9-]+\.jpg$/)
  })

  it("creates directory recursively", async () => {
    const file = new File(["image-data"], "photo.jpg", { type: "image/jpeg" })
    await savePhoto(file, "dog-1", "2026-03-01")
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(path.join("dog-1", "2026-03-01")),
      { recursive: true },
    )
  })
})

describe("getPhotoPath", () => {
  it("blocks directory traversal", async () => {
    const result = await getPhotoPath(["..", "..", "etc", "passwd"])
    expect(result).toBeNull()
  })

  it("returns null for nonexistent files", async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"))
    const result = await getPhotoPath(["dog-1", "2026-03-01", "photo.jpg"])
    expect(result).toBeNull()
  })

  it("returns path for existing files", async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    const result = await getPhotoPath(["dog-1", "2026-03-01", "photo.jpg"])
    expect(result).toContain(path.join("dog-1", "2026-03-01", "photo.jpg"))
  })
})
