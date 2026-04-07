/**
 * Skill visibility helpers — Code Change A from the Reporting Agent spec.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §3 / T6.
 *
 * Two distinct predicates, intentionally separated:
 *  - canViewContents(): may the viewer read the skill body (instructions,
 *    methodology, definition)? Owner-tier viewers always can. Lower tiers
 *    only when the skill is flagged contentsVisible.
 *  - canManageSkill(): may the viewer edit/delete the skill? Owner-tier
 *    only AND must hold the relevant permission.
 *
 * Visibility never grants write access. The two are explicitly distinct
 * because an owner-tier user may legitimately need read access without
 * edit rights.
 */

export type SkillTier = 'system' | 'organisation' | 'subaccount';

export interface SkillVisibilityInput {
  /** Tier that owns the skill (where it was defined). */
  ownerTier: SkillTier;
  /** Whether the contents-visible flag is set on the skill. */
  contentsVisible: boolean;
}

export interface SkillViewer {
  /** Tier of the viewer relative to the skill being inspected. */
  tier: SkillTier;
  /** Whether the viewer holds the skill-management permission at their tier. */
  hasManagePermission: boolean;
}

/**
 * May the viewer read the full skill body (instructions, methodology,
 * tool definition)?
 *
 * Rules:
 *  - Owner tier always sees contents (no manage permission required for read).
 *  - Lower tiers gated by the contentsVisible flag.
 */
export function canViewContents(skill: SkillVisibilityInput, viewer: SkillViewer): boolean {
  if (viewer.tier === skill.ownerTier) return true;
  return skill.contentsVisible === true;
}

/**
 * May the viewer edit / delete the skill?
 *
 * Rules:
 *  - Must be at the owning tier.
 *  - Must hold the skill-management permission at that tier.
 *  - The contentsVisible flag is irrelevant — visibility never grants edit.
 */
export function canManageSkill(skill: SkillVisibilityInput, viewer: SkillViewer): boolean {
  if (viewer.tier !== skill.ownerTier) return false;
  return viewer.hasManagePermission === true;
}
