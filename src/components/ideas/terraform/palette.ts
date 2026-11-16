// Curated palettes (sRGB hex) and a tiny seeded PRNG.

export function mulberry(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Palette = {
  name: string;
  deep: string; shallow: string; fresh: string; foam: string;
  sand: string; seabed: string; weed: string;
  dirt: string; grassLo: string; grassHi: string;
  rock1: string; rock2: string; snow: string;
  leaf: string; leaf2: string; pine: string; trunk: string;
  wall: string; roofs: string[];
  plinth: string; rim: string; ink: string;
  bgTop: string; bgBot: string; duskTop: string; duskBot: string; nightTop: string; nightBot: string;
  sky: string; ground: string;
  palms: boolean;
};

export const PALETTES: Palette[] = [
  {
    name: 'lagoon',
    deep: '#0b4a6a', shallow: '#46d6c8', fresh: '#5fc8e0', foam: '#f6fbf7',
    sand: '#efd6a2', seabed: '#b9b583', weed: '#6fa58a',
    dirt: '#a47650', grassLo: '#86bd4e', grassHi: '#b3ad57',
    rock1: '#8f857c', rock2: '#a99c8c', snow: '#f4f7fb',
    leaf: '#4f9a3c', leaf2: '#6db04a', pine: '#2f6b44', trunk: '#6e4b33',
    wall: '#f7f0e4', roofs: ['#d0603d', '#e3a04f', '#5d86b0', '#ecd07a', '#c44f55'],
    plinth: '#26313d', rim: '#e2cfa3', ink: '#e9dcc0',
    bgTop: '#f8ead8', bgBot: '#d8e9ec', duskTop: '#f6c8a8', duskBot: '#c9b6d6', nightTop: '#0c1530', nightBot: '#1b2a4a',
    sky: '#cfe6f3', ground: '#bba88b',
    palms: true,
  },
  {
    name: 'fjord',
    deep: '#123a52', shallow: '#5fb3b0', fresh: '#7cc3d3', foam: '#f2f6f6',
    sand: '#e2d1ab', seabed: '#9aa086', weed: '#5f8a76',
    dirt: '#7e624b', grassLo: '#6f9e5a', grassHi: '#97a26b',
    rock1: '#7f858b', rock2: '#9aa0a4', snow: '#f6f8fb',
    leaf: '#4b7f4e', leaf2: '#638f55', pine: '#284f3e', trunk: '#5c4433',
    wall: '#efe9dc', roofs: ['#b04a3c', '#3f5468', '#c79245', '#e9e3d4', '#7a3b36'],
    plinth: '#3a2d28', rim: '#cdb68d', ink: '#e8dcc6',
    bgTop: '#eef0ee', bgBot: '#cfdbe0', duskTop: '#f0c6b4', duskBot: '#aab4cf', nightTop: '#0a1224', nightBot: '#1a2540',
    sky: '#d6e3ec', ground: '#a99b86',
    palms: false,
  },
  {
    name: 'coral',
    deep: '#1c3f78', shallow: '#4fd8de', fresh: '#6fd0ea', foam: '#fffaf4',
    sand: '#f5cfa8', seabed: '#d6ae96', weed: '#8bb59a',
    dirt: '#a8654b', grassLo: '#8fc85d', grassHi: '#c9bb62',
    rock1: '#9d837c', rock2: '#b6998f', snow: '#fbf8fb',
    leaf: '#5aa64b', leaf2: '#7bbd55', pine: '#2f7552', trunk: '#7a4b38',
    wall: '#fff6ec', roofs: ['#ff8c6c', '#f4c25a', '#6aaedc', '#ffffff', '#e86a8a'],
    plinth: '#2c2244', rim: '#f0c2a6', ink: '#f3dcd0',
    bgTop: '#fde4d8', bgBot: '#e4d9f0', duskTop: '#ffbfa0', duskBot: '#c8a8d8', nightTop: '#120f2e', nightBot: '#28214a',
    sky: '#f1dfe8', ground: '#c8a790',
    palms: true,
  },
  {
    name: 'jade',
    deep: '#0f3d3c', shallow: '#72c9a8', fresh: '#86cfc0', foam: '#f3f6ef',
    sand: '#e8d6ad', seabed: '#a9ae8a', weed: '#5e9a7c',
    dirt: '#8a674f', grassLo: '#78ad60', grassHi: '#a7aa6c',
    rock1: '#727874', rock2: '#8b908a', snow: '#f5f7f4',
    leaf: '#3f8253', leaf2: '#5e9a5a', pine: '#245a41', trunk: '#5d4535',
    wall: '#f2ede2', roofs: ['#b9483b', '#2f4b5c', '#d8a54f', '#f1ebdf', '#8c5a3c'],
    plinth: '#1f2626', rim: '#bfae80', ink: '#ddd3bb',
    bgTop: '#efede4', bgBot: '#d3ddd6', duskTop: '#efc6a9', duskBot: '#a9bcb8', nightTop: '#08141a', nightBot: '#16282e',
    sky: '#dbe7e0', ground: '#a5a08a',
    palms: false,
  },
];
