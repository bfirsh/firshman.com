// Seeded randomness and the quiet edition mark shared by the piece.

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getSeed(): number {
  const q = new URLSearchParams(location.search).get('seed');
  const n = q ? parseInt(q, 10) : NaN;
  if (Number.isFinite(n) && n > 0) return n;
  return 1 + Math.floor(Math.random() * 99999);
}

export function mountEdition(el: HTMLButtonElement | null, seed: number) {
  if (!el) return;
  const label = `No. ${seed}`;
  el.textContent = label;
  el.hidden = false;
  const url = `${location.origin}${location.pathname}?seed=${seed}`;
  el.title = 'Copy a link to this edition';
  el.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      el.textContent = 'Link copied';
    } catch {
      history.replaceState(null, '', `?seed=${seed}`);
      el.textContent = 'Link in address bar';
    }
    setTimeout(() => (el.textContent = label), 1600);
  });
}
