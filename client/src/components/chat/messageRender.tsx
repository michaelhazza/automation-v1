import React from 'react';

export function renderAssistantContent(text: string): React.ReactNode[] {
  const codeBlockRegex = /```[\s\S]*?```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) parts.push(...renderInlineMarkdown(before, keyIdx++));
    const code = match[0].replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
    parts.push(
      <pre key={`code-${keyIdx++}`} className="bg-slate-900 text-slate-200 px-4 py-3 rounded-lg text-[12.5px] overflow-auto whitespace-pre-wrap break-words leading-relaxed my-2 font-mono border border-slate-800">
        <code>{code}</code>
      </pre>
    );
    lastIndex = match.index + match[0].length;
  }
  const remaining = text.slice(lastIndex);
  if (remaining) parts.push(...renderInlineMarkdown(remaining, keyIdx));
  return parts;
}

export function renderInlineMarkdown(text: string, baseKey: number): React.ReactNode[] {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let i = 0;
  let k = baseKey * 10000;

  while (i < lines.length) {
    const line = lines[i];
    if (line.match(/^- .+/)) {
      const listItems: React.ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^- .+/)) {
        listItems.push(<li key={`li-${k++}`} className="mb-0.5">{renderBold(lines[i].slice(2), k++)}</li>);
        i++;
      }
      result.push(<ul key={`ul-${k++}`} className="my-1 pl-5">{listItems}</ul>);
      continue;
    }
    if (line.trim() === '') { result.push(<br key={`br-${k++}`} />); i++; continue; }
    result.push(
      <span key={`line-${k++}`}>
        {renderBold(line, k++)}
        {i < lines.length - 1 && lines[i + 1] !== '' && !lines[i + 1].match(/^- /) ? <br /> : null}
      </span>
    );
    i++;
  }
  return result;
}

export function renderBold(text: string, baseKey: number): React.ReactNode[] {
  const boldRegex = /\*\*(.+?)\*\*/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let k = baseKey * 100;
  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(<span key={`txt-${k++}`}>{text.slice(lastIndex, match.index)}</span>);
    parts.push(<strong key={`bold-${k++}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(<span key={`txt-${k++}`}>{text.slice(lastIndex)}</span>);
  return parts.length ? parts : [<span key={`txt-${k}`}>{text}</span>];
}
