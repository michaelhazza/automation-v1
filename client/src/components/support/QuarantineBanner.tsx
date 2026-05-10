interface QuarantineBannerProps {
  ticketId?: string;
}

export default function QuarantineBanner({ ticketId }: QuarantineBannerProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      <span>
        This ticket has an unknown status in the provider and cannot accept automated replies.
        {ticketId && (
          <> Ticket ID: <code className="font-mono">{ticketId}</code></>
        )}
      </span>
    </div>
  );
}
