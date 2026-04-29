import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { User } from '../lib/auth';
import { getAgentMailbox, getAgentMailboxThread, sendAgentEmail } from '../lib/api';

interface Message {
  id: string;
  threadId: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  bodyText: string | null;
  direction: 'inbound' | 'outbound';
  receivedAt: string | null;
  sentAt: string | null;
  metadata: Record<string, unknown> | null;
}

interface Thread {
  threadId: string;
  subject: string;
  lastMessage: Message;
  messageCount: number;
}

export default function AgentMailboxPage({ user: _user }: { user: User }) {
  const { subaccountId, agentId } = useParams<{ subaccountId: string; agentId: string }>();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await getAgentMailbox(agentId);
      // Group messages into threads
      const messages: Message[] = data.messages ?? [];
      const threadMap = new Map<string, Thread>();
      for (const m of messages) {
        const existing = threadMap.get(m.threadId);
        if (!existing || new Date(m.receivedAt ?? m.sentAt ?? 0) > new Date(existing.lastMessage.receivedAt ?? existing.lastMessage.sentAt ?? 0)) {
          threadMap.set(m.threadId, {
            threadId: m.threadId,
            subject: m.subject,
            lastMessage: m,
            messageCount: (existing?.messageCount ?? 0) + 1,
          });
        } else {
          existing.messageCount += 1;
        }
      }
      setThreads(Array.from(threadMap.values()).sort(
        (a, b) => new Date(b.lastMessage.receivedAt ?? b.lastMessage.sentAt ?? 0).getTime() - new Date(a.lastMessage.receivedAt ?? a.lastMessage.sentAt ?? 0).getTime()
      ));
    } catch {
      // ignore — no identity provisioned yet
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!selectedThreadId || !agentId) return;
    setThreadLoading(true);
    getAgentMailboxThread(agentId, selectedThreadId)
      .then((data) => setThreadMessages(data.messages ?? []))
      .catch(() => setThreadMessages([]))
      .finally(() => setThreadLoading(false));
  }, [selectedThreadId, agentId]);

  async function handleSend() {
    if (!agentId) return;
    setSending(true);
    try {
      await sendAgentEmail(agentId, { to: composeTo, subject: composeSubject, bodyText: composeBody });
      setComposeOpen(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      await load();
    } catch {
      // surface error inline — keep modal open
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 -mx-6 -my-7">
      {/* Thread list */}
      <div className="w-72 border-r border-slate-200 flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold text-slate-800">Mailbox</div>
            <Link
              to={`/admin/subaccounts/${subaccountId}`}
              className="text-[11px] text-slate-400 hover:text-slate-600 no-underline"
            >
              ← Back
            </Link>
          </div>
          <button
            onClick={() => setComposeOpen(true)}
            className="px-3 py-1.5 text-[12px] bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Compose
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-4 py-4 text-[13px] text-slate-400">Loading…</div>}
          {!loading && threads.length === 0 && (
            <div className="px-4 py-8 text-[13px] text-slate-400 text-center">No messages yet</div>
          )}
          {threads.map((thread) => (
            <button
              key={thread.threadId}
              onClick={() => setSelectedThreadId(thread.threadId)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors bg-transparent cursor-pointer ${
                selectedThreadId === thread.threadId ? 'bg-indigo-50' : ''
              }`}
            >
              <div className="text-[13px] font-medium text-slate-800 truncate">{thread.subject}</div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate">{thread.lastMessage.fromAddress}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                {new Date(thread.lastMessage.receivedAt ?? thread.lastMessage.sentAt ?? 0).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread view */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedThreadId && (
          <div className="flex-1 flex items-center justify-center text-[14px] text-slate-400">
            Select a thread to read
          </div>
        )}
        {selectedThreadId && (
          <>
            <div className="px-6 py-3 border-b border-slate-200 text-[13px] font-semibold text-slate-800">
              {threads.find(t => t.threadId === selectedThreadId)?.subject ?? 'Thread'}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {threadLoading && <div className="text-[13px] text-slate-400">Loading…</div>}
              {threadMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-4 rounded-lg border ${msg.direction === 'outbound' ? 'bg-indigo-50 border-indigo-100 ml-8' : 'bg-white border-slate-200'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] font-medium text-slate-700">{msg.fromAddress}</span>
                    <span className="text-[11px] text-slate-400">{new Date(msg.receivedAt ?? msg.sentAt ?? 0).toLocaleString()}</span>
                    <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      msg.direction === 'outbound' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {msg.direction}
                    </span>
                  </div>
                  <div className="text-[13px] text-slate-700 whitespace-pre-wrap">{msg.bodyText ?? '(no body)'}</div>
                  {typeof msg.metadata?.gmail_thread_id === 'string' && (
                    <a
                      href={`https://mail.google.com/mail/u/0/#inbox/${msg.metadata.gmail_thread_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-block text-[12px] text-indigo-500 hover:underline"
                    >
                      Open in Gmail →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Compose modal */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Compose email</h2>
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                To
                <input
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  value={composeTo}
                  onChange={e => setComposeTo(e.target.value)}
                  placeholder="recipient@example.com"
                />
              </label>
              <label className="block text-sm font-medium">
                Subject
                <input
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  value={composeSubject}
                  onChange={e => setComposeSubject(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Body
                <textarea
                  className="mt-1 block w-full border rounded px-3 py-2 text-sm"
                  rows={5}
                  value={composeBody}
                  onChange={e => setComposeBody(e.target.value)}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setComposeOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded">
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !composeTo || !composeSubject}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
