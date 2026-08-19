import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useQueueActions } from './useQueueActions'
import { useGeneratedNamesStore } from '@/store/generated-names-store'
import { useLocalUploadQueue } from '@/store/local-upload-queue-store'
import { useMediaAnalysisStore } from '@/store/media-analysis-store'
import { makeAnalysis } from '@/lib/__fixtures__/media-analysis'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readDir: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({ join: vi.fn() }))

const OK = '/m/ok.mkv'
const BAD = '/m/bad.mkv'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function seed(path: string) {
  const analysis = makeAnalysis({
    path,
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
  })
  useMediaAnalysisStore.getState().setAnalyses([analysis])
  useGeneratedNamesStore.getState().setGeneratedTracks(path, {
    videoTitleText: 'Movie (2020) - Downloaded From site.com',
    videoTitles: ['1080p / BluRay / AVC / site.com'],
    audioTitles: ['English / DDP 5.1 / site.com'],
    subtitleTitles: [],
    encoderName: '',
  })
}

describe('handleClearTitles', () => {
  beforeEach(() => {
    useGeneratedNamesStore.getState().clear()
    useLocalUploadQueue.setState({ items: [] })
    useMediaAnalysisStore.setState({ analysesByPath: {} })
    vi.mocked(invoke).mockReset()
  })

  it('blanks the editor only for files that were actually cleared', async () => {
    seed(OK)
    seed(BAD)
    useLocalUploadQueue.setState({
      items: [
        { id: '1', path: OK, name: 'ok.mkv', status: 'pending' },
        { id: '2', path: BAD, name: 'bad.mkv', status: 'pending' },
      ] as never,
    })

    // The second file fails to write; its titles are still on disk.
    vi.mocked(invoke).mockImplementation(async (_cmd, payload) => {
      const path = (payload as { items: { path: string }[] }).items[0]?.path
      return [{ path, success: path === OK, error: path === OK ? null : 'boom' }]
    })

    const { result } = renderHook(() => useQueueActions(), { wrapper })
    await act(async () => {
      await result.current.handleClearTitles()
    })

    await waitFor(() => {
      const entries = useGeneratedNamesStore.getState().entries
      expect(entries[OK]?.videoTitleText).toBe('')
      expect(entries[OK]?.audioTitles).toEqual([''])
      // Failed file keeps what is still written in the file.
      expect(entries[BAD]?.videoTitleText).toContain('Downloaded From')
      expect(entries[BAD]?.audioTitles[0]).toContain('site.com')
    })
  })

  it('sends clearTitles with real stream indexes', async () => {
    seed(OK)
    useLocalUploadQueue.setState({
      items: [{ id: '1', path: OK, name: 'ok.mkv', status: 'pending' }] as never,
    })
    vi.mocked(invoke).mockResolvedValue([
      { path: OK, success: true, error: null },
    ])

    const { result } = renderHook(() => useQueueActions(), { wrapper })
    await act(async () => {
      await result.current.handleClearTitles()
    })

    // The hook also loads preferences, so pick the retag call rather than the first.
    const call = vi
      .mocked(invoke)
      .mock.calls.find(([command]) => command === 'retag_media_files')
    expect(call).toBeDefined()
    const request = (call?.[1] as { items: Record<string, unknown>[] })
      .items[0]
    expect(request?.clearTitles).toBe(true)
    expect(request?.audioStreamIndexes).toEqual([1])
  })
})
