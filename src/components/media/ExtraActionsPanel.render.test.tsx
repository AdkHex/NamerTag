import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// The panel loads preferences through Tauri; jsdom has no Tauri bridge. Returning an empty
// object exercises the built-in defaults path.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({}),
}))

import { ExtraActionsPanel } from './ExtraActionsPanel'

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const result = render(
    <QueryClientProvider client={client}>
      <ExtraActionsPanel paths={['/m/a.mkv']} />
    </QueryClientProvider>
  )
  // ToolSection is collapsed by default; the fields only mount once it is expanded.
  fireEvent.click(screen.getByRole('button', { name: /extra actions/i }))
  return result
}

describe('ExtraActionsPanel', () => {
  it('renders the five built-in fields with editable labels', () => {
    renderPanel()
    for (const label of [
      'Writing application',
      'Writing library',
      'Website',
      'Encoded by',
      'Telegram',
    ]) {
      // Labels are inputs now, so they are queried by value rather than as text.
      expect(screen.getByDisplayValue(label)).toBeInTheDocument()
    }
  })

  it('lets a label be renamed in place', () => {
    renderPanel()
    const label = screen.getByDisplayValue('Writing library')
    fireEvent.change(label, { target: { value: 'Muxer' } })
    expect(screen.getByDisplayValue('Muxer')).toBeInTheDocument()
  })

  it('offers an Add field control for custom tags', () => {
    renderPanel()
    expect(screen.getByTitle('Add a custom global tag field')).toBeInTheDocument()
  })

  it('does not offer removal for built-in fields', () => {
    renderPanel()
    expect(
      screen.queryByLabelText('Remove Website field')
    ).not.toBeInTheDocument()
  })
})
