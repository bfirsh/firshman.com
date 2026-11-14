// The cargo of the MV Firshman. Shared by the page (manifest) and the 3D ship.
import { projects, now, email, socials } from '../../../data/bio';

const P = Object.fromEntries(projects.map((p) => [p.slug, p]));

export type Cargo = {
  slug: string;
  name: string;
  url: string;
  blurb: string;
  label: string; // stencilled on the doors
  color: string;
  code: string; // container number
  contents: string;
  bay: number;
  tier: number;
};

const box = (slug: string, label: string, color: string, n: number, contents: string, bay: number, tier: number): Cargo => ({
  slug, name: P[slug].name, url: P[slug].url, blurb: P[slug].blurb, label, color, contents, bay, tier,
  code: `FIRU ${String(n).padStart(6, '0')} ${(n * 7) % 10}`,
});

// bays run from the bridge (0) to the bow (10)
export const CARGO: Cargo[] = [
  box('clig', 'CLIG', '#2b8a78', 101, 'One terminal. It responds to --help.', 0, 2),
  box('arxiv-vanity', 'ARXIV\nVANITY', '#d9a63a', 102, 'A vanity mirror and a stack of papers that finally look good.', 1, 0),
  box('cog', 'COG', '#d4602c', 103, 'Two gears, meshing nicely.', 2, 3),
  box('ukhas', 'UKHAS', '#e9e5dc', 104, 'One weather balloon. Do not open indoors.', 3, 2),
  box('compose', 'COMPOSE', '#2f68ad', 105, 'Smaller containers. It is containers all the way down.', 4, 1),
  box('machine', 'MACHINE', '#6a4c9c', 106, 'One server rack, provisioned and blinking.', 5, 0),
  box('jsnes', 'JSNES', '#c0393a', 107, 'A television and a game. No cartridge required.', 6, 1),
  box('whalebrew', 'WHALE\nBREW', '#3b8db6', 108, 'One whale, in a bottle. Handle with care.', 7, 0),
  box('django', 'DJANGO', '#0f5a3c', 109, 'One guitar, Selmer style, named after the same man.', 8, 1),
];

export const ENGINE = { name: now.name, url: now.url, blurb: now.blurb };
export const LOG = { email, socials };
