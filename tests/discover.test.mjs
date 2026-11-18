import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const qml = readFileSync(new URL('../DiscoverView.qml', import.meta.url), 'utf8');

// Exercise the production functions with a fake model and process runner.
function discovery(overrides = {}) {
    const calls = [];
    const data = Array.from({ length: 12 }, (_, i) => ({ wid: String(i), fileName: `wallhaven-${i}.jpg`, full: `https://w.wallhaven.cc/${i}.jpg` }));
    const saved = [];
    const state = {
        hub: {
            apiKey: '',
            previewDir: '/cache/preview',
            previewScript: '/plugin/preview-cache.sh',
            userAgent: 'test-agent',
            ensureMigrated: () => {},
            loadState: () => undefined,
            saveState: (key, value) => saved.push([key, value]),
        },
        api: 'https://wallhaven.cc/api/v1', query: '', categories: '111', purity: '111', sorting: 'toplist', topRange: '1M', atleast: '', seed: '',
        previewing: true, grid: { currentIndex: 0 }, results: { count: data.length, get: i => data[i] },
        cachedFull: {}, fetchingFull: {}, failedFull: {}, previewQueue: [], cacheMinutes: 30, filtersReady: true,
        Proc: { runCommand: (...args) => calls.push(args) },
        I18n: { trFor: (_id, text) => text },
        ...overrides,
    };
    state.saved = saved;
    state.view = state;
    vm.createContext(state);
    for (const match of qml.matchAll(/^    function (\w+)\(([^)]*)\) \{\n([\s\S]*?)^    \}/gm)) {
        vm.runInContext(`function ${match[1]}(${match[2]}) {\n${match[3]}\n}`, state);
    }
    return { state, calls };
}

test('persistFilters writes every search-driving field, including empty query and atleast', () => {
    const { state } = discovery({
        query: ' mountains ',
        categories: '101',
        purity: '110',
        sorting: 'hot',
        atleast: '',
        topRange: '1w',
    });
    state.persistFilters();
    assert.deepEqual(Object.fromEntries(state.saved), {
        query: ' mountains ',
        categories: '101',
        purity: '110',
        sorting: 'hot',
        atleast: '',
        topRange: '1w',
    });
});

test('no key keeps SFW; all seven toplist periods reach the API URL', () => {
    const { state } = discovery();
    for (const period of ['1d', '3d', '1w', '1M', '3M', '6M', '1y']) {
        state.topRange = period;
        const url = new URL(state.url(1));
        assert.equal(url.searchParams.get('purity'), '100');
        assert.equal(url.searchParams.get('topRange'), period);
        assert.equal(url.searchParams.has('apikey'), false);
    }
    state.hub.apiKey = 'fake-test-key';
    state.purity = '010';
    assert.equal(new URL(state.url(2)).searchParams.get('purity'), '010');
    assert.equal(state.explain('HTTP 401'), 'Wallhaven rejected the API key. Check WALLHAVEN_API_KEY in the session environment.');
});

test('fast navigation keeps at most three active downloads and replaces queued neighbors', () => {
    const { state, calls } = discovery();
    state.prefetchAround();
    assert.equal(calls.length, 2);
    state.grid.currentIndex = 3;
    state.prefetchAround();
    assert.equal(calls.length, 3);
    state.grid.currentIndex = 9;
    state.prefetchAround();
    assert.equal(calls.length, 3);
    assert.equal(Object.keys(state.fetchingFull).length, 3);
    calls[0][2]('', 0);
    assert.equal(calls.length, 4);
    assert.equal(calls[3][0], 'wallhavenCarousel.preview.9');
    assert.equal(Object.keys(state.fetchingFull).length, 3);
    state.previewing = false;
    state.prefetchAround();
    calls[1][2]('', 0);
    assert.equal(calls.length, 4);
});

function wallpaper(id) {
    return {
        id,
        path: `https://w.wallhaven.cc/full/${id}.jpg`,
        thumbs: { large: `https://thumbs/${id}.jpg`, original: `https://thumbs/${id}-o.jpg` },
        resolution: '1920x1080',
        file_size: 4096,
        category: 'general',
        colors: ['#112233'],
        views: 10,
        favorites: 2,
    };
}

function pageJson(ids, lastPage = 3) {
    return JSON.stringify({
        data: ids.map(wallpaper),
        meta: { last_page: lastPage, total: 40 },
    });
}

function resultModel(n = 12) {
    const data = Array.from({ length: n }, (_, i) => ({
        wid: String(i),
        fileName: `wallhaven-${i}.jpg`,
        full: `https://w.wallhaven.cc/${i}.jpg`,
    }));
    return {
        get count() {
            return data.length;
        },
        get: i => data[i],
        append(item) {
            data.push(item);
        },
        clear() {
            data.length = 0;
        },
    };
}

// Preview is open on a search that already has a page of results.
function previewBrowse(overrides = {}) {
    const { results: model = resultModel(), hub: hubOverrides, ...rest } = overrides;
    return discovery({
        page: 1,
        lastPage: 3,
        loading: false,
        serial: 0,
        errorText: '',
        noticeText: '',
        noticeIsEnd: false,
        armedNextFrom: -1,
        grid: {
            currentIndex: 0,
            positionViewAtIndex() {},
            forceActiveFocus() {},
        },
        results: model,
        GridView: { Contain: 1 },
        ...rest,
        hub: {
            apiKey: '',
            previewDir: '/cache/preview',
            previewScript: '/plugin/preview-cache.sh',
            userAgent: 'test-agent',
            ensureMigrated: () => {},
            loadState: () => undefined,
            saveState: () => {},
            fetch: url => url,
            ...hubOverrides,
        },
    });
}

test('PgDn on the last page shows "No more results" and does not ask again', () => {
    const { state, calls } = previewBrowse({ page: 2, lastPage: 2 });
    state.grid.currentIndex = 4;

    state.loadMore();
    state.loadMore();

    assert.equal(calls.length, 0);
    assert.equal(state.grid.currentIndex, 4);
    assert.equal(state.noticeText, 'No more results');
    assert.equal(state.noticeIsEnd, true);
    assert.equal(state.errorText, '');
});

test('a failed Load more shows the same sentence as the grid', () => {
    const cases = [
        ['HTTP 429', 'Wallhaven is rate limiting searches. Wait a minute.'],
        ['HTTP 401', 'Wallhaven rejected the API key. Check WALLHAVEN_API_KEY in the session environment.'],
        ['HTTP 503', 'Wallhaven answered with an error (HTTP 503).'],
        ['offline', 'No connection to Wallhaven.'],
    ];
    for (const [out, sentence] of cases) {
        const { state, calls } = previewBrowse({
            I18n: {
                trFor(_id, text) {
                    const translated = new String(text);
                    translated.arg = (...values) => text.replace(/%(\d+)/g, (_, n) => values[Number(n) - 1]);
                    return translated;
                },
            },
        });
        state.grid.currentIndex = 4;
        state.loadMore();
        assert.equal(calls.length, 1);
        assert.equal(calls[0][0], 'wallhavenCarousel.search');
        assert.equal(String(calls[0][1]).includes('page=2'), true);
        calls[0][2](out, 1);
        assert.equal(state.grid.currentIndex, 4);
        assert.equal(String(state.noticeText), sentence);
        assert.equal(String(state.errorText), sentence);
    }
});

test('a Load more that is not a wallpaper list shows the grid sentence', () => {
    const cases = [
        ['{', "Wallhaven sent an answer that isn't JSON."],
        ['{"error":"bad query"}', 'bad query'],
        ['{}', 'Wallhaven sent an unexpected answer.'],
    ];
    for (const [out, sentence] of cases) {
        const { state, calls } = previewBrowse();
        state.grid.currentIndex = 4;
        state.loadMore();
        calls[0][2](out, 0);
        assert.equal(state.grid.currentIndex, 4);
        assert.equal(state.noticeText, sentence);
        assert.equal(state.errorText, sentence);
    }
});

test('a successful PgDn appends a result and shows no Notice', () => {
    const { state, calls } = previewBrowse();
    state.grid.currentIndex = 4;
    const before = state.results.count;

    state.loadMore();

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'wallhavenCarousel.search');
    assert.equal(String(calls[0][1]).includes('page=2'), true);
    assert.equal(state.noticeText, '');
    assert.equal(state.grid.currentIndex, 4);

    calls[0][2](pageJson(['aa']), 0);

    assert.equal(state.grid.currentIndex, 4);
    assert.equal(state.results.count, before + 1);
    assert.equal(state.results.get(before).wid, 'aa');
    assert.equal(state.noticeText, '');
});

test('an error Notice stays through a retry and clears when a result arrives', () => {
    const { state, calls } = previewBrowse();
    state.grid.currentIndex = 4;
    const before = state.results.count;

    state.loadMore();
    calls[0][2]('HTTP 429', 1);
    assert.equal(state.noticeText, 'Wallhaven is rate limiting searches. Wait a minute.');

    state.loadMore();
    assert.equal(calls.length, 2);
    assert.equal(state.noticeText, 'Wallhaven is rate limiting searches. Wait a minute.');
    assert.equal(state.grid.currentIndex, 4);

    calls[1][2](pageJson(['bb']), 0);

    assert.equal(state.grid.currentIndex, 4);
    assert.equal(state.results.count, before + 1);
    assert.equal(state.noticeText, '');
    assert.equal(state.errorText, '');
});

test('a new failure replaces the Notice text', () => {
    const { state, calls } = previewBrowse();
    state.grid.currentIndex = 4;

    state.loadMore();
    calls[0][2]('HTTP 429', 1);
    state.loadMore();
    assert.equal(state.noticeText, 'Wallhaven is rate limiting searches. Wait a minute.');

    calls[1][2]('HTTP 401', 1);

    assert.equal(state.grid.currentIndex, 4);
    assert.equal(state.noticeText, 'Wallhaven rejected the API key. Check WALLHAVEN_API_KEY in the session environment.');
    assert.equal(state.errorText, 'Wallhaven rejected the API key. Check WALLHAVEN_API_KEY in the session environment.');
});

test('stepping to another loaded result clears the Notice', () => {
    const { state } = previewBrowse({ page: 2, lastPage: 2 });
    state.grid.currentIndex = 4;
    state.loadMore();
    assert.equal(state.noticeText, 'No more results');

    state.step(1);

    assert.equal(state.grid.currentIndex, 5);
    assert.equal(state.noticeText, '');
});

test('Next on the last loaded result runs Load more and lands on the first new result', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'wallhavenCarousel.search');
    assert.equal(String(calls[0][1]).includes('page=2'), true);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.noticeText, '');
    assert.equal(state.previewing, true);

    calls[0][2](pageJson(['aa', 'bb']), 0);

    assert.equal(state.results.count, before + 2);
    assert.equal(state.grid.currentIndex, before);
    assert.equal(state.results.get(state.grid.currentIndex).wid, 'aa');
    assert.equal(state.noticeText, '');
    assert.equal(state.previewing, true);
});

test('a new search does not keep Next armed', () => {
    const model = resultModel(1);
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4, results: model });
    state.grid.currentIndex = 0;

    state.step(1);
    state.search();
    calls[1][2](pageJson(['zz']), 0);

    assert.equal(state.grid.currentIndex, 0);
    assert.equal(state.results.get(0).wid, 'zz');

    calls[0][2](pageJson(['aa']), 0);
    assert.equal(state.grid.currentIndex, 0);
    assert.equal(state.results.get(0).wid, 'zz');

    state.loadMore();
    calls[2][2](pageJson(['bb']), 0);

    assert.equal(state.grid.currentIndex, 0);
    assert.equal(state.results.get(0).wid, 'zz');
    assert.equal(state.results.get(1).wid, 'bb');
});

test('the result Next lands on loads through the existing Preview fetch', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    calls[0][2](pageJson(['aa']), 0);

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'wallhavenCarousel.search');
    assert.equal(state.results.get(state.grid.currentIndex).wid, 'aa');

    state.prefetchAround();

    assert.equal(calls.some(call => call[0] === 'wallhavenCarousel.preview.aa'), true);
});

test('a Notice stays while Next retries and clears when the new result arrives', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    calls[0][2]('HTTP 429', 1);
    assert.equal(state.noticeText, 'Wallhaven is rate limiting searches. Wait a minute.');
    assert.equal(state.noticeIsEnd, false);

    state.step(1);
    assert.equal(calls.length, 2);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.noticeText, 'Wallhaven is rate limiting searches. Wait a minute.');

    calls[1][2](pageJson(['aa']), 0);

    assert.equal(state.grid.currentIndex, before);
    assert.equal(state.results.get(state.grid.currentIndex).wid, 'aa');
    assert.equal(state.noticeText, '');
    assert.equal(state.errorText, '');
});

test('Load more after a failed Next appends without stepping', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    calls[0][2]('HTTP 429', 1);
    assert.equal(state.noticeText, 'Wallhaven is rate limiting searches. Wait a minute.');

    state.loadMore();
    assert.equal(calls.length, 2);
    assert.equal(state.grid.currentIndex, before - 1);

    calls[1][2](pageJson(['aa']), 0);

    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.results.get(before).wid, 'aa');
    assert.equal(state.noticeText, '');
    assert.equal(state.errorText, '');
});

test('a failed Next stays put and shows the grid sentence', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const last = state.results.count - 1;
    state.grid.currentIndex = last;

    state.step(1);
    calls[0][2]('HTTP 429', 1);

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, last);
    assert.equal(state.noticeText, 'Wallhaven is rate limiting searches. Wait a minute.');
    assert.equal(state.errorText, 'Wallhaven is rate limiting searches. Wait a minute.');
});

test('Load more on the last loaded result appends without stepping', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.loadMore();

    assert.equal(calls.length, 1);
    assert.equal(String(calls[0][1]).includes('page=2'), true);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.noticeText, '');

    calls[0][2](pageJson(['aa', 'bb']), 0);

    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.results.get(before).wid, 'aa');
    assert.equal(state.noticeText, '');
});

test('Next on the last loaded result outside Preview does not Load more', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4, previewing: false });
    const last = state.results.count - 1;
    state.grid.currentIndex = last;

    state.step(1);

    assert.equal(calls.length, 0);
    assert.equal(state.grid.currentIndex, last);
    assert.equal(state.noticeText, '');
});

test('an empty page from Next stays put, says "No more results", and does not fetch again', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    calls[0][2](JSON.stringify({
        data: [],
        meta: { last_page: 9, total: before },
    }), 0);

    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.results.count, before);
    assert.equal(state.noticeText, 'No more results');
    assert.equal(state.errorText, '');

    state.step(1);

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.noticeText, 'No more results');
});

test('reopening Preview before the page arrives does not step onto the new result', () => {
    const { state, calls } = previewBrowse({
        page: 1,
        lastPage: 4,
        selected: { wid: '11' },
        preview: { forceActiveFocus() {} },
    });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    state.closePreview();
    state.openPreview();

    assert.equal(state.previewing, true);
    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, before - 1);

    calls[0][2](pageJson(['aa']), 0);

    assert.equal(state.previewing, true);
    assert.equal(state.results.count, before + 1);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.noticeText, '');
});

test('closing Preview during Load more does not step onto the new result', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    state.closePreview();

    assert.equal(calls.length, 1);
    assert.equal(state.previewing, false);
    assert.equal(state.noticeText, '');

    calls[0][2](pageJson(['aa']), 0);

    assert.equal(state.previewing, false);
    assert.equal(state.results.count, before + 1);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.results.get(before).wid, 'aa');
    assert.equal(state.noticeText, '');
});

test('stepping back onto the last loaded result does not step onto the new result', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    state.step(-1);
    state.step(1);

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, before - 1);

    calls[0][2](pageJson(['aa']), 0);

    assert.equal(state.results.count, before + 1);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.results.get(before).wid, 'aa');
    assert.equal(state.noticeText, '');
});

test('stepping backward during Load more keeps the result you moved to', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    state.step(-1);

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, before - 2);

    calls[0][2](pageJson(['aa']), 0);

    assert.equal(state.results.count, before + 1);
    assert.equal(state.grid.currentIndex, before - 2);
    assert.equal(state.noticeText, '');
});

test('Next during a PgDn fetch does not step when the page arrives', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.loadMore();
    state.step(1);

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, before - 1);

    calls[0][2](pageJson(['aa', 'bb']), 0);

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.results.get(before).wid, 'aa');
    assert.equal(state.noticeText, '');
});

test('another Next while Load more is in flight does not ask again', () => {
    const { state, calls } = previewBrowse({ page: 1, lastPage: 4 });
    const before = state.results.count;
    state.grid.currentIndex = before - 1;

    state.step(1);
    state.step(1);

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, before - 1);
    assert.equal(state.noticeText, '');

    calls[0][2](pageJson(['aa', 'bb']), 0);

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, before);
    assert.equal(state.results.get(state.grid.currentIndex).wid, 'aa');
    assert.equal(state.noticeText, '');
});

test('Next on the last page shows "No more results" and does not ask again', () => {
    const { state, calls } = previewBrowse({ page: 2, lastPage: 2 });
    const last = state.results.count - 1;
    state.grid.currentIndex = last;

    state.step(1);

    assert.equal(calls.length, 0);
    assert.equal(state.grid.currentIndex, last);
    assert.equal(state.noticeText, 'No more results');
    assert.equal(state.errorText, '');

    state.step(1);

    assert.equal(calls.length, 0);
    assert.equal(state.grid.currentIndex, last);
    assert.equal(state.noticeText, 'No more results');
});

test('Next in the middle moves one result and Previous moves back', () => {
    const { state, calls } = previewBrowse();
    state.grid.currentIndex = 4;

    state.step(1);

    assert.equal(calls.length, 0);
    assert.equal(state.grid.currentIndex, 5);
    assert.equal(state.noticeText, '');

    state.step(-1);

    assert.equal(calls.length, 0);
    assert.equal(state.grid.currentIndex, 4);
    assert.equal(state.noticeText, '');
});

test('Previous on the first loaded result does nothing', () => {
    const { state, calls } = previewBrowse();
    state.grid.currentIndex = 0;

    state.step(-1);

    assert.equal(calls.length, 0);
    assert.equal(state.grid.currentIndex, 0);
    assert.equal(state.noticeText, '');
});

test('staying on the same result leaves the Notice', () => {
    const { state } = previewBrowse({ page: 2, lastPage: 2 });
    state.grid.currentIndex = state.results.count - 1;
    state.loadMore();
    assert.equal(state.noticeText, 'No more results');

    state.step(1);

    assert.equal(state.grid.currentIndex, state.results.count - 1);
    assert.equal(state.noticeText, 'No more results');
});

test('closing Preview clears the Notice', () => {
    const { state, calls } = previewBrowse();
    state.loadMore();
    calls[0][2]('HTTP 429', 1);
    assert.equal(state.noticeText, 'Wallhaven is rate limiting searches. Wait a minute.');

    state.closePreview();

    assert.equal(state.previewing, false);
    assert.equal(state.noticeText, '');
});

test('a failure after Preview closes updates the grid line and leaves the Notice clear', () => {
    const { state, calls } = previewBrowse();
    state.loadMore();
    state.closePreview();
    calls[0][2]('HTTP 429', 1);

    assert.equal(state.previewing, false);
    assert.equal(state.noticeText, '');
    assert.equal(state.errorText, 'Wallhaven is rate limiting searches. Wait a minute.');
});

test('an empty page leaves the result, shows "No more results", and does not fetch again', () => {
    const { state, calls } = previewBrowse();
    state.grid.currentIndex = 4;
    const before = state.results.count;

    state.loadMore();
    calls[0][2](JSON.stringify({
        data: [],
        meta: { last_page: 9, total: before },
    }), 0);

    assert.equal(state.grid.currentIndex, 4);
    assert.equal(state.results.count, before);
    assert.equal(state.noticeText, 'No more results');
    assert.equal(state.errorText, '');

    state.loadMore();

    assert.equal(calls.length, 1);
    assert.equal(state.grid.currentIndex, 4);
    assert.equal(state.noticeText, 'No more results');
});

test('Load more outside Preview does not plant a Notice', () => {
    const finished = previewBrowse({ page: 2, lastPage: 2, previewing: false });
    finished.state.loadMore();
    assert.equal(finished.calls.length, 0);
    assert.equal(finished.state.noticeText, '');
    assert.equal(finished.state.errorText, '');

    const failed = previewBrowse({ previewing: false });
    failed.state.loadMore();
    failed.calls[0][2]('HTTP 429', 1);
    assert.equal(failed.state.noticeText, '');
    assert.equal(failed.state.errorText, 'Wallhaven is rate limiting searches. Wait a minute.');

    const empty = previewBrowse({ previewing: false });
    empty.state.loadMore();
    empty.calls[0][2](JSON.stringify({ data: [], meta: { last_page: 9, total: 1 } }), 0);
    assert.equal(empty.state.noticeText, '');
    assert.equal(empty.state.errorText, '');
    empty.state.loadMore();
    assert.equal(empty.calls.length, 1);
});

test('failed previews are not cached and can be retried', () => {
    const { state, calls } = discovery({ previewing: false });
    state.fetchFull(2);
    calls[0][2]('', 1);
    assert.equal(state.failedFull['2'], true);
    assert.equal(state.cachedFull['2'], undefined);
    assert.equal(state.fetchingFull['2'], undefined);
    state.fetchFull(2);
    assert.equal(state.failedFull['2'], undefined);
    calls[1][2]('', 0);
    assert.equal(state.isCached('2'), true);
    assert.equal(state.fullSource(state.results.get(2)), 'file:///cache/preview/wallhaven-2.jpg');
});

test('wallhavenPageUrl is the public Wallhaven page for an id', () => {
    const { state } = discovery();
    assert.equal(state.wallhavenPageUrl('abc12'), 'https://wallhaven.cc/w/abc12');
});

test('openWallhavenPage opens the Wallhaven page and leaves Discover open', () => {
    const opened = [];
    let closed = 0;
    const { state } = discovery({
        selected: { wid: 'abc12' },
        Qt: {
            openUrlExternally: url => {
                opened.push(url);
                return true;
            },
        },
    });
    state.hub.close = () => {
        closed += 1;
    };
    assert.equal(state.openWallhavenPage(), true);
    assert.deepEqual(opened, ['https://wallhaven.cc/w/abc12']);
    assert.equal(closed, 0);
});

test('openWallhavenPage does nothing with no selection', () => {
    const opened = [];
    let closed = 0;
    const { state } = discovery({
        selected: null,
        Qt: {
            openUrlExternally: url => {
                opened.push(url);
                return true;
            },
        },
    });
    state.hub.close = () => {
        closed += 1;
    };
    assert.equal(state.openWallhavenPage(), false);
    assert.deepEqual(opened, []);
    assert.equal(closed, 0);
});

test('openWallhavenPage returns false when open fails', () => {
    let closed = 0;
    const { state } = discovery({
        selected: { wid: 'abc12' },
        Qt: { openUrlExternally: () => false },
    });
    state.hub.close = () => {
        closed += 1;
    };
    assert.equal(state.openWallhavenPage(), false);
    assert.equal(closed, 0);
});

test('act openPage opens the Wallhaven page and leaves Discover open', () => {
    const opened = [];
    let closed = 0;
    const { state } = discovery({
        selected: { wid: 'zz9' },
        Qt: {
            openUrlExternally: url => {
                opened.push(url);
                return true;
            },
        },
    });
    state.hub.close = () => {
        closed += 1;
    };
    assert.equal(state.act('openPage'), true);
    assert.deepEqual(opened, ['https://wallhaven.cc/w/zz9']);
    assert.equal(closed, 0);
});
