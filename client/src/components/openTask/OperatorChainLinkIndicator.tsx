// Operator chain-link status indicator rendered next to the status badge in
// TaskHeader. Three variants per mockup r14 and spec §3.9 item 9:
//   - Running, known estimate: "link 3 of ~12"
//   - Running, unknown:        "link 3 of --"
//   - Terminal:                "6 sessions, 12h 4m total"

import { formatChainLinkRunning, formatChainLinkTerminal } from '../operator/_shared.js';

interface RunningProps {
  variant: 'running';
  chainSeq: number;
  estimatedTotalLinks: number | null;
}

interface TerminalProps {
  variant: 'terminal';
  totalLinks: number;
  totalElapsedMs: number;
}

type OperatorChainLinkIndicatorProps = RunningProps | TerminalProps;

export function OperatorChainLinkIndicator(props: OperatorChainLinkIndicatorProps) {
  const label =
    props.variant === 'running'
      ? formatChainLinkRunning({
          chainSeq: props.chainSeq,
          estimatedTotalLinks: props.estimatedTotalLinks,
        })
      : formatChainLinkTerminal({
          totalLinks: props.totalLinks,
          totalElapsedMs: props.totalElapsedMs,
        });

  return (
    <span className="text-[11px] text-slate-500 font-medium ml-1">
      {label}
    </span>
  );
}
