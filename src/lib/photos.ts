import path from "path"
import fs from "fs/promises"
import sharp from "sharp"
import { randomUUID } from "crypto"

const PHOTOS_DIR = path.join(process.cwd(), "data", "photos")
const MAX_WIDTH = 1200
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png"]

export async function savePhoto(
  file: File,
  dogId: string,
  date: string,
): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("Only JPEG and PNG files are accepted")
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error("File must be under 10MB")
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const resized = await sharp(buffer)
    .resize(MAX_WIDTH, undefined, { withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()

  // Validate date format to prevent path traversal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date format")
  }

  const dir = path.join(PHOTOS_DIR, dogId, date)
  const resolved = path.resolve(dir)
  if (!resolved.startsWith(path.resolve(PHOTOS_DIR))) {
    throw new Error("Invalid path")
  }
  await fs.mkdir(dir, { recursive: true })

  const filename = `${randomUUID()}.jpg`
  const filepath = path.join(dir, filename)
  await fs.writeFile(filepath, resized)

  return `/api/photos/${dogId}/${date}/${filename}`
}

export async function getPhotoPath(segments: string[]): Promise<string | null> {
  const filepath = path.join(PHOTOS_DIR, ...segments)

  // Prevent directory traversal
  const resolved = path.resolve(filepath)
  if (!resolved.startsWith(path.resolve(PHOTOS_DIR))) {
    return null
  }

  try {
    await fs.access(filepath)
    return filepath
  } catch {
    return null
  }
}
