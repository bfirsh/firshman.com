// The six faces of the box, and what unfolds from each one.
// Shared by the page markup (links) and the client (voxel dioramas), so the
// order of `items` here is the order of figures on each diorama.

import { now, projects, alsoWorkedOn, socials, email } from '../../../data/bio';

export type Item = { name: string; url: string; blurb?: string; fig: string };
export type Section = {
  id: string;
  word: string; // voxel lettering on the diorama
  title: string; // panel heading
  lede: string;
  items: Item[];
};

const p = (slug: string, fig: string): Item => {
  const x = projects.find((q) => q.slug === slug)!;
  return { name: x.name, url: x.url, blurb: x.blurb, fig };
};
const a = (i: number, fig: string): Item => ({ name: alsoWorkedOn[i].name, url: alsoWorkedOn[i].url, fig });
const s = (i: number, fig: string): Item => ({ name: socials[i].name, url: socials[i].url, blurb: socials[i].handle, fig });

export const SECTIONS: Section[] = [
  {
    id: 'now',
    word: 'NOW',
    title: 'Now',
    lede: "I'm working on",
    items: [{ name: now.name, url: now.url, blurb: now.blurb, fig: 'cloud' }],
  },
  {
    id: 'boxes',
    word: 'BOXES',
    title: 'Boxes',
    lede: 'Things that put other things in boxes.',
    items: [p('compose', 'crates'), p('machine', 'server'), p('whalebrew', 'whale'), p('cog', 'gear')],
  },
  {
    id: 'tools',
    word: 'TOOLS',
    title: 'Tools',
    lede: 'For people who make software, and people who read papers.',
    items: [p('clig', 'terminal'), p('arxiv-vanity', 'book'), p('django', 'guitar')],
  },
  {
    id: 'play',
    word: 'PLAY',
    title: 'Play',
    lede: 'Up, up, and 8-bit.',
    items: [p('jsnes', 'pad'), p('ukhas', 'balloon')],
  },
  {
    id: 'greets',
    word: 'GREETS',
    title: 'Greets',
    lede: 'Also worked on, with lovely people. Greetings to:',
    items: [a(0, 'portico'), a(1, 'tablet'), a(2, 'jar'), a(3, 'badge'), a(4, 'rocket')],
  },
  {
    id: 'hello',
    word: 'HELLO',
    title: 'Hello',
    lede: 'Write to me, or find me elsewhere.',
    items: [
      { name: email, url: `mailto:${email}`, blurb: 'email', fig: 'envelope' },
      s(0, 'glyphX'),
      s(1, 'glyphGH'),
      s(2, 'glyphIN'),
    ],
  },
];

// Which section sits on which face of the solved box. Directions are
// +x, -x, +y, -y, +z, -z.
export const FACE_SECTION = ['boxes', 'tools', 'play', 'hello', 'now', 'greets'];
