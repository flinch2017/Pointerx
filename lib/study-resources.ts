import { fetch } from 'expo/fetch';

export type StudyResourceKind = 'image' | 'video';

export type StudyResource = {
  id: string;
  imageUrl?: string;
  kind: StudyResourceKind;
  sourceLabel: string;
  subtitle?: string;
  title: string;
  url: string;
};

export type StudyResourceIntent = {
  kinds: StudyResourceKind[];
  query: string;
};

type CommonsImageInfo = {
  descriptionurl?: string;
  extmetadata?: {
    Artist?: { value?: string };
    Credit?: { value?: string };
    LicenseShortName?: { value?: string };
  };
  thumburl?: string;
  url?: string;
};

type CommonsPage = {
  imageinfo?: CommonsImageInfo[];
  pageid?: number;
  title?: string;
};

type CommonsResponse = {
  query?: {
    pages?: Record<string, CommonsPage>;
  };
};

type YouTubeSearchItem = {
  id?: {
    videoId?: string;
  };
  snippet?: {
    channelTitle?: string;
    description?: string;
    thumbnails?: {
      default?: { url?: string };
      high?: { url?: string };
      medium?: { url?: string };
    };
    title?: string;
  };
};

type YouTubeSearchResponse = {
  items?: YouTubeSearchItem[];
};

const YOUTUBE_API_KEY = process.env.EXPO_PUBLIC_YOUTUBE_API_KEY;

function normalizePrompt(prompt: string) {
  return prompt
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value?: string) {
  return (value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value?: string) {
  return stripHtml(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanQuery(prompt: string) {
  const query = prompt
    .replace(/https?:\/\/[^\s<>"']+|www\.[^\s<>"']+/gi, ' ')
    .replace(/[?!.,]+/g, ' ')
    .replace(
      /\b(can you|could you|please|pls|show me|show|find|fetch|get|give me|recommend|send|look for|search for|i need|i want|study|studying|learn|learning|about|on|of|for|some|good|best|helpful|pictures?|images?|photos?|diagrams?|visuals?|illustrations?|videos?|youtube|lectures?|tutorials?|explainers?|resources?)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

  return query || prompt.replace(/\s+/g, ' ').trim();
}

export function getStudyResourceIntent(prompt: string): StudyResourceIntent | null {
  const normalizedPrompt = normalizePrompt(prompt);
  const wantsImages =
    /\b(pictures?|images?|photos?|diagrams?|visuals?|illustrations?)\b/.test(normalizedPrompt);
  const wantsVideos =
    /\b(videos?|youtube|lectures?|tutorials?|explainers?|watch)\b/.test(normalizedPrompt);

  if (!wantsImages && !wantsVideos) {
    return null;
  }

  const query = cleanQuery(prompt);

  if (query.length < 2) {
    return null;
  }

  const kinds: StudyResourceKind[] = [];

  if (wantsImages) {
    kinds.push('image');
  }

  if (wantsVideos) {
    kinds.push('video');
  }

  return { kinds, query };
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Resource search returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchCommonsImages(query: string, signal?: AbortSignal): Promise<StudyResource[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrlimit: '6',
    gsrnamespace: '6',
    gsrsearch: `${query} educational diagram`,
    iiprop: 'url|extmetadata',
    iiurlwidth: '520',
    origin: '*',
    prop: 'imageinfo',
  });
  const data = await fetchJson<CommonsResponse>(
    `https://commons.wikimedia.org/w/api.php?${params.toString()}`,
    signal,
  );
  const pages = Object.values(data.query?.pages ?? {});

  return pages
    .map((page) => {
      const imageInfo = page.imageinfo?.[0];
      const imageUrl = imageInfo?.thumburl ?? imageInfo?.url;
      const url = imageInfo?.descriptionurl;

      if (!imageUrl || !url) {
        return null;
      }

      const title = decodeHtmlEntities(page.title?.replace(/^File:/i, '') ?? 'Study image');
      const license = decodeHtmlEntities(imageInfo.extmetadata?.LicenseShortName?.value);
      const credit =
        decodeHtmlEntities(imageInfo.extmetadata?.Artist?.value) ||
        decodeHtmlEntities(imageInfo.extmetadata?.Credit?.value);

      const resource: StudyResource = {
        id: `commons-${page.pageid ?? title}`,
        imageUrl,
        kind: 'image',
        sourceLabel: license ? `Wikimedia Commons · ${license}` : 'Wikimedia Commons',
        subtitle: credit ? `By ${credit}` : 'Open source study image',
        title,
        url,
      };

      return resource;
    })
    .filter((resource): resource is StudyResource => resource !== null)
    .slice(0, 4);
}

function buildYouTubeSearchResource(query: string): StudyResource {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    `${query} study lesson`,
  )}`;

  return {
    id: `youtube-search-${query}`,
    kind: 'video',
    sourceLabel: 'YouTube',
    subtitle: YOUTUBE_API_KEY
      ? 'Open focused YouTube results'
      : 'Add EXPO_PUBLIC_YOUTUBE_API_KEY for direct video cards',
    title: `Search YouTube for "${query}"`,
    url: searchUrl,
  };
}

async function fetchYouTubeVideos(query: string, signal?: AbortSignal): Promise<StudyResource[]> {
  if (!YOUTUBE_API_KEY) {
    return [buildYouTubeSearchResource(query)];
  }

  const params = new URLSearchParams({
    key: YOUTUBE_API_KEY,
    maxResults: '4',
    part: 'snippet',
    q: `${query} study lesson`,
    safeSearch: 'strict',
    type: 'video',
    videoEmbeddable: 'true',
  });
  const data = await fetchJson<YouTubeSearchResponse>(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
    signal,
  );
  const videos =
    data.items
      ?.map((item) => {
        const videoId = item.id?.videoId;

        if (!videoId) {
          return null;
        }

        const resource: StudyResource = {
          id: `youtube-${videoId}`,
          imageUrl:
            item.snippet?.thumbnails?.high?.url ??
            item.snippet?.thumbnails?.medium?.url ??
            item.snippet?.thumbnails?.default?.url,
          kind: 'video',
          sourceLabel: 'YouTube',
          subtitle:
            decodeHtmlEntities(item.snippet?.channelTitle) ||
            decodeHtmlEntities(item.snippet?.description) ||
            'Study video',
          title: decodeHtmlEntities(item.snippet?.title) || 'Study video',
          url: `https://www.youtube.com/watch?v=${videoId}`,
        };

        return resource;
      })
      .filter((resource): resource is StudyResource => resource !== null) ?? [];

  return videos.length > 0 ? videos : [buildYouTubeSearchResource(query)];
}

export async function fetchStudyResources(
  intent: StudyResourceIntent,
  signal?: AbortSignal,
): Promise<StudyResource[]> {
  const requests = intent.kinds.map((kind) =>
    kind === 'image'
      ? fetchCommonsImages(intent.query, signal).catch(() => [])
      : fetchYouTubeVideos(intent.query, signal).catch(() => [buildYouTubeSearchResource(intent.query)]),
  );
  const resources = (await Promise.all(requests)).flat();

  if (resources.length === 0) {
    throw new Error('No study resources found');
  }

  return resources;
}
