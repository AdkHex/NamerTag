import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TitleBar } from './TitleBar'
import { APP_ATTRIBUTION, APP_NAME } from '@/lib/app-info'

function renderTitleBar() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TitleBar />
    </QueryClientProvider>
  )
}

describe('TitleBar app name', () => {
  it('shows the attribution as its own, visibly smaller run of text', () => {
    renderTitleBar()
    const name = screen.getByText(APP_NAME)
    const attribution = screen.getByText(APP_ATTRIBUTION)

    // Separate elements, so the attribution can be styled down without shrinking the name.
    expect(name).not.toBe(attribution)
    expect(name.className).toContain('text-sm')
    expect(attribution.className).toContain('text-[10px]')
    // Visible, just quieter — not hidden.
    expect(attribution).toBeVisible()
  })
})
