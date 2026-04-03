// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CommandPalette from '@/components/CommandPalette';

// Mock the api module
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/api/subaccounts') {
        return Promise.resolve({ data: [
          { id: 'c1', name: 'Acme Corp', status: 'active' },
          { id: 'c2', name: 'Globex Inc', status: 'active' },
        ]});
      }
      if (url === '/api/agents') {
        return Promise.resolve({ data: [
          { id: 'ag1', name: 'Research Agent' },
        ]});
      }
      return Promise.resolve({ data: [] });
    }),
  },
}));

vi.mock('@/lib/auth', () => ({
  setActiveClient: vi.fn(),
}));

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  activeClientId: null,
  onSelectClient: vi.fn(),
};

function renderPalette(props = {}) {
  return render(
    <MemoryRouter>
      <CommandPalette {...defaultProps} {...props} />
    </MemoryRouter>
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when open', () => {
    renderPalette();
    expect(screen.getByPlaceholderText('Search pages, companies, agents...')).toBeInTheDocument();
  });

  it('returns null when closed', () => {
    const { container } = renderPalette({ isOpen: false });
    expect(container.innerHTML).toBe('');
  });

  it('shows navigation items by default', async () => {
    renderPalette();
    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });
  });

  it('filters results based on input', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = screen.getByPlaceholderText('Search pages, companies, agents...');
    await user.type(input, 'dash');
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Projects')).not.toBeInTheDocument();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    renderPalette({ onClose });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking backdrop', () => {
    const onClose = vi.fn();
    renderPalette({ onClose });
    // The backdrop is the outermost fixed div
    const backdrop = screen.getByPlaceholderText('Search pages, companies, agents...').closest('.fixed');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
