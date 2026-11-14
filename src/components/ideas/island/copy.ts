// Words for the island. Shared by the page (guidebook list) and the 3D world (signboards).
import { projects, now, email, socials } from '../../../data/bio';

const P = Object.fromEntries(projects.map((p) => [p.slug, p]));

export type Item = { name: string; url: string; blurb: string };
export type Place = {
  id: string;
  place: string;
  plaque: string;
  items: Item[];
  color: string;
  flag: string; // the label on the signpost arrow that points here
};

const pick = (slug: string): Item => ({ name: P[slug].name, url: P[slug].url, blurb: P[slug].blurb });

export const PLACES: Place[] = [
  {
    id: 'lighthouse', place: 'The lighthouse', flag: '--lighthouse', color: '#e0503b',
    plaque: 'Tallest thing on the island, up on the hill. Currently keeping the light on.',
    items: [{ name: now.name, url: now.url, blurb: now.blurb }],
  },
  {
    id: 'windmill', place: 'The windmill', flag: '--windmill', color: '#ef8f2f',
    plaque: 'The sails turn on a cog. It grinds models into containers.',
    items: [pick('cog')],
  },
  {
    id: 'dock', place: 'The container dock', flag: '--dock', color: '#3b78c4',
    plaque: 'Containers, stacked several at a time. The crane moves them anywhere.',
    items: [pick('compose'), pick('machine')],
  },
  {
    id: 'telescope', place: 'The whale-watching telescope', flag: '--whale', color: '#35597c',
    plaque: 'Free to use. The whale is a regular.',
    items: [pick('whalebrew')],
  },
  {
    id: 'balloon', place: 'The launch pad', flag: '--launch', color: '#d4497e',
    plaque: 'Every so often the balloon lets go for the edge of space. Unlike the real ones, it always comes back.',
    items: [pick('ukhas')],
  },
  {
    id: 'arcade', place: 'The arcade', flag: '--arcade', color: '#6c4fd0',
    plaque: 'One cabinet. No coins needed: it runs in the browser.',
    items: [pick('jsnes')],
  },
  {
    id: 'library', place: 'The reading room', flag: '--library', color: '#2f8a63',
    plaque: 'Papers you can actually read on your phone. Some of them fly.',
    items: [pick('arxiv-vanity')],
  },
  {
    id: 'sign', place: 'The signpost', flag: '--help', color: '#9a6232',
    plaque: 'Every direction clearly documented, with sensible flags.',
    items: [pick('clig')],
  },
  {
    id: 'pond', place: 'The guitar pond', flag: '--pond', color: '#2696b0',
    plaque: 'Guitar-shaped, because Django is named after Django Reinhardt.',
    items: [pick('django')],
  },
  {
    id: 'bottle', place: 'A message in a bottle', flag: '--bottle', color: '#3f9150',
    plaque: 'Washed up on the beach. It says: write any time.',
    items: [
      { name: email, url: `mailto:${email}`, blurb: 'Email' },
      ...socials.map((s) => ({ name: s.name, url: s.url, blurb: s.handle })),
    ],
  },
];
