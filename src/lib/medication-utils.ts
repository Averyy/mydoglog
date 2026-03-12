import {
  LiaCapsulesSolid,
  LiaSyringeSolid,
  LiaTintSolid,
  LiaSprayCanSolid,
  LiaMortarPestleSolid,
  LiaRingSolid,
} from "react-icons/lia"
import type { IconType } from "react-icons"

export const DOSAGE_FORM_ICONS: Record<string, IconType> = {
  tablet: LiaCapsulesSolid,
  chewable: LiaCapsulesSolid,
  capsule: LiaCapsulesSolid,
  liquid: LiaTintSolid,
  injection: LiaSyringeSolid,
  topical: LiaTintSolid,
  spray: LiaSprayCanSolid,
  powder: LiaMortarPestleSolid,
  granules: LiaMortarPestleSolid,
  gel: LiaTintSolid,
  collar: LiaRingSolid,
}

export function getDosageFormIcon(dosageForm: string | null | undefined): IconType {
  if (!dosageForm) return LiaCapsulesSolid
  return DOSAGE_FORM_ICONS[dosageForm] ?? LiaCapsulesSolid
}
