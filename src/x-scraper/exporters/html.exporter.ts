import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import type { IPostExporter, ProfileScrapeResult, ScrapedPost } from '../contracts/x-scraper.interfaces.js';

function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.trim()) {
    return '#';
  }
  const trimmed = url.trim();
  if (/^(?:https?:|\/)/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '#';
}

function formatPostText(text: string): string {
  if (!text) return '';
  const escaped = escapeHtml(text);
  return escaped.replace(/\r?\n/g, '<br>');
}

function renderPost(post: ScrapedPost): string {
  const authorName = escapeHtml(post.authorName || 'Anonymous');
  const rawAuthorHandle = post.authorHandle || '';
  const authorHandle = escapeHtml(rawAuthorHandle.startsWith('@') ? rawAuthorHandle : `@${rawAuthorHandle}`);
  const publishedAt = escapeHtml(post.publishedAt || '');

  const postUrl = sanitizeUrl(post.url);
  const postLinkHtml = postUrl !== '#'
    ? `<a href="${postUrl}" target="_blank" rel="noopener noreferrer" class="post-source-link">View on X &rarr;</a>`
    : '';

  const avatarUrl = post.authorAvatarUrl ? sanitizeUrl(post.authorAvatarUrl) : '';
  const avatarHtml = avatarUrl && avatarUrl !== '#'
    ? `<img src="${avatarUrl}" alt="${authorName}" class="author-avatar" loading="lazy" />`
    : `<div class="avatar-placeholder">${escapeHtml((post.authorName || post.authorHandle || 'U').charAt(0).toUpperCase())}</div>`;

  let badgesHtml = '';
  if (post.isPinned || post.isRetweet) {
    badgesHtml = `
      <div class="post-badges">
        ${post.isPinned ? '<span class="badge badge-pinned">📌 Pinned</span>' : ''}
        ${post.isRetweet ? '<span class="badge badge-retweet">🔁 Retweet</span>' : ''}
      </div>`;
  }

  let mediaHtml = '';
  if (Array.isArray(post.media) && post.media.length > 0) {
    const mediaElements = post.media
      .map((item) => {
        const mediaUrl = sanitizeUrl(item.url);
        if (mediaUrl === '#') return '';
        const previewUrl = item.previewUrl ? sanitizeUrl(item.previewUrl) : '';
        const posterAttr = previewUrl && previewUrl !== '#' ? ` poster="${previewUrl}"` : '';

        if (item.type === 'video') {
          return `<div class="media-container"><video src="${mediaUrl}"${posterAttr} controls preload="metadata"></video></div>`;
        }
        if (item.type === 'animated_gif') {
          return `<div class="media-container"><video src="${mediaUrl}"${posterAttr} autoplay loop muted playsinline></video></div>`;
        }
        return `<div class="media-container"><img src="${mediaUrl}" alt="Post attachment" loading="lazy" /></div>`;
      })
      .filter(Boolean)
      .join('\n');

    if (mediaElements) {
      mediaHtml = `<div class="post-media-grid">${mediaElements}</div>`;
    }
  }

  const metrics = post.metrics || { replies: 0, retweets: 0, likes: 0, views: 0, bookmarks: 0 };
  const replies = Number(metrics.replies || 0).toLocaleString();
  const retweets = Number(metrics.retweets || 0).toLocaleString();
  const likes = Number(metrics.likes || 0).toLocaleString();
  const views = Number(metrics.views || 0).toLocaleString();
  const bookmarks = Number(metrics.bookmarks || 0).toLocaleString();

  let snippetHtml = '';
  if (post.rawHtmlSnippet) {
    snippetHtml = `
      <details class="raw-snippet">
        <summary>Raw HTML Snippet</summary>
        <pre><code>${escapeHtml(post.rawHtmlSnippet)}</code></pre>
      </details>`;
  }

  return `
    <article class="post-card" id="post-${escapeHtml(post.id)}">
      ${badgesHtml}
      <div class="post-header">
        ${avatarHtml}
        <div class="post-author-meta">
          <div class="author-line">
            <span class="author-name">${authorName}</span>
            <span class="author-handle">${authorHandle}</span>
          </div>
          <time class="post-timestamp">${publishedAt}</time>
        </div>
      </div>
      <div class="post-body">
        <p class="post-text">${formatPostText(post.text)}</p>
        ${mediaHtml}
      </div>
      <div class="post-metrics">
        <span class="metric-item" title="Replies">💬 ${replies}</span>
        <span class="metric-item" title="Retweets">🔁 ${retweets}</span>
        <span class="metric-item" title="Likes">❤️ ${likes}</span>
        <span class="metric-item" title="Views">👁️ ${views}</span>
        <span class="metric-item" title="Bookmarks">🔖 ${bookmarks}</span>
      </div>
      <footer class="post-footer">
        ${postLinkHtml}
        ${snippetHtml}
      </footer>
    </article>
  `;
}

function generateHtml(result: ProfileScrapeResult): string {
  const rawHandle = result && result.handle ? result.handle : '';
  const cleanHandle = rawHandle.replace(/^@/, '').trim() || 'profile';
  const displayHandle = escapeHtml(rawHandle.startsWith('@') ? rawHandle : `@${cleanHandle}`);
  const provider = escapeHtml(result.providerUsed || 'Unknown');
  const scrapedAt = escapeHtml(result.scrapedAt || new Date().toISOString());
  const posts = Array.isArray(result.posts) ? result.posts : [];
  const totalPosts = escapeHtml(result.totalPosts ?? posts.length);

  const postsHtml = posts.length > 0
    ? posts.map(renderPost).join('\n')
    : '<div class="empty-state"><p>No posts available for this profile.</p></div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scraped Profile: ${displayHandle}</title>
  <style>
    :root {
      --bg-color: #0f1419;
      --card-bg: #16181c;
      --border-color: #2f3336;
      --text-main: #e7e9ea;
      --text-secondary: #71767b;
      --accent: #1d9bf0;
      --badge-pinned: #794bc4;
      --badge-retweet: #00ba7c;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: var(--font-family);
      line-height: 1.5;
      padding: 2rem 1rem;
    }
    .container {
      max-width: 680px;
      margin: 0 auto;
    }
    header.report-header {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .profile-title {
      font-size: 1.75rem;
      font-weight: 800;
      color: var(--text-main);
      margin-bottom: 0.75rem;
    }
    .meta-list {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    .meta-item strong {
      color: var(--text-main);
    }
    .posts-stream {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .post-card {
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      transition: border-color 0.15s ease;
    }
    .post-card:hover {
      border-color: #536471;
    }
    .post-badges {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }
    .badge {
      font-size: 0.75rem;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 9999px;
      color: #fff;
    }
    .badge-pinned {
      background-color: var(--badge-pinned);
    }
    .badge-retweet {
      background-color: var(--badge-retweet);
    }
    .post-header {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }
    .author-avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      object-fit: cover;
      background-color: var(--border-color);
    }
    .avatar-placeholder {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background-color: #2f3336;
      color: var(--text-main);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      font-weight: 700;
    }
    .post-author-meta {
      display: flex;
      flex-direction: column;
    }
    .author-line {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .author-name {
      font-weight: 700;
      color: var(--text-main);
    }
    .author-handle {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    .post-timestamp {
      color: var(--text-secondary);
      font-size: 0.8125rem;
    }
    .post-body {
      font-size: 0.95rem;
      word-break: break-word;
    }
    .post-text {
      white-space: pre-line;
      line-height: 1.6;
    }
    .post-media-grid {
      margin-top: 0.75rem;
      display: grid;
      gap: 0.5rem;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      border-radius: 12px;
      overflow: hidden;
    }
    .media-container img,
    .media-container video {
      width: 100%;
      max-height: 450px;
      object-fit: cover;
      border-radius: 8px;
      display: block;
      background-color: #000;
    }
    .post-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 1.25rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border-color);
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }
    .metric-item {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    .post-footer {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      font-size: 0.8125rem;
    }
    .post-source-link {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
      align-self: flex-start;
    }
    .post-source-link:hover {
      text-decoration: underline;
    }
    .raw-snippet {
      margin-top: 0.5rem;
      background: #000;
      padding: 0.5rem;
      border-radius: 6px;
      font-size: 0.75rem;
      color: #999;
    }
    .raw-snippet summary {
      cursor: pointer;
      color: var(--text-secondary);
      user-select: none;
    }
    .raw-snippet pre {
      white-space: pre-wrap;
      word-break: break-all;
      margin-top: 0.5rem;
    }
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-secondary);
      background-color: var(--card-bg);
      border-radius: 16px;
      border: 1px dashed var(--border-color);
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="report-header">
      <h1 class="profile-title">${displayHandle}</h1>
      <div class="meta-list">
        <span class="meta-item"><strong>Provider:</strong> ${provider}</span>
        <span class="meta-item"><strong>Scraped At:</strong> ${scrapedAt}</span>
        <span class="meta-item"><strong>Total Posts:</strong> ${totalPosts}</span>
      </div>
    </header>
    <main class="posts-stream">
      ${postsHtml}
    </main>
  </div>
</body>
</html>`;
}

@Injectable()
export class HtmlExporter implements IPostExporter {
  public async export(result: ProfileScrapeResult, outputDir: string): Promise<string> {
    const targetDir = outputDir || '.';
    await fs.mkdir(targetDir, { recursive: true });

    const rawHandle = result && result.handle ? result.handle : '';
    const cleanHandle = rawHandle.replace(/^@/, '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'profile';
    const fileName = `${cleanHandle}.html`;
    const filePath = path.join(targetDir, fileName);

    const htmlContent = generateHtml(result);
    await fs.writeFile(filePath, htmlContent, 'utf-8');

    return filePath;
  }
}

export default HtmlExporter;
