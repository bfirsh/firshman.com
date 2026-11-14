// Shared content for every design idea under /ideas. Edit once, every idea updates.

export const name = "Ben Firshman";
export const email = "ben@firshman.com";

export const now = {
  name: "Replicate",
  url: "https://replicate.com",
  blurb: "run AI models with a cloud API",
};

export type Project = {
  slug: string;
  name: string;
  url: string;
  blurb: string;
  // rough era, used by timeline-ish designs
  era: "early" | "middle" | "recent";
  tags: string[];
};

export const projects: Project[] = [
  { slug: "cog", name: "Cog", url: "https://github.com/replicate/cog", blurb: "containers for machine learning", era: "recent", tags: ["ml", "containers"] },
  { slug: "clig", name: "Command Line Interface Guidelines", url: "https://clig.dev", blurb: "a guide to help you write better command-line programs", era: "recent", tags: ["cli", "writing"] },
  { slug: "compose", name: "Docker Compose", url: "https://github.com/docker/compose", blurb: "define and run multi-container apps", era: "middle", tags: ["containers"] },
  { slug: "machine", name: "Docker Machine", url: "https://github.com/docker/machine", blurb: "provision Docker hosts anywhere", era: "middle", tags: ["containers"] },
  { slug: "jsnes", name: "JSNES", url: "https://github.com/bfirsh/jsnes", blurb: "one of the first JavaScript emulators", era: "early", tags: ["games", "javascript"] },
  { slug: "whalebrew", name: "Whalebrew", url: "https://github.com/whalebrew/whalebrew", blurb: "a Docker package manager", era: "middle", tags: ["containers", "cli"] },
  { slug: "arxiv-vanity", name: "arXiv Vanity", url: "https://www.arxiv-vanity.com/", blurb: "rendered papers from arXiv as responsive web pages", era: "middle", tags: ["ml", "web"] },
  { slug: "django", name: "Django", url: "https://www.djangoproject.com/", blurb: "worked on class-based views, feeds, and search", era: "early", tags: ["python", "web"] },
  { slug: "ukhas", name: "UK High Altitude Society", url: "https://ukhas.org.uk/", blurb: "helped start a group for amateur near-space exploration", era: "early", tags: ["space", "hardware"] },
];

export const alsoWorkedOn = [
  { name: "GOV.UK", url: "https://gov.uk" },
  { name: "The Guardian's iPad app", url: "https://www.youtube.com/watch?v=53ZJdJNsBto" },
  { name: "This Is My Jam", url: "https://www.thisismyjam.com" },
  { name: "Lanyrd", url: "https://en.wikipedia.org/wiki/Lanyrd" },
  { name: "Spacelog", url: "https://spacelog.org" },
];

export const socials = [
  { name: "X", handle: "@bfirsh", url: "https://x.com/bfirsh" },
  { name: "GitHub", handle: "bfirsh", url: "https://github.com/bfirsh" },
  { name: "LinkedIn", handle: "bfirsh", url: "https://www.linkedin.com/in/bfirsh/" },
];

export const profileImage = "/profile.png";
