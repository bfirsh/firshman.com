// The tracks in the song. Content from bio.ts; the instrument roles are the joke.
import { projects, now } from '../../../data/bio';

export type Voice = 'ai' | 'square' | 'pluck' | 'pad' | 'whale' | 'bass' | 'hat' | 'type' | 'paper' | 'kick';

export type Channel = {
  id: string;
  voice: Voice;
  name: string;
  lcd: string; // short name for the 30-column LCD
  url: string;
  blurb: string;
  role: string;
  color: string;
  now?: boolean;
};

const p = Object.fromEntries(projects.map((x) => [x.slug, x]));

export const channels: Channel[] = [
  { id: 'replicate', voice: 'ai', name: now.name, lcd: 'REPLICATE', url: now.url, blurb: now.blurb, role: 'AI melody', color: '#f4f1ea', now: true },
  { id: 'jsnes', voice: 'square', name: p.jsnes.name, lcd: 'JSNES', url: p.jsnes.url, blurb: p.jsnes.blurb, role: 'Square lead', color: '#ff5fa2' },
  { id: 'django', voice: 'pluck', name: p.django.name, lcd: 'DJANGO', url: p.django.url, blurb: p.django.blurb, role: 'Pluck arp', color: '#3ddc97' },
  { id: 'ukhas', voice: 'pad', name: p.ukhas.name, lcd: 'UK HIGH ALTITUDE SOCIETY', url: p.ukhas.url, blurb: p.ukhas.blurb, role: 'Rising pad', color: '#8fb3ff' },
  { id: 'whalebrew', voice: 'whale', name: p.whalebrew.name, lcd: 'WHALEBREW', url: p.whalebrew.url, blurb: p.whalebrew.blurb, role: 'Whale song', color: '#47d4ff' },
  { id: 'compose', voice: 'bass', name: p.compose.name, lcd: 'DOCKER COMPOSE', url: p.compose.url, blurb: p.compose.blurb, role: 'Bass', color: '#3b8cff' },
  { id: 'cog', voice: 'hat', name: p.cog.name, lcd: 'COG', url: p.cog.url, blurb: p.cog.blurb, role: 'Hi-hat', color: '#ffc23d' },
  { id: 'clig', voice: 'type', name: p.clig.name, lcd: 'CLI GUIDELINES', url: p.clig.url, blurb: p.clig.blurb, role: 'Typewriter', color: '#b8f55a' },
  { id: 'arxiv-vanity', voice: 'paper', name: p['arxiv-vanity'].name, lcd: 'ARXIV VANITY', url: p['arxiv-vanity'].url, blurb: p['arxiv-vanity'].blurb, role: 'Paper rustle', color: '#ff6b5b' },
  { id: 'machine', voice: 'kick', name: p.machine.name, lcd: 'DOCKER MACHINE', url: p.machine.url, blurb: p.machine.blurb, role: 'Kick (the drum machine)', color: '#ff7a1a' },
];
