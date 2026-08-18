export interface MediaAnalysis {
  general: {
    container: {
      format_name: string | null
      duration_seconds: number | null
      size_bytes: number | null
      overall_bitrate: number | null
    }
    file: {
      path: string | null
      filename: string | null
      extension: string | null
    }
    derived: {
      title: string | null
      year: number | null
      source: 'BluRay' | 'UHD BluRay' | 'WEB-DL' | null
      release_type: 'REMUX' | 'Encode' | null
      resolution_tag: '2160p' | '1440p' | '1080p' | '720p' | '480p' | null
      codec_tag: 'x264' | 'x265' | null
      bit_depth_tag: '10bit' | null
      hdr_tag: 'DoVi HDR' | 'HDR' | null
      release_group: string | null
    }
  }
  video: {
    stream_index: number
    codec: {
      name: string | null
      long_name: string | null
      profile: string | null
      level: number | null
    }
    dimensions: {
      width: number | null
      height: number | null
      resolution_tag: '2160p' | '1440p' | '1080p' | '720p' | '480p' | null
    }
    bitrate: {
      bitrate: number | null
      max_bitrate: number | null
    }
    frame_rate: {
      avg: string | null
      real: number | null
    }
    pixel: {
      pixel_format: string | null
      bit_depth: number | null
    }
    color: {
      primaries: string | null
      transfer: string | null
      matrix: string | null
    }
    hdr: {
      type: 'dolby_vision' | 'hdr10' | 'hlg' | 'sdr' | null
      is_hdr: boolean
      is_dolby_vision: boolean
      dolby_vision: {
        profile: string | null
        level: string | null
      }
      hdr10: {
        mastering_display: boolean
        max_cll: string | null
      }
    }
    derived: {
      source_type: 'BluRay' | 'UHD BluRay' | 'WEB-DL' | null
      encode_type: 'REMUX' | 'Encode' | null
    }
  }[]
  audio: {
    stream_index: number
    // Existing embedded track title. Preserved so distinguishing text a generated title
    // cannot reproduce (e.g. which commentary a track is) is not destroyed by retagging.
    title: string | null
    codec: {
      name: string | null
      long_name: string | null
      profile: string | null
    }
    channels: {
      count: number | null
      layout: string | null
    }
    bitrate: number | null
    sample_rate: number | null
    bit_depth: number | null
    language: {
      code: string | null
      name: string | null
    }
    flags: {
      atmos: boolean
      lossless: boolean
      // Director's commentary / audio description. Excluded from the filename audio block.
      // Optional: a cached analysis written before this field existed omits it.
      commentary?: boolean
    }
    derived: {
      display_name: string | null
    }
  }[]
  subtitles: {
    stream_index: number
    codec: string | null
    title: string | null
    language: {
      code: string | null
      name: string | null
    }
    flags: {
      forced: boolean
      default: boolean
      hearing_impaired: boolean
    }
  }[]
}
