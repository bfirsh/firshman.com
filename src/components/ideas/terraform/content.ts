// What the archipelago reveals as it grows. Everything comes from the shared bio.
import { now, projects, alsoWorkedOn, socials, email, name } from '../../../data/bio';

export type Place = {
  id: string;
  name: string;
  blurb: string;
  url: string;
  host: string;
};

const host = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const p = (slug: string) => projects.find((x) => x.slug === slug)!;

const blurbs: Record<string, string> = {
  cog: 'Containers for machine learning.',
  clig: 'A guide to help you write better command-line programs.',
  compose: 'Define and run multi-container apps.',
  machine: 'Provision Docker hosts anywhere.',
  jsnes: 'One of the first JavaScript emulators.',
  whalebrew: 'A Docker package manager.',
  'arxiv-vanity': 'Rendered papers from arXiv as responsive web pages.',
  django: 'I worked on many parts of it, including class-based views, feeds, and search.',
  ukhas: 'I helped start a group for amateur near-space exploration.',
};

// The capital is always first; the rest are founded in this order.
export const CAPITAL: Place = {
  id: 'replicate',
  name: now.name,
  blurb: `I'm working on ${now.name}: ${now.blurb}.`,
  url: now.url,
  host: host(now.url),
};

export const TOWNS: Place[] = ['cog', 'clig', 'compose', 'jsnes', 'machine', 'whalebrew', 'arxiv-vanity', 'django', 'ukhas'].map((slug) => {
  const x = p(slug);
  return { id: slug, name: x.name, blurb: blurbs[slug] ?? x.blurb, url: x.url, host: host(x.url) };
});

export const GREETS = alsoWorkedOn.map((a) => ({
  id: a.name,
  name: a.name,
  url: a.url,
  host: host(a.url),
}));

export const KEEPER = { name, email, socials };
