import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { FilteredPostsService } from '../src/events/filtered-posts.service.js';
import { MetaController } from '../src/meta/meta.controller.js';
import { MetaService } from '../src/meta/meta.service.js';

// Minimal DOM surface used by the actual inline page, so rendering needs no browser dependency.
class Element {
  children: Element[] = [];
  className = '';
  private text = '';
  constructor(readonly tag: string) {}
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren() {
    this.children = [];
    this.text = '';
  }
  set textContent(value: string) {
    this.replaceChildren();
    this.text = value;
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
}

it('renders real post highlights as DOM nodes and treats collector text as literal text', async () => {
  const text = 'A bomb <img src=x onerror=alert(1)> here';
  const posts = new Element('div');
  const status = new Element('div');
  const post = {
    channel: '<script>untrusted channel</script>',
    text,
    createdAt: '2026-10-21T00:00:00.000Z',
    severity: 'high',
    matches: [
      { start: 2, end: 6, term: '<b>bomb</b>' },
      { start: 3, end: 6, term: 'overlap' },
    ],
  };
  const page = new MetaController(
    {} as MetaService,
    new FilteredPostsService(),
  ).rootPage();
  const script = page.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const node = (tag: string, value?: string) => {
    const element = new Element(tag);
    if (value !== undefined) element.textContent = value;
    return element;
  };
  runInNewContext(script, {
    document: {
      getElementById: (id: string) => (id === 'posts' ? posts : status),
      createElement: (tag: string) => node(tag),
      createTextNode: (value: string) => node('#text', value),
    },
    EventSource: class {
      addEventListener() {}
    },
    fetch: async () => ({ ok: true, json: async () => [post] }),
    console,
  });
  await vi.waitFor(() => expect(posts.children).toHaveLength(1));
  const card = posts.children[0]!;
  const body = card.children[1]!;
  expect(body.textContent).toBe(text);
  expect(
    body.children
      .filter((child) => child.tag === 'mark')
      .map((child) => child.textContent),
  ).toEqual(['bomb']);
  expect(card.children[0]!.children[0]!.textContent).toBe(post.channel);
  expect(card.children[2]!.children[1]!.textContent).toBe('<b>bomb</b>');
  const tags = (element: Element): string[] => [
    element.tag,
    ...element.children.flatMap(tags),
  ];
  expect(tags(card)).not.toContain('img');
  expect(tags(card)).not.toContain('script');
});
