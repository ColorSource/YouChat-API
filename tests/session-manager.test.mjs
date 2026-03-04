import test from 'node:test';
import assert from 'node:assert/strict';
import SessionManager from '../src/core/session-manager.mjs';

function createManager() {
    const provider = {
        getRandomSwitchThreshold: () => 1,
    };
    return new SessionManager(provider);
}

test('isBrowserConnected 支持 browser.isConnected', () => {
    const manager = createManager();
    const browser = {
        isConnected: () => true,
    };
    assert.equal(manager.isBrowserConnected(browser), true);
});

test('isBrowserConnected 支持 context.pages 可达性检查', () => {
    const manager = createManager();
    const browserInstance = {
        context: {
            pages: () => [],
        },
    };
    assert.equal(manager.isBrowserConnected(browserInstance), true);
});

test('isBrowserConnected 在 context.pages 抛错时返回 false', () => {
    const manager = createManager();
    const browserInstance = {
        context: {
            pages: () => {
                throw new Error('closed');
            },
        },
    };
    assert.equal(manager.isBrowserConnected(browserInstance), false);
});

test('getAvailableSessions 在浏览器分配失败时回滚 session 锁', async () => {
    const manager = createManager();
    manager.setSessions({
        'user@example.com': {},
    });

    manager.getAvailableBrowser = async () => {
        throw new Error('browser unavailable');
    };

    await assert.rejects(
        manager.getAvailableSessions(),
        /browser unavailable/
    );

    assert.equal(manager.sessions['user@example.com'].locked, false);
    assert.equal(manager.sessions['user@example.com'].requestCount, 0);
});

test('startAutoUnlockTimer 会自动释放 session 和 browser 锁', async () => {
    const manager = createManager();
    manager.setSessions({
        'user@example.com': {},
    });
    manager.sessions['user@example.com'].locked = true;

    let releasedBrowserId = null;
    manager.releaseBrowser = async (browserId) => {
        releasedBrowserId = browserId;
    };

    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    let capturedTimerCallback = null;
    global.setTimeout = (fn) => {
        capturedTimerCallback = fn;
        return Symbol('timer');
    };
    global.clearTimeout = () => {};

    try {
        manager.startAutoUnlockTimer('user@example.com', 'browser_0');
        assert.equal(typeof capturedTimerCallback, 'function');
        await capturedTimerCallback();
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }

    assert.equal(manager.sessions['user@example.com'].locked, false);
    assert.equal(releasedBrowserId, 'browser_0');
});
