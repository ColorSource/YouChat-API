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
