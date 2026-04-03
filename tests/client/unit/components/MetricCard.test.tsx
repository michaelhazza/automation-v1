// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MetricCard from '@/components/MetricCard';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const icon = <span data-testid="metric-icon">IC</span>;

describe('MetricCard', () => {
  it('renders the label and value', () => {
    renderWithRouter(<MetricCard label="Total Tasks" value={42} icon={icon} />);
    expect(screen.getByText('Total Tasks')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders a string value', () => {
    renderWithRouter(<MetricCard label="Status" value="Healthy" icon={icon} />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders zero value correctly', () => {
    renderWithRouter(<MetricCard label="Errors" value={0} icon={icon} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows the sub text when provided', () => {
    renderWithRouter(<MetricCard label="Revenue" value="$1,200" sub="+12% this month" icon={icon} />);
    expect(screen.getByText('+12% this month')).toBeInTheDocument();
  });

  it('shows utilisation bar when utilisation is provided', () => {
    renderWithRouter(<MetricCard label="Budget" value="$800" icon={icon} utilisation={0.75} />);
    expect(screen.getByText('Utilisation')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders as a link when `to` is provided', () => {
    renderWithRouter(<MetricCard label="Tasks" value={10} icon={icon} to="/tasks" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/tasks');
  });
});
