export function userInApproverPool(
  snapshot: string[] | null | undefined,
  userId: string
): boolean {
  if (!snapshot || snapshot.length === 0) return true;
  return snapshot.includes(userId);
}
