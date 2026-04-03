// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '@/components/Modal';

describe('Modal', () => {
  it('renders title and children', () => {
    render(<Modal title="Test Modal" onClose={() => {}}>
      <p>Content here</p>
    </Modal>);
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Content here')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<Modal title="Closable" onClose={onClose}><p>Body</p></Modal>);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<Modal title="Backdrop" onClose={onClose}><p>Body</p></Modal>);
    // The backdrop is the outermost fixed div
    const backdrop = screen.getByText('Backdrop').closest('.fixed');
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn();
    render(<Modal title="Escape" onClose={onClose}><p>Body</p></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not call onClose when clicking inside the modal content', () => {
    const onClose = vi.fn();
    render(<Modal title="NoClose" onClose={onClose}><p>Click me</p></Modal>);
    fireEvent.click(screen.getByText('Click me'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
