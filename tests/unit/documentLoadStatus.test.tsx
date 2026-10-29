import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentLoadStatus } from '@/components/DocumentLoadStatus';

describe('DocumentLoadStatus', () => {
  it('shows nothing when everything was read successfully', () => {
    const { container } = render(<DocumentLoadStatus progress={{ total: 12, done: 12, failed: [] }} />);
    expect(container.textContent).toBe('');
  });

  it('shows nothing without progress or without documents', () => {
    expect(render(<DocumentLoadStatus progress={null} />).container.textContent).toBe('');
    expect(render(<DocumentLoadStatus progress={{ total: 0, done: 0, failed: [] }} />).container.textContent).toBe('');
  });

  it('shows a quiet progress line only while loading', () => {
    const { getByText, queryByRole } = render(<DocumentLoadStatus progress={{ total: 12, done: 4, failed: [] }} />);
    expect(getByText('Loading documents… 4/12')).toBeDefined();
    expect(queryByRole('button')).toBeNull();
  });

  it('shows one clickable line for failures that expands to names and reasons', () => {
    const progress = {
      total: 12,
      done: 12,
      failed: [{ title: 'Old slides.ppt', reason: 'unsupported file type (application/vnd.ms-powerpoint)' }],
    };
    const { getByRole, queryByText, getByText } = render(<DocumentLoadStatus progress={progress} />);
    const button = getByRole('button', { name: /1 document could not be read/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(queryByText(/Old slides\.ppt/)).toBeNull(); // details hidden by default
    expect(queryByText(/documents read/)).toBeNull(); // no success count

    fireEvent.click(button);
    expect(getByText('Old slides.ppt')).toBeDefined();
    expect(getByText(/unsupported file type/)).toBeDefined();
    fireEvent.click(button);
    expect(queryByText('Old slides.ppt')).toBeNull();
  });

  it('pluralizes and keeps the failure line visible while other documents still load', () => {
    const { getByRole, getByText } = render(
      <DocumentLoadStatus
        progress={{ total: 12, done: 8, failed: [{ title: 'a', reason: 'x' }, { title: 'b', reason: 'y' }] }}
      />
    );
    expect(getByRole('button', { name: /2 documents could not be read/ })).toBeDefined();
    expect(getByText('Loading documents… 8/12')).toBeDefined();
  });
});
