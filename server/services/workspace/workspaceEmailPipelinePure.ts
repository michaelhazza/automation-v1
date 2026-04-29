import { createHash, randomUUID } from 'node:crypto';

export interface DedupeInput {
  fromAddress: string;
  subject: string;
  sentAtIso: string;
  providerMessageId: string;
}

export function computeDedupeKey(input: DedupeInput): string {
  return createHash('sha256')
    .update(`${input.fromAddress}|${input.subject}|${input.sentAtIso}|${input.providerMessageId}`)
    .digest('hex');
}

export interface SignatureInput {
  template: string;
  agentName: string;
  role: string;
  subaccountName: string;
  discloseAsAgent: boolean;
  agencyName?: string;
}

export function applySignature(body: string, sig: SignatureInput): string {
  let signature = sig.template
    .replaceAll('{agent-name}', sig.agentName)
    .replaceAll('{role}', sig.role)
    .replaceAll('{subaccount-name}', sig.subaccountName);
  if (sig.discloseAsAgent) {
    signature += `\n\nSent by ${sig.agentName}, AI agent at ${sig.subaccountName}, on behalf of ${sig.agencyName ?? sig.subaccountName}.`;
  }
  return `${body}\n\n--\n${signature}`;
}

export type ThreadLookup = (externalIds: string[]) => Promise<string | null>;

export interface ThreadInput {
  inReplyToExternalId?: string;
  referencesExternalIds: string[];
}

export async function resolveThreadId(input: ThreadInput, lookup: ThreadLookup): Promise<string> {
  const externalIds = [
    ...(input.inReplyToExternalId ? [input.inReplyToExternalId] : []),
    ...input.referencesExternalIds,
  ];
  const existing = externalIds.length ? await lookup(externalIds) : null;
  return existing ?? randomUUID();
}
