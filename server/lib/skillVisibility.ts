/**
 * Skill visibility helpers — three-state cascade.
 *
 * The cascade runs system → organisation → subaccount. At every level the
 * owner sets a `visibility` value that controls what the level below sees:
 *
 *   none   — skill is invisible to lower tiers (filtered out of lists)
 *   basic  — name + one-line description visible only; body stripped
 *   full   — everything visible (instructions, methodology, definition)
 *
 * Two predicates kept intentionally distinct from `canManageSkill`:
 *  - isVisibleToViewer():  may the viewer SEE the skill in lists at all
 *  - canViewContents():    may the viewer read the body fields
 *  - canManageSkill():     may the viewer edit/delete the skill (owner-tier
 *                          + permission only — visibility never grants edit)
 *
 * Owner-tier viewers always see everything regardless of the visibility
 * value. Visibility only ever restricts; it never expands.
 */

export type SkillTier = 'system' | 'organisation' | 'subaccount';
export type SkillVisibility = 'none' | 'basic' | 'full';

export const SKILL_VISIBILITY_VALUES: readonly SkillVisibility[] = ['none', 'basic', 'full'];

export function isSkillVisibility(v: unknown): v is SkillVisibility {
  return v === 'none' || v === 'basic' || v === 'full';
}

export interface SkillVisibilityInput {
  /** Tier that owns the skill (where it was defined). */
  ownerTier: SkillTier;
  /** Cascade visibility set by the owner. */
  visibility: SkillVisibility;
}

export interface SkillViewer {
  /** Tier of the viewer relative to the skill being inspected. */
  tier: SkillTier;
  /** Whether the viewer holds the skill-management permission at their tier. */
  hasManagePermission: boolean;
}

/**
 * Is the skill visible to the viewer at all? Owner tier always yes; lower
 * tiers only when visibility is 'basic' or 'full'.
 *
 * Used to filter list endpoints. List responses must omit skills entirely
 * when this returns false.
 */
export function isSkillVisibleToViewer(skill: SkillVisibilityInput, viewer: SkillViewer): boolean {
  if (viewer.tier === skill.ownerTier) return true;
  return skill.visibility !== 'none';
}

/**
 * May the viewer read the full skill body (instructions, methodology,
 * tool definition)?
 *
 *  - Owner tier always yes.
 *  - Lower tiers: only when visibility === 'full'. The 'basic' state shows
 *    metadata only and the body is stripped at the response boundary.
 */
export function canViewContents(skill: SkillVisibilityInput, viewer: SkillViewer): boolean {
  if (viewer.tier === skill.ownerTier) return true;
  return skill.visibility === 'full';
}

/**
 * May the viewer edit / delete the skill?
 *
 *  - Must be at the owning tier.
 *  - Must hold the skill-management permission at that tier.
 *  - Visibility is irrelevant — visibility never grants edit.
 */
export function canManageSkill(skill: SkillVisibilityInput, viewer: SkillViewer): boolean {
  if (viewer.tier !== skill.ownerTier) return false;
  return viewer.hasManagePermission === true;
}
