import type { ProfileScrapeResult } from '../../../src/x-scraper/contracts/x-scraper.interfaces.js';

export const mockBatchScrapeResult: ProfileScrapeResult = {
  handle: 'osint-network',
  scrapedAt: '2026-10-19T14:30:00.000Z',
  providerUsed:
    'twitterapi_io (Search: "(from:AJArabic OR from:AJEnglish) -fil...")',
  totalPosts: 2,
  posts: [
    {
      id: '1847321098492019482',
      url: 'https://x.com/AJEnglish/status/1847321098492019482',
      authorHandle: 'AJEnglish',
      authorName: 'Al Jazeera English',
      authorAvatarUrl:
        'https://pbs.twimg.com/profile_images/ajenglish_avatar.jpg',
      text: 'Breaking: Regional developments update following high-level diplomatic talks in Geneva.',
      publishedAt: '2026-10-19T14:15:00.000Z',
      metrics: {
        replies: 142,
        retweets: 820,
        likes: 3450,
        views: 125000,
        bookmarks: 210,
      },
      media: [
        {
          type: 'photo',
          url: 'https://pbs.twimg.com/media/news_conference.jpg',
          previewUrl: 'https://pbs.twimg.com/media/news_conference.jpg',
        },
      ],
      isRetweet: false,
      isPinned: true,
      rawHtmlSnippet: '<div>Breaking: Regional developments update...</div>',
    },
    {
      id: '1847318045123984120',
      url: 'https://x.com/AJArabic/status/1847318045123984120',
      authorHandle: 'AJArabic',
      authorName: 'الجزيرة - عاجل',
      authorAvatarUrl:
        'https://pbs.twimg.com/profile_images/ajarabic_avatar.jpg',
      text: 'موجز الأخبار: استمرار المشاورات الدولية بشأن سبل التهدئة.',
      publishedAt: '2026-10-19T14:02:10.000Z',
      metrics: {
        replies: 45,
        retweets: 310,
        likes: 1240,
        views: 89000,
        bookmarks: 56,
      },
      media: [
        {
          type: 'video',
          url: 'https://video.twimg.com/amplify_video/vid_high.mp4',
          previewUrl: 'https://pbs.twimg.com/amplify_video_thumb/thumb.jpg',
        },
      ],
      isRetweet: false,
      isPinned: false,
    },
  ],
};
