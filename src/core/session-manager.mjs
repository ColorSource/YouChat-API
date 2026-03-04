import fs from 'fs';
import path from 'path';
import {Mutex} from 'async-mutex';
import {chromium} from 'playwright';
import {detectBrowser} from '../utils/browser-detector.mjs';
import {createDirectoryIfNotExists} from '../utils/cookie-utils.mjs';
import {optimizeBrowserDisplay} from '../utils/browser-display-fixer.mjs';
import {setupBrowserFingerprint} from '../utils/browser-fingerprint.mjs';
const isHeadless = process.env.HEADLESS_BROWSER === 'true' && process.env.USE_MANUAL_LOGIN !== 'true';

// 浼氳瘽鑷姩閲婃斁鏃堕棿锛堢锛?
const SESSION_LOCK_TIMEOUT = parseInt(process.env.SESSION_LOCK_TIMEOUT || '0', 10);
const runtimeLogDir = path.join(process.cwd(), 'logs');
createDirectoryIfNotExists(runtimeLogDir);

// 瀛樺偍宸茶揪璇锋眰涓婇檺鐨勮处鍙?鏍煎紡: "timestamp | username")
const cooldownFilePath = path.join(runtimeLogDir, 'cooldown-accounts.log');

// 鍐峰嵈鏃堕暱(榛樿24灏忔椂)
const COOLDOWN_DURATION = 24 * 60 * 60 * 1000;

class SessionManager {
    constructor(provider) {
        this.provider = provider;
        this.isCustomModeEnabled = process.env.USE_CUSTOM_MODE === 'true';
        this.isRotationEnabled = process.env.ENABLE_MODE_ROTATION === 'true';
        this.isHeadless = isHeadless; // 鏄惁闅愯棌娴忚鍣?
        this.currentIndex = 0;
        this.usernameList = []; // 缂撳瓨鐢ㄦ埛鍚嶅垪琛?
        this.browserInstances = []; // 娴忚鍣ㄥ疄渚嬫暟缁?
        this.browserMutex = new Mutex(); // 娴忚鍣ㄤ簰鏂ラ攣
        this.browserIndex = 0;
        this.sessionAutoUnlockTimers = {}; // 鑷姩瑙ｉ攣璁℃椂鍣?
        this.cooldownList = this.loadCooldownList(); // 鍔犺浇骞舵竻鐞?cooldown 鏂囦欢
        this.cleanupCooldownList();
    }

    setSessions(sessions) {
        this.sessions = sessions;
        this.usernameList = Object.keys(this.sessions);

        // 涓烘瘡涓?session 鍒濆鍖栫浉鍏冲睘鎬?
        for (const username in this.sessions) {
            const session = this.sessions[username];
            session.locked = false;           // 鏍囪浼氳瘽鏄惁琚攣瀹?
            session.requestCount = 0;         // 璇锋眰璁℃暟
            session.valid = true;            // 鏍囪浼氳瘽鏄惁鏈夋晥
            session.mutex = new Mutex();      // 鍒涘缓浜掓枼閿?
            if (session.currentMode === undefined) {
                session.currentMode = this.isCustomModeEnabled ? 'custom' : 'default';
            }
            if (!session.modeStatus) {
                session.modeStatus = {
                    default: true,
                    custom: true,
                };
            }
            session.rotationEnabled = true; // 鏄惁鍚敤妯″紡杞崲
            session.switchCounter = 0; // 妯″紡鍒囨崲璁℃暟鍣?
            session.requestsInCurrentMode = 0; // 褰撳墠妯″紡涓嬬殑璇锋眰娆℃暟
            session.lastDefaultThreshold = 0; // 涓婃榛樿妯″紡闃堝€?
            session.switchThreshold = this.provider.getRandomSwitchThreshold(session);

            // 璁板綍璇锋眰娆℃暟
            session.youTotalRequests = 0;
            // 鏉冮噸
            if (typeof session.weight !== 'number') {
                session.weight = 1;
            }
        }
    }

    loadCooldownList() {
        try {
            if (!fs.existsSync(cooldownFilePath)) {
                fs.writeFileSync(cooldownFilePath, '', 'utf8');
                return [];
            }
            const lines = fs.readFileSync(cooldownFilePath, 'utf8')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const arr = [];
            for (const line of lines) {
                const parts = line.split('|').map(x => x.trim());
                if (parts.length === 2) {
                    const timestamp = parseInt(parts[0], 10);
                    const name = parts[1];
                    if (!isNaN(timestamp) && name) {
                        arr.push({time: timestamp, username: name});
                    }
                }
            }
            return arr;
        } catch (err) {
            console.error(`Failed to read ${cooldownFilePath}:`, err);
            return [];
        }
    }

    saveCooldownList() {
        try {
            const lines = this.cooldownList.map(item => `${item.time} | ${item.username}`);
            fs.writeFileSync(cooldownFilePath, lines.join('\n') + '\n', 'utf8');
        } catch (err) {
            console.error(`Failed to write ${cooldownFilePath}:`, err);
        }
    }

    // 娓呯悊杩囨湡(瓒呰繃鎸囧畾鍐峰嵈鏃堕暱)
    cleanupCooldownList() {
        const now = Date.now();
        let changed = false;
        this.cooldownList = this.cooldownList.filter(item => {
            const expired = (now - item.time) >= COOLDOWN_DURATION;
            if (expired) changed = true;
            return !expired;
        });
        if (changed) {
            this.saveCooldownList();
        }
    }

    recordLimitedAccount(username) {
        const now = Date.now();
        const already = this.cooldownList.find(x => x.username === username);
        if (!already) {
            this.cooldownList.push({time: now, username});
            this.saveCooldownList();
            console.log(`Added cooldown entry: ${new Date(now).toLocaleString()} | ${username}`);
        }
    }

    // 鏄惁鍦ㄥ喎鍗存湡(24灏忔椂鍐?
    isInCooldown(username) {
        this.cleanupCooldownList();
        return this.cooldownList.some(item => item.username === username);
    }

    // 鎵归噺鍒濆鍖栨祻瑙堝櫒瀹炰緥
    async initBrowserInstancesInBatch() {
        const browserCount = parseInt(process.env.BROWSER_INSTANCE_COUNT) || 1;
        // 鍙互鏄?'chrome', 'edge', 鎴?'auto'
        const browserPath = detectBrowser(process.env.BROWSER_TYPE || 'auto');
        const sharedProfilePath = path.join(process.cwd(), 'browser_profiles');
        createDirectoryIfNotExists(sharedProfilePath);

        const tasks = [];
        for (let i = 0; i < browserCount; i++) {
            const browserId = `browser_${i}`;
            const userDataDir = path.join(sharedProfilePath, browserId);
            createDirectoryIfNotExists(userDataDir);

            tasks.push(this.launchSingleBrowser(browserId, userDataDir, browserPath));
        }

        // 骞惰鎵ц
        const results = await Promise.all(tasks);
        for (const instanceInfo of results) {
            this.browserInstances.push(instanceInfo);
            console.log(`Created browser instance ${instanceInfo.id}`);
        }
    }

    async launchSingleBrowser(browserId, userDataDir, browserPath) {
        const launchArgs = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--window-size=1280,850',
            '--force-device-scale-factor=1',
        ];

        const context = await chromium.launchPersistentContext(userDataDir, {
            headless: this.isHeadless,
            executablePath: browserPath,
            viewport: {width: 1280, height: 850},
            args: launchArgs,
        });
        const browser = context.browser();
        let page = context.pages()[0];
        if (!page || page.isClosed()) {
            page = await context.newPage();
        }

        const isEdge = browserPath.toLowerCase().includes('msedge') ||
            process.env.BROWSER_TYPE === 'edge';
        const browserType = isEdge ? 'edge' : 'chrome';
        let originalUserAgent = 'unknown';
        try {
            if (!page || page.isClosed()) {
                page = await context.newPage();
            }
            originalUserAgent = await page.evaluate(() => navigator.userAgent);
        } catch (error) {
            console.warn(`[${browserId}] Failed to read initial userAgent, recreating page`, error?.message || error);
            if (this.isBrowserConnected(browser)) {
                page = await context.newPage();
            } else {
                throw error;
            }
        }
        // console.log(`Browser ${browserId} original userAgent: ${originalUserAgent}`);

        const fingerprint = await setupBrowserFingerprint(page, browserType);

        try {
            const newUserAgent = await page.evaluate(() => navigator.userAgent);
            const newPlatform = await page.evaluate(() => navigator.platform);
            const newCores = await page.evaluate(() => navigator.hardwareConcurrency);

            // console.log(`娴忚鍣?${browserId} 搴旂敤鎸囩汗鍚?`);
            // console.log(`- 鐢ㄦ埛浠ｇ悊: ${newUserAgent}`);
            // console.log(`- 骞冲彴: ${newPlatform}`);
            // console.log(`- CPU鏍稿績: ${newCores}`);
            // console.log(`- 鍐呭瓨: ${fingerprint.ram}GB`);
            // console.log(`- 璁惧鍚嶇О: ${fingerprint.deviceName}`);

            const isActuallyEdge = newUserAgent.includes('Edg');

            // 搴旂敤鏄剧ず浼樺寲
            try {
                await optimizeBrowserDisplay(page, {
                    width: 1280,
                    height: 850,
                    deviceScaleFactor: 1,
                    cssScale: 1,
                    fixHighDpi: true,
                    isHeadless: this.isHeadless
                });
            } catch (error) {
                console.warn(`Display optimization failed:`, error);
            }

            const instanceInfo = {
                id: browserId,
                browser: browser,
                context: context,
                page: page,
                locked: false,
                isEdgeBrowser: isActuallyEdge,
                fingerprint: fingerprint,
                browserPath: browserPath,
                userDataDir: userDataDir,
                browserType: browserType,
            };
            this.attachBrowserLifecycleHandlers(instanceInfo);
            return instanceInfo;
        } catch (error) {
            console.error(`Fingerprint verification failed:`, error);

            try {
                await optimizeBrowserDisplay(page, {
                    width: 1280,
                    height: 850,
                    deviceScaleFactor: 1,
                    cssScale: 1,
                    fixHighDpi: true,
                    isHeadless: this.isHeadless
                });
            } catch (displayError) {
                console.warn(`Display optimization failed:`, displayError);
            }

            const isActuallyEdge = originalUserAgent.includes('Edg');
            const instanceInfo = {
                id: browserId,
                browser: browser,
                context: context,
                page: page,
                locked: false,
                isEdgeBrowser: isActuallyEdge,
                browserPath: browserPath,
                userDataDir: userDataDir,
                browserType: browserType,
            };
            this.attachBrowserLifecycleHandlers(instanceInfo);
            return instanceInfo;
        }
    }


    isTargetClosedError(error) {
        if (!error) return false;
        const message = String(error?.message || error);
        return message.includes('Target closed') ||
            message.includes('Session closed') ||
            message.includes('Most likely the page has been closed');
    }

    isBrowserConnected(browserOrInstance) {
        if (!browserOrInstance) {
            return false;
        }

        const context = browserOrInstance.context;
        if (context && typeof context.pages === 'function') {
            try {
                context.pages();
                return true;
            } catch (error) {
                return false;
            }
        }

        const browser = browserOrInstance.browser || browserOrInstance;
        if (browser && typeof browser.isConnected === 'function') {
            return browser.isConnected();
        }

        return false;
    }

    isBrowserInstanceConnected(browserInstance) {
        return this.isBrowserConnected(browserInstance);
    }

    attachBrowserLifecycleHandlers(browserInstance) {
        if (!browserInstance || browserInstance._lifecycleBound) {
            return;
        }
        browserInstance._lifecycleBound = true;
        try {
            browserInstance.context?.on('close', () => {
                console.warn(`[${browserInstance.id}] Browser context closed, instance will be rebuilt on next request`);
            });
            if (browserInstance.browser && typeof browserInstance.browser.on === 'function') {
                browserInstance.browser.on('disconnected', () => {
                    console.warn(`[${browserInstance.id}] Browser disconnected, instance will be rebuilt on next request`);
                });
            }
        } catch (error) {
            console.warn(`[${browserInstance.id}] Failed to bind lifecycle listener:`, error?.message || error);
        }
    }

    async recreatePage(browserInstance) {
        if (!browserInstance || !this.isBrowserInstanceConnected(browserInstance)) {
            throw new Error('Browser instance is unavailable, cannot recreate page');
        }
        if (!browserInstance.context) {
            throw new Error('Browser context is unavailable, cannot recreate page');
        }
        browserInstance.page = await browserInstance.context.newPage();
        browserInstance.fingerprint = await setupBrowserFingerprint(
            browserInstance.page,
            browserInstance.browserType || 'chrome'
        );
        try {
            await optimizeBrowserDisplay(browserInstance.page, {
                width: 1280,
                height: 850,
                deviceScaleFactor: 1,
                cssScale: 1,
                fixHighDpi: true,
                isHeadless: this.isHeadless
            });
        } catch (error) {
            console.warn(`[${browserInstance.id}] Display optimize failed after page recreation:`, error?.message || error);
        }
        return browserInstance;
    }

    async ensureBrowserInstanceReady(browserInstance) {
        if (!browserInstance) {
            throw new Error('Browser instance is empty');
        }

        if (!this.isBrowserInstanceConnected(browserInstance)) {
            console.warn(`[${browserInstance.id}] Browser disconnected, rebuilding instance...`);
            const relaunched = await this.launchSingleBrowser(
                browserInstance.id,
                browserInstance.userDataDir,
                browserInstance.browserPath
            );
            Object.assign(browserInstance, relaunched);
            return browserInstance;
        }

        if (!browserInstance.page || browserInstance.page.isClosed()) {
            console.warn(`[${browserInstance.id}] Page closed, recreating page...`);
            await this.recreatePage(browserInstance);
        }
        return browserInstance;
    }

    async getAvailableBrowser() {
        return await this.browserMutex.runExclusive(async () => {
            const totalBrowsers = this.browserInstances.length;

            for (let i = 0; i < totalBrowsers; i++) {
                const index = (this.browserIndex + i) % totalBrowsers;
                const browserInstance = this.browserInstances[index];

                if (!browserInstance.locked) {
                    browserInstance.locked = true;
                    try {
                        await this.ensureBrowserInstanceReady(browserInstance);
                        this.browserIndex = (index + 1) % totalBrowsers;
                        return browserInstance;
                    } catch (error) {
                        browserInstance.locked = false;
                        console.error(`[${browserInstance.id}] Browser recovery failed:`, error?.message || error);
                    }
                }
            }
            throw new Error("Current load is saturated. Please retry later.");
        });
    }

    async releaseBrowser(browserId) {
        await this.browserMutex.runExclusive(async () => {
            const browserInstance = this.browserInstances.find(b => b.id === browserId);
            if (browserInstance) {
                browserInstance.locked = false;
            }
        });
    }

    async getAvailableSessions() {
        const allSessionsLocked = this.usernameList.every(username => this.sessions[username].locked);
        if (allSessionsLocked) {
            throw new Error("All sessions are saturated. No account is available now.");
        }

        // 鏀堕泦鎵€鏈塿alid && !locked && (涓嶅湪鍐峰嵈鏈?
        let candidates = [];
        for (const username of this.usernameList) {
            const session = this.sessions[username];
            // 濡傛灉娌¤閿?骞朵笖 session.valid
            if (session.valid && !session.locked) {
                if (this.provider.enableRequestLimit && this.isInCooldown(username)) {
                    // console.log(`璐﹀彿 ${username} 澶勪簬 24 灏忔椂鍐峰嵈涓紝璺宠繃`);
                    continue;
                }
                candidates.push(username);
            }
        }

        if (candidates.length === 0) {
            throw new Error("No available session.");
        }

        // 闅忔満娲楃墝
        shuffleArray(candidates);

        // 鍔犳潈鎶界
        let weightSum = 0;
        for (const uname of candidates) {
            weightSum += this.sessions[uname].weight;
        }

        // 鐢熸垚闅忔満
        const randValue = Math.floor(Math.random() * weightSum) + 1;

        // 閬嶅巻骞舵墸鍑?
        let cumulative = 0;
        let selectedUsername = null;
        for (const uname of candidates) {
            cumulative += this.sessions[uname].weight;
            if (randValue <= cumulative) {
                selectedUsername = uname;
                break;
            }
        }

        if (!selectedUsername) {
            selectedUsername = candidates[0];
        }

        const selectedSession = this.sessions[selectedUsername];

        // 鍐嶅皾璇曢攣瀹氳处鍙?
        const result = await selectedSession.mutex.runExclusive(async () => {
            if (selectedSession.locked) {
                return null;
            }

            // 鍒ゆ柇鏄惁鍙敤
            if (selectedSession.modeStatus && selectedSession.modeStatus[selectedSession.currentMode]) {
                // 閿佸畾
                selectedSession.locked = true;
                selectedSession.requestCount++;

                // 鑾峰彇鍙敤娴忚鍣?
                let browserInstance;
                try {
                    browserInstance = await this.getAvailableBrowser();
                } catch (error) {
                    selectedSession.locked = false;
                    selectedSession.requestCount = Math.max(0, selectedSession.requestCount - 1);
                    throw error;
                }

                // 鍚姩鑷姩瑙ｉ攣璁℃椂鍣?
                if (SESSION_LOCK_TIMEOUT > 0) {
                    this.startAutoUnlockTimer(selectedUsername, browserInstance.id);
                }

                return {
                    selectedUsername,
                    modeSwitched: false,
                    browserInstance
                };
            } else if (
                this.isCustomModeEnabled &&
                this.isRotationEnabled &&
                this.provider &&
                typeof this.provider.switchMode === 'function'
            ) {
                console.warn(`Trying to switch mode for account ${selectedUsername}...`);
                this.provider.switchMode(selectedSession);
                selectedSession.rotationEnabled = false;

                if (selectedSession.modeStatus && selectedSession.modeStatus[selectedSession.currentMode]) {
                    selectedSession.locked = true;
                    selectedSession.requestCount++;
                    let browserInstance;
                    try {
                        browserInstance = await this.getAvailableBrowser();
                    } catch (error) {
                        selectedSession.locked = false;
                        selectedSession.requestCount = Math.max(0, selectedSession.requestCount - 1);
                        throw error;
                    }

                    if (SESSION_LOCK_TIMEOUT > 0) {
                        this.startAutoUnlockTimer(selectedUsername, browserInstance.id);
                    }

                    return {
                        selectedUsername,
                        modeSwitched: true,
                        browserInstance
                    };
                }
            }

            return null;
        });

        if (result) {
            return result;
        } else {
            throw new Error("Session was occupied or mode is unavailable.");
        }
    }

    startAutoUnlockTimer(username, browserId) {
        // 娓呴櫎鍙兘娈嬬暀璁℃椂鍣?
        if (this.sessionAutoUnlockTimers[username]) {
            clearTimeout(this.sessionAutoUnlockTimers[username]);
        }
        const lockDurationMs = SESSION_LOCK_TIMEOUT * 1000;

        this.sessionAutoUnlockTimers[username] = setTimeout(async () => {
            try {
                const session = this.sessions[username];
                if (session && session.locked) {
                    console.warn(`Session "${username}" auto-unlocked after ${SESSION_LOCK_TIMEOUT}s`);
                    await session.mutex.runExclusive(async () => {
                        session.locked = false;
                    });
                }

                if (browserId) {
                    await this.releaseBrowser(browserId);
                }
            } catch (error) {
                console.error(`Failed to auto-unlock session "${username}":`, error);
            } finally {
                delete this.sessionAutoUnlockTimers[username];
            }
        }, lockDurationMs);
    }

    async releaseSession(username, browserId) {
        const session = this.sessions[username];
        if (session) {
            await session.mutex.runExclusive(() => {
                session.locked = false;
            });
        }
        // 瀛樺湪鐩稿簲璁℃椂鍣ㄦ竻闄?
        if (this.sessionAutoUnlockTimers[username]) {
            clearTimeout(this.sessionAutoUnlockTimers[username]);
            delete this.sessionAutoUnlockTimers[username];
        }

        if (browserId) {
            await this.releaseBrowser(browserId);
        }
    }

    // 杩斿洖浼氳瘽
    // getBrowserInstances() {
    //     return this.browserInstances;
    // }

    // 绛栫暐
    async getSessionByStrategy(strategy = 'round_robin') {
        if (strategy === 'round_robin') {
            return await this.getAvailableSessions();
        }
        throw new Error(`Strategy not implemented: ${strategy}`);
    }
}

/**
 * Fisher鈥揧ates 娲楃墝
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

export default SessionManager;

