// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskCard from '@/components/TaskCard';

const baseItem = {
  id: '1',
  title: 'Fix login bug',
  priority: 'high',
  createdAt: '2026-01-01T00:00:00Z',
};

describe('TaskCard', () => {
  it('renders the task title', () => {
    render(<TaskCard item={baseItem} onClick={() => {}} />);
    expect(screen.getByText('Fix login bug')).toBeInTheDocument();
  });

  it('renders the priority indicator with correct color class', () => {
    const { container } = render(<TaskCard item={{ ...baseItem, priority: 'urgent' }} onClick={() => {}} />);
    const dot = container.querySelector('.bg-red-500');
    expect(dot).toBeInTheDocument();
  });

  it('shows "Unassigned" when no agents are provided', () => {
    render(<TaskCard item={baseItem} onClick={() => {}} />);
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('shows assigned agent names', () => {
    const item = {
      ...baseItem,
      assignedAgents: [
        { id: 'a1', name: 'Research Bot', slug: 'research-bot' },
        { id: 'a2', name: 'Writer Bot', slug: 'writer-bot' },
      ],
    };
    render(<TaskCard item={item} onClick={() => {}} />);
    expect(screen.getByText('Research Bot')).toBeInTheDocument();
    expect(screen.getByText('Writer Bot')).toBeInTheDocument();
  });

  it('shows overflow count when more than 3 agents assigned', () => {
    const item = {
      ...baseItem,
      assignedAgents: [
        { id: 'a1', name: 'Agent 1', slug: 'a1' },
        { id: 'a2', name: 'Agent 2', slug: 'a2' },
        { id: 'a3', name: 'Agent 3', slug: 'a3' },
        { id: 'a4', name: 'Agent 4', slug: 'a4' },
      ],
    };
    render(<TaskCard item={item} onClick={() => {}} />);
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('Agent 4')).not.toBeInTheDocument();
  });

  it('fires onClick handler when clicked', () => {
    const onClick = vi.fn();
    render(<TaskCard item={baseItem} onClick={onClick} />);
    fireEvent.click(screen.getByText('Fix login bug'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
