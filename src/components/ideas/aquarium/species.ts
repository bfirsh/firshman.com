// Who lives in the tank. Content comes from bio.ts; the Latin is a joke.
import { projects, alsoWorkedOn, now, email, name } from '../../../data/bio';

export type Kind =
  | 'whale' | 'baby' | 'cog' | 'nes' | 'clig' | 'django' | 'origami'
  | 'puffer' | 'angler' | 'crab' | 'small' | 'chest';

export type Info = {
  id: string;
  kind: Kind;
  name: string;
  latin: string;
  blurb: string;
  habit: string;
  url: string;
  color: string;
  now?: boolean;
};

const p = Object.fromEntries(projects.map((x) => [x.slug, x]));

export const SMALL_COLORS = [
  { body: '#2f86d6', belly: '#d8ecff', fin: '#ffdd00' },
  { body: '#e0473f', belly: '#ffe4dc', fin: '#ffffff' },
  { body: '#ff5d97', belly: '#ffe3ee', fin: '#ffc2d8' },
  { body: '#3fb07a', belly: '#dcf5e7', fin: '#a7ecc6' },
  { body: '#c8d3de', belly: '#ffffff', fin: '#4b5b70' },
];

export const species: Info[] = [
  { id: 'replicate', kind: 'angler', name: now.name, latin: 'Lophius replicatus', blurb: now.blurb, habit: 'What I’m working on now. Lures you in with a glowing API.', url: now.url, color: '#8ff5e2', now: true },
  { id: 'compose', kind: 'whale', name: p.compose.name, latin: 'Balaenoptera composita', blurb: p.compose.blurb, habit: 'Carries several containers at once. Very gentle.', url: p.compose.url, color: '#3b8ede' },
  { id: 'whalebrew', kind: 'baby', name: p.whalebrew.name, latin: 'Balaena homebrewensis (juv.)', blurb: p.whalebrew.blurb, habit: 'Juvenile. Travels in packages.', url: p.whalebrew.url, color: '#6fb3ef' },
  { id: 'machine', kind: 'crab', name: p.machine.name, latin: 'Pagurus provisionensis', blurb: p.machine.blurb, habit: 'Carries its host around and sets up wherever it lands.', url: p.machine.url, color: '#e2603f' },
  { id: 'cog', kind: 'cog', name: p.cog.name, latin: 'Horologichthys dentatus', blurb: p.cog.blurb, habit: 'Clockwork. Ships in its own container.', url: p.cog.url, color: '#d9a441' },
  { id: 'clig', kind: 'clig', name: p.clig.name, latin: 'Promptus maiorquam', blurb: p.clig.blurb, habit: 'Swims in a pipeline.', url: p.clig.url, color: '#b9f6c8' },
  { id: 'jsnes', kind: 'nes', name: p.jsnes.name, latin: 'Pixelichthys famicomensis', blurb: p.jsnes.blurb, habit: 'Runs at sixty frames a second, give or take.', url: p.jsnes.url, color: '#e45c10' },
  { id: 'django', kind: 'django', name: p.django.name, latin: 'Rhinobatos reinhardti', blurb: p.django.blurb, habit: 'Named after a jazz guitarist. So is the framework.', url: p.django.url, color: '#44b78b' },
  { id: 'arxiv-vanity', kind: 'origami', name: p['arxiv-vanity'].name, latin: 'Chartichthys preprintus', blurb: p['arxiv-vanity'].blurb, habit: 'Unfolds into something you can actually read.', url: p['arxiv-vanity'].url, color: '#efe8d8' },
  { id: 'ukhas', kind: 'puffer', name: p.ukhas.name, latin: 'Tetraodon stratosphericus', blurb: p.ukhas.blurb, habit: 'Inflates and heads for the edge of space.', url: p.ukhas.url, color: '#efc65a' },
  ...alsoWorkedOn.map((a, i): Info => ({
    id: `also-${i}`,
    kind: 'small',
    name: a.name,
    latin: 'Clupea collaborata',
    blurb: 'also worked on this',
    habit: 'Schools with lots of other people.',
    url: a.url,
    color: SMALL_COLORS[i % SMALL_COLORS.length].body,
  })),
];

export const keeper: Info = {
  id: 'keeper',
  kind: 'chest',
  name,
  latin: 'Custos aquarii',
  blurb: 'keeper of this tank',
  habit: 'Found in the treasure chest. Answers email.',
  url: `mailto:${email}`,
  color: '#f2c94c',
};

export const prettyUrl = (u: string) =>
  u.startsWith('mailto:')
    ? u.slice(7)
    : u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
