// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HeartbeatEditor, { type HeartbeatAgentConfig } from '@/components/HeartbeatEditor';

const agent: HeartbeatAgentConfig = {
  id: 'a1',
  name: 'Research Bot',
  icon: null,
  heartbeatEnabled: true,
  heartbeatIntervalHours: 8,
  heartbeatOffsetHours: 6,
  heartbeatOffsetMinutes: 0,
};

const disabledAgent: HeartbeatAgentConfig = {
  ...agent,
  id: 'a2',
  name: 'Disabled Bot',
  heartbeatEnabled: false,
};

describe('HeartbeatEditor', () => {
  it('renders the Heartbeat Schedule heading', () => {
    render(<HeartbeatEditor agents={[agent]} onUpdate={vi.fn()} />);
    expect(screen.getByText('Heartbeat Schedule')).toBeInTheDocument();
  });

  it('renders agent names', () => {
    render(<HeartbeatEditor agents={[agent, disabledAgent]} onUpdate={vi.fn()} />);
    expect(screen.getByText('Research Bot')).toBeInTheDocument();
    expect(screen.getByText('Disabled Bot')).toBeInTheDocument();
  });

  it('shows "disabled" text for disabled agents', () => {
    render(<HeartbeatEditor agents={[disabledAgent]} onUpdate={vi.fn()} />);
    expect(screen.getByText('disabled')).toBeInTheDocument();
  });

  it('calls onUpdate when toggle is clicked', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<HeartbeatEditor agents={[disabledAgent]} onUpdate={onUpdate} />);
    // The toggle is a button inside the agent row
    const toggles = screen.getAllByRole('button');
    // The first button in the row is the toggle
    fireEvent.click(toggles[0]);
    expect(onUpdate).toHaveBeenCalledWith('a2', expect.objectContaining({
      heartbeatEnabled: true,
    }));
  });

  it('shows empty state when no agents provided', () => {
    render(<HeartbeatEditor agents={[]} onUpdate={vi.fn()} />);
    expect(screen.getByText('No agents available.')).toBeInTheDocument();
  });

  it('displays timezone badge', () => {
    render(<HeartbeatEditor agents={[agent]} onUpdate={vi.fn()} timezone="America/New_York" />);
    expect(screen.getByText((content) => content.includes('America/New_York'))).toBeInTheDocument();
  });
});
