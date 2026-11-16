// The sixteen finds buried in the block, built from the shared bio.
import { now, projects, alsoWorkedOn, email, socials } from '../../../data/bio';

export type FindItem = {
  key: string;
  type: 'tablet' | 'geode';
  lines?: string[]; // carved inscription for tablets
  kind: 'now' | 'project' | 'greet' | 'contact';
  title: string;
  url?: string;
  blurb?: string;
  crystal?: string; // geode crystal colour
};

const carve: Record<string, string[]> = {
  cog: ['COG'],
  clig: ['CLIG'],
  compose: ['COMPOSE'],
  machine: ['MACHINE'],
  jsnes: ['JSNES'],
  whalebrew: ['WHALEBREW'],
  'arxiv-vanity': ['ARXIV', 'VANITY'],
  django: ['DJANGO'],
  ukhas: ['UKHAS'],
};

const crystals = ['#a67be0', '#f0bf4c', '#eef3f6', '#8fc0f0', '#f0a7bf'];

export const items: FindItem[] = [
  { key: 'replicate', type: 'tablet', lines: ['REPLICATE'], kind: 'now', title: now.name, url: now.url, blurb: `what I'm working on now: ${now.blurb}` },
  ...projects.map<FindItem>((p) => ({
    key: p.slug,
    type: 'tablet',
    lines: carve[p.slug] || [p.name.toUpperCase()],
    kind: 'project',
    title: p.name,
    url: p.url,
    blurb: p.blurb,
  })),
  ...alsoWorkedOn.map<FindItem>((g, i) => ({
    key: 'greet-' + i,
    type: 'geode',
    kind: 'greet',
    title: g.name,
    url: g.url,
    blurb: 'greetings to an old crew I worked on',
    crystal: crystals[i % crystals.length],
  })),
  { key: 'contact', type: 'geode', kind: 'contact', title: 'Say hello', url: `mailto:${email}`, blurb: email, crystal: '#ffc35a' },
];

export { email, socials, now };
