import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { CatalogSearchService } from './lib/catalog/searchService';
import { CatalogError, type CatalogProvider } from './lib/providers/types';
import { STORAGE_KEY } from './state/storage';
import type { CatalogRecording } from './types';
import { recording } from './test/fixtures';

const CATALOG: Record<string, CatalogRecording[]> = {
  'The Weeknd Blinding Lights': [
    recording({ id: 'itunes:1', title: 'Blinding Lights (Live)', album: 'Live at SoFi Stadium', listingUrl: 'https://music.apple.com/us/album/x?i=1' }),
    recording({ id: 'itunes:2', listingUrl: 'https://music.apple.com/us/album/blinding-lights/1499378108?i=2&uo=4' }),
  ],
  'Daft Punk One More Time': [
    recording({ id: 'itunes:3', artist: 'Daft Punk', title: 'One More Time', album: 'Discovery', price: undefined, listingUrl: 'https://music.apple.com/us/album/x?i=3' }),
  ],
  'Usher Yeah!': [recording({ id: 'itunes:4', artist: 'Some Tribute Band', title: 'Hey', album: 'Party Covers' })],
  'The Weeknd Save Your Tears': [recording({ id: 'itunes:5', title: 'Save Your Tears', listingUrl: 'https://music.apple.com/us/album/x?i=5' })],
};

function setup(options: { failing?: boolean } = {}) {
  const search = vi.fn<CatalogProvider['search']>(async ({ term }) => {
    if (options.failing) throw new CatalogError('network', 'Couldn’t reach Apple’s catalog.');
    return CATALOG[term] ?? [];
  });
  const provider: CatalogProvider = { id: 'itunes', name: 'Test', search };
  const service = new CatalogSearchService(provider, { minIntervalMs: 0, maxRetries: 0 });
  const user = userEvent.setup();
  const utils = render(<App service={service} />);
  return { ...utils, user, search, service };
}

async function pasteAndImport(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByLabelText('Paste one track per line'));
  await user.paste(text);
  await user.click(screen.getByRole('button', { name: /^Import \d+ tracks?$/ }));
}

const row = (title: string) => {
  const el = screen.getAllByRole('listitem').find((li) => li.hasAttribute('data-track-id') && within(li).queryAllByText(title, { selector: 'p' }).length > 0);
  if (!el) throw new Error(`No row for ${title}`);
  return el;
};

describe('App', () => {
  it('imports a pasted tracklist and links each match to its verified store listing', async () => {
    const { user, search } = setup();
    expect(screen.getByRole('heading', { name: 'Start a purchase list' })).toBeInTheDocument();

    await pasteAndImport(user, 'The Weeknd - Blinding Lights\nDaft Punk — One More Time\nUsher - Yeah!');
    expect(screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-track-id'))).toHaveLength(3);

    const listing = await within(row('Blinding Lights')).findByRole('link', { name: /Open iTunes Store listing for The Weeknd – Blinding Lights/ });
    expect(listing).toHaveAttribute('href', 'https://music.apple.com/us/album/blinding-lights/1499378108?i=2&uo=4');
    expect(listing).toHaveAttribute('target', '_blank');
    expect(listing).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(listing.textContent).not.toMatch(/buy/i);
    expect(within(row('Blinding Lights')).getByText('High confidence')).toBeInTheDocument();

    // A listing without an individual price is clearly marked as unverified.
    await waitFor(() => expect(within(row('One More Time')).getByRole('link', { name: /no individual track price/ })).toBeInTheDocument());

    // A poor result is labelled, and search links still work.
    await waitFor(() => expect(within(row('Yeah!')).getByText('No reliable match')).toBeInTheDocument());
    await user.click(within(row('Yeah!')).getByRole('button', { name: /^Search$/ }));
    const amazon = within(row('Yeah!')).getByRole('link', { name: /Amazon Digital Music/ });
    expect(amazon).toHaveAttribute('href', 'https://www.amazon.com/s?k=Usher%20Yeah!&i=digital-music');
    expect(within(row('Yeah!')).getByText(/not an iTunes Store purchase page/)).toBeInTheDocument();

    // One request per track: the broader fallback query only runs when a search returns nothing.
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('requires a fix before importing lines it could not parse', async () => {
    const { user } = setup();
    await user.click(screen.getByLabelText('Paste one track per line'));
    await user.paste('Blinding Lights\nDaft Punk - One More Time');
    expect(screen.getByText(/1 need a look/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import 1 track' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Artist for line 1'), 'The Weeknd');
    await user.click(screen.getByRole('button', { name: 'Import 2 tracks' }));
    expect(row('Blinding Lights')).toHaveTextContent('The Weeknd');
  });

  it('tracks purchase status, updates the summary, and restores it after a reload', async () => {
    const { user, unmount, search } = setup();
    await pasteAndImport(user, 'The Weeknd - Blinding Lights\nDaft Punk - One More Time');
    await within(row('Blinding Lights')).findByRole('link', { name: /Open iTunes Store listing/ });

    await user.click(within(row('Blinding Lights')).getByRole('button', { name: /^Purchased/ }));
    expect(within(row('Blinding Lights')).getByRole('button', { name: /^Purchased/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('1/2 done · 50%')).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEY)).toContain('"purchased"'));

    const calls = search.mock.calls.length;
    unmount();
    setup();
    expect(within(row('Blinding Lights')).getByRole('button', { name: /^Purchased/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row('Blinding Lights')).getByRole('link', { name: /Open iTunes Store listing/ })).toBeInTheDocument();
    expect(search.mock.calls.length).toBe(calls);
  });

  it('lets the user compare versions and pick an alternative', async () => {
    const { user } = setup();
    await pasteAndImport(user, 'The Weeknd - Blinding Lights');
    await within(row('Blinding Lights')).findByText('High confidence');

    await user.click(within(row('Blinding Lights')).getByRole('button', { name: /Versions/ }));
    const versions = within(row('Blinding Lights')).getByRole('list', { name: 'Candidate recordings' });
    expect(versions.children).toHaveLength(2);
    expect(within(versions).getByText('Live version (not requested)')).toBeInTheDocument();

    await user.click(within(versions).getByRole('button', { name: /Use this version: The Weeknd – Blinding Lights \(Live\)/ }));
    expect(within(row('Blinding Lights')).getByText('Your pick')).toBeInTheDocument();
    expect(within(row('Blinding Lights')).getAllByRole('link', { name: /Open iTunes Store listing/ })[0]).toHaveAttribute(
      'href',
      'https://music.apple.com/us/album/x?i=1',
    );
  });

  it('re-matches a track after it is edited', async () => {
    const { user, search } = setup();
    await pasteAndImport(user, 'The Weeknd - Blinding Lights');
    await within(row('Blinding Lights')).findByText('High confidence');
    await user.click(within(row('Blinding Lights')).getByRole('button', { name: /Versions/ }));

    const title = within(row('Blinding Lights')).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Save Your Tears');
    await user.click(screen.getByRole('button', { name: 'Save and re-match' }));

    await waitFor(() => expect(search).toHaveBeenCalledWith(expect.objectContaining({ term: 'The Weeknd Save Your Tears' }), expect.anything()));
    expect((await within(row('Save Your Tears')).findAllByRole('link', { name: /Open iTunes Store listing/ }))[0]).toHaveAttribute(
      'href',
      'https://music.apple.com/us/album/x?i=5',
    );
  });

  it('removes a track and can undo it', async () => {
    const { user } = setup();
    await pasteAndImport(user, 'The Weeknd - Blinding Lights\nDaft Punk - One More Time');
    await user.click(within(row('One More Time')).getByRole('button', { name: /Versions/ }));
    await user.click(screen.getByRole('button', { name: 'Remove track' }));
    expect(screen.queryByText('One More Time', { selector: 'p' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(row('One More Time')).toBeInTheDocument();
  });

  it('removes duplicates only after confirmation', async () => {
    const { user } = setup();
    await pasteAndImport(user, 'The Weeknd - Blinding Lights\nthe weeknd – blinding lights\nThe Weeknd - Blinding Lights (Live)');
    expect(screen.getByText(/1 likely duplicate/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove duplicates…' }));
    expect(screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-track-id'))).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Confirm: remove 1' }));
    expect(screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-track-id'))).toHaveLength(2);
  });

  it('shows lookup failures with a retry while keeping search links available', async () => {
    const { user } = setup({ failing: true });
    await pasteAndImport(user, 'The Weeknd - Blinding Lights');
    await within(row('Blinding Lights')).findByText('Lookup failed');
    await user.click(within(row('Blinding Lights')).getByRole('button', { name: /^Search$/ }));
    expect(within(row('Blinding Lights')).getByRole('link', { name: /Beatport/ })).toHaveAttribute(
      'href',
      'https://www.beatport.com/search?q=The%20Weeknd%20Blinding%20Lights',
    );
    expect(screen.getByRole('button', { name: /Retry 1 failed lookup/ })).toBeInTheDocument();
  });

  it('imports a CSV file', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: /Upload CSV/ }));
    const file = new File(['Track Name,Artist Name(s),Album Name\n"Blinding Lights","The Weeknd","After Hours"\n'], 'playlist.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText(/Drop a CSV here/), file);
    expect(await screen.findByText(/Loaded/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import 1 track' }));
    expect(row('Blinding Lights')).toBeInTheDocument();
  });

  it('adds a track manually', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('tab', { name: /Add a track/ }));
    await user.type(screen.getByLabelText('Artist'), 'Daft Punk');
    await user.type(screen.getByLabelText('Title'), 'One More Time');
    await user.click(screen.getByRole('button', { name: 'Add track' }));
    expect(row('One More Time')).toHaveTextContent('Daft Punk');
  });

  it('supports keyboard navigation and status shortcuts', async () => {
    const { user } = setup();
    await pasteAndImport(user, 'The Weeknd - Blinding Lights\nDaft Punk - One More Time');
    await user.click(document.body);
    await user.keyboard('j');
    expect(row('Blinding Lights')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('p');
    expect(within(row('Blinding Lights')).getByRole('button', { name: /^Purchased/ })).toHaveAttribute('aria-pressed', 'true');
    // Marking purchased moves on to the next track.
    expect(row('One More Time')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('s');
    expect(within(row('One More Time')).getByRole('button', { name: /^Skipped/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters by status', async () => {
    const { user } = setup();
    await pasteAndImport(user, 'The Weeknd - Blinding Lights\nDaft Punk - One More Time');
    await user.click(within(row('One More Time')).getByRole('button', { name: /^Skipped/ }));
    await user.click(screen.getByRole('button', { name: /^Skipped 1/ }));
    expect(screen.getAllByRole('listitem').filter((li) => li.hasAttribute('data-track-id'))).toHaveLength(1);
    await user.type(screen.getByRole('searchbox'), 'weeknd');
    expect(screen.getByText(/No tracks match these filters/)).toBeInTheDocument();
  });

  it('starts fresh with a notice when stored data is corrupted', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    setup();
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Start a purchase list' })).toBeInTheDocument();
  });

  it('clears the workspace after confirmation', async () => {
    const { user } = setup();
    await pasteAndImport(user, 'The Weeknd - Blinding Lights');
    await user.click(screen.getByRole('button', { name: 'Clear workspace' }));
    expect(screen.getByText(/Remove all 1 tracks/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear workspace' }).at(-1)!);
    expect(screen.getByRole('heading', { name: 'Start a purchase list' })).toBeInTheDocument();
  });
});
