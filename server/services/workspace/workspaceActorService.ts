import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { workspaceActors } from '../../db/schema/workspaceActors.js';
import { throwFailure } from '../../../shared/iee/failure.js';

export type WorkspaceActor = typeof workspaceActors.$inferSelect;

const MAX_ANCESTOR_DEPTH = 20;

export const workspaceActorService = {
  async getActorById(id: string): Promise<WorkspaceActor | null> {
    const [row] = await db
      .select()
      .from(workspaceActors)
      .where(eq(workspaceActors.id, id));
    return row ?? null;
  },

  async listActorsForSubaccount(subaccountId: string): Promise<WorkspaceActor[]> {
    return db
      .select()
      .from(workspaceActors)
      .where(eq(workspaceActors.subaccountId, subaccountId));
  },

  async updateDisplayName(id: string, displayName: string): Promise<WorkspaceActor> {
    const [updated] = await db
      .update(workspaceActors)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(workspaceActors.id, id))
      .returning();
    if (!updated) throw { statusCode: 404, message: 'WorkspaceActor not found' };
    return updated;
  },

  async setParent(
    actorId: string,
    parentActorId: string | null,
  ): Promise<WorkspaceActor> {
    if (parentActorId !== null) {
      // Self-reference check
      if (parentActorId === actorId) {
        throwFailure(
          'parent_actor_cycle_detected',
          'cycle detected',
          { actorId, parentActorId },
        );
      }

      // Verify both actor and proposed parent exist and are in the same subaccount
      const [actor, parent] = await Promise.all([
        workspaceActorService.getActorById(actorId),
        workspaceActorService.getActorById(parentActorId),
      ]);

      if (!actor) throw { statusCode: 404, message: 'WorkspaceActor not found' };
      if (!parent) throw { statusCode: 404, message: 'Parent WorkspaceActor not found' };

      if (actor.subaccountId !== parent.subaccountId) {
        throw { statusCode: 422, message: 'Parent actor must be in the same subaccount' };
      }

      // Ancestor walk — reject if actorId appears in proposed parent's ancestry
      let current: WorkspaceActor | null = parent;
      let depth = 0;
      while (current !== null) {
        if (current.parentActorId === null) break;

        depth += 1;
        if (depth > MAX_ANCESTOR_DEPTH) {
          throwFailure(
            'parent_actor_cycle_detected',
            'ancestor depth cap reached — possible corrupted data',
            { actorId, parentActorId, depth },
          );
        }

        if (current.parentActorId === actorId) {
          throwFailure(
            'parent_actor_cycle_detected',
            'cycle detected',
            { actorId, parentActorId },
          );
        }

        // eslint-disable-next-line no-await-in-loop
        current = await workspaceActorService.getActorById(current.parentActorId);
      }
    }

    const [updated] = await db
      .update(workspaceActors)
      .set({ parentActorId, updatedAt: new Date() })
      .where(eq(workspaceActors.id, actorId))
      .returning();
    if (!updated) throw { statusCode: 404, message: 'WorkspaceActor not found' };
    return updated;
  },
};
