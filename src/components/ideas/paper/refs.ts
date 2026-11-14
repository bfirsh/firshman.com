import { projects, now, alsoWorkedOn } from '../../../data/bio';

export type Ref = {
  key: string;
  type: string;
  title: string;
  author: string;
  url: string;
  note: string;
  year: string;
};

const typeFor: Record<string, string> = {
  clig: 'manual',
  'arxiv-vanity': 'online',
  ukhas: 'misc',
  django: 'software',
};

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export const refs: Ref[] = [
  { key: 'replicate', type: 'online', title: now.name, author: 'Firshman, Ben and colleagues', url: now.url, note: now.blurb, year: '{\\em now}' },
  ...projects.map((p) => ({
    key: p.slug,
    type: typeFor[p.slug] ?? 'software',
    title: p.name,
    author: p.slug === 'django' || p.slug === 'ukhas' ? 'Many people, incl. Firshman, Ben' : 'Firshman, Ben and others',
    url: p.url,
    note: p.blurb,
    year: `{\\em ${p.era}}`,
  })),
  ...alsoWorkedOn.map((a) => ({
    key: slugify(a.name),
    type: 'misc',
    title: a.name,
    author: 'Many people, incl. Firshman, Ben',
    url: a.url,
    note: 'also worked on',
    year: '{\\em various}',
  })),
];

export const refIndex: Record<string, number> = Object.fromEntries(refs.map((r, i) => [r.key, i + 1]));
export const alsoKeys = alsoWorkedOn.map((a) => slugify(a.name));
