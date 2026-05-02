import { useState, useEffect, useRef } from 'react';

const TOUR_KEY = 'clientpulse_tour_completed';

interface TourStep {
  targetId: string;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

const TOUR_STEPS: TourStep[] = [
  {
    targetId: 'tour-health-widget',
    title: 'Portfolio health at a glance',
    body: 'Green means healthy, yellow needs attention, red is at risk. This gives you a snapshot of your entire portfolio instantly.',
    placement: 'bottom',
  },
  {
    targetId: 'tour-high-risk-widget',
    title: 'High-risk clients',
    body: 'These clients have the highest churn risk this week — prioritise reaching out to them first.',
    placement: 'bottom',
  },
  {
    targetId: 'tour-latest-report-widget',
    title: 'Your weekly report',
    body: 'Your full weekly report lives here. It\'s also delivered to your inbox every Monday morning automatically.',
    placement: 'top',
  },
  {
    targetId: 'tour-reports-nav',
    title: 'All past reports',
    body: 'Every report is saved here — you can share them with clients or review historical trends.',
    placement: 'right',
  },
];

interface TooltipPos {
  top: number;
  left: number;
  arrowDir: 'up' | 'down' | 'left' | 'right';
}

function getTooltipPosition(el: Element, placement: TourStep['placement'] = 'bottom'): TooltipPos {
  const rect = el.getBoundingClientRect();
  const TOOLTIP_W = 280;
  const TOOLTIP_H = 120; // approximate
  const GAP = 12;

  switch (placement) {
    case 'bottom':
      return {
        top: rect.bottom + GAP,
        left: Math.min(Math.max(rect.left + rect.width / 2 - TOOLTIP_W / 2, 16), window.innerWidth - TOOLTIP_W - 16),
        arrowDir: 'up',
      };
    case 'top':
      return {
        top: rect.top - TOOLTIP_H - GAP,
        left: Math.min(Math.max(rect.left + rect.width / 2 - TOOLTIP_W / 2, 16), window.innerWidth - TOOLTIP_W - 16),
        arrowDir: 'down',
      };
    case 'right':
      return {
        top: rect.top + rect.height / 2 - TOOLTIP_H / 2,
        left: rect.right + GAP,
        arrowDir: 'left',
      };
    case 'left':
      return {
        top: rect.top + rect.height / 2 - TOOLTIP_H / 2,
        left: rect.left - TOOLTIP_W - GAP,
        arrowDir: 'right',
      };
  }
}

interface GuidedTourProps {
  /** Pass true to force-show (e.g. for testing). Otherwise auto-shows if not yet seen. */
  forceShow?: boolean;
}

export default function GuidedTour({ forceShow = false }: GuidedTourProps) {
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const highlightRef = useRef<{ top: number; left: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const alreadySeen = localStorage.getItem(TOUR_KEY);
    if (!alreadySeen || forceShow) {
      // Slight delay so the dashboard has time to render its widgets
      const t = setTimeout(() => setActive(true), 800);
      return () => clearTimeout(t);
    }
  }, [forceShow]);

  const dismiss = () => {
    setActive(false);
    localStorage.setItem(TOUR_KEY, '1');
  };

  useEffect(() => {
    if (!active) return;
    const currentStep = TOUR_STEPS[step];
    if (!currentStep) return;

    const recalc = () => {
      const el = document.getElementById(currentStep.targetId);
      if (!el) {
        // Target not found — skip to next or dismiss if already at last step
        if (step >= TOUR_STEPS.length - 1) {
          dismiss();
        } else {
          setStep((s) => s + 1);
        }
        return;
      }
      const rect = el.getBoundingClientRect();
      highlightRef.current = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      setPos(getTooltipPosition(el, currentStep.placement));
    };

    recalc();
    window.addEventListener('scroll', recalc, { passive: true });
    window.addEventListener('resize', recalc);
    return () => {
      window.removeEventListener('scroll', recalc);
      window.removeEventListener('resize', recalc);
    };
   
  }, [active, step]);

  const next = () => {
    if (step < TOUR_STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  if (!active || !pos) return null;

  const hl = highlightRef.current;
  const currentStep = TOUR_STEPS[step];

  return (
    <>
      {/* Backdrop with hole cutout */}
      <div
        className="fixed inset-0 z-[999] pointer-events-none"
        style={{
          background: 'rgba(0,0,0,0.45)',
          ...(hl ? {
            WebkitMaskImage: `radial-gradient(ellipse ${hl.width + 24}px ${hl.height + 24}px at ${hl.left + hl.width / 2}px ${hl.top + hl.height / 2}px, transparent 85%, black 100%)`,
            maskImage: `radial-gradient(ellipse ${hl.width + 24}px ${hl.height + 24}px at ${hl.left + hl.width / 2}px ${hl.top + hl.height / 2}px, transparent 85%, black 100%)`,
          } : {}),
        }}
      />

      {/* Click-through catcher for dismiss */}
      <div
        className="fixed inset-0 z-[1000]"
        onClick={dismiss}
      />

      {/* Tooltip */}
      <div
        className="fixed z-[1001] w-[280px] bg-slate-900 text-white rounded-xl shadow-2xl border border-white/10 p-4 animate-[fadeIn_0.15s_ease-out_both]"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Arrow */}
        {pos.arrowDir === 'up' && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 border-l border-t border-white/10 rotate-45" />
        )}
        {pos.arrowDir === 'down' && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 border-r border-b border-white/10 rotate-45" />
        )}
        {pos.arrowDir === 'left' && (
          <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-3 h-3 bg-slate-900 border-l border-b border-white/10 rotate-45" />
        )}
        {pos.arrowDir === 'right' && (
          <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-3 h-3 bg-slate-900 border-r border-t border-white/10 rotate-45" />
        )}

        {/* Step counter */}
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Step {step + 1} of {TOUR_STEPS.length}
          </span>
          <button
            onClick={dismiss}
            className="text-slate-500 hover:text-slate-300 bg-transparent border-0 cursor-pointer text-[15px] leading-none p-0.5"
          >
            ×
          </button>
        </div>

        <h3 className="text-[14px] font-bold text-white mb-1.5">{currentStep.title}</h3>
        <p className="text-[13px] text-slate-300 leading-relaxed mb-4">{currentStep.body}</p>

        {/* Dots + nav */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {TOUR_STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === step ? 'bg-indigo-400' : 'bg-slate-600'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={dismiss}
              className="text-[12px] text-slate-400 hover:text-slate-200 bg-transparent border-0 cursor-pointer px-2 py-1 rounded"
            >
              Skip tour
            </button>
            <button
              onClick={next}
              className="text-[12px] text-white bg-indigo-600 hover:bg-indigo-500 border-0 cursor-pointer px-3 py-1 rounded-lg font-semibold transition-colors"
            >
              {step === TOUR_STEPS.length - 1 ? 'Got it' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
