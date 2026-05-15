import React from 'react';

const BOUNCE_DELAY_CLS = ['[animation-delay:0s]', '[animation-delay:0.2s]', '[animation-delay:0.4s]'];

export default function TypingIndicator() {
  return (
    <>
      <div className="flex items-end gap-2 self-start">
        <div className="bg-white text-slate-800 rounded-[18px_18px_18px_4px] px-4 py-3 shadow-sm flex gap-1.5 items-center">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`w-1.5 h-1.5 rounded-full bg-slate-400 inline-block [animation:typingBounce_1.2s_ease-in-out_infinite] ${BOUNCE_DELAY_CLS[i]}`} />
          ))}
        </div>
      </div>
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </>
  );
}
