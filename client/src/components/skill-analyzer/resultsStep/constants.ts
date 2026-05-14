export type Classification = 'DUPLICATE' | 'IMPROVEMENT' | 'PARTIAL_OVERLAP' | 'DISTINCT';

export const SECTION_CONFIG: Record<Classification, {
  label: string;
  dot: string;         // Tailwind bg-* class for the section dot
  bandBg: string;      // hex colour for header band background
  bandBorder: string;  // hex colour for header band bottom border
  badgeBg: string;     // hex colour for count badge background
  badgeText: string;   // hex colour for count badge text
  defaultOpen: boolean;
}> = {
  PARTIAL_OVERLAP: {
    label: 'Partial Overlaps',
    dot: 'bg-amber-400',
    bandBg: '#fffbeb',
    bandBorder: '#fcd34d',
    badgeBg: '#fef3c7',
    badgeText: '#92400e',
    defaultOpen: true,
  },
  IMPROVEMENT: {
    label: 'Replacements — incoming is strictly better',
    dot: 'bg-blue-400',
    bandBg: '#eff6ff',
    bandBorder: '#93c5fd',
    badgeBg: '#dbeafe',
    badgeText: '#1e40af',
    defaultOpen: true,
  },
  DISTINCT: {
    label: 'New Skills',
    dot: 'bg-green-400',
    bandBg: '#f0fdf4',
    bandBorder: '#86efac',
    badgeBg: '#dcfce7',
    badgeText: '#166534',
    defaultOpen: true,
  },
  DUPLICATE: {
    label: 'Duplicates — already in library',
    dot: 'bg-red-400',
    bandBg: '#fef2f2',
    bandBorder: '#fca5a5',
    badgeBg: '#fee2e2',
    badgeText: '#991b1b',
    defaultOpen: false,
  },
};
