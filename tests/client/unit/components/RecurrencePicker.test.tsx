// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecurrencePicker from '@/components/RecurrencePicker';

const defaultValue = {
  rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR',
  endsAt: null,
  endsAfterRuns: null,
};

describe('RecurrencePicker', () => {
  it('renders the "Repeat every" section with interval input', () => {
    render(<RecurrencePicker value={defaultValue} onChange={vi.fn()} />);
    expect(screen.getByText('Repeat every')).toBeInTheDocument();
    const intervalInput = screen.getByDisplayValue('1');
    expect(intervalInput).toBeInTheDocument();
  });

  it('renders the frequency selector with "week" selected', () => {
    render(<RecurrencePicker value={defaultValue} onChange={vi.fn()} />);
    const select = screen.getByDisplayValue('week');
    expect(select).toBeInTheDocument();
  });

  it('shows weekday buttons for weekly frequency', () => {
    render(<RecurrencePicker value={defaultValue} onChange={vi.fn()} />);
    expect(screen.getByText('Repeat on')).toBeInTheDocument();
    // DAYS labels: M, T, W, T, F, S, S
    const buttons = screen.getAllByRole('button');
    // There should be 7 day buttons
    expect(buttons.length).toBe(7);
  });

  it('calls onChange when interval is updated', () => {
    const onChange = vi.fn();
    render(<RecurrencePicker value={defaultValue} onChange={onChange} />);
    const intervalInput = screen.getByDisplayValue('1');
    fireEvent.change(intervalInput, { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      rrule: expect.stringContaining('INTERVAL=2'),
    }));
  });

  it('renders end condition radio buttons', () => {
    render(<RecurrencePicker value={defaultValue} onChange={vi.fn()} />);
    expect(screen.getByText('Ends')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
  });

  it('calls onChange with endsAfterRuns when "After" end type is selected', () => {
    const onChange = vi.fn();
    render(<RecurrencePicker value={defaultValue} onChange={onChange} />);
    const afterRadio = screen.getByLabelText(/After/);
    fireEvent.click(afterRadio);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      endsAfterRuns: 13, // default value
      endsAt: null,
    }));
  });
});
